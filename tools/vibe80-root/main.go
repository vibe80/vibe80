package main

import (
  "errors"
  "fmt"
  "os"
  "os/exec"
  "path/filepath"
  "regexp"
  "strconv"
  "strings"
)

const (
  workspaceSessionsDirName = "sessions"
)

var workspaceIDPattern = regexp.MustCompile(`^w[0-9a-f]{24}$`)

func main() {
  if len(os.Args) < 2 {
    fail("missing command")
  }

  switch os.Args[1] {
  case "create-workspace":
    workspaceID := parseFlagValue("--workspace-id")
    uid := parseFlagIntValue("--uid")
    gid := parseFlagIntValue("--gid")
    ensureWorkspace(workspaceID, uid, gid)
  default:
    fail("unknown command")
  }
}

func parseFlagValue(flag string) string {
  for i := 2; i < len(os.Args); i++ {
    if os.Args[i] == flag && i+1 < len(os.Args) {
      return os.Args[i+1]
    }
  }
  fail("missing required flag: " + flag)
  return ""
}

func parseFlagIntValue(flag string) int {
  value := parseFlagValue(flag)
  parsed, err := strconv.Atoi(strings.TrimSpace(value))
  if err != nil {
    fail("invalid value for " + flag)
  }
  return parsed
}

func ensureWorkspace(workspaceID string, desiredUID, desiredGID int) {
  if !workspaceIDPattern.MatchString(workspaceID) {
    fail("invalid workspace-id")
  }
  if desiredUID < 1 || desiredGID < 1 {
    fail("uid/gid must be >= 1")
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
  rootDir := filepath.Join(workspaceRootBase, workspaceID)
  sessionsDir := filepath.Join(rootDir, workspaceSessionsDirName)

  if err := ensureUser(workspaceID, homeDir, desiredUID, desiredGID); err != nil {
    fail(err.Error())
  }

  if err := ensureDir(homeDir, 02750, desiredUID, desiredGID); err != nil {
    fail(err.Error())
  }
  if err := ensureFile(filepath.Join(homeDir, ".profile"), 0640, desiredUID, desiredGID); err != nil {
    fail(err.Error())
  }
  if err := ensureFile(filepath.Join(homeDir, ".bashrc"), 0640, desiredUID, desiredGID); err != nil {
    fail(err.Error())
  }
  if err := ensureDir(rootDir, 02750, desiredUID, desiredGID); err != nil {
    fail(err.Error())
  }
  if err := ensureDir(sessionsDir, 02750, desiredUID, desiredGID); err != nil {
    fail(err.Error())
  }
}

func ensureUser(workspaceID, homeDir string, uid, gid int) error {
  existingUID, existingGID, found, err := lookupPasswdByName(workspaceID)
  if err != nil {
    return err
  }
  if found {
    if uid >= 0 && existingUID != uid {
      return fmt.Errorf("existing user uid mismatch for %s", workspaceID)
    }
    if gid >= 0 && existingGID != gid {
      return fmt.Errorf("existing user gid mismatch for %s", workspaceID)
    }
    return nil
  }
  args := []string{"-m", "-d", homeDir, "-s", "/bin/bash"}
  if uid >= 0 {
    args = append(args, "-u", strconv.Itoa(uid))
  }
  if gid >= 0 {
    ensureGroup(workspaceID, gid)
    args = append(args, "-g", strconv.Itoa(gid))
  }
  args = append(args, workspaceID)
  cmd := exec.Command("useradd", args...)
  output, err := cmd.CombinedOutput()
  if err != nil {
    return fmt.Errorf("useradd failed: %s", strings.TrimSpace(string(output)))
  }
  return nil
}

func lookupPasswdByName(workspaceID string) (int, int, bool, error) {
  output, err := exec.Command("getent", "passwd", workspaceID).Output()
  if err != nil {
    if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() != 0 {
      return 0, 0, false, nil
    }
    return 0, 0, false, errors.New("unable to resolve workspace ids")
  }
  line := strings.TrimSpace(string(output))
  if line == "" {
    return 0, 0, false, nil
  }
  fields := strings.Split(line, ":")
  if len(fields) < 4 {
    return 0, 0, false, errors.New("invalid passwd entry")
  }
  uid, err := strconv.Atoi(fields[2])
  if err != nil {
    return 0, 0, false, errors.New("invalid uid")
  }
  gid, err := strconv.Atoi(fields[3])
  if err != nil {
    return 0, 0, false, errors.New("invalid gid")
  }
  return uid, gid, true, nil
}

func ensureDir(path string, mode os.FileMode, uid, gid int) error {
  if err := os.MkdirAll(path, mode); err != nil {
    return fmt.Errorf("mkdir failed: %s", err)
  }
  if err := os.Chmod(path, mode); err != nil {
    return fmt.Errorf("chmod failed: %s", err)
  }
  if err := os.Chown(path, uid, gid); err != nil {
    return fmt.Errorf("chown failed: %s", err)
  }
  return nil
}

func ensureFile(path string, mode os.FileMode, uid, gid int) error {
  file, err := os.OpenFile(path, os.O_RDONLY|os.O_CREATE, mode)
  if err != nil {
    return fmt.Errorf("touch failed: %s", err)
  }
  if err := file.Close(); err != nil {
    return fmt.Errorf("close failed: %s", err)
  }
  if err := os.Chown(path, uid, gid); err != nil {
    return fmt.Errorf("chown failed: %s", err)
  }
  if err := os.Chmod(path, mode); err != nil {
    return fmt.Errorf("chmod failed: %s", err)
  }
  return nil
}

func ensureGroup(name string, gid int) {
  if _, err := exec.Command("getent", "group", strconv.Itoa(gid)).Output(); err == nil {
    return
  }
  _ = exec.Command("groupadd", "-g", strconv.Itoa(gid), name).Run()
}

func fail(message string) {
  fmt.Fprintln(os.Stderr, message)
  os.Exit(1)
}
