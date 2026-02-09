package main

import (
  "encoding/json"
  "errors"
  "fmt"
  "os"
  "os/exec"
  "os/signal"
  "path/filepath"
  "regexp"
  "strconv"
  "strings"
  "syscall"

  landlock "github.com/landlock-lsm/go-landlock/landlock"
  seccomp "github.com/seccomp/libseccomp-golang"
)

var workspaceIDPattern = regexp.MustCompile(`^w[0-9a-f]{24}$`)
const workspaceMetadataDirName = "metadata"
const workspaceConfigName = "workspace.json"

var allowedCommands = map[string]struct{}{
  "/usr/bin/git":        {},
  "/usr/bin/ssh-keyscan": {},
  "/bin/mkdir":          {},
  "/bin/chmod":          {},
  "/bin/cat":            {},
  "/bin/rm":             {},
  "/bin/ls":             {},
  "/usr/bin/stat":       {},
  "/usr/bin/head":       {},
  "/usr/bin/find":       {},
  "/usr/bin/tee":        {},
  "/usr/local/bin/codex": {},
  "/usr/local/bin/claude": {},
  "/usr/bin/claude":     {},
  "/bin/bash":           {},
  "/usr/bin/bash":       {},
  "/bin/sh":             {},
  "/usr/bin/sh":         {},
  "/usr/bin/env":        {},
  "/usr/bin/id":         {},
}

var allowedEnvKeys = map[string]struct{}{
  "GIT_SSH_COMMAND":    {},
  "GIT_CONFIG_GLOBAL":  {},
  "GIT_TERMINAL_PROMPT": {},
  "TERM":               {},
  "TMPDIR":             {},
}

