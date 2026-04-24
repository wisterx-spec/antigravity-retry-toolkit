#!/usr/bin/env node

const fs = require("fs/promises");
const dns = require("dns");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

const port = Number(process.env.ANTIGRAVITY_PROXY_PORT || "38475");
const targetHost = process.env.ANTIGRAVITY_PROXY_TARGET_HOST || "daily-cloudcode-pa.googleapis.com";
const maxAttempts = Number(process.env.ANTIGRAVITY_PROXY_MAX_ATTEMPTS || "15");
const baseDelayMs = Number(process.env.ANTIGRAVITY_PROXY_BASE_DELAY_MS || "3000");
const maxDelayMs = Number(process.env.ANTIGRAVITY_PROXY_MAX_DELAY_MS || "5000");
const retryableStatuses = new Set([429, 500, 502, 503, 504]);
const statusHoldMs = Number(process.env.ANTIGRAVITY_PROXY_STATUS_HOLD_MS || "5000");
const quotaStatusHoldMs = Number(process.env.ANTIGRAVITY_PROXY_QUOTA_STATUS_HOLD_MS || "20000");
const eventHistoryLimit = Number(process.env.ANTIGRAVITY_PROXY_EVENT_HISTORY_LIMIT || "25");
const attemptHistoryLimit = Number(process.env.ANTIGRAVITY_PROXY_ATTEMPT_HISTORY_LIMIT || "10");
const attemptLogPath =
  process.env.ANTIGRAVITY_PROXY_ATTEMPT_LOG_PATH || path.join(os.homedir(), "Library", "Logs", "antigravity-cloudcode-proxy-attempts.jsonl");
const streamFreshConnectEnabled = process.env.ANTIGRAVITY_PROXY_STREAM_FRESH_CONNECT !== "0";
const streamFreshConnectOnFirstAttempt = process.env.ANTIGRAVITY_PROXY_STREAM_FRESH_CONNECT_ON_FIRST_ATTEMPT === "1";
const streamBadAddressTtlMs = Number(process.env.ANTIGRAVITY_PROXY_STREAM_BAD_ADDRESS_TTL_MS || "300000");
const streamAddressSignalTtlMs = Number(process.env.ANTIGRAVITY_PROXY_STREAM_ADDRESS_SIGNAL_TTL_MS || "600000");
const streamSlowSuccessMs = Number(process.env.ANTIGRAVITY_PROXY_STREAM_SLOW_SUCCESS_MS || "15000");
const streamTotalBudgetMs = Number(process.env.ANTIGRAVITY_PROXY_STREAM_TOTAL_BUDGET_MS || "90000");
const streamMinRemainingBudgetMs = Number(process.env.ANTIGRAVITY_PROXY_STREAM_MIN_REMAINING_BUDGET_MS || "5000");
const streamCapacity429BackoffMs = Number(process.env.ANTIGRAVITY_PROXY_STREAM_CAPACITY_429_BACKOFF_MS || "5000");
const debugRequestIdentifiers = process.env.ANTIGRAVITY_PROXY_DEBUG_REQUEST_IDENTIFIERS === "1";
const requestIdentifierCandidates = new Set(["cascadeid", "conversationid", "sessionid", "requestid", "threadid", "chatid"]);
const diagnosticHeaderNames = [
  "server",
  "via",
  "alt-svc",
  "retry-after",
  "x-envoy-upstream-service-time",
  "x-guploader-uploadid",
  "x-request-id",
  "x-cloud-trace-context",
  "traceparent",
  "grpc-status",
  "grpc-message",
];
const diagnosticRequestHeaderNames = [
  "accept",
  "accept-encoding",
  "content-type",
  "grpc-timeout",
  "te",
  "traceparent",
  "user-agent",
  "x-client-data",
  "x-goog-api-client",
  "x-goog-request-params",
  "x-request-id",
];

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
    lastAttempt: null,
    attemptDiagnostics: [],
  };
}

const runtimeStatus = {
  ...createStatusSnapshot(),
  activeCascadeId: "",
  cascades: {},
};

const cascadeStatuses = new Map();
const cascadeClearTimers = new Map();
const activeRequestControls = new Map();
const recentBadStreamAddresses = new Map();
const streamAddressSignals = new Map();

class RetryStoppedError extends Error {
  constructor(message = "Retry stopped by user") {
    super(message);
    this.name = "RetryStoppedError";
    this.code = "RETRY_STOPPED";
  }
}

class RetryBudgetExceededError extends Error {
  constructor(message = "Retry budget exceeded") {
    super(message);
    this.name = "RetryBudgetExceededError";
    this.code = "RETRY_BUDGET_EXCEEDED";
  }
}

