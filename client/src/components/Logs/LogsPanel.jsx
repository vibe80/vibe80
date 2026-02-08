import React from "react";

export default function LogsPanel({
  t,
  activePane,
  filteredRpcLogs,
  logFilter,
  setLogFilter,
  scopedRpcLogs,
  handleClearRpcLogs,
}) {
  return (
    <div className={`logs-panel ${activePane === "logs" ? "" : "is-hidden"}`}>
      <div className="logs-header">
        <div className="logs-title">{t("JSON-RPC")}</div>
        <div className="logs-controls">
          <div className="logs-count">
            {t("{{count}} item(s)", { count: filteredRpcLogs.length })}
          </div>
          <div className="logs-filters">
            <button
              type="button"
              className={`logs-filter ${logFilter === "all" ? "is-active" : ""}`}
              onClick={() => setLogFilter("all")}
            >
              {t("All")}
            </button>
            <button
              type="button"
              className={`logs-filter ${logFilter === "stdin" ? "is-active" : ""}`}
              onClick={() => setLogFilter("stdin")}
            >
              {t("Stdin")}
            </button>
            <button
              type="button"
              className={`logs-filter ${logFilter === "stdout" ? "is-active" : ""}`}
              onClick={() => setLogFilter("stdout")}
            >
              {t("Stdout")}
            </button>
          </div>
          <button
            type="button"
            className="logs-clear"
            onClick={handleClearRpcLogs}
            disabled={scopedRpcLogs.length === 0}
          >
            {t("Clear")}
          </button>
        </div>
      </div>
      {filteredRpcLogs.length === 0 ? (
        <div className="logs-empty">{t("No logs yet.")}</div>
      ) : (
        <div className="logs-list">
          {filteredRpcLogs.map((entry, index) => (
            <div
              key={`${entry.timestamp}-${index}`}
              className={`logs-item logs-${entry.direction}`}
            >
              <div className="logs-meta">
                <span className="logs-direction">
                  {entry.direction === "stdin" ? t("stdin") : t("stdout")}
                </span>
                <span className="logs-time">{entry.timeLabel}</span>
                {entry.payload?.method && (
                  <span className="logs-method">{entry.payload.method}</span>
                )}
              </div>
              <pre className="logs-payload">
                {JSON.stringify(entry.payload, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
