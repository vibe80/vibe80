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
  workspaceRootName        = "vibe80_workspace"
  workspaceMetadataDirName = "metadata"
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
    ensureWorkspace(workspaceID)
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

func ensureWorkspace(workspaceID string) {
  if !workspaceIDPattern.MatchString(workspaceID) {
    fail("invalid workspace-id")
  }

  homeBase := os.Getenv("WORKSPACE_HOME_BASE")
  if homeBase == "" {
    homeBase = "/home"
  }

  homeDir := filepath.Join(homeBase, workspaceID)
  rootDir := filepath.Join(homeDir, workspaceRootName)
  metadataDir := filepath.Join(rootDir, workspaceMetadataDirName)
  sessionsDir := filepath.Join(rootDir, workspaceSessionsDirName)

  if err := ensureUser(workspaceID, homeDir); err != nil {
    fail(err.Error())
  }

  uid, gid, err := lookupIDs(workspaceID)
  if err != nil {
    fail(err.Error())
  }

  if err := ensureDir(homeDir, 02750, uid, gid); err != nil {
    fail(err.Error())
  }
  if err := ensureFile(filepath.Join(homeDir, ".profile"), 0640, uid, gid); err != nil {
    fail(err.Error())
  }
  if err := ensureFile(filepath.Join(homeDir, ".bashrc"), 0640, uid, gid); err != nil {
    fail(err.Error())
  }
  if err := ensureDir(rootDir, 02750, uid, gid); err != nil {
    fail(err.Error())
  }
  if err := ensureDir(metadataDir, 02750, uid, gid); err != nil {
    fail(err.Error())
  }
  if err := ensureDir(sessionsDir, 02750, uid, gid); err != nil {
    fail(err.Error())
  }
}

func ensureUser(workspaceID, homeDir string) error {
  _, err := exec.Command("id", "-u", workspaceID).Output()
  if err == nil {
    return nil
  }
  cmd := exec.Command("useradd", "-m", "-d", homeDir, "-s", "/bin/bash", workspaceID)
  output, err := cmd.CombinedOutput()
  if err != nil {
    return fmt.Errorf("useradd failed: %s", strings.TrimSpace(string(output)))
  }
  return nil
}

func lookupIDs(workspaceID string) (int, int, error) {
  uidRaw, err := exec.Command("id", "-u", workspaceID).Output()
  if err != nil {
    return 0, 0, errors.New("unable to resolve uid")
  }
  gidRaw, err := exec.Command("id", "-g", workspaceID).Output()
  if err != nil {
    return 0, 0, errors.New("unable to resolve gid")
  }
  uid, err := strconv.Atoi(strings.TrimSpace(string(uidRaw)))
  if err != nil {
    return 0, 0, errors.New("invalid uid")
  }
  gid, err := strconv.Atoi(strings.TrimSpace(string(gidRaw)))
  if err != nil {
    return 0, 0, errors.New("invalid gid")
  }
  return uid, gid, nil
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

func fail(message string) {
  fmt.Fprintln(os.Stderr, message)
  os.Exit(1)
}
