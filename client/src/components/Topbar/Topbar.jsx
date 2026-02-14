import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGear, faQrcode, faRightFromBracket } from "@fortawesome/free-solid-svg-icons";
import WorktreeTabs from "../WorktreeTabs.jsx";

export default function Topbar({
  t,
  brandLogo,
  allTabs,
  activeWorktreeId,
  handleSelectWorktree,
  createWorktree,
  openCloseConfirm,
  renameWorktreeHandler,
  llmProvider,
  availableProviders,
  branches,
  defaultBranch,
  currentBranch,
  branchLoading,
  branchError,
  defaultInternetAccess,
  defaultDenyGitCredentialsAccess,
  deploymentMode,
  loadBranches,
  providerModelState,
  loadProviderModels,
  connected,
  isMobileLayout,
  requestHandoffQr,
  attachmentSession,
  handoffLoading,
  handleOpenSettings,
  handleLeaveSession,
}) {
  return (
    <header className="header">
      <div className="topbar-left">
        <div className="topbar-spacer" />
        <div className="topbar-brand">
          <img className="brand-logo" src={brandLogo} alt="vibe80" />
        </div>
        <div className="topbar-tabs">
          <WorktreeTabs
            worktrees={allTabs}
            activeWorktreeId={activeWorktreeId}
            onSelect={handleSelectWorktree}
            onCreate={createWorktree}
            onClose={openCloseConfirm}
            onRename={renameWorktreeHandler}
            provider={llmProvider}
            providers={
              availableProviders.length ? availableProviders : [llmProvider]
            }
            branches={branches}
            defaultBranch={defaultBranch || currentBranch}
            branchLoading={branchLoading}
            branchError={branchError}
            defaultInternetAccess={defaultInternetAccess}
            defaultDenyGitCredentialsAccess={defaultDenyGitCredentialsAccess}
            deploymentMode={deploymentMode}
            onRefreshBranches={loadBranches}
            providerModelState={providerModelState}
            onRequestProviderModels={loadProviderModels}
            disabled={!connected}
            isMobile={isMobileLayout}
          />
        </div>
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className="icon-button"
          aria-label={t("Resume on mobile")}
          title={t("Resume on mobile")}
          onClick={requestHandoffQr}
          disabled={!attachmentSession?.sessionId || handoffLoading}
        >
          <FontAwesomeIcon icon={faQrcode} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Open settings")}
          onClick={handleOpenSettings}
        >
          <FontAwesomeIcon icon={faGear} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Leave session")}
          onClick={handleLeaveSession}
        >
          <FontAwesomeIcon icon={faRightFromBracket} />
        </button>
      </div>
    </header>
  );
}