function log(message) {
  const now = new Date().toISOString();
  process.stdout.write(`${now} ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneRecentBadStreamAddresses(now = Date.now()) {
  for (const [address, expiresAt] of [...recentBadStreamAddresses.entries()]) {
    if (expiresAt <= now) {
      recentBadStreamAddresses.delete(address);
    }
  }
}

function markRecentBadStreamAddress(address) {
  if (!address || !streamBadAddressTtlMs) {
    return;
  }
  pruneRecentBadStreamAddresses();
  recentBadStreamAddresses.set(address, Date.now() + streamBadAddressTtlMs);
}

function pruneExpiredStreamAddressSignals(now = Date.now()) {
  for (const [address, signals] of [...streamAddressSignals.entries()]) {
    const activeSignals = signals.filter((signal) => signal.expiresAt > now);
    if (activeSignals.length) {
      streamAddressSignals.set(address, activeSignals);
      continue;
    }
    streamAddressSignals.delete(address);
  }
}

function recordStreamAddressSignal(address, value, reason, now = Date.now()) {
  if (!address || !streamAddressSignalTtlMs || !Number.isFinite(value) || !value) {
    return;
  }

  pruneExpiredStreamAddressSignals(now);
  const currentSignals = streamAddressSignals.get(address) || [];
  currentSignals.push({
    at: now,
    expiresAt: now + streamAddressSignalTtlMs,
    value,
    reason,
  });
  streamAddressSignals.set(address, currentSignals.slice(-20));
}

function getStreamAddressScore(address, now = Date.now()) {
  pruneExpiredStreamAddressSignals(now);
  const signals = streamAddressSignals.get(address) || [];
  let score = 0;
  let lastAt = 0;
  for (const signal of signals) {
    score += signal.value;
    lastAt = Math.max(lastAt, signal.at);
  }
  return { score, lastAt };
}

function rankStreamAddresses(addresses, failedAddresses = new Set(), now = Date.now()) {
  pruneRecentBadStreamAddresses(now);
  pruneExpiredStreamAddressSignals(now);

  const ranked = addresses.map((address, index) => {
    const { score, lastAt } = getStreamAddressScore(address, now);
    return {
      address,
      index,
      score,
      lastAt,
      failed: failedAddresses.has(address),
      recentlyBad: recentBadStreamAddresses.has(address),
    };
  });

  ranked.sort((left, right) => {
    if (left.failed !== right.failed) {
      return left.failed ? 1 : -1;
    }
    if (left.recentlyBad !== right.recentlyBad) {
      return left.recentlyBad ? 1 : -1;
    }
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    if (left.lastAt !== right.lastAt) {
      return right.lastAt - left.lastAt;
    }
    return left.index - right.index;
  });

  return ranked;
}

function isRetryStoppedError(error) {
  return error instanceof RetryStoppedError || error?.code === "RETRY_STOPPED";
}

function isRetryBudgetExceededError(error) {
  return error instanceof RetryBudgetExceededError || error?.code === "RETRY_BUDGET_EXCEEDED";
}

function requestStop(control, error = new RetryStoppedError()) {
  if (!control || control.stopped) {
    return false;
  }

  control.stopped = true;

  if (control.currentUpstreamRes && typeof control.currentUpstreamRes.destroy === "function") {
    control.currentUpstreamRes.destroy(error);
  }

  if (control.currentUpstreamReq && typeof control.currentUpstreamReq.destroy === "function") {
    control.currentUpstreamReq.destroy(error);
  }

  for (const listener of [...control.stopListeners]) {
    listener();
  }

  return true;
}

function cloneStatusSnapshot(status) {
  return {
    ...status,
    events: [...status.events],
    lastAttempt: status.lastAttempt ? JSON.parse(JSON.stringify(status.lastAttempt)) : null,
    attemptDiagnostics: (status.attemptDiagnostics || []).map((entry) => JSON.parse(JSON.stringify(entry))),
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

function captureRelevantHeaders(headers) {
  const captured = {};
  for (const headerName of diagnosticHeaderNames) {
    const headerValue = headers?.[headerName];
    if (headerValue === undefined) {
      continue;
    }
    captured[headerName] = Array.isArray(headerValue) ? headerValue.join(", ") : String(headerValue);
  }
  return captured;
}

function captureRelevantRequestHeaders(headers) {
  const captured = {};
  for (const headerName of diagnosticRequestHeaderNames) {
    const headerValue = headers?.[headerName];
    if (headerValue === undefined) {
      continue;
    }
    captured[headerName] = Array.isArray(headerValue) ? headerValue.join(", ") : String(headerValue);
  }
  return captured;
}

function describeSocket(socket) {
  if (!socket) {
    return {};
  }

  return {
    remoteAddress: socket.remoteAddress || "",
    remotePort: socket.remotePort || 0,
    remoteFamily: socket.remoteFamily || "",
    localAddress: socket.localAddress || "",
    localPort: socket.localPort || 0,
    alpnProtocol: socket.alpnProtocol || "",
    authorized: typeof socket.authorized === "boolean" ? socket.authorized : undefined,
    servername: socket.servername || "",
  };
}

function pushAttemptDiagnostic(requestInfo, diagnostic) {
  runtimeStatus.lastAttempt = diagnostic;
  runtimeStatus.attemptDiagnostics = [...runtimeStatus.attemptDiagnostics, diagnostic].slice(-attemptHistoryLimit);
  runtimeStatus.updatedAt = Date.now();

  if (requestInfo.cascadeId) {
    const cascadeStatus = cascadeStatuses.get(requestInfo.cascadeId) || createStatusSnapshot(requestInfo.cascadeId);
    cascadeStatus.lastAttempt = diagnostic;
    cascadeStatus.attemptDiagnostics = [...(cascadeStatus.attemptDiagnostics || []), diagnostic].slice(-attemptHistoryLimit);
    cascadeStatus.updatedAt = Date.now();
    cascadeStatuses.set(requestInfo.cascadeId, cascadeStatus);
    syncCascadeStatuses();
  }

  const payload = JSON.stringify({
    recordedAt: new Date().toISOString(),
    requestInfo: {
      path: requestInfo.path,
      model: requestInfo.model,
      cascadeId: requestInfo.cascadeId,
      requestHeaders: requestInfo.requestHeaders || {},
    },
    diagnostic,
  });
  fs.appendFile(attemptLogPath, `${payload}\n`, "utf8").catch((error) => {
    log(`failed to append attempt diagnostic log_path=${attemptLogPath} error=${error.message}`);
  });
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

function markStopped(requestInfo, attempt = 0) {
  const next = {
    active: false,
    label: "Stopped",
    attempt: 0,
    path: requestInfo.path,
    model: requestInfo.model,
    cascadeId: requestInfo.cascadeId,
    statusCode: 499,
    message: "Stopped by user",
  };
  setRuntimeStatus(next);
  setCascadeStatus(requestInfo.cascadeId, next);
  pushEvent({
    type: "stopped",
    path: requestInfo.path,
    model: requestInfo.model,
    cascadeId: requestInfo.cascadeId,
    attempt,
    statusCode: 499,
    message: "Stopped by user",
  });
  scheduleRuntimeClear(requestInfo.cascadeId, requestInfo.path, "Stopped", "Stopped by user", statusHoldMs);
  scheduleCascadeClear(requestInfo.cascadeId, requestInfo.path, "Stopped", "Stopped by user", statusHoldMs);
}

function markStoppedOnce(control, requestInfo, attempt = 0) {
  if (control?.stopRecorded) {
    return false;
  }
  if (control) {
    control.stopRecorded = true;
  }
  markStopped(requestInfo, attempt);
  return true;
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

function retryDelayMsForStreamRequest(requestInfo, attempt, headers, bodyText) {
  if (!requestInfo.isStreamGenerateContent) {
    return retryDelayMs(attempt, headers, bodyText);
  }

  const upstreamDelay = retryDelayMs(attempt, headers, bodyText);
  if (attempt <= 2) {
    return Math.min(upstreamDelay, 1000);
  }
  return upstreamDelay;
}

function isQuotaExhausted(statusCode, bodyText) {
  if (statusCode !== 429) {
    return false;
  }

  return /quota will reset after/i.test(bodyText) || /exhausted your capacity/i.test(bodyText);
}

function isCapacityRateLimited(statusCode, bodyText) {
  return statusCode === 429 && !isQuotaExhausted(statusCode, bodyText);
}

function retryDelayMsForRetryableResponse(requestInfo, attempt, statusCode, headers, bodyText) {
  if (isCapacityRateLimited(statusCode, bodyText)) {
    return Math.max(retryDelayMs(attempt, headers, bodyText), streamCapacity429BackoffMs);
  }

  return retryDelayMsForStreamRequest(requestInfo, attempt, headers, bodyText);
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
    requestHeaders: captureRelevantRequestHeaders(req.headers),
    isStreamGenerateContent: /\/v1internal:streamGenerateContent\b/i.test(req.url || ""),
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

function assertNotStopped(control) {
  if (control?.stopped) {
    throw new RetryStoppedError();
  }
}

function waitForDelayOrStop(control, delayMs) {
  if (!control) {
    return sleep(delayMs);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);

    const cleanup = () => {
      clearTimeout(timer);
      if (control.stopListeners) {
        control.stopListeners.delete(onStop);
      }
    };

    const onStop = () => {
      cleanup();
      reject(new RetryStoppedError());
    };

    control.stopListeners.add(onStop);
    if (control.stopped) {
      onStop();
    }
  });
}

async function waitForRetryDelay(requestInfo, control, attempt, delay) {
  try {
    await waitForDelayOrStop(control, delay);
  } catch (error) {
    if (isRetryStoppedError(error)) {
      if (markStoppedOnce(control, requestInfo, attempt)) {
        log(`retry stopped attempt=${attempt}/${maxAttempts}${formatRequestContext(requestInfo)}`);
      }
    }
    throw error;
  }
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
  if (requestInfo.requestHeaders?.["x-goog-api-client"]) {
    parts.push(` x_goog_api_client=${truncateForLog(requestInfo.requestHeaders["x-goog-api-client"])}`);
  }
  if (requestInfo.requestHeaders?.["x-client-data"]) {
    parts.push(` x_client_data=${truncateForLog(requestInfo.requestHeaders["x-client-data"])}`);
  }
  if (requestInfo.requestHeaders?.traceparent) {
    parts.push(` traceparent=${truncateForLog(requestInfo.requestHeaders.traceparent)}`);
  }
  return parts.join("");
}

function formatAttemptDiagnosticSummary(diagnostic) {
  if (!diagnostic || typeof diagnostic !== "object") {
    return "";
  }

  const parts = [];
  if (diagnostic.statusCode) {
    parts.push(`status=${diagnostic.statusCode}`);
  }
  if (diagnostic.outcome) {
    parts.push(`outcome=${diagnostic.outcome}`);
  }
  if (diagnostic.upstream?.remoteAddress) {
    const portSuffix = diagnostic.upstream.remotePort ? `:${diagnostic.upstream.remotePort}` : "";
    parts.push(`upstream=${diagnostic.upstream.remoteAddress}${portSuffix}`);
  }
  if (diagnostic.upstream?.selectedAddress && diagnostic.upstream.selectedAddress !== diagnostic.upstream.remoteAddress) {
    parts.push(`selected=${diagnostic.upstream.selectedAddress}`);
  }
  if (Number.isFinite(diagnostic.timings?.dnsLookupMs)) {
    parts.push(`dns_ms=${diagnostic.timings.dnsLookupMs}`);
  }
  if (Number.isFinite(diagnostic.timings?.firstByteMs)) {
    parts.push(`ttfb_ms=${diagnostic.timings.firstByteMs}`);
  }
  if (Number.isFinite(diagnostic.timings?.totalMs)) {
    parts.push(`total_ms=${diagnostic.timings.totalMs}`);
  }
  if (diagnostic.responseHeaders?.["x-envoy-upstream-service-time"]) {
    parts.push(`envoy_ms=${diagnostic.responseHeaders["x-envoy-upstream-service-time"]}`);
  }
  if (diagnostic.responseHeaders?.["retry-after"]) {
    parts.push(`retry_after=${diagnostic.responseHeaders["retry-after"]}`);
  }

  return parts.length ? ` ${parts.join(" ")}` : "";
}

function buildFallbackAttemptDiagnostic(req, requestInfo, attempt, error, outcome = "network_error") {
  const now = new Date().toISOString();
  return {
    attempt,
    method: req.method,
    path: requestInfo.path,
    model: requestInfo.model,
    cascadeId: requestInfo.cascadeId,
    startedAt: now,
    completedAt: now,
    outcome,
    statusCode: 0,
    error: error?.message || "Unknown upstream error",
    socketReused: false,
    timings: {
      totalMs: 0,
    },
    requestHeaders: requestInfo.requestHeaders || {},
    upstream: {
      host: targetHost,
    },
    responseHeaders: {},
  };
}

function getRemainingStreamBudgetMs(control) {
  if (!control?.deadlineAtMs) {
    return Number.POSITIVE_INFINITY;
  }

  return control.deadlineAtMs - Date.now();
}

function assertWithinRetryBudget(control) {
  if (!control?.deadlineAtMs) {
    return;
  }

  if (getRemainingStreamBudgetMs(control) > 0) {
    return;
  }

  throw new RetryBudgetExceededError(`Stream retry budget exceeded after ${streamTotalBudgetMs}ms`);
}

function shouldAvoidStreamAddress(diagnostic) {
  if (!diagnostic?.upstream?.remoteAddress) {
    return false;
  }

  if (diagnostic.outcome === "attempt_timeout") {
    return true;
  }

  if (diagnostic.statusCode >= 500) {
    return true;
  }

  if (diagnostic.outcome?.includes("network")) {
    return true;
  }

  return diagnostic.statusCode === 429;
}

function updateStreamAddressHealth(diagnostic) {
  if (!diagnostic?.upstream?.remoteAddress || !/\/v1internal:streamGenerateContent\b/i.test(diagnostic.path || "")) {
    return;
  }

  const address = diagnostic.upstream.remoteAddress;
  const firstByteMs = diagnostic.timings?.firstByteMs;

  if (diagnostic.outcome === "success") {
    if (Number.isFinite(firstByteMs) && firstByteMs >= streamSlowSuccessMs) {
      recordStreamAddressSignal(address, -1, "slow_success");
      return;
    }
    recordStreamAddressSignal(address, 2, "success");
    return;
  }

  if (diagnostic.outcome === "quota_exhausted") {
    return;
  }

  if (diagnostic.outcome === "attempt_timeout") {
    recordStreamAddressSignal(address, -4, "attempt_timeout");
    return;
  }

  if (diagnostic.statusCode === 429) {
    recordStreamAddressSignal(address, -2, "capacity_429");
    return;
  }

  if (diagnostic.statusCode >= 500) {
    recordStreamAddressSignal(address, -4, `http_${diagnostic.statusCode}`);
    return;
  }

  if (diagnostic.outcome?.includes("network")) {
    recordStreamAddressSignal(address, -4, "network_error");
  }
}

async function resolveUpstreamTarget(requestInfo, control, attempt) {
  if (!requestInfo.isStreamGenerateContent || !streamFreshConnectEnabled) {
    return {
      connectHostname: targetHost,
      servername: targetHost,
      resolvedAddresses: [],
      selectedAddress: "",
      selectedScore: 0,
      agent: undefined,
    };
  }

  const failedAddresses = control?.failedUpstreamAddresses || new Set();
  const shouldFreshConnect = streamFreshConnectOnFirstAttempt || attempt > 1 || failedAddresses.size > 0;
  if (!shouldFreshConnect) {
    return {
      connectHostname: targetHost,
      servername: targetHost,
      resolvedAddresses: [],
      selectedAddress: "",
      selectedScore: 0,
      agent: undefined,
    };
  }

  try {
    const records = await dns.promises.lookup(targetHost, { all: true, family: 4 });
    const uniqueAddresses = [...new Set(records.map((record) => record.address).filter(Boolean))];
    if (!uniqueAddresses.length) {
      return {
        connectHostname: targetHost,
        servername: targetHost,
        resolvedAddresses: [],
        selectedAddress: "",
        selectedScore: 0,
        agent: false,
      };
    }

    const rankedAddresses = rankStreamAddresses(uniqueAddresses, failedAddresses);
    const healthyAddresses = rankedAddresses.filter((entry) => !entry.failed && !entry.recentlyBad);
    const fallbackAddresses = rankedAddresses.filter((entry) => !entry.failed);
    const pool = (healthyAddresses.length ? healthyAddresses : fallbackAddresses.length ? fallbackAddresses : rankedAddresses);
    const selected = pool[0];
    const selectedAddress = selected?.address || uniqueAddresses[0];
    return {
      connectHostname: selectedAddress,
      servername: targetHost,
      resolvedAddresses: uniqueAddresses,
      selectedAddress,
      selectedScore: selected?.score || 0,
      agent: false,
    };
  } catch (error) {
    log(`dns lookup failed host=${targetHost} path=${requestInfo.path} error=${error.message}`);
    return {
      connectHostname: targetHost,
      servername: targetHost,
      resolvedAddresses: [],
      selectedAddress: "",
      selectedScore: 0,
      agent: false,
    };
  }
}

async function singleForwardRequest(req, body, control, requestInfo, attempt) {
  const upstreamTarget = await resolveUpstreamTarget(requestInfo, control, attempt);
  return new Promise((resolve, reject) => {
    const startedAtMs = Date.now();
    const attemptDiagnostic = {
      attempt,
      method: req.method,
      path: requestInfo.path,
      model: requestInfo.model,
      cascadeId: requestInfo.cascadeId,
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: "",
      outcome: "",
      statusCode: 0,
      error: "",
      retryDelayMs: 0,
      socketReused: false,
      httpVersion: "",
      bodyBytes: 0,
      timings: {},
      requestHeaders: requestInfo.requestHeaders || {},
      upstream: {
        host: targetHost,
        selectedAddress: upstreamTarget.selectedAddress,
        resolvedAddresses: upstreamTarget.resolvedAddresses,
        selectedScore: upstreamTarget.selectedScore,
      },
      responseHeaders: {},
    };

    const finalizeAttemptDiagnostic = (updates = {}) => {
      const completedAtMs = Date.now();
      return {
        ...attemptDiagnostic,
        ...updates,
        completedAt: updates.completedAt || new Date(completedAtMs).toISOString(),
        timings: {
          ...attemptDiagnostic.timings,
          totalMs: completedAtMs - startedAtMs,
          ...(updates.timings || {}),
        },
        upstream: {
          ...attemptDiagnostic.upstream,
          ...(updates.upstream || {}),
        },
        responseHeaders: {
          ...attemptDiagnostic.responseHeaders,
          ...(updates.responseHeaders || {}),
        },
      };
    };

    const headers = { ...req.headers, host: targetHost };
    if (body.length > 0) {
      headers["content-length"] = String(body.length);
    } else {
      delete headers["content-length"];
    }

    const upstreamReq = https.request(
      {
        protocol: "https:",
        hostname: upstreamTarget.connectHostname,
        port: 443,
        method: req.method,
        path: req.url,
        headers,
        servername: upstreamTarget.servername,
        agent: upstreamTarget.agent,
      },
      (upstreamRes) => {
        if (control) {
          control.currentUpstreamReq = undefined;
          control.currentUpstreamRes = upstreamRes;
        }
        const responseSocket = upstreamRes.socket || upstreamReq.socket;
        const responseHeaders = captureRelevantHeaders(upstreamRes.headers);
        resolve({
          upstreamRes,
          attemptDiagnostic: finalizeAttemptDiagnostic({
            statusCode: upstreamRes.statusCode || 0,
            httpVersion: upstreamRes.httpVersion || "",
            responseHeaders,
            upstream: describeSocket(responseSocket),
            timings: {
              firstByteMs: Date.now() - startedAtMs,
            },
          }),
        });
      },
    );

    const attemptBudgetMs = requestInfo.isStreamGenerateContent ? getRemainingStreamBudgetMs(control) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(attemptBudgetMs) && attemptBudgetMs > 0) {
      upstreamReq.setTimeout(attemptBudgetMs, () => {
        const timeoutError = new Error(`Stream retry budget reached during attempt after ${attemptBudgetMs}ms`);
        timeoutError.code = "STREAM_ATTEMPT_TIMEOUT";
        timeoutError.attemptDiagnostic = finalizeAttemptDiagnostic({
          outcome: "attempt_timeout",
          error: timeoutError.message,
          upstream: describeSocket(upstreamReq.socket),
        });
        upstreamReq.destroy(timeoutError);
      });
    }

    if (control) {
      control.currentUpstreamReq = upstreamReq;
    }

    upstreamReq.on("socket", (socket) => {
      attemptDiagnostic.socketReused = Boolean(upstreamReq.reusedSocket);
      attemptDiagnostic.upstream = {
        ...attemptDiagnostic.upstream,
        ...describeSocket(socket),
      };

      socket.once("lookup", (error, address, family, host) => {
        if (error) {
          attemptDiagnostic.error = error.message;
          return;
        }
        attemptDiagnostic.timings.dnsLookupMs = Date.now() - startedAtMs;
        attemptDiagnostic.upstream.lookupAddress = address || "";
        attemptDiagnostic.upstream.lookupFamily = family || 0;
        attemptDiagnostic.upstream.lookupHost = host || "";
      });

      socket.once("connect", () => {
        attemptDiagnostic.timings.tcpConnectMs = Date.now() - startedAtMs;
        attemptDiagnostic.upstream = {
          ...attemptDiagnostic.upstream,
          ...describeSocket(socket),
        };
      });

      socket.once("secureConnect", () => {
        attemptDiagnostic.timings.tlsHandshakeMs = Date.now() - startedAtMs;
        attemptDiagnostic.upstream = {
          ...attemptDiagnostic.upstream,
          ...describeSocket(socket),
        };
      });
    });

    upstreamReq.on("error", (error) => {
      if (control) {
        control.currentUpstreamReq = undefined;
        control.currentUpstreamRes = undefined;
      }
      error.attemptDiagnostic =
        error.attemptDiagnostic ||
        finalizeAttemptDiagnostic({
          outcome: "network_error",
          error: error.message,
          upstream: describeSocket(upstreamReq.socket),
        });
      reject(error);
    });

    if (body.length > 0) {
      upstreamReq.write(body);
    }
    upstreamReq.end();
  });
}

async function forwardRequest(req, body, requestInfo) {
  const control = {
    requestInfo,
    stopped: false,
    stopListeners: new Set(),
    failedUpstreamAddresses: new Set(),
    deadlineAtMs: requestInfo.isStreamGenerateContent && streamTotalBudgetMs > 0 ? Date.now() + streamTotalBudgetMs : 0,
  };

  if (requestInfo.cascadeId) {
    activeRequestControls.set(requestInfo.cascadeId, control);
  }

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        assertWithinRetryBudget(control);
        assertNotStopped(control);
        const { upstreamRes, attemptDiagnostic } = await singleForwardRequest(req, body, control, requestInfo, attempt);
        assertNotStopped(control);

        const statusCode = upstreamRes.statusCode || 0;
        if (!retryableStatuses.has(statusCode)) {
          const successDiagnostic = {
            ...attemptDiagnostic,
            outcome: "success",
          };
          updateStreamAddressHealth(successDiagnostic);
          pushAttemptDiagnostic(requestInfo, successDiagnostic);
          return { upstreamRes };
        }

        const responseBody = await readResponseBody(upstreamRes);
        if (control) {
          control.currentUpstreamRes = undefined;
        }
        assertNotStopped(control);
        const bodyText = responseBody.toString("utf8");

        if (isQuotaExhausted(statusCode, bodyText)) {
          const quotaDiagnostic = {
            ...attemptDiagnostic,
            outcome: "quota_exhausted",
            bodyBytes: responseBody.length,
          };
          updateStreamAddressHealth(quotaDiagnostic);
          pushAttemptDiagnostic(requestInfo, quotaDiagnostic);
          showQuotaExhausted(requestInfo);
          log(
            `passthrough quota exhaustion status=${statusCode} attempt=${attempt}/${maxAttempts}${formatRequestContext(requestInfo)}${formatAttemptDiagnosticSummary(quotaDiagnostic)}`,
          );
          return { upstreamRes, responseBody };
        }

        if (attempt >= maxAttempts) {
          const exhaustedDiagnostic = {
            ...attemptDiagnostic,
            outcome: "retry_exhausted_status",
            bodyBytes: responseBody.length,
          };
          updateStreamAddressHealth(exhaustedDiagnostic);
          pushAttemptDiagnostic(requestInfo, exhaustedDiagnostic);
          return { upstreamRes, responseBody };
        }

        const delay = retryDelayMsForRetryableResponse(requestInfo, attempt, statusCode, upstreamRes.headers, bodyText);
        const diagnosticWithRetry = {
          ...attemptDiagnostic,
          outcome: "retry_scheduled",
          retryDelayMs: delay,
          bodyBytes: responseBody.length,
        };
        updateStreamAddressHealth(diagnosticWithRetry);
        if (requestInfo.isStreamGenerateContent && shouldAvoidStreamAddress(diagnosticWithRetry)) {
          control?.failedUpstreamAddresses.add(diagnosticWithRetry.upstream.remoteAddress);
          markRecentBadStreamAddress(diagnosticWithRetry.upstream.remoteAddress);
        }
        pushAttemptDiagnostic(requestInfo, diagnosticWithRetry);
        if (
          requestInfo.isStreamGenerateContent &&
          control?.deadlineAtMs &&
          getRemainingStreamBudgetMs(control) <= Math.max(delay, streamMinRemainingBudgetMs)
        ) {
          log(`retry budget exhausted attempt=${attempt}/${maxAttempts}${formatRequestContext(requestInfo)}${formatAttemptDiagnosticSummary(diagnosticWithRetry)}`);
          return { upstreamRes, responseBody };
        }
        beginRetryStatus(requestInfo, attempt, statusCode, `HTTP ${statusCode}`);
        log(
          `retryable upstream status=${statusCode} attempt=${attempt}/${maxAttempts} delay_ms=${delay}${formatRequestContext(requestInfo)}${formatAttemptDiagnosticSummary(diagnosticWithRetry)}`,
        );
        await waitForRetryDelay(requestInfo, control, attempt, delay);
      } catch (error) {
        if (isRetryStoppedError(error)) {
          if (markStoppedOnce(control, requestInfo, attempt)) {
            log(`retry stopped attempt=${attempt}/${maxAttempts}${formatRequestContext(requestInfo)}`);
          }
          throw error;
        }

        if (isRetryBudgetExceededError(error)) {
          pushAttemptDiagnostic(requestInfo, buildFallbackAttemptDiagnostic(req, requestInfo, attempt, error, "retry_budget_exhausted"));
          throw error;
        }

        if (attempt >= maxAttempts) {
          const exhaustedDiagnostic =
            error.attemptDiagnostic
              ? {
                  ...error.attemptDiagnostic,
                  outcome: "retry_exhausted_network_error",
                }
              : buildFallbackAttemptDiagnostic(req, requestInfo, attempt, error, "retry_exhausted_network_error");
          updateStreamAddressHealth(exhaustedDiagnostic);
          pushAttemptDiagnostic(requestInfo, exhaustedDiagnostic);
          throw error;
        }

        const delay = Math.min(baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)), maxDelayMs);
        const adjustedDelay = requestInfo.isStreamGenerateContent ? Math.min(delay, attempt <= 2 ? 1000 : delay) : delay;
        const diagnosticWithRetry =
          error.attemptDiagnostic
            ? {
                ...error.attemptDiagnostic,
                outcome: "network_retry_scheduled",
                retryDelayMs: adjustedDelay,
              }
            : buildFallbackAttemptDiagnostic(req, requestInfo, attempt, error, "network_retry_scheduled");
        updateStreamAddressHealth(diagnosticWithRetry);
        if (requestInfo.isStreamGenerateContent && shouldAvoidStreamAddress(diagnosticWithRetry)) {
          control?.failedUpstreamAddresses.add(diagnosticWithRetry.upstream.remoteAddress);
          markRecentBadStreamAddress(diagnosticWithRetry.upstream.remoteAddress);
        }
        pushAttemptDiagnostic(requestInfo, diagnosticWithRetry);
        if (
          requestInfo.isStreamGenerateContent &&
          control?.deadlineAtMs &&
          getRemainingStreamBudgetMs(control) <= Math.max(adjustedDelay, streamMinRemainingBudgetMs)
        ) {
          log(`retry budget exhausted attempt=${attempt}/${maxAttempts}${formatRequestContext(requestInfo)}${formatAttemptDiagnosticSummary(diagnosticWithRetry)}`);
          throw error;
        }
        beginRetryStatus(requestInfo, attempt, 0, error.message);
        log(
          `upstream error attempt=${attempt}/${maxAttempts} delay_ms=${adjustedDelay}${formatRequestContext(requestInfo)} error=${error.message}${formatAttemptDiagnosticSummary(diagnosticWithRetry)}`,
        );
        await waitForRetryDelay(requestInfo, control, attempt, adjustedDelay);
      }
    }

    throw new Error("retry loop exited unexpectedly");
  } finally {
    if (requestInfo.cascadeId && activeRequestControls.get(requestInfo.cascadeId) === control) {
      activeRequestControls.delete(requestInfo.cascadeId);
    }
  }
}

function stopActiveRetry(cascadeId) {
  if (!cascadeId) {
    return { ok: false, statusCode: 400, message: "Missing cascadeId" };
  }

  const control = activeRequestControls.get(cascadeId);
  if (!control) {
    return { ok: false, statusCode: 409, message: `No active retry for cascade ${cascadeId}` };
  }

  requestStop(control);

  return {
    ok: true,
    statusCode: 200,
    requestInfo: control.requestInfo,
  };
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

  if (req.url === "/__stop" && req.method === "POST") {
    try {
      const body = await readBody(req);
      let cascadeId = runtimeStatus.activeCascadeId || runtimeStatus.cascadeId || "";
      if (body.length > 0) {
        try {
          const parsed = JSON.parse(body.toString("utf8"));
          if (typeof parsed?.cascadeId === "string" && parsed.cascadeId.trim()) {
            cascadeId = parsed.cascadeId.trim();
          }
        } catch {
          // Ignore invalid JSON and fall back to the current active cascade.
        }
      }

      const result = stopActiveRetry(cascadeId);
      if (!result.ok) {
        res.writeHead(result.statusCode, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: result.message, cascadeId }));
        return;
      }

      log(`manual stop${formatRequestContext(result.requestInfo)}`);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, cascadeId }));
      return;
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: error.message }));
      return;
    }
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
    let downstreamClosed = false;
    const handleDownstreamClose = () => {
      if (downstreamClosed) {
        return;
      }
      downstreamClosed = true;
      if (!requestInfo.cascadeId) {
        return;
      }
      const control = activeRequestControls.get(requestInfo.cascadeId);
      if (!control) {
        return;
      }
      if (requestStop(control)) {
        log(`downstream closed${formatRequestContext(requestInfo)}`);
      }
    };

    res.on("close", () => {
      if (!res.writableEnded) {
        handleDownstreamClose();
      }
    });

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
    if (isRetryStoppedError(error)) {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(499, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "retry_stopped", message: error.message, cascadeId: requestInfo.cascadeId }));
      }
      return;
    }

    if (isRetryBudgetExceededError(error)) {
      log(`retry budget exhausted${formatRequestContext(requestInfo)} error=${error.message}`);
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(504, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "retry_budget_exhausted", message: error.message, cascadeId: requestInfo.cascadeId }));
      }
      return;
    }

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