func main() {
  args := os.Args[1:]
  workspaceID := ""
  cwd := ""
  envPairs := []string{}
  command := ""
  commandArgs := []string{}
  allowRO := []string{}
  allowRW := []string{}
  allowROFiles := []string{}
  allowRWFiles := []string{}
  netMode := ""
  seccompMode := ""

  for i := 0; i < len(args); i++ {
    arg := args[i]
    switch arg {
    case "--workspace-id":
      if i+1 >= len(args) {
        fail("missing workspace-id value")
      }
      workspaceID = args[i+1]
      i++
    case "--cwd":
      if i+1 >= len(args) {
        fail("missing cwd value")
      }
      cwd = args[i+1]
      i++
    case "--env":
      if i+1 >= len(args) {
        fail("missing env value")
      }
      envPairs = append(envPairs, args[i+1])
      i++
    case "--allow-ro":
      if i+1 >= len(args) {
        fail("missing allow-ro value")
      }
      allowRO = append(allowRO, splitList(args[i+1])...)
      i++
    case "--allow-rw":
      if i+1 >= len(args) {
        fail("missing allow-rw value")
      }
      allowRW = append(allowRW, splitList(args[i+1])...)
      i++
    case "--allow-ro-file":
      if i+1 >= len(args) {
        fail("missing allow-ro-file value")
      }
      allowROFiles = append(allowROFiles, splitList(args[i+1])...)
      i++
    case "--allow-rw-file":
      if i+1 >= len(args) {
        fail("missing allow-rw-file value")
      }
      allowRWFiles = append(allowRWFiles, splitList(args[i+1])...)
      i++
    case "--net":
      if i+1 >= len(args) {
        fail("missing net value")
      }
      netMode = strings.TrimSpace(args[i+1])
      i++
    case "--seccomp":
      if i+1 >= len(args) {
        fail("missing seccomp value")
      }
      seccompMode = strings.TrimSpace(args[i+1])
      i++
    case "--":
      if i+1 >= len(args) {
        fail("missing command")
      }
      command = args[i+1]
      commandArgs = args[i+2:]
      i = len(args)
    default:
      // ignore unknown flags to keep interface explicit
    }
  }

  if !workspaceIDPattern.MatchString(workspaceID) {
    fail("invalid workspace-id")
  }
  if command == "" {
    fail("missing command")
  }

  os.Setenv("PATH", "/usr/local/bin:/usr/bin:/bin")

  resolved, err := resolveCommand(command)
  if err != nil {
    fail(err.Error())
  }

  uid, gid, err := lookupIDs(workspaceID)
  if err != nil {
    fail(err.Error())
  }

  homeBase := os.Getenv("WORKSPACE_HOME_BASE")
  if homeBase == "" {
    homeBase = "/home"
  }
  workspaceRootBase := os.Getenv("WORKSPACE_ROOT_DIRECTORY")
  if workspaceRootBase == "" {
    workspaceRootBase = "/workspaces"
  }
  homeDir := filepath.Join(homeBase, workspaceID)
  workspaceRootDir := filepath.Join(workspaceRootBase, workspaceID)

  if cwd != "" {
    resolvedCwd, err := filepath.Abs(cwd)
    if err != nil {
      fail("invalid cwd")
    }
    if !strings.HasPrefix(resolvedCwd, homeDir+string(os.PathSeparator)) &&
      resolvedCwd != homeDir &&
      !strings.HasPrefix(resolvedCwd, workspaceRootDir+string(os.PathSeparator)) &&
      resolvedCwd != workspaceRootDir {
      fail("cwd outside workspace")
    }
    cwd = resolvedCwd
  } else {
    cwd = homeDir
  }

  env := []string{
    "HOME=" + homeDir,
    "USER=" + workspaceID,
    "LOGNAME=" + workspaceID,
    "PATH=/usr/local/bin:/usr/bin:/bin",
  }

  for _, pair := range envPairs {
    key := strings.SplitN(pair, "=", 2)[0]
    if _, ok := allowedEnvKeys[key]; !ok {
      fail("disallowed env key: " + key)
    }
    env = append(env, pair)
  }

  cmd := exec.Command(resolved, commandArgs...)
  cmd.Env = env
  cmd.Dir = cwd
  cmd.Stdin = os.Stdin
  cmd.Stdout = os.Stdout
  cmd.Stderr = os.Stderr
  isTty := false
  if info, err := os.Stdin.Stat(); err == nil {
    isTty = (info.Mode() & os.ModeCharDevice) != 0
  }
  cmd.SysProcAttr = &syscall.SysProcAttr{
    Setpgid: !isTty,
    Credential: &syscall.Credential{Uid: uid, Gid: gid},
  }

  sigCh := make(chan os.Signal, 1)
  signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
  defer signal.Stop(sigCh)

  go func() {
    for sig := range sigCh {
      if cmd.Process == nil {
        continue
      }
      pgid, err := syscall.Getpgid(cmd.Process.Pid)
      if err != nil {
        _ = cmd.Process.Signal(sig)
        continue
      }
      _ = syscall.Kill(-pgid, sig.(syscall.Signal))
    }
  }()

  allowRO = uniqueStrings(allowRO)
  allowRW = uniqueStrings(allowRW)
  allowROFiles = uniqueStrings(allowROFiles)
  allowRWFiles = uniqueStrings(allowRWFiles)
  if len(allowRO) > 0 || len(allowRW) > 0 || len(allowROFiles) > 0 || len(allowRWFiles) > 0 {
    allowRO = ensureBaseReadPaths(allowRO, resolved)
  }
  if err := applyLandlock(allowRO, allowRW, allowROFiles, allowRWFiles, netMode); err != nil {
    fail("landlock failed: " + err.Error())
  }
  if err := applySeccomp(seccompMode, netMode); err != nil {
    fail("seccomp failed")
  }

  if err := cmd.Run(); err != nil {
    if exitErr := (*exec.ExitError)(nil); errors.As(err, &exitErr) {
      if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
        os.Exit(status.ExitStatus())
      }
    }
    fail("command failed")
  }
}

func resolveCommand(command string) (string, error) {
  resolved := command
  if !strings.HasPrefix(command, "/") {
    path, err := exec.LookPath(command)
    if err != nil {
      return "", errors.New("command not found")
    }
    resolved = path
  }
  if _, ok := allowedCommands[resolved]; !ok {
    return "", errors.New("command not allowed")
  }
  return resolved, nil
}

