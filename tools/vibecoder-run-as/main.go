package main

import (
  "encoding/json"
  "errors"
  "fmt"
  "os"
  "os/exec"
  "path/filepath"
  "regexp"
  "strconv"
  "strings"
  "syscall"
)

var workspaceIDPattern = regexp.MustCompile(`^w[0-9a-f]{24}$`)
const workspaceRootName = "vibecoder_workspace"
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
}

func main() {
  args := os.Args[1:]
  workspaceID := ""
  cwd := ""
  envPairs := []string{}
  command := ""
  commandArgs := []string{}

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
  homeDir := filepath.Join(homeBase, workspaceID)

  if cwd != "" {
    resolvedCwd, err := filepath.Abs(cwd)
    if err != nil {
      fail("invalid cwd")
    }
    if !strings.HasPrefix(resolvedCwd, homeDir+string(os.PathSeparator)) && resolvedCwd != homeDir {
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
      fail("disallowed env key")
    }
    env = append(env, pair)
  }

  cmd := exec.Command(resolved, commandArgs...)
  cmd.Env = env
  cmd.Dir = cwd
  cmd.Stdin = os.Stdin
  cmd.Stdout = os.Stdout
  cmd.Stderr = os.Stderr
  cmd.SysProcAttr = &syscall.SysProcAttr{
    Credential: &syscall.Credential{Uid: uid, Gid: gid},
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
  homeBase := os.Getenv("WORKSPACE_HOME_BASE")
  if homeBase == "" {
    homeBase = "/home"
  }
  configPath := filepath.Join(
    homeBase,
    workspaceID,
    workspaceRootName,
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
