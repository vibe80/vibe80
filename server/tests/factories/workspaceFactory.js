export const makeWorkspaceCredentials = (overrides = {}) => ({
  workspaceId: "w0123456789abcdef01234567",
  workspaceSecret: "test-workspace-secret",
  ...overrides,
});

export const makeWorkspaceTokens = (overrides = {}) => ({
  workspaceToken: "workspace-token",
  refreshToken: "refresh-token",
  expiresIn: 3600,
  refreshExpiresIn: 2592000,
  ...overrides,
});
