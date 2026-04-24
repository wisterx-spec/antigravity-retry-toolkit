const vscode = require("vscode");
const fs = require("fs/promises");
const childProcess = require("child_process");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const util = require("util");

const execFileAsync = util.promisify(childProcess.execFile);
const toolkitLabel = "com.wister.antigravity-cloudcode-proxy";

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

function getHealthUrl(statusUrl) {
  try {
    const url = new URL(statusUrl);
    url.pathname = "/__health";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "http://127.0.0.1:38475/__health";
  }
}

function getToolkitPaths(proxyPort) {
  const settingsDir = path.join(os.homedir(), "Library", "Application Support", "Antigravity", "User");
  return {
    launchdDomain: `gui/${process.getuid?.() ?? process.pid}`,
    launchdTarget: `gui/${process.getuid?.() ?? process.pid}/${toolkitLabel}`,
    plistPath: path.join(os.homedir(), "Library", "LaunchAgents", `${toolkitLabel}.plist`),
    settingsDir,
    settingsPath: path.join(settingsDir, "settings.json"),
    statePath: path.join(settingsDir, "antigravity-retry-toolkit-state.json"),
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
  };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function removePathIfExists(filePath) {
  try {
    await fs.rm(filePath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures for already-removed files.
  }
}

function getExtensionsHome() {
  return path.dirname(getExtensionRegistryPath());
}

function getExtensionObsoletePath() {
  return path.join(getExtensionsHome(), ".obsolete");
}

class RetryStatusBarController {
  constructor(context) {
    this.context = context;
    this.output = vscode.window.createOutputChannel("Retry Status Bar");
    this.toolkitStatusBar = vscode.window.createStatusBarItem("retryStatusBar.toolkit", vscode.StatusBarAlignment.Left, 1001);
    this.toolkitStatusBar.name = "Retry Toolkit";
    this.toolkitStatusBar.command = "retryStatusBar.toggleToolkit";
    this.statusBar = vscode.window.createStatusBarItem("retryStatusBar.item", vscode.StatusBarAlignment.Left, 1000);
    this.statusBar.name = "Retry Status Bar";
    this.statusBar.command = "retryStatusBar.showLog";
    this.lastEventId = 0;
    this.lastStatusSignature = "";
    this.lastToolkitSignature = "";
    this.lastToolkitStatus = undefined;
    this.lastToolkitStatusAt = 0;
    this.logBuffer = [];
    this.maxLogLines = 200;
    this.timer = undefined;
    this.windowKey = "";
    this.activeCascadeId = "";
    this.activeCascadeState = undefined;
    this.windowConfigsState = undefined;
    this.unifiedStateSubscription = undefined;
    this.windowConfigsSubscription = undefined;
    this.versionMonitorTimer = undefined;
    this.reloadRequestedForVersion = "";

    context.subscriptions.push(this.output, this.statusBar, this.toolkitStatusBar);
    context.subscriptions.push(
      vscode.commands.registerCommand("retryStatusBar.showLog", () => this.showLog()),
      vscode.commands.registerCommand("retryStatusBar.refresh", () => this.refreshNow()),
      vscode.commands.registerCommand("retryStatusBar.stopCurrentRetry", () => this.stopCurrentRetry()),
      vscode.commands.registerCommand("retryStatusBar.dumpAntigravityContext", () => this.dumpAntigravityContext()),
      vscode.commands.registerCommand("retryStatusBar.enableToolkit", () => this.enableToolkit()),
      vscode.commands.registerCommand("retryStatusBar.disableToolkit", () => this.disableToolkit()),
      vscode.commands.registerCommand("retryStatusBar.restartToolkit", () => this.restartToolkit()),
      vscode.commands.registerCommand("retryStatusBar.showToolkitStatus", () => this.showToolkitStatus()),
      vscode.commands.registerCommand("retryStatusBar.toggleToolkit", () => this.toggleToolkit()),
      vscode.commands.registerCommand("retryStatusBar.uninstallToolkit", () => this.uninstallToolkit()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("retryStatusBar")) {
          this.restart();
        }
      }),
    );
  }

  start() {
    this.log(`Extension started v${this.context.extension?.packageJSON?.version || "unknown"}`);
    this.initializeCascadeTracking();
    this.restart();
    this.startInstalledVersionMonitor();
  }

  log(message) {
    const line = `${new Date().toLocaleTimeString()}  ${message}`;
    this.logBuffer.push(line);
    if (this.logBuffer.length > this.maxLogLines) {
      this.logBuffer.shift();
    }
    this.output.appendLine(line);
  }

  async showLog() {
    if (this.logBuffer.length === 0) {
      this.log("Log opened");
    }
    this.output.show(true);
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

  async getToolkitStatusCached(force = false) {
    const now = Date.now();
    if (!force && this.lastToolkitStatus && now - this.lastToolkitStatusAt < 3000) {
      return this.lastToolkitStatus;
    }
    const status = await this.getToolkitStatus();
    this.lastToolkitStatus = status;
    this.lastToolkitStatusAt = now;
    return status;
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
      healthUrl: getHealthUrl(config.get("statusUrl", "http://127.0.0.1:38475/__status")),
      stopUrl: config.get("stopUrl", "http://127.0.0.1:38475/__stop"),
      pollIntervalMs: config.get("pollIntervalMs", 1000),
      showWhenIdle: config.get("showWhenIdle", true),
      idleText: config.get("idleText", "0"),
      maxTooltipEvents: config.get("maxTooltipEvents", 8),
    };
  }

  async runLaunchctl(args, options = {}) {
    try {
      return await execFileAsync("launchctl", args);
    } catch (error) {
      if (options.ignoreFailure) {
        return { stdout: "", stderr: typeof error?.stderr === "string" ? error.stderr : "" };
      }
      throw new Error(typeof error?.stderr === "string" && error.stderr.trim() ? error.stderr.trim() : error.message);
    }
  }

  async ensureToolkitSettingsFile(toolkitPaths) {
    await fs.mkdir(toolkitPaths.settingsDir, { recursive: true });
    if (!(await fileExists(toolkitPaths.settingsPath))) {
      await fs.writeFile(toolkitPaths.settingsPath, "{}\n", "utf8");
    }
  }

  async updateToolkitSettings(mode) {
    const toolkitPaths = getToolkitPaths(this.getProxyPort());
    await this.ensureToolkitSettingsFile(toolkitPaths);

    const settings = await readJsonFile(toolkitPaths.settingsPath, {});
    const state = await readJsonFile(toolkitPaths.statePath, {});
    const currentUrl = typeof settings["jetski.cloudCodeUrl"] === "string" ? settings["jetski.cloudCodeUrl"] : "";

    if (mode === "enable") {
      if (currentUrl !== toolkitPaths.proxyUrl) {
        if (currentUrl) {
          state.previousCloudCodeUrl = currentUrl;
          state.hadPreviousCloudCodeUrl = true;
        } else {
          delete state.previousCloudCodeUrl;
          state.hadPreviousCloudCodeUrl = false;
        }
        settings["jetski.cloudCodeUrl"] = toolkitPaths.proxyUrl;
      }
      state.enabled = true;
    } else {
      if (state.hadPreviousCloudCodeUrl && typeof state.previousCloudCodeUrl === "string" && state.previousCloudCodeUrl) {
        settings["jetski.cloudCodeUrl"] = state.previousCloudCodeUrl;
      } else {
        delete settings["jetski.cloudCodeUrl"];
      }
      state.enabled = false;
    }

    state.proxyUrl = toolkitPaths.proxyUrl;
    state.updatedAt = new Date().toISOString();
    await fs.writeFile(toolkitPaths.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await fs.writeFile(toolkitPaths.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return { toolkitPaths, settings, state };
  }

  getProxyPort() {
    const statusUrl = this.getConfig().statusUrl;
    try {
      return new URL(statusUrl).port || "38475";
    } catch {
      return "38475";
    }
  }

  async getToolkitStatus() {
    const toolkitPaths = getToolkitPaths(this.getProxyPort());
    const config = this.getConfig();
    const settings = await readJsonFile(toolkitPaths.settingsPath, {});
    const state = await readJsonFile(toolkitPaths.statePath, {});
    let proxyLoaded = false;
    try {
      await this.runLaunchctl(["print", toolkitPaths.launchdTarget]);
      proxyLoaded = true;
    } catch {
      proxyLoaded = false;
    }

    let proxyHealthy = false;
    let healthError = "";
    let healthPayload = undefined;
    try {
      healthPayload = await this.fetchStatus(config.healthUrl);
      proxyHealthy = Boolean(healthPayload?.ok);
    } catch (error) {
      proxyHealthy = false;
      healthError = typeof error?.message === "string" ? error.message : String(error);
    }

    const toolkitEnabledInSettings = settings["jetski.cloudCodeUrl"] === toolkitPaths.proxyUrl;
    let mode = "off";
    if (toolkitEnabledInSettings && proxyHealthy) {
      mode = "on";
    } else if (toolkitEnabledInSettings && proxyLoaded) {
      mode = "starting";
    } else if (toolkitEnabledInSettings) {
      mode = "error";
    } else if (proxyLoaded || proxyHealthy) {
      mode = "paused";
    }

    return {
      settingsPath: toolkitPaths.settingsPath,
      statePath: toolkitPaths.statePath,
      currentCloudCodeUrl: typeof settings["jetski.cloudCodeUrl"] === "string" ? settings["jetski.cloudCodeUrl"] : "",
      proxyUrl: toolkitPaths.proxyUrl,
      toolkitEnabledInSettings,
      rememberedPreviousCloudCodeUrl: state.previousCloudCodeUrl || "",
      stateEnabled: Boolean(state.enabled),
      proxyPlistPath: toolkitPaths.plistPath,
      proxyPlistExists: await fileExists(toolkitPaths.plistPath),
      proxyLoaded,
      proxyHealthy,
      healthError,
      healthUrl: config.healthUrl,
      healthPayload,
      mode,
    };
  }

  async startToolkitProxy() {
    const toolkitPaths = getToolkitPaths(this.getProxyPort());
    if (!(await fileExists(toolkitPaths.plistPath))) {
      throw new Error(`Proxy plist not found: ${toolkitPaths.plistPath}. Run scripts/install-proxy.sh once first.`);
    }
    await this.runLaunchctl(["enable", toolkitPaths.launchdTarget], { ignoreFailure: true });
    await this.runLaunchctl(["bootstrap", toolkitPaths.launchdDomain, toolkitPaths.plistPath], { ignoreFailure: true });
    await this.runLaunchctl(["kickstart", "-k", toolkitPaths.launchdTarget], { ignoreFailure: true });
  }

  async stopToolkitProxy() {
    const toolkitPaths = getToolkitPaths(this.getProxyPort());
    if (!(await fileExists(toolkitPaths.plistPath))) {
      return;
    }
    await this.runLaunchctl(["bootout", toolkitPaths.launchdDomain, toolkitPaths.plistPath], { ignoreFailure: true });
    await this.runLaunchctl(["disable", toolkitPaths.launchdTarget], { ignoreFailure: true });
  }

  async enableToolkit() {
    try {
      await this.startToolkitProxy();
      const { toolkitPaths } = await this.updateToolkitSettings("enable");
      this.lastToolkitStatus = undefined;
      this.lastToolkitStatusAt = 0;
      this.log(`[diag] Toolkit enabled: ${toolkitPaths.proxyUrl}`);
      await this.refreshNow();
    } catch (error) {
      const message = typeof error?.message === "string" ? error.message : String(error);
      this.log(`[diag] Toolkit enable failed: ${message}`);
      vscode.window.showErrorMessage(`Retry Status Bar: ${message}`);
    }
  }

  async disableToolkit() {
    try {
      await this.updateToolkitSettings("disable");
      await this.stopToolkitProxy();
      this.lastToolkitStatus = undefined;
      this.lastToolkitStatusAt = 0;
      this.log("[diag] Toolkit disabled");
      await this.refreshNow();
    } catch (error) {
      const message = typeof error?.message === "string" ? error.message : String(error);
      this.log(`[diag] Toolkit disable failed: ${message}`);
      vscode.window.showErrorMessage(`Retry Status Bar: ${message}`);
    }
  }

  async cleanupToolkitArtifacts() {
    const toolkitPaths = getToolkitPaths(this.getProxyPort());
    const pathsToRemove = [
      toolkitPaths.plistPath,
      toolkitPaths.statePath,
      path.join(os.homedir(), "Library", "Logs", "antigravity-cloudcode-proxy.log"),
      path.join(os.homedir(), "Library", "Logs", "antigravity-cloudcode-proxy-attempts.jsonl"),
    ];
    await Promise.all(pathsToRemove.map((filePath) => removePathIfExists(filePath)));
  }

  async uninstallInstalledExtension() {
    const packageJson = this.context.extension?.packageJSON;
    const extensionId = packageJson ? `${packageJson.publisher}.${packageJson.name}` : "";
    if (!extensionId) {
      return { extensionId: "", removedDirectories: [] };
    }

    const extensionsHome = getExtensionsHome();
    const registryPath = getExtensionRegistryPath();
    const obsoletePath = getExtensionObsoletePath();

    await fs.mkdir(extensionsHome, { recursive: true });

    const registry = await readJsonFile(registryPath, []);
    const nextRegistry = Array.isArray(registry)
      ? registry.filter((entry) => entry?.identifier?.id !== extensionId)
      : [];
    await writeJsonFile(registryPath, nextRegistry);

    const obsolete = await readJsonFile(obsoletePath, {});
    const directoryEntries = await fs.readdir(extensionsHome, { withFileTypes: true });
    const removedDirectories = [];

    for (const entry of directoryEntries) {
      if (!entry.isDirectory() || !entry.name.startsWith(`${extensionId}-`)) {
        continue;
      }
      removedDirectories.push(path.join(extensionsHome, entry.name));
      obsolete[entry.name] = true;
    }

    await writeJsonFile(obsoletePath, obsolete);

    if (removedDirectories.length) {
      const cleanupScript = `
        const fs = require("fs");
        const targets = ${JSON.stringify(removedDirectories)};
        setTimeout(() => {
          for (const target of targets) {
            try {
              fs.rmSync(target, { recursive: true, force: true });
            } catch {}
          }
        }, 1500);
      `;
      const cleanupProcess = childProcess.spawn(process.execPath, ["-e", cleanupScript], {
        detached: true,
        stdio: "ignore",
      });
      cleanupProcess.unref();
    }

    return { extensionId, removedDirectories };
  }

  async uninstallToolkit() {
    const decision = await vscode.window.showWarningMessage(
      "Uninstall Retry Toolkit? This restores cloudCodeUrl, removes the local proxy launch agent, and uninstalls the status bar extension.",
      { modal: true },
      "Uninstall",
    );
    if (decision !== "Uninstall") {
      return;
    }

    try {
      await this.updateToolkitSettings("disable");
      await this.stopToolkitProxy();
      await this.cleanupToolkitArtifacts();
      const extensionRemoval = await this.uninstallInstalledExtension();
      this.lastToolkitStatus = undefined;
      this.lastToolkitStatusAt = 0;
      this.log(
        `[diag] Toolkit uninstalled${extensionRemoval.extensionId ? `: ${extensionRemoval.extensionId}` : ""}`,
      );
      await this.refreshNow();
      vscode.window.showInformationMessage("Retry toolkit uninstalled. Reloading window to finish cleanup.");
      setTimeout(() => {
        vscode.commands.executeCommand("workbench.action.reloadWindow");
      }, 300);
    } catch (error) {
      const message = typeof error?.message === "string" ? error.message : String(error);
      this.log(`[diag] Toolkit uninstall failed: ${message}`);
      vscode.window.showErrorMessage(`Retry Status Bar: ${message}`);
    }
  }

  async restartToolkit() {
    try {
      await this.stopToolkitProxy();
      await this.startToolkitProxy();
      const { toolkitPaths } = await this.updateToolkitSettings("enable");
      this.lastToolkitStatus = undefined;
      this.lastToolkitStatusAt = 0;
      this.log(`[diag] Toolkit restarted: ${toolkitPaths.proxyUrl}`);
      await this.refreshNow();
    } catch (error) {
      const message = typeof error?.message === "string" ? error.message : String(error);
      this.log(`[diag] Toolkit restart failed: ${message}`);
      vscode.window.showErrorMessage(`Retry Status Bar: ${message}`);
    }
  }

  async showToolkitStatus() {
    const status = await this.getToolkitStatusCached(true);
    this.log("[diag] Toolkit status");
    this.output.appendLine(formatJson(status));
    this.output.show(true);
    const summary = {
      on: "enabled and healthy",
      starting: "enabled, proxy is starting",
      error: "enabled, but proxy is unavailable",
      paused: "paused",
      off: "off",
    }[status.mode] || "unknown";
    vscode.window.showInformationMessage(`Retry Status Bar: ${summary}`);
  }

  async toggleToolkit() {
    const status = await this.getToolkitStatusCached(true);
    if (status.mode === "on") {
      await this.disableToolkit();
      return;
    }
    if (status.mode === "starting" || status.mode === "error") {
      await this.restartToolkit();
      return;
    }
    await this.enableToolkit();
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
    const toolkitStatus = await this.getToolkitStatusCached();
    this.renderToolkitStatus(toolkitStatus);

    try {
      if (toolkitStatus.mode === "off" || toolkitStatus.mode === "paused") {
        this.renderDisabledRetryStatus();
        return;
      }
      const status = await this.fetchStatus(this.getConfig().statusUrl);
      const scopedStatus = this.getScopedStatus(status);
      this.consumeEvents(scopedStatus.events || []);
      this.render(scopedStatus);
    } catch (error) {
      this.renderRetryUnavailable(toolkitStatus, error);
      this.statusBar.show();
    }
  }

  renderToolkitStatus(status) {
    const effectiveStatus = status || {
      mode: "off",
      toolkitEnabledInSettings: false,
      proxyLoaded: false,
      proxyHealthy: false,
      currentCloudCodeUrl: "",
      proxyUrl: `http://127.0.0.1:${this.getProxyPort()}`,
    };

    const signature = JSON.stringify({
      mode: effectiveStatus.mode,
      toolkitEnabledInSettings: effectiveStatus.toolkitEnabledInSettings,
      proxyLoaded: effectiveStatus.proxyLoaded,
      proxyHealthy: effectiveStatus.proxyHealthy,
      currentCloudCodeUrl: effectiveStatus.currentCloudCodeUrl,
      proxyUrl: effectiveStatus.proxyUrl,
    });

    if (signature === this.lastToolkitSignature && this.toolkitStatusBar.text) {
      return;
    }
    this.lastToolkitSignature = signature;

    this.toolkitStatusBar.backgroundColor = undefined;
    this.toolkitStatusBar.color = undefined;

    if (effectiveStatus.mode === "on") {
      this.toolkitStatusBar.text = "$(shield) Toolkit On";
      this.toolkitStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.prominentBackground");
    } else if (effectiveStatus.mode === "starting") {
      this.toolkitStatusBar.text = "$(sync~spin) Toolkit Starting";
      this.toolkitStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else if (effectiveStatus.mode === "error") {
      this.toolkitStatusBar.text = "$(error) Toolkit Error";
      this.toolkitStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else if (effectiveStatus.mode === "paused") {
      this.toolkitStatusBar.text = "$(debug-pause) Toolkit Paused";
    } else {
      this.toolkitStatusBar.text = "$(circle-slash) Toolkit Off";
    }

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown(`**Retry Toolkit**\n\n`);
    md.appendMarkdown(`- Mode: ${effectiveStatus.mode || "off"}\n`);
    md.appendMarkdown(`- Settings enabled: ${effectiveStatus.toolkitEnabledInSettings ? "yes" : "no"}\n`);
    md.appendMarkdown(`- Proxy loaded: ${effectiveStatus.proxyLoaded ? "yes" : "no"}\n`);
    md.appendMarkdown(`- Proxy healthy: ${effectiveStatus.proxyHealthy ? "yes" : "no"}\n`);
    md.appendMarkdown(`- Proxy URL: ${effectiveStatus.proxyUrl || "-"}\n`);
    md.appendMarkdown(`- Current cloudCodeUrl: ${effectiveStatus.currentCloudCodeUrl || "-"}\n`);
    if (effectiveStatus.healthError) {
      md.appendMarkdown(`- Health error: ${effectiveStatus.healthError}\n`);
    }
    if (effectiveStatus.mode === "on") {
      md.appendMarkdown(`\nClick the status bar item to pause the toolkit.\n`);
    } else if (effectiveStatus.mode === "starting" || effectiveStatus.mode === "error") {
      md.appendMarkdown(`\nClick the status bar item to restart the toolkit.\n`);
    } else {
      md.appendMarkdown(`\nClick the status bar item to enable the toolkit.\n`);
    }
    md.appendMarkdown(
      `\n[Restart](command:retryStatusBar.restartToolkit) · [Status](command:retryStatusBar.showToolkitStatus) · [Uninstall](command:retryStatusBar.uninstallToolkit)`,
    );
    this.toolkitStatusBar.tooltip = md;
    this.toolkitStatusBar.show();
  }

  renderDisabledRetryStatus() {
    const config = this.getConfig();
    if (config.showWhenIdle) {
      this.statusBar.backgroundColor = undefined;
      this.statusBar.color = undefined;
      this.statusBar.text = `$(debug-alt-small) ${config.idleText}`;
      this.statusBar.tooltip = "Retry toolkit is currently off.";
      this.statusBar.show();
      return;
    }
    this.statusBar.hide();
  }

  renderRetryUnavailable(toolkitStatus, error) {
    const message = typeof error?.message === "string" ? error.message : String(error);
    this.statusBar.backgroundColor = undefined;
    this.statusBar.color = undefined;

    if (toolkitStatus?.mode === "starting") {
      this.statusBar.text = "$(sync~spin) Proxy Starting";
      this.statusBar.tooltip = `Toolkit is starting.\n\n${message}`;
      return;
    }

    if (toolkitStatus?.mode === "error") {
      this.statusBar.text = "$(warning) Proxy Unavailable";
      this.statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      this.statusBar.tooltip = `Toolkit is enabled, but the local proxy is unavailable.\n\n${message}`;
      return;
    }

    this.statusBar.text = "$(warning) Retry status unavailable";
    this.statusBar.tooltip = message;
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

  postJson(urlString, payload) {
    return new Promise((resolve, reject) => {
      let url;
      try {
        url = new URL(urlString);
      } catch {
        reject(new Error(`Invalid retry control URL: ${urlString}`));
        return;
      }

      const body = Buffer.from(JSON.stringify(payload));
      const client = url.protocol === "https:" ? https : http;
      const req = client.request(
        url,
        {
          method: "POST",
          timeout: 1500,
          headers: {
            "content-type": "application/json",
            "content-length": String(body.length),
            "cache-control": "no-cache",
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => {
            const responseText = Buffer.concat(chunks).toString("utf8");
            let parsed = {};
            if (responseText) {
              try {
                parsed = JSON.parse(responseText);
              } catch {
                reject(new Error(`Invalid JSON from control endpoint: ${responseText}`));
                return;
              }
            }

            if ((res.statusCode || 0) >= 400) {
              reject(new Error(parsed?.message || `Retry control failed: HTTP ${res.statusCode}`));
              return;
            }

            resolve(parsed);
          });
        },
      );

      req.on("timeout", () => {
        req.destroy(new Error("Retry control timeout"));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  consumeEvents(events) {
    for (const event of events) {
      if (!event || typeof event.id !== "number" || event.id <= this.lastEventId) {
        continue;
      }
      this.lastEventId = event.id;
      this.log(formatEventLine(event));
    }
  }

  async stopCurrentRetry() {
    if (!this.activeCascadeId) {
      vscode.window.showWarningMessage("Retry Status Bar: there is no active conversation retry to stop.");
      return;
    }

    try {
      await this.postJson(this.getConfig().stopUrl, { cascadeId: this.activeCascadeId });
      this.log(`[diag] Manual stop requested for cascade ${this.activeCascadeId}`);
      await this.refreshNow();
      vscode.window.showInformationMessage(`Retry Status Bar: stopped retry for ${this.activeCascadeId}`);
    } catch (error) {
      const message = typeof error?.message === "string" ? error.message : String(error);
      this.log(`[diag] Manual stop failed for ${this.activeCascadeId}: ${message}`);
      vscode.window.showErrorMessage(`Retry Status Bar: ${message}`);
    }
  }

  async initializeCascadeTracking() {
    const unifiedStateSync = vscode.antigravityUnifiedStateSync;
    if (!unifiedStateSync || typeof unifiedStateSync.subscribe !== "function") {
      this.log("[diag] antigravityUnifiedStateSync is unavailable; falling back to global retry status.");
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
      this.log(
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
    this.log(`[diag] Active cascade for workspace window ${this.windowKey || "-"}: ${this.activeCascadeId || "-"}`);
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

    if (label === "Stopped") {
      this.statusBar.text = "$(circle-slash) Stopped";
      this.statusBar.tooltip = this.buildTooltip(status, events, "The current conversation retry was stopped manually.");
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
    md.appendMarkdown(`\n`);
    if (status.active && (status.scopeCascadeId || status.cascadeId)) {
      md.appendMarkdown(`[Stop retry](command:retryStatusBar.stopCurrentRetry) · `);
    }
    md.appendMarkdown(`[Open log](command:retryStatusBar.showLog)`);
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
    const retryProxyStatus = await this.fetchStatus(this.getConfig().statusUrl).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: typeof error?.message === "string" ? error.message : String(error) }),
    );
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
      retryProxyStatus,
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
    this.log("[diag] Antigravity context");
    this.output.appendLine(formatJson(payload));
    this.log(`[diag] Saved to ${dumpPath}`);
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