func lookupIDs(workspaceID string) (uint32, uint32, error) {
  uidRaw, uidErr := exec.Command("id", "-u", workspaceID).Output()
  gidRaw, gidErr := exec.Command("id", "-g", workspaceID).Output()
  if uidErr == nil && gidErr == nil {
    uid, err := parseUint(strings.TrimSpace(string(uidRaw)))
    if err != nil {
      return 0, 0, errors.New("invalid uid")
    }
    gid, err := parseUint(strings.TrimSpace(string(gidRaw)))
    if err != nil {
      return 0, 0, errors.New("invalid gid")
    }
    return uid, gid, nil
  }

  uid, gid, err := readIDsFromConfig(workspaceID)
  if err == nil {
    return uid, gid, nil
  }

  if uidErr != nil {
    return 0, 0, errors.New("unable to resolve uid")
  }
  if gidErr != nil {
    return 0, 0, errors.New("unable to resolve gid")
  }
  return 0, 0, errors.New("unable to resolve workspace ids")
}

func parseUint(value string) (uint32, error) {
  parsed, err := strconv.ParseUint(value, 10, 32)
  if err != nil {
    return 0, err
  }
  return uint32(parsed), nil
}

type workspaceConfig struct {
  UID int `json:"uid"`
  GID int `json:"gid"`
}

func readIDsFromConfig(workspaceID string) (uint32, uint32, error) {
  workspaceRootBase := os.Getenv("WORKSPACE_ROOT_DIRECTORY")
  if workspaceRootBase == "" {
    workspaceRootBase = "/workspaces"
  }
  configPath := filepath.Join(
    workspaceRootBase,
    workspaceID,
    workspaceMetadataDirName,
    workspaceConfigName,
  )
  raw, err := os.ReadFile(configPath)
  if err != nil {
    return 0, 0, err
  }
  var config workspaceConfig
  if err := json.Unmarshal(raw, &config); err != nil {
    return 0, 0, err
  }
  if config.UID < 0 || config.GID < 0 {
    return 0, 0, errors.New("invalid workspace ids")
  }
  return uint32(config.UID), uint32(config.GID), nil
}

func fail(message string) {
  fmt.Fprintln(os.Stderr, message)
  os.Exit(1)
}

func splitList(value string) []string {
  if value == "" {
    return nil
  }
  parts := strings.Split(value, ",")
  results := []string{}
  for _, part := range parts {
    cleaned := strings.TrimSpace(part)
    if cleaned == "" {
      continue
    }
    if !filepath.IsAbs(cleaned) {
      cleaned = filepath.Clean(cleaned)
    }
    results = append(results, cleaned)
  }
  return results
}

func uniqueStrings(values []string) []string {
  seen := map[string]struct{}{}
  result := []string{}
  for _, value := range values {
    if value == "" {
      continue
    }
    if _, ok := seen[value]; ok {
      continue
    }
    seen[value] = struct{}{}
    result = append(result, value)
  }
  return result
}

func ensureDirsExist(paths []string, label string) error {
  for _, target := range paths {
    if target == "" {
      continue
    }
    info, err := os.Stat(target)
    if err == nil {
      if !info.IsDir() {
        return fmt.Errorf("%s path is not a directory: %s", label, target)
      }
      continue
    }
    if !os.IsNotExist(err) {
      return fmt.Errorf("unable to stat %s path: %s (%v)", label, target, err)
    }
    if mkErr := os.MkdirAll(target, 0o700); mkErr != nil {
      return fmt.Errorf("failed to create %s path: %s (%v)", label, target, mkErr)
    }
  }
  return nil
}

func validatePathsExist(paths []string, label string) error {
  for _, target := range paths {
    if target == "" {
      continue
    }
    if _, err := os.Stat(target); err != nil {
      return fmt.Errorf("missing %s path: %s (%v)", label, target, err)
    }
  }
  return nil
}

func ensureBaseReadPaths(paths []string, resolvedCommand string) []string {
  base := []string{
    filepath.Dir(resolvedCommand),
    "/lib",
    "/lib64",
    "/usr/lib",
    "/usr/lib64",
    "/usr/local/bin",
    "/usr/local/lib",
  }
  return uniqueStrings(append(paths, base...))
}

