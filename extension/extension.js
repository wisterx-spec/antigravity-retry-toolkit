const vscode = require("vscode");
const fs = require("fs/promises");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

function formatTime(timestamp) {
  if (!timestamp) {
    return "-";
  }
  return new Date(timestamp).toLocaleTimeString();
}

function formatEventLine(event) {
  const code = event.statusCode ? `HTTP ${event.statusCode}` : "network";
  const attempt = event.attempt ? `Attempt ${event.attempt}` : "";
  const message = event.message || code;
  const model = event.model ? ` · ${event.model}` : "";
  const path = event.path ? ` · ${event.path}` : "";
  const suffix = `${model}${path}`;
  return `${formatTime(event.at)}  ${attempt} ${message}${suffix}`.trim();
}

function formatJson(value) {
  return JSON.stringify(
    value,
    (_, current) => {
      if (typeof current === "bigint") {
        return current.toString();
      }
      return current;
    },
    2,
  );
}

function getPrimaryWorkspaceUri() {
  return vscode.workspace.workspaceFolders?.[0]?.uri?.toString() || "";
}

function getUnifiedTopicState(topic) {
  if (!topic || typeof topic !== "object") {
    return undefined;
  }
  if (typeof topic.getState === "function") {
    return topic.getState();
  }
  if (typeof topic.get === "function") {
    return topic.get();
  }
  return undefined;
}

function extractUnifiedStateValue(entry) {
  if (entry === undefined || entry === null) {
    return undefined;
  }
  if (typeof entry === "string") {
    return entry;
  }
  if (typeof entry.value === "string") {
    return entry.value;
  }
  if (entry.row && typeof entry.row.value === "string") {
    return entry.row.value;
  }
  if (entry.newRow && typeof entry.newRow.value === "string") {
    return entry.newRow.value;
  }
  return undefined;
}

function decodeCascadeIdCandidate(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const uuidMatch = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch) {
    return uuidMatch[0];
  }

  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const decodedMatch = decoded.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (decodedMatch) {
      return decodedMatch[0];
    }
  } catch {
    // Ignore non-base64 values and fall through.
  }

  return "";
}

