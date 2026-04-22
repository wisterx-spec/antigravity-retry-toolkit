#!/usr/bin/env node

const http = require("http");
const https = require("https");

const port = Number(process.env.ANTIGRAVITY_PROXY_PORT || "38475");
const targetHost = process.env.ANTIGRAVITY_PROXY_TARGET_HOST || "daily-cloudcode-pa.googleapis.com";
const maxAttempts = Number(process.env.ANTIGRAVITY_PROXY_MAX_ATTEMPTS || "15");
const baseDelayMs = Number(process.env.ANTIGRAVITY_PROXY_BASE_DELAY_MS || "3000");
const maxDelayMs = Number(process.env.ANTIGRAVITY_PROXY_MAX_DELAY_MS || "5000");
const retryableStatuses = new Set([429, 500, 502, 503, 504]);
const statusHoldMs = Number(process.env.ANTIGRAVITY_PROXY_STATUS_HOLD_MS || "5000");
const quotaStatusHoldMs = Number(process.env.ANTIGRAVITY_PROXY_QUOTA_STATUS_HOLD_MS || "20000");
const eventHistoryLimit = Number(process.env.ANTIGRAVITY_PROXY_EVENT_HISTORY_LIMIT || "25");
const debugRequestIdentifiers = process.env.ANTIGRAVITY_PROXY_DEBUG_REQUEST_IDENTIFIERS === "1";
const requestIdentifierCandidates = new Set(["cascadeid", "conversationid", "sessionid", "requestid", "threadid", "chatid"]);

let nextEventId = 1;

function createStatusSnapshot(cascadeId = "") {
  return {
    active: false,
    label: "",
    attempt: 0,
    maxAttempts,
    path: "",
    model: "",
    cascadeId,
    statusCode: 0,
    message: "",
    updatedAt: 0,
    events: [],
  };
}

const runtimeStatus = {
  ...createStatusSnapshot(),
  activeCascadeId: "",
  cascades: {},
};

const cascadeStatuses = new Map();
const cascadeClearTimers = new Map();