func applyLandlock(allowRO, allowRW, allowROFiles, allowRWFiles []string, netMode string) error {
  if len(allowRO) == 0 && len(allowRW) == 0 && len(allowROFiles) == 0 && len(allowRWFiles) == 0 && netMode == "" {
    return nil
  }
  if err := ensureDirsExist(allowRO, "allow-ro"); err != nil {
    return err
  }
  if err := ensureDirsExist(allowRW, "allow-rw"); err != nil {
    return err
  }
  if err := validatePathsExist(allowROFiles, "allow-ro-file"); err != nil {
    return err
  }
  if err := validatePathsExist(allowRWFiles, "allow-rw-file"); err != nil {
    return err
  }
  ruleset := landlock.V6.BestEffort()
  if len(allowRO) > 0 || len(allowRW) > 0 || len(allowROFiles) > 0 || len(allowRWFiles) > 0 {
    if err := ruleset.RestrictPaths(
      landlock.RODirs(allowRO...),
      landlock.RWDirs(allowRW...),
      landlock.ROFiles(allowROFiles...),
      landlock.RWFiles(allowRWFiles...),
    ); err != nil {
      return err
    }
  }
  if netMode == "" {
    return nil
  }
  netRules, err := buildNetRules(netMode)
  if err != nil {
    return err
  }
  if err := ruleset.RestrictNet(netRules...); err != nil {
    return err
  }
  return nil
}

func buildNetRules(netMode string) ([]landlock.Rule, error) {
  if netMode == "" || netMode == "none" {
    return nil, nil
  }
  if strings.HasPrefix(netMode, "tcp:") {
    portsRaw := strings.TrimPrefix(netMode, "tcp:")
    ports, err := parsePorts(portsRaw)
    if err != nil {
      return nil, err
    }
    rules := []landlock.Rule{}
    for _, port := range ports {
      rules = append(rules, landlock.ConnectTCP(uint16(port)))
    }
    return rules, nil
  }
  if strings.HasPrefix(netMode, "bind:") {
    portsRaw := strings.TrimPrefix(netMode, "bind:")
    ports, err := parsePorts(portsRaw)
    if err != nil {
      return nil, err
    }
    rules := []landlock.Rule{}
    for _, port := range ports {
      rules = append(rules, landlock.BindTCP(uint16(port)))
    }
    return rules, nil
  }
  return nil, fmt.Errorf("unsupported net mode")
}

func parsePorts(raw string) ([]int, error) {
  if raw == "" {
    return nil, nil
  }
  parts := strings.Split(raw, ",")
  result := []int{}
  for _, part := range parts {
    trimmed := strings.TrimSpace(part)
    if trimmed == "" {
      continue
    }
    port, err := strconv.Atoi(trimmed)
    if err != nil || port <= 0 || port > 65535 {
      return nil, fmt.Errorf("invalid port")
    }
    result = append(result, port)
  }
  return result, nil
}

func applySeccomp(mode string, netMode string) error {
  if mode == "" || mode == "off" {
    return nil
  }
  filter, err := seccomp.NewFilter(seccomp.ActAllow)
  if err != nil {
    return err
  }
  if netMode == "none" {
    if err := blockNetworkSyscalls(filter); err != nil {
      return err
    }
  }
  return filter.Load()
}

func blockNetworkSyscalls(filter *seccomp.ScmpFilter) error {
  blocked := []string{
    "socket",
    "socketpair",
    "connect",
    "accept",
    "accept4",
    "bind",
    "listen",
    "sendto",
    "sendmsg",
    "sendmmsg",
    "recvfrom",
    "recvmsg",
    "recvmmsg",
    "shutdown",
    "getsockopt",
    "setsockopt",
    "getpeername",
    "getsockname",
  }
  action := seccomp.ActErrno.SetReturnCode(int16(syscall.EPERM))
  for _, name := range blocked {
    syscallID, err := seccomp.GetSyscallFromName(name)
    if err != nil {
      continue
    }
    if err := filter.AddRule(syscallID, action); err != nil {
      return err
    }
  }
  return nil
}
