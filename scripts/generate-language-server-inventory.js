#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");

const defaultBinaryPath =
  "/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm";

function parseArgs(argv) {
  let binaryPath = defaultBinaryPath;
  let outputPath = null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--write" && argv[index + 1]) {
      outputPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--binary" && argv[index + 1]) {
      binaryPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (!value.startsWith("--")) {
      binaryPath = value;
    }
  }

  return { binaryPath, outputPath };
}

const { binaryPath, outputPath } = parseArgs(process.argv.slice(2));

function sh(command) {
  return execFileSync("sh", ["-lc", command], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function markdownEscape(value) {
  return String(value).replace(/\|/g, "\\|");
}

function splitCamelCase(value) {
  return value
    .replace(/Mcp/g, "MCP ")
    .replace(/Citc/g, "CITC ")
    .replace(/PR/g, "PR ")
    .replace(/Url/g, "URL ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function inferPattern(methodName) {
  if (/^(Stream|Watch|Subscribe)/.test(methodName) || methodName === "HandleStreamingCommand") {
    return "stream";
  }
  return "unary";
}

function inferCategory(methodName) {
  if (/^(Heartbeat|GetStatus|Restart|Exit|ReconnectExtensionServer|SignalExecutableIdle|ManageSidecar|SubscribeToSidecars|GetSidecars|GetSidecarEvents|DumpFlightRecorder|DumpPprof|SimulateSegFault)$/.test(methodName)) {
    return "Lifecycle";
  }
  if (/^(FetchUserInfo|GetUserStatus|SetUserInfo|GetTermsOfService|AcceptTermsOfService|RegisterGdmUser|MigrateApiKey|CompleteMcpOAuth|DisconnectMcpOAuth|GetTokenBase)$/.test(methodName)) {
    return "Auth/User";
  }
  if (/^(GetAvailableModels|GetModelStatuses|GetModelResponse|GetLoadCodeAssist|GetCascadeModelConfigData|GetCascadeModelConfigs|GetCommandModelConfigs|SetCloudCodeURL)$/.test(methodName)) {
    return "Models";
  }
  if (
    /(Cascade|Conversation|AgentStatePage|AgentMessage|StreamingCommand|HandleCascadeUserInteraction|ResolveOutstandingSteps|DeleteQueuedUserInputStep|SendStepsToBackground|SendActionToChatPanel|SendAllQueuedMessages|SmartFocusConversation|ForceBackgroundResearchRefresh)/.test(
      methodName,
    ) ||
    /^(StartCascade|SendUserCascadeMessage|RequestAgentStatePageUpdate|ForceStopCascadeTree)$/.test(methodName)
  ) {
    return "Cascade/Agent";
  }
  if (/(Trajectory|Memories|Memory|Replay)/.test(methodName)) {
    return "Trajectory/Memory";
  }
  if (
    /(Worktree|Workspace|Repo|Directory|File|Uri|WorkingDirectories|TrackedWorkspace|PatchAndCodeChange|RevertPreview|CommitMessage|ReadDir|ReadFile|WriteFile|DeleteFileOrDirectory|StatUri|SearchCode|SearchFiles)/.test(
      methodName,
    )
  ) {
    return "Workspace/File";
  }
  if (/(Browser|Screenshot|ScreenRecording|OpenUrl|OpenBrowser|ListPages)/.test(methodName)) {
    return "Browser/Screen";
  }
  if (/(Audio|Transcription)/.test(methodName)) {
    return "Audio";
  }
  if (/(Mcp|Plugin|Skill|Customization|Workflow|Rules|Prompt|UniversitySandbox)/.test(methodName)) {
    return "MCP/Plugins";
  }
  if (/(Unleash|Experiment|StaticConfig)/.test(methodName)) {
    return "Experiments/Config";
  }
  if (/^(Record|ProvideCompletionFeedback|GetUserAnalyticsSummary|CaptureConsoleLogs)/.test(methodName)) {
    return "Telemetry/Feedback";
  }
  if (/(BattleMode|ProfileData|Team|OrganizationalControls|FocusUserPage|WellSupportedLanguages|GetAllSkills|GetAllPlugins|GetAllWorkflows|GetAgentScripts)/.test(methodName)) {
    return "Product";
  }
  return "Other";
}

const purposeOverrides = new Map(
  Object.entries({
    AcceptTermsOfService: "Accept and persist the current terms-of-service decision for the user.",
    AcknowledgeCascadeCodeEdit: "Confirm that a cascade-proposed code edit was seen, applied, or dismissed.",
    AcknowledgeCodeActionStep: "Acknowledge a code-action step inside a larger guided flow.",
    BrowserValidateCascadeOrCancelOverlay:
      "Coordinate a browser-side validation flow and either continue or cancel a cascade overlay interaction.",
    CompleteMcpOAuth: "Finish an MCP OAuth exchange and bind the resulting auth state locally.",
    CreateCitcWorkspace: "Create a CITC-style workspace and return its local metadata.",
    CreateReplayWorkspace: "Create a workspace for replaying or inspecting recorded trajectories.",
    CreateTrajectoryShare: "Create a shareable export or link for a saved trajectory.",
    DumpFlightRecorder: "Export internal runtime/flight-recorder diagnostics for debugging.",
    DumpPprof: "Export profiling data from the Go process for debugging or performance analysis.",
    FetchUserInfo: "Fetch the current signed-in user identity and profile data.",
    ForceBackgroundResearchRefresh: "Force-refresh background research state outside the normal scheduling flow.",
    ForceStopCascadeTree: "Force-stop a cascade tree and its child work regardless of normal shutdown state.",
    GenerateCommitMessage: "Generate a commit message from repo diff/context.",
    GenerateSkillInstallationCL: "Generate change-list content for installing or updating skills.",
    GetAvailableModels: "Fetch the currently available model catalog for the local product surface.",
    GetBrowserOpenConversation: "Read which conversation should currently be opened in the browser surface.",
    GetCascadeMemories: "Load memory items associated with a cascade or conversation.",
    GetCascadeModelConfigData: "Read richer per-cascade model configuration metadata.",
    GetCascadeModelConfigs: "Read model options/configuration used for cascade-style interactions.",
    GetChangelog: "Fetch or render product changelog content.",
    GetCommandModelConfigs: "Read model options/configuration used for command-style interactions.",
    GetDebugDiagnostics: "Return internal debug/diagnostic state for inspection.",
    GetLoadCodeAssist: "Load or initialize code-assist state from cloud code.",
    GetMcpPrompt: "Resolve and return a specific MCP prompt definition.",
    GetMcpServerStates: "Return current MCP server status/health state.",
    GetMcpServerTemplates: "Return MCP server template/configuration definitions.",
    GetModelResponse: "Execute or fetch a model response through the language-server surface.",
    GetModelStatuses: "Return per-model status/availability information.",
    GetPatchAndCodeChange: "Produce patch/code-change artifacts for the current task or trajectory state.",
    GetRevertPreview: "Preview how reverting to a prior step or patch state would look.",
    GetSidecarEvents: "Read recent sidecar lifecycle or state-change events.",
    GetSidecars: "Return the currently known/managed sidecar instances.",
    GetSkillMarketplaceLink: "Return the marketplace URL or link target for skills.",
    GetStaticExperimentStatus: "Return current static experiment/config enablement state.",
    GetTokenBase: "Return token/account base state used by downstream auth flows.",
    GetTranscription: "Fetch or produce a transcription result for captured audio.",
    GetUnleashData: "Fetch feature-flag/unleash state for this install or user.",
    GetUserAnalyticsSummary: "Return a summary view of user/product analytics state.",
    GetUserMemories: "Load user-level memory items independent of a single cascade.",
    GetUserTrajectory: "Load a recorded user trajectory artifact.",
    GetUserTrajectoryDebug: "Load a debug-oriented view of a recorded trajectory.",
    GetUserTrajectoryDescriptions: "Return descriptions/metadata for stored trajectories.",
    GetWebDocsOptions: "Return web/docs retrieval options available to the product.",
    HandleCascadeUserInteraction: "Handle an interactive user event within an active cascade.",
    HandleScreenRecording: "Handle screen-recording state or events during a workflow.",
    HandleStreamingCommand: "Run a server-streaming command workflow for interactive coding/chat operations.",
    Heartbeat: "Report liveliness/health for the local service.",
    ImportFromCursor: "Import state or artifacts from Cursor into Antigravity/Jetski state.",
    InitializeCascadePanelState: "Initialize the panel/UI state for a cascade session.",
    InstallCascadePlugin: "Install a cascade plugin into the local environment.",
    JetboxDeleteSummary: "Delete a Jetbox-managed summary artifact.",
    JetboxGetLatestVersion: "Fetch the latest available Jetbox version/state.",
    JetboxSubscribeToGcertState: "Subscribe to Jetbox gcert-related state updates.",
    JetboxSubscribeToOAuthState: "Subscribe to Jetbox OAuth state updates.",
    JetboxSubscribeToState: "Subscribe to core Jetbox state updates.",
    JetboxSubscribeToSummaries: "Subscribe to Jetbox summary updates.",
    JetboxWriteState: "Write Jetbox state from the local process.",
    JetboxWriteSummary: "Write a Jetbox summary artifact from the local process.",
    ListCustomizationPathsByFile: "List customization definitions relevant to a given file/path.",
    ListMcpPrompts: "List MCP-provided prompt definitions.",
    ListMcpResources: "List MCP-provided resources/connectors.",
    LoadReplayConversation: "Load a replayable conversation artifact into active state.",
    LoadTrajectory: "Load a stored trajectory into active memory/UI state.",
    ManageSidecar: "Manage the lifecycle or mode of a local sidecar process.",
    MigrateApiKey: "Migrate legacy API-key auth into the current auth path.",
    OpenUrl: "Open a URL in a browser or browser-like embedded surface.",
    ProvideCompletionFeedback: "Send user feedback about a completion result.",
    ReadDir: "Read directory contents through the language-server file abstraction.",
    ReadFile: "Read file contents through the language-server file abstraction.",
    ReconnectExtensionServer: "Reconnect the extension host/server after a disconnect.",
    RecordInteractiveCascadeFeedback: "Persist feedback about an interactive cascade run.",
    RecordObservabilityData: "Persist observability/diagnostic telemetry from the local product.",
    RecordUserGrep: "Record usage around user grep/search behavior.",
    RecordUserStepSnapshot: "Persist a snapshot of user step state within a trajectory/cascade.",
    RefreshContextForIdeAction: "Refresh contextual state before handling an IDE-triggered action.",
    RefreshMcpServers: "Refresh MCP server registrations/configuration from local state.",
    ReplayGroundTruthTrajectory: "Replay a trajectory against stored ground-truth data.",
    RequestAgentStatePageUpdate: "Request a UI/state-page update for current agent state.",
    ResolveOutstandingSteps: "Resolve pending steps in an active cascade/agent plan.",
    RevertToCascadeStep: "Move active state back to a prior cascade step.",
    RunCommand: "Run a local or remote command as part of the workflow.",
    SaveAgentScriptCommandSpec: "Persist a command spec used by an agent script.",
    SaveMediaAsArtifact: "Persist captured media into the artifact store.",
    SaveScreenRecording: "Persist a completed screen recording artifact.",
    ScanSkillsConfigFile: "Scan a skills configuration file and refresh in-memory definitions.",
    SearchCode: "Search code using local or indexed search facilities.",
    SearchConversations: "Search stored conversations or cascade history.",
    SearchFiles: "Search files using local or indexed file search facilities.",
    SendActionToChatPanel: "Send an action/result into the chat panel surface.",
    SendAgentMessage: "Send a message into an active agent session.",
    SendAllQueuedMessages: "Flush queued messages into the active flow.",
    SendAudioChunk: "Send one chunk of audio into a transcription/audio session.",
    SendStepsToBackground: "Move selected steps/work into background execution.",
    SendUserCascadeMessage: "Send a top-level user message into a cascade/chat workflow.",
    SetBaseExperiments: "Set the base experiment configuration for the local process.",
    SetBrowserOpenConversation: "Set which conversation the browser surface should open.",
    SetCloudCodeURL: "Override the cloud code endpoint used by the local process.",
    SetOrVerifyStaticConfig: "Set or verify static local configuration/state.",
    SetUserInfo: "Update local user/account metadata.",
    SetUserSettings: "Persist user settings through the language-server surface.",
    SetWorkingDirectories: "Set the working directories used by the local process.",
    SetupUniversitySandbox: "Set up an education/sandbox mode for the product.",
    ShouldEnableUnleash: "Decide whether unleash/feature flags should be enabled.",
    SignalExecutableIdle: "Signal that a managed executable is idle.",
    SkipBrowserSubagent: "Skip or dismiss a browser subagent interaction.",
    SkipOnboarding: "Skip the onboarding flow for the current user/install.",
    SmartFocusConversation: "Apply product-specific logic to focus the most relevant conversation.",
    SmartOpenBrowser: "Open a browser target using product-specific heuristics/context.",
    StartBattleMode: "Enter battle-mode or evaluation-style workflow mode.",
    StartCascade: "Start a new cascade session.",
    StartScreenRecording: "Start screen recording for the current workflow.",
    StatUri: "Return metadata/stat information for a URI/path.",
    StreamAgentStateUpdates: "Stream incremental agent state updates.",
    StreamAudioTranscription: "Stream incremental transcription messages from an audio session.",
    StreamCascadePanelReactiveUpdates: "Stream reactive updates for the cascade panel UI.",
    StreamCascadeReactiveUpdates: "Stream reactive updates for a running cascade.",
    StreamCascadeSummariesReactiveUpdates: "Stream reactive updates for cascade summaries.",
    StreamTerminalShellCommand: "Stream output and state for a shell command execution.",
    StreamUserTrajectoryReactiveUpdates: "Stream reactive updates for user trajectory state.",
    SubscribeToSidecars: "Subscribe to sidecar lifecycle/state updates.",
    UpdateCascadeMemory: "Update memory content associated with a cascade.",
    UpdateConversationAnnotations: "Update stored annotations attached to a conversation.",
    UpdateCustomization: "Update a customization definition or object.",
    UpdateCustomizationPathsFile: "Update the file that stores customization-to-path mappings.",
    UpdateDevExperiments: "Update developer experiment configuration.",
    UpdateEnterpriseExperimentsFromUrl: "Load enterprise experiment settings from a URL source.",
    UpdatePRForWorktree: "Update a pull request associated with a worktree.",
    WatchDirectory: "Watch a directory and stream back file-system changes.",
    WellSupportedLanguages: "Return the currently well-supported languages.",
    WriteFile: "Write file contents through the language-server file abstraction.",
  }),
);

function inferPurpose(methodName) {
  if (purposeOverrides.has(methodName)) {
    return purposeOverrides.get(methodName);
  }

  const parts = splitCamelCase(methodName);
  const verb = parts[0] || methodName;
  const object = parts.slice(1).join(" ").toLowerCase();
  const templates = {
    Accept: `Accept or acknowledge ${object} for the current user/session.`,
    Acknowledge: `Acknowledge completion or receipt of ${object}.`,
    Add: `Add ${object} to local or server-managed state.`,
    Cancel: `Cancel in-flight ${object} work.`,
    Capture: `Capture ${object} data for runtime or debugging use.`,
    Checkout: `Checkout or switch ${object} state.`,
    Complete: `Finish ${object} handshake or workflow.`,
    Convert: `Convert ${object} into another representation.`,
    Copy: `Copy ${object} into a workspace-local form.`,
    Create: `Create ${object} resources or local artifacts.`,
    Delete: `Delete ${object} from local or remote state.`,
    Disconnect: `Disconnect ${object} integration or session.`,
    Dump: `Dump ${object} diagnostics for debugging.`,
    End: `End the active ${object} session or mode.`,
    Fetch: `Fetch ${object} from a local or remote service.`,
    Focus: `Bring focus to ${object} in the UI or workflow.`,
    Force: `Force-refresh or force-stop ${object} behavior outside the normal flow.`,
    Fork: `Fork ${object} into a new branch of work or conversation state.`,
    Generate: `Generate ${object} from current repo/session context.`,
    Get: `Read or compute ${object} state.`,
    Handle: `Handle ${object} as part of an active workflow.`,
    Import: `Import ${object} into local product state.`,
    Initialize: `Initialize ${object} state.`,
    Install: `Install ${object} into the local environment.`,
    List: `List available ${object} items.`,
    Load: `Load ${object} into active memory or UI state.`,
    Manage: `Manage ${object} lifecycle or coordination.`,
    Migrate: `Migrate ${object} into a newer auth/config path.`,
    Open: `Open ${object} in an external or embedded surface.`,
    Provide: `Provide ${object} back to the service for learning or control.`,
    Read: `Read ${object} contents.`,
    Reconnect: `Reconnect ${object} after a disconnect or restart.`,
    Record: `Record ${object} telemetry, analytics, or feedback.`,
    Refresh: `Refresh ${object} state from the current environment.`,
    Register: `Register ${object} with a local or remote service.`,
    Remove: `Remove ${object} from tracked state.`,
    Replay: `Replay ${object} for analysis or reproduction.`,
    Request: `Request ${object} update or action.`,
    Reset: `Reset ${object} to a default state.`,
    Resolve: `Resolve pending ${object} work.`,
    Restart: `Restart the local service or managed worker.`,
    Revert: `Revert to ${object} state.`,
    Run: `Run ${object} against the current environment.`,
    Save: `Save ${object} as a persistent artifact.`,
    Scan: `Scan ${object} for available definitions or changes.`,
    Search: `Search ${object} against local or remote indices.`,
    Send: `Send ${object} into an active workflow or remote call.`,
    Set: `Set ${object} configuration or state.`,
    Setup: `Set up ${object} for the current install/user.`,
    Should: `Check whether ${object} should be enabled.`,
    Signal: `Signal ${object} state to the service.`,
    Simulate: `Simulate ${object} for testing or diagnostics.`,
    Skip: `Skip ${object} in the current workflow.`,
    Smart: `Perform a product-specific smart ${object} action.`,
    Start: `Start ${object} for the current session.`,
    Stat: `Return metadata/stat information for ${object}.`,
    Stream: `Stream incremental ${object} updates.`,
    Subscribe: `Subscribe to ongoing ${object} updates.`,
    Update: `Update ${object} in local or remote state.`,
    Watch: `Watch ${object} for incremental changes.`,
    WellSupported: `Return the currently well-supported ${object}.`,
    Write: `Write ${object} contents.`,
  };
  return templates[verb] || `Handle ${splitCamelCase(methodName).join(" ").toLowerCase()} as part of the local control plane.`;
}

function getMethods() {
  const stringsOutput = sh(`strings -a ${JSON.stringify(binaryPath)}`);
  const matches = [...stringsOutput.matchAll(/LanguageServerServiceHandler\.([A-Za-z0-9]+)-fm/g)];
  return [...new Set(matches.map((match) => match[1]).filter(Boolean))].sort();
}

function renderInventory(methods) {
  const orderedCategories = [
    "Lifecycle",
    "Auth/User",
    "Models",
    "Cascade/Agent",
    "Trajectory/Memory",
    "Workspace/File",
    "Browser/Screen",
    "Audio",
    "MCP/Plugins",
    "Experiments/Config",
    "Telemetry/Feedback",
    "Product",
    "Other",
  ];

  const groups = new Map();
  for (const methodName of methods) {
    const category = inferCategory(methodName);
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category).push(methodName);
  }

  let markdown = "# LanguageServerService Inventory\n\n";
  markdown +=
    `Recovered handler count: **${methods.length}**.\n\n` +
    "This file lists every recovered `LanguageServerService` handler from `language_server_macos_arm`. " +
    "`Request`/`Response` types are recovered or inferred from the binary naming pattern. " +
    "`Likely purpose` is an inference from method names, recovered message fields, and available runtime logs.\n\n";

  for (const category of orderedCategories) {
    const methodsInCategory = groups.get(category);
    if (!methodsInCategory || !methodsInCategory.length) {
      continue;
    }

    markdown += `## ${category}\n\n`;
    markdown += "| Method | Request | Response | Pattern | Likely purpose |\n";
    markdown += "|---|---|---|---|---|\n";
    for (const methodName of methodsInCategory) {
      markdown += `| \`${markdownEscape(methodName)}\` | \`${methodName}Request\` | \`${methodName}Response\` | ${inferPattern(methodName)} | ${markdownEscape(inferPurpose(methodName))} |\n`;
    }
    markdown += "\n";
  }

  return markdown;
}

const rendered = renderInventory(getMethods());
if (outputPath) {
  fs.writeFileSync(outputPath, rendered);
} else {
  process.stdout.write(rendered);
}
