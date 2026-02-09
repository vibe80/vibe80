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
)

const (
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
  workspaceRootBase := os.Getenv("WORKSPACE_ROOT_DIRECTORY")
  if workspaceRootBase == "" {
    workspaceRootBase = "/workspaces"
  }

  homeDir := filepath.Join(homeBase, workspaceID)
  rootDir := filepath.Join(workspaceRootBase, workspaceID)
  metadataDir := filepath.Join(rootDir, workspaceMetadataDirName)
  sessionsDir := filepath.Join(rootDir, workspaceSessionsDirName)

  desiredUID, desiredGID := readWorkspaceUIDGID(metadataDir)

  if err := ensureUser(workspaceID, homeDir, desiredUID, desiredGID); err != nil {
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
  ensureOwnership(filepath.Join(metadataDir, "workspace.json"), uid, gid)
  ensureOwnership(filepath.Join(metadataDir, "workspace.secret"), uid, gid)
}

func ensureUser(workspaceID, homeDir string, uid, gid int) error {
  _, err := exec.Command("id", "-u", workspaceID).Output()
  if err == nil {
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

func ensureOwnership(path string, uid, gid int) {
  if _, err := os.Stat(path); err != nil {
    return
  }
  _ = os.Chown(path, uid, gid)
}

func ensureGroup(name string, gid int) {
  if _, err := exec.Command("getent", "group", strconv.Itoa(gid)).Output(); err == nil {
    return
  }
  _ = exec.Command("groupadd", "-g", strconv.Itoa(gid), name).Run()
}

func readWorkspaceUIDGID(metadataDir string) (int, int) {
  configPath := filepath.Join(metadataDir, "workspace.json")
  raw, err := os.ReadFile(configPath)
  if err != nil {
    return -1, -1
  }
  var payload struct {
    UID int `json:"uid"`
    GID int `json:"gid"`
  }
  if err := json.Unmarshal(raw, &payload); err != nil {
    return -1, -1
  }
  if payload.UID <= 0 || payload.GID <= 0 {
    return -1, -1
  }
  return payload.UID, payload.GID
}

func fail(message string) {
  fmt.Fprintln(os.Stderr, message)
  os.Exit(1)
}