function log(message) {
  const now = new Date().toISOString();
  process.stdout.write(`${now} ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cloneStatusSnapshot(status) {
  return {
    ...status,
    events: [...status.events],
  };
}

function syncCascadeStatuses() {
  runtimeStatus.cascades = Object.fromEntries(
    [...cascadeStatuses.entries()].map(([cascadeId, status]) => [cascadeId, cloneStatusSnapshot(status)]),
  );
}

function setRuntimeStatus(next) {
  Object.assign(runtimeStatus, next, {
    updatedAt: Date.now(),
    activeCascadeId: next.cascadeId || "",
  });
}

function pushEvent(event) {
  const nextEvent = {
    id: nextEventId++,
    at: Date.now(),
    ...event,
  };

  runtimeStatus.events = [...runtimeStatus.events, nextEvent].slice(-eventHistoryLimit);
  runtimeStatus.updatedAt = Date.now();

  if (event.cascadeId) {
    const cascadeStatus = cascadeStatuses.get(event.cascadeId);
    if (cascadeStatus) {
      cascadeStatus.events = [...cascadeStatus.events, nextEvent].slice(-eventHistoryLimit);
      cascadeStatus.updatedAt = nextEvent.at;
      syncCascadeStatuses();
    }
  }
}

function setCascadeStatus(cascadeId, next) {
  if (!cascadeId) {
    return;
  }

  const current = cascadeStatuses.get(cascadeId) || createStatusSnapshot(cascadeId);
  const updated = {
    ...current,
    ...next,
    cascadeId,
    updatedAt: Date.now(),
  };
  cascadeStatuses.set(cascadeId, updated);
  syncCascadeStatuses();
}

function clearRuntimeStatus() {
  Object.assign(runtimeStatus, createStatusSnapshot(), {
    events: runtimeStatus.events,
    cascades: runtimeStatus.cascades,
    activeCascadeId: "",
    updatedAt: Date.now(),
  });
}

function clearCascadeStatus(cascadeId) {
  if (!cascadeId) {
    return;
  }

  if (cascadeStatuses.delete(cascadeId)) {
    syncCascadeStatuses();
  }
}

function scheduleCascadeClear(cascadeId, expectedPath, expectedLabel, expectedMessage, delayMs) {
  if (!cascadeId) {
    return;
  }

  const existingTimer = cascadeClearTimers.get(cascadeId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    cascadeClearTimers.delete(cascadeId);
    const cascadeStatus = cascadeStatuses.get(cascadeId);
    if (
      cascadeStatus &&
      !cascadeStatus.active &&
      cascadeStatus.path === expectedPath &&
      cascadeStatus.label === expectedLabel &&
      cascadeStatus.message === expectedMessage
    ) {
      clearCascadeStatus(cascadeId);
    }
  }, delayMs);

  cascadeClearTimers.set(cascadeId, timer);
}

function scheduleRuntimeClear(cascadeId, expectedPath, expectedLabel, expectedMessage, delayMs) {
  setTimeout(() => {
    if (
      !runtimeStatus.active &&
      runtimeStatus.path === expectedPath &&
      runtimeStatus.label === expectedLabel &&
      runtimeStatus.message === expectedMessage &&
      runtimeStatus.cascadeId === cascadeId
    ) {
      clearRuntimeStatus();
    }
  }, delayMs);
}

function beginRetryStatus(requestInfo, attempt, statusCode, message) {
  const next = {
    active: true,
    label: String(attempt),
    attempt,
    path: requestInfo.path,
    model: requestInfo.model,
    cascadeId: requestInfo.cascadeId,
    statusCode,
    message,
  };
  setRuntimeStatus(next);
  setCascadeStatus(requestInfo.cascadeId, next);
  pushEvent({
    type: "retry",
    path: requestInfo.path,
    model: requestInfo.model,
    cascadeId: requestInfo.cascadeId,
    attempt,
    statusCode,
    message,
  });
}

function markRecovered(requestInfo) {
  const next = {
    active: false,
    label: "",
    attempt: 0,
    path: requestInfo.path,
    model: requestInfo.model,
    cascadeId: requestInfo.cascadeId,
    statusCode: 200,
    message: "Recovered",
  };
  setRuntimeStatus(next);
  setCascadeStatus(requestInfo.cascadeId, next);
  pushEvent({
    type: "recovered",
    path: requestInfo.path,
    model: requestInfo.model,
    cascadeId: requestInfo.cascadeId,
    attempt: 0,
    statusCode: 200,
    message: "Recovered",
  });
  scheduleRuntimeClear(requestInfo.cascadeId, requestInfo.path, "", "Recovered", statusHoldMs);
  scheduleCascadeClear(requestInfo.cascadeId, requestInfo.path, "", "Recovered", statusHoldMs);
}

function showQuotaExhausted(requestInfo) {
  const next = {
    active: false,
    label: "Quota Exceeded",
    attempt: 0,
    path: requestInfo.path,
    model: requestInfo.model,
    cascadeId: requestInfo.cascadeId,
    statusCode: 429,
    message: "Quota Exceeded",
  };
  setRuntimeStatus(next);
  setCascadeStatus(requestInfo.cascadeId, next);
  pushEvent({
    type: "quota",
    path: requestInfo.path,
    model: requestInfo.model,
    cascadeId: requestInfo.cascadeId,
    attempt: 0,
    statusCode: 429,
    message: "Quota Exceeded",
  });
  scheduleRuntimeClear(requestInfo.cascadeId, requestInfo.path, "Quota Exceeded", "Quota Exceeded", quotaStatusHoldMs);
  scheduleCascadeClear(requestInfo.cascadeId, requestInfo.path, "Quota Exceeded", "Quota Exceeded", quotaStatusHoldMs);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readResponseBody(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    res.on("end", () => resolve(Buffer.concat(chunks)));
    res.on("error", reject);
  });
}

function retryDelayMs(attempt, headers, bodyText) {
  const retryAfter = headers["retry-after"];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.min(Math.max(seconds * 1000, baseDelayMs), maxDelayMs);
    }
  }

  const bodyMatch = bodyText.match(/reset after (\d+)s/i);
  if (bodyMatch) {
    const seconds = Number(bodyMatch[1]);
    if (Number.isFinite(seconds)) {
      return Math.min(Math.max(seconds * 1000 + 250, baseDelayMs), maxDelayMs);
    }
  }

  return Math.min(baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)), maxDelayMs);
}

function isQuotaExhausted(statusCode, bodyText) {
  if (statusCode !== 429) {
    return false;
  }

  return /quota will reset after/i.test(bodyText) || /exhausted your capacity/i.test(bodyText);
}

function extractModelFromValue(value) {
  if (!value || typeof value !== "object") {
    return "";
  }

  if (typeof value.model === "string" && value.model.trim()) {
    return value.model.trim();
  }

  if (typeof value.modelName === "string" && value.modelName.trim()) {
    return value.modelName.trim();
  }

  if (typeof value.requestedModel === "string" && value.requestedModel.trim()) {
    return value.requestedModel.trim();
  }

  if (value.requestedModel && typeof value.requestedModel === "object") {
    const nestedRequestedModel = extractModelFromValue(value.requestedModel);
    if (nestedRequestedModel) {
      return nestedRequestedModel;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedModel = extractModelFromValue(item);
      if (nestedModel) {
        return nestedModel;
      }
    }
    return "";
  }

  for (const nestedValue of Object.values(value)) {
    const nestedModel = extractModelFromValue(nestedValue);
    if (nestedModel) {
      return nestedModel;
    }
  }

  return "";
}

function collectRequestIdentifiers(value, results, path = "", depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) {
    return;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectRequestIdentifiers(value[index], results, `${path}[${index}]`, depth + 1);
    }
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (requestIdentifierCandidates.has(normalizedKey)) {
      if (typeof nestedValue === "string" && nestedValue.trim()) {
        results[normalizedKey] = results[normalizedKey] || { path: nextPath, value: nestedValue.trim() };
      } else if (typeof nestedValue === "number" && Number.isFinite(nestedValue)) {
        results[normalizedKey] = results[normalizedKey] || { path: nextPath, value: String(nestedValue) };
      }
    }
    collectRequestIdentifiers(nestedValue, results, nextPath, depth + 1);
  }
}

function extractRequestIdentifiers(value) {
  const identifiers = {};
  collectRequestIdentifiers(value, identifiers);
  return identifiers;
}

function getIdentifierValue(identifiers, key) {
  return identifiers[key]?.value || "";
}

function extractCascadeId(identifiers) {
  const explicitCascadeId = getIdentifierValue(identifiers, "cascadeid");
  if (explicitCascadeId) {
    return explicitCascadeId;
  }

  const requestId = getIdentifierValue(identifiers, "requestid");
  const requestIdMatch = requestId.match(/^agent\/([0-9a-f-]{36})\//i);
  if (requestIdMatch) {
    return requestIdMatch[1];
  }

  return "";
}

function truncateForLog(value, maxLength = 80) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function extractRequestInfo(req, body) {
  const info = {
    path: req.url,
    model: "",
    identifiers: {},
    cascadeId: "",
  };

  if (!body || body.length === 0) {
    return info;
  }

  const text = body.toString("utf8");
  try {
    const parsed = JSON.parse(text);
    info.model = extractModelFromValue(parsed);
    info.identifiers = extractRequestIdentifiers(parsed);
    info.cascadeId = extractCascadeId(info.identifiers);
  } catch {
    info.model = "";
  }

  return info;
}

function formatRequestContext(requestInfo) {
  const parts = [` path=${requestInfo.path}`];
  if (requestInfo.model) {
    parts.push(` model=${requestInfo.model}`);
  }
  if (requestInfo.cascadeId) {
    parts.push(` cascadeId=${requestInfo.cascadeId}`);
  }
  const identifiers = Object.values(requestInfo.identifiers || {});
  if (debugRequestIdentifiers && identifiers.length) {
    const formattedIdentifiers = identifiers
      .map(({ path, value }) => `${path}=${truncateForLog(value)}`)
      .join(",");
    parts.push(` ids=${formattedIdentifiers}`);
  }
  return parts.join("");
}

function singleForwardRequest(req, body) {
  return new Promise((resolve, reject) => {
    const headers = { ...req.headers, host: targetHost };
    if (body.length > 0) {
      headers["content-length"] = String(body.length);
    } else {
      delete headers["content-length"];
    }

    const upstreamReq = https.request(
      {
        protocol: "https:",
        hostname: targetHost,
        port: 443,
        method: req.method,
        path: req.url,
        headers,
      },
      (upstreamRes) => resolve({ upstreamRes }),
    );

    upstreamReq.on("error", reject);

    if (body.length > 0) {
      upstreamReq.write(body);
    }
    upstreamReq.end();
  });
}

async function forwardRequest(req, body, requestInfo) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { upstreamRes } = await singleForwardRequest(req, body);
      const statusCode = upstreamRes.statusCode || 0;
      if (!retryableStatuses.has(statusCode)) {
        return { upstreamRes };
      }

      const responseBody = await readResponseBody(upstreamRes);
      const bodyText = responseBody.toString("utf8");

      if (isQuotaExhausted(statusCode, bodyText)) {
        showQuotaExhausted(requestInfo);
        log(`passthrough quota exhaustion status=${statusCode} attempt=${attempt}/${maxAttempts}${formatRequestContext(requestInfo)}`);
        return { upstreamRes, responseBody };
      }

      if (attempt >= maxAttempts) {
        return { upstreamRes, responseBody };
      }

      const delay = retryDelayMs(attempt, upstreamRes.headers, bodyText);
      beginRetryStatus(requestInfo, attempt, statusCode, `HTTP ${statusCode}`);
      log(`retryable upstream status=${statusCode} attempt=${attempt}/${maxAttempts} delay_ms=${delay}${formatRequestContext(requestInfo)}`);
      await sleep(delay);
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)), maxDelayMs);
      beginRetryStatus(requestInfo, attempt, 0, error.message);
      log(`upstream error attempt=${attempt}/${maxAttempts} delay_ms=${delay}${formatRequestContext(requestInfo)} error=${error.message}`);
      await sleep(delay);
    }
  }

  throw new Error("retry loop exited unexpectedly");
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/__health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, targetHost }));
    return;
  }

  if (req.url === "/__status") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(runtimeStatus));
    return;
  }

  let requestInfo = {
    path: req.url,
    model: "",
    identifiers: {},
    cascadeId: "",
  };

  try {
    const body = await readBody(req);
    requestInfo = extractRequestInfo(req, body);
    log(`request method=${req.method}${formatRequestContext(requestInfo)}`);
    const { upstreamRes, responseBody } = await forwardRequest(req, body, requestInfo);
    const headers = { ...upstreamRes.headers };
    delete headers["content-length"];
    if (runtimeStatus.active && runtimeStatus.path === req.url && runtimeStatus.cascadeId === requestInfo.cascadeId) {
      markRecovered(requestInfo);
    }
    log(`response status=${upstreamRes.statusCode}${formatRequestContext(requestInfo)}`);
    res.writeHead(upstreamRes.statusCode || 502, headers);
    if (responseBody) {
      res.end(responseBody);
    } else {
      upstreamRes.pipe(res);
    }
  } catch (error) {
    if (runtimeStatus.path === req.url && runtimeStatus.cascadeId === requestInfo.cascadeId) {
      const failureStatus = {
        active: false,
        label: "Retry Failed",
        attempt: 0,
        path: req.url,
        model: requestInfo.model,
        cascadeId: requestInfo.cascadeId,
        statusCode: 502,
        message: error.message,
      };
      setRuntimeStatus(failureStatus);
      setCascadeStatus(requestInfo.cascadeId, failureStatus);
      pushEvent({
        type: "failure",
        path: req.url,
        model: requestInfo.model,
        cascadeId: requestInfo.cascadeId,
        attempt: 0,
        statusCode: 502,
        message: error.message,
      });
    }
    log(`proxy failure path=${req.url} error=${error.message}`);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "proxy_failure", message: error.message }));
  }
});

server.on("clientError", (error, socket) => {
  log(`client error ${error.message}`);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(port, "127.0.0.1", () => {
  log(`antigravity cloud code proxy listening on http://127.0.0.1:${port}`);
});
