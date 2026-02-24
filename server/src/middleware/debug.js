import { createDebugId, formatDebugPayload } from "../helpers.js";

const debugApiWsLog = /^(1|true|yes|on)$/i.test(
  process.env.VIBE80_DEBUG_API_WS_LOG || ""
);
const debugLogMaxBody = Number.isFinite(Number(process.env.VIBE80_DEBUG_API_WS_LOG_MAX_BODY))
  ? Number(process.env.VIBE80_DEBUG_API_WS_LOG_MAX_BODY)
  : 2000;

export { debugApiWsLog };

export const logDebug = (...args) => {
  if (!debugApiWsLog) return;
  console.log(...args);
};

export const attachWebSocketDebug = (socket, req, label) => {
  if (!debugApiWsLog) return;
  const connectionId = createDebugId();
  const url = req?.url || "";
  console.log("[debug] ws connected", { id: connectionId, label, url });

  socket.on("message", (data) => {
    console.log("[debug] ws recv", {
      id: connectionId,
      label,
      data: formatDebugPayload(data, debugLogMaxBody),
    });
  });

  const originalSend = socket.send.bind(socket);
  socket.send = (data, ...args) => {
    console.log("[debug] ws send", {
      id: connectionId,
      label,
      data: formatDebugPayload(data, debugLogMaxBody),
    });
    return originalSend(data, ...args);
  };

  socket.on("close", (code, reason) => {
    console.log("[debug] ws closed", {
      id: connectionId,
      label,
      code,
      reason: formatDebugPayload(reason, debugLogMaxBody),
    });
  });
};

export function debugMiddleware(req, res, next) {
  if (!debugApiWsLog || !req.path.startsWith("/api")) {
    next();
    return;
  }
  const requestId = createDebugId();
  const startedAt = Date.now();

  console.log("[debug] api request", {
    id: requestId,
    method: req.method,
    url: req.originalUrl,
    query: req.query,
    body: formatDebugPayload(req.body, debugLogMaxBody),
  });

  let responseBody;
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    responseBody = body;
    return originalSend(body);
  };

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const formattedBody =
      responseBody === undefined && res.statusCode !== 204
        ? "<streamed or empty>"
        : formatDebugPayload(responseBody, debugLogMaxBody);
    console.log("[debug] api response", {
      id: requestId,
      status: res.statusCode,
      durationMs,
      body: formattedBody,
    });
  });

  next();
}