function parseWindowConfigEntry(entry) {
  const rawValue = extractUnifiedStateValue(entry);
  if (typeof rawValue !== "string" || !rawValue) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function findWindowKeyForWorkspace(windowConfigsState, workspaceUri) {
  if (!windowConfigsState || typeof windowConfigsState !== "object" || !workspaceUri) {
    return "";
  }

  for (const [windowKey, entry] of Object.entries(windowConfigsState.data || {})) {
    const parsed = parseWindowConfigEntry(entry);
    if (Array.isArray(parsed?.folderUris) && parsed.folderUris.includes(workspaceUri)) {
      return windowKey;
    }
  }

  for (const [windowKey, entry] of Object.entries(windowConfigsState)) {
    const parsed = parseWindowConfigEntry(entry);
    if (Array.isArray(parsed?.folderUris) && parsed.folderUris.includes(workspaceUri)) {
      return windowKey;
    }
  }

  return "";
}

function extractCascadeIdForWindow(state, windowKey) {
  if (!state || typeof state !== "object" || !windowKey) {
    return "";
  }

  const directValue = decodeCascadeIdCandidate(extractUnifiedStateValue(state.data?.[windowKey]));
  if (directValue) {
    return directValue;
  }

  return decodeCascadeIdCandidate(extractUnifiedStateValue(state[windowKey]));
}

async function tryExecuteCommand(command, ...args) {
  try {
    return {
      ok: true,
      value: await vscode.commands.executeCommand(command, ...args),
    };
  } catch (error) {
    return {
      ok: false,
      error: typeof error?.message === "string" ? error.message : String(error),
    };
  }
}

function describeTabInput(input) {
  if (!input) {
    return { kind: "unknown" };
  }

  const summary = {
    kind: input.constructor?.name || typeof input,
  };

  const copyIfPresent = (key) => {
    if (key in input && input[key] !== undefined) {
      summary[key] = input[key]?.toString?.() || input[key];
    }
  };

  copyIfPresent("uri");
  copyIfPresent("viewType");
  copyIfPresent("notebookType");

  if ("original" in input && input.original) {
    summary.original = input.original.toString?.() || input.original;
  }
  if ("modified" in input && input.modified) {
    summary.modified = input.modified.toString?.() || input.modified;
  }
  if ("textInput" in input && input.textInput) {
    summary.textInput = {
      kind: input.textInput.constructor?.name || typeof input.textInput,
      uri: input.textInput.uri?.toString?.() || null,
    };
  }

  const extraKeys = Object.keys(input).filter((key) => !(key in summary)).slice(0, 12);
  if (extraKeys.length) {
    summary.extraKeys = extraKeys;
  }

  return summary;
}

function pickProcessEnv(keys) {
  const result = {};
  for (const key of keys) {
    if (process.env[key] !== undefined) {
      result[key] = process.env[key];
    }
  }
  return result;
}

function getExtensionRegistryPath() {
  return path.join(os.homedir(), ".antigravity", "extensions", "extensions.json");
}

class RetryStatusBarController {
  constructor(context) {
    this.context = context;
    this.output = vscode.window.createOutputChannel("Retry Status Bar");
    this.statusBar = vscode.window.createStatusBarItem("retryStatusBar.item", vscode.StatusBarAlignment.Left, 1000);
    this.statusBar.name = "Retry Status Bar";
    this.statusBar.command = "retryStatusBar.showLog";
    this.lastEventId = 0;
    this.lastStatusSignature = "";
    this.timer = undefined;
    this.windowKey = "";
    this.activeCascadeId = "";
    this.activeCascadeState = undefined;
    this.windowConfigsState = undefined;
    this.unifiedStateSubscription = undefined;
    this.windowConfigsSubscription = undefined;
    this.versionMonitorTimer = undefined;
    this.reloadRequestedForVersion = "";

    context.subscriptions.push(this.output, this.statusBar);
    context.subscriptions.push(
      vscode.commands.registerCommand("retryStatusBar.showLog", () => this.output.show(true)),
      vscode.commands.registerCommand("retryStatusBar.refresh", () => this.refreshNow()),
      vscode.commands.registerCommand("retryStatusBar.dumpAntigravityContext", () => this.dumpAntigravityContext()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("retryStatusBar")) {
          this.restart();
        }
      }),
    );
  }

  start() {
    this.initializeCascadeTracking();
    this.restart();
    this.startInstalledVersionMonitor();
  }

  stopRefreshTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  dispose() {
    this.stopRefreshTimer();
    if (this.unifiedStateSubscription) {
      this.unifiedStateSubscription.dispose();
      this.unifiedStateSubscription = undefined;
    }
    if (this.windowConfigsSubscription) {
      this.windowConfigsSubscription.dispose();
      this.windowConfigsSubscription = undefined;
    }
    if (this.versionMonitorTimer) {
      clearInterval(this.versionMonitorTimer);
      this.versionMonitorTimer = undefined;
    }
  }

  restart() {
    this.stopRefreshTimer();
    this.refreshNow();
    const intervalMs = this.getConfig().pollIntervalMs;
    this.timer = setInterval(() => {
      this.refreshNow();
    }, intervalMs);
  }

  getConfig() {
    const config = vscode.workspace.getConfiguration("retryStatusBar");
    return {
      statusUrl: config.get("statusUrl", "http://127.0.0.1:38475/__status"),
      pollIntervalMs: config.get("pollIntervalMs", 1000),
      showWhenIdle: config.get("showWhenIdle", true),
      idleText: config.get("idleText", "0"),
      maxTooltipEvents: config.get("maxTooltipEvents", 8),
    };
  }

  startInstalledVersionMonitor() {
    this.checkInstalledVersionAndReload();
    this.versionMonitorTimer = setInterval(() => {
      this.checkInstalledVersionAndReload();
    }, 2000);
  }

  async checkInstalledVersionAndReload() {
    const packageJson = this.context.extension?.packageJSON;
    const extensionId = packageJson ? `${packageJson.publisher}.${packageJson.name}` : "";
    const runningVersion = packageJson?.version || "";

    if (!extensionId || !runningVersion) {
      return;
    }

    let registry;
    try {
      registry = JSON.parse(await fs.readFile(getExtensionRegistryPath(), "utf8"));
    } catch {
      return;
    }

    const installedEntry = Array.isArray(registry)
      ? registry.find((entry) => entry?.identifier?.id === extensionId)
      : undefined;
    const installedVersion = installedEntry?.version || "";

    if (!installedVersion || installedVersion === runningVersion || installedVersion === this.reloadRequestedForVersion) {
      return;
    }

    this.reloadRequestedForVersion = installedVersion;
    this.output.appendLine(
      `[diag] Installed extension version changed from ${runningVersion} to ${installedVersion}; reloading window.`,
    );

    setTimeout(() => {
      vscode.commands.executeCommand("workbench.action.reloadWindow");
    }, 300);
  }

  async refreshNow() {
    try {
      const status = await this.fetchStatus(this.getConfig().statusUrl);
      const scopedStatus = this.getScopedStatus(status);
      this.consumeEvents(scopedStatus.events || []);
      this.render(scopedStatus);
    } catch (error) {
      this.statusBar.text = "$(warning) Retry status unavailable";
      this.statusBar.tooltip = typeof error?.message === "string" ? error.message : String(error);
      this.statusBar.show();
    }
  }

  fetchStatus(urlString) {
    return new Promise((resolve, reject) => {
      let url;
      try {
        url = new URL(urlString);
      } catch (error) {
        reject(new Error(`Invalid retry status URL: ${urlString}`));
        return;
      }

      const client = url.protocol === "https:" ? https : http;
      const req = client.request(
        url,
        {
          method: "GET",
          timeout: 1500,
          headers: {
            "cache-control": "no-cache",
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            if ((res.statusCode || 0) >= 400) {
              reject(new Error(`Status endpoint failed: HTTP ${res.statusCode} ${body}`));
              return;
            }

            try {
              resolve(JSON.parse(body));
            } catch (error) {
              reject(new Error(`Invalid JSON from status endpoint: ${body}`));
            }
          });
        },
      );

      req.on("timeout", () => {
        req.destroy(new Error("Status endpoint timeout"));
      });
      req.on("error", reject);
      req.end();
    });
  }

  consumeEvents(events) {
    for (const event of events) {
      if (!event || typeof event.id !== "number" || event.id <= this.lastEventId) {
        continue;
      }
      this.lastEventId = event.id;
      this.output.appendLine(formatEventLine(event));
    }
  }

  async initializeCascadeTracking() {
    const unifiedStateSync = vscode.antigravityUnifiedStateSync;
    if (!unifiedStateSync || typeof unifiedStateSync.subscribe !== "function") {
      this.output.appendLine("[diag] antigravityUnifiedStateSync is unavailable; falling back to global retry status.");
      return;
    }

    try {
      const [activeCascadeTopic, windowConfigsTopic] = await Promise.all([
        unifiedStateSync.subscribe("uss-activeCascadeIds"),
        unifiedStateSync.subscribe("uss-windowConfigs"),
      ]);
      this.activeCascadeState = getUnifiedTopicState(activeCascadeTopic);
      this.windowConfigsState = getUnifiedTopicState(windowConfigsTopic);
      this.updateActiveCascadeId();

      const onActiveCascadeChange =
        typeof activeCascadeTopic.onDidChange === "function" ? activeCascadeTopic.onDidChange.bind(activeCascadeTopic) : undefined;
      this.unifiedStateSubscription = onActiveCascadeChange?.(() => {
        this.activeCascadeState = getUnifiedTopicState(activeCascadeTopic);
        this.updateActiveCascadeId();
      });
      if (this.unifiedStateSubscription) {
        this.context.subscriptions.push(this.unifiedStateSubscription);
      }

      const onWindowConfigsChange =
        typeof windowConfigsTopic.onDidChange === "function" ? windowConfigsTopic.onDidChange.bind(windowConfigsTopic) : undefined;
      this.windowConfigsSubscription = onWindowConfigsChange?.(() => {
        this.windowConfigsState = getUnifiedTopicState(windowConfigsTopic);
        this.updateActiveCascadeId();
      });
      if (this.windowConfigsSubscription) {
        this.context.subscriptions.push(this.windowConfigsSubscription);
      }

      this.context.subscriptions.push({
        dispose: () => {
          if (typeof activeCascadeTopic.dispose === "function") {
            activeCascadeTopic.dispose();
          }
          if (typeof windowConfigsTopic.dispose === "function") {
            windowConfigsTopic.dispose();
          }
        },
      });
    } catch (error) {
      this.output.appendLine(
        `[diag] Failed to subscribe to unified state topics: ${typeof error?.message === "string" ? error.message : String(error)}`,
      );
    }
  }

  updateActiveCascadeId() {
    const nextWindowKey = findWindowKeyForWorkspace(this.windowConfigsState, getPrimaryWorkspaceUri());
    const nextCascadeId = extractCascadeIdForWindow(this.activeCascadeState, nextWindowKey);
    if (nextWindowKey === this.windowKey && nextCascadeId === this.activeCascadeId) {
      return;
    }
    this.windowKey = nextWindowKey;
    this.activeCascadeId = nextCascadeId;
    this.output.appendLine(`[diag] Active cascade for workspace window ${this.windowKey || "-"}: ${this.activeCascadeId || "-"}`);
    this.refreshNow();
  }

  getScopedStatus(status) {
    if (!this.activeCascadeId) {
      return {
        active: false,
        label: "",
        attempt: 0,
        maxAttempts: status?.maxAttempts || 0,
        path: "",
        model: "",
        cascadeId: "",
        statusCode: 0,
        message: "",
        updatedAt: 0,
        events: [],
        scopeCascadeId: "",
      };
    }

    const cascadeStatus = status?.cascades?.[this.activeCascadeId];
    if (!cascadeStatus || typeof cascadeStatus !== "object") {
      return {
        active: false,
        label: "",
        attempt: 0,
        maxAttempts: status?.maxAttempts || 0,
        path: "",
        model: "",
        cascadeId: "",
        statusCode: 0,
        message: "",
        updatedAt: 0,
        events: [],
        scopeCascadeId: "",
      };
    }

    return {
      ...cascadeStatus,
      maxAttempts: cascadeStatus.maxAttempts || status?.maxAttempts || 0,
      scopeCascadeId: this.activeCascadeId,
    };
  }

  render(status) {
    const config = this.getConfig();
    const events = Array.isArray(status.events) ? status.events.slice(-config.maxTooltipEvents).reverse() : [];
    const signature = JSON.stringify({
      active: status.active,
      label: status.label,
      attempt: status.attempt,
      model: status.model,
      cascadeId: status.scopeCascadeId || status.cascadeId,
      statusCode: status.statusCode,
      message: status.message,
      updatedAt: status.updatedAt,
      eventCount: Array.isArray(status.events) ? status.events.length : 0,
    });

    if (signature === this.lastStatusSignature && this.statusBar.text) {
      return;
    }
    this.lastStatusSignature = signature;

    this.statusBar.backgroundColor = undefined;
    this.statusBar.color = undefined;

    const label = (status.label || "").trim();
    const message = (status.message || "").trim();

    if (label === "Quota Exceeded") {
      this.statusBar.text = "$(error) Quota Exceeded";
      this.statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      this.statusBar.tooltip = this.buildTooltip(status, events, "This is a hard quota exhaustion error, not a temporary traffic spike.");
      this.statusBar.show();
      return;
    }

    if (status.active) {
      this.statusBar.text = `$(sync~spin) ${label || status.attempt || "?"}`;
      this.statusBar.tooltip = this.buildTooltip(status, events);
      this.statusBar.show();
      return;
    }

    if (message === "Recovered") {
      this.statusBar.text = "$(check) Recovered";
      this.statusBar.tooltip = this.buildTooltip(status, events);
      this.statusBar.show();
      return;
    }

    if (label === "Retry Failed") {
      this.statusBar.text = "$(error) Retry Failed";
      this.statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      this.statusBar.tooltip = this.buildTooltip(status, events, "The request exhausted retry attempts or the proxy could not reach the upstream service.");
      this.statusBar.show();
      return;
    }

    if (config.showWhenIdle) {
      this.statusBar.text = `$(debug-alt-small) ${config.idleText}`;
      this.statusBar.tooltip = this.buildTooltip(status, events);
      this.statusBar.show();
      return;
    }

    this.statusBar.hide();
  }

  buildTooltip(status, events, extraLine) {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown(`**Retry Status**\n\n`);
    md.appendMarkdown(`- Status: ${status.active ? "Retrying" : ((status.label || "").trim() || "Idle")}\n`);
    md.appendMarkdown(`- Attempt: ${status.attempt || 0}\n`);
    md.appendMarkdown(`- Cascade ID: ${status.scopeCascadeId || status.cascadeId || "-"}\n`);
    md.appendMarkdown(`- Model: ${status.model || "-"}\n`);
    md.appendMarkdown(`- Current error: ${status.message || (status.statusCode ? `HTTP ${status.statusCode}` : "-")}\n`);
    md.appendMarkdown(`- Endpoint: ${status.path || "-"}\n`);
    md.appendMarkdown(`- Updated at: ${formatTime(status.updatedAt)}\n`);
    if (extraLine) {
      md.appendMarkdown(`\n${extraLine}\n`);
    }
    if (events.length) {
      md.appendMarkdown(`\n**Recent events**\n`);
      for (const event of events) {
        md.appendMarkdown(`- ${formatEventLine(event)}\n`);
      }
    }
    md.appendMarkdown(`\n[Open log](command:retryStatusBar.showLog)`);
    return md;
  }

  async dumpAntigravityContext() {
    const activeGroup = vscode.window.tabGroups.activeTabGroup;
    const activeTab = activeGroup?.activeTab;
    const allCommands = await vscode.commands.getCommands(true);
    const antigravityCommands = allCommands.filter((command) => command.includes("antigravity"));
    const conversationCommands = allCommands.filter(
      (command) => command.includes("cascade") || command.includes("conversation"),
    );
    const antigravityDiagnostics = await tryExecuteCommand("antigravity.getDiagnostics");
    const antigravityWorkbenchTrace = await tryExecuteCommand("antigravity.getWorkbenchTrace");
    const antigravityManagerTrace = await tryExecuteCommand("antigravity.getManagerTrace");
    const antigravityManagerStatus = await tryExecuteCommand("antigravityAgentManager.reportStatus");
    const unifiedStateSync = vscode.antigravityUnifiedStateSync;
    const activeCascadeTopic = unifiedStateSync ? await unifiedStateSync.subscribe("uss-activeCascadeIds") : undefined;
    const windowConfigsTopic = unifiedStateSync ? await unifiedStateSync.subscribe("uss-windowConfigs") : undefined;
    const windowVisibilitiesTopic = unifiedStateSync ? await unifiedStateSync.subscribe("uss-windowVisibilities") : undefined;
    const dumpPath = path.join(os.tmpdir(), "retry-status-bar-context.json");

    const payload = {
      timestamp: new Date().toISOString(),
      process: {
        pid: process.pid,
        ppid: process.ppid,
        cwd: process.cwd(),
        argv: process.argv,
        execPath: process.execPath,
        env: pickProcessEnv([
          "VSCODE_IPC_HOOK",
          "VSCODE_IPC_HOOK_EXTHOST",
          "VSCODE_NLS_CONFIG",
          "VSCODE_HANDLES_UNCAUGHT_ERRORS",
          "VSCODE_CWD",
          "VSCODE_CODE_CACHE_PATH",
          "ELECTRON_RUN_AS_NODE",
        ]),
      },
      vscodeEnv: {
        appHost: vscode.env.appHost,
        appName: vscode.env.appName,
        language: vscode.env.language,
        machineId: vscode.env.machineId,
        remoteName: vscode.env.remoteName,
        sessionId: vscode.env.sessionId,
        shell: vscode.env.shell,
        uiKind: vscode.env.uiKind,
        uriScheme: vscode.env.uriScheme,
      },
      workspaceFolders: (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.toString()),
      activeTextEditor: vscode.window.activeTextEditor?.document.uri.toString() || null,
      visibleTextEditors: vscode.window.visibleTextEditors.map((editor) => editor.document.uri.toString()),
      activeTab: activeTab
        ? {
            label: activeTab.label,
            isActive: activeTab.isActive,
            isDirty: activeTab.isDirty,
            isPinned: activeTab.isPinned,
            input: describeTabInput(activeTab.input),
          }
        : null,
      activeTabGroup: activeGroup
        ? {
            viewColumn: activeGroup.viewColumn,
            isActive: activeGroup.isActive,
            tabs: activeGroup.tabs.map((tab) => ({
              label: tab.label,
              isActive: tab.isActive,
              isDirty: tab.isDirty,
              isPinned: tab.isPinned,
              input: describeTabInput(tab.input),
            })),
          }
        : null,
      antigravityCommands,
      conversationCommands,
      antigravityUnifiedStateSync: {
        available: Boolean(vscode.antigravityUnifiedStateSync),
        workspaceUri: getPrimaryWorkspaceUri(),
        windowKey: findWindowKeyForWorkspace(getUnifiedTopicState(windowConfigsTopic), getPrimaryWorkspaceUri()),
        activeCascadeId: this.activeCascadeId,
        activeCascadeState: this.activeCascadeState || null,
        activeCascadeTopicState: getUnifiedTopicState(activeCascadeTopic) || null,
        windowConfigsState: getUnifiedTopicState(windowConfigsTopic) || null,
        windowVisibilitiesState: getUnifiedTopicState(windowVisibilitiesTopic) || null,
      },
      antigravityDiagnostics,
      antigravityWorkbenchTrace,
      antigravityManagerTrace,
      antigravityManagerStatus,
    };

    if (typeof activeCascadeTopic?.dispose === "function") {
      activeCascadeTopic.dispose();
    }
    if (typeof windowConfigsTopic?.dispose === "function") {
      windowConfigsTopic.dispose();
    }
    if (typeof windowVisibilitiesTopic?.dispose === "function") {
      windowVisibilitiesTopic.dispose();
    }

    await fs.writeFile(dumpPath, `${formatJson(payload)}\n`, "utf8");
    this.output.appendLine("[diag] Antigravity context");
    this.output.appendLine(formatJson(payload));
    this.output.appendLine(`[diag] Saved to ${dumpPath}`);
    this.output.show(true);
    vscode.window.showInformationMessage(`Retry Status Bar: diagnostic context written to ${dumpPath}`);
  }
}

function activate(context) {
  const controller = new RetryStatusBarController(context);
  controller.start();
  context.subscriptions.push(controller);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
