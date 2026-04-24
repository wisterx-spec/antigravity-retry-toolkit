# `language_server_macos_arm` Reverse Engineering Notes

Binary:
- `/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm`

Related reference docs:

- `docs/language-server-service-inventory.md`
- `docs/language-server-interface-details.md`

## What It Is

- Mach-O arm64 executable
- Built with Go: `go1.27-20260305-RC02`
- Links against standard macOS system frameworks and `libresolv`
- Uses both `connectrpc` and `grpc` surfaces
- Acts as a local control-plane process, not just a thin IDE bridge

Observed runtime args:

```text
--cloud_code_endpoint http://127.0.0.1:38475
--extension_server_port <port>
--extension_server_csrf_token <token>
--workspace_id <workspace>
--csrf_token <token>
```

## Runtime / Transport Findings

Recovered transport clues show the binary supports:

- unary RPCs
- server-streaming RPCs
- client-streaming / bidi-style flows on some endpoints
- `connect.Request[*]` / `connect.Response[*]` wrappers with:
  - `Header`
  - `HTTPMethod`
  - `Peer`
  - `Spec`
- `grpc.ServerStreamingClient` / `grpc.ServerStreamingServer`

Concrete implications:

- this process can inspect or set request headers locally
- it exposes a typed RPC surface internally, not ad hoc JSON handlers
- some features are long-lived streams, not one-shot calls

Examples of clearly streaming-style methods:

- `WatchDirectory`
- `HandleStreamingCommand`
- `StreamAgentStateUpdates`
- `StreamAudioTranscription`
- `StreamTerminalShellCommand`
- `SubscribeToSidecars`

## Local State and On-Disk Footprint

Observed local files and directories:

- `~/.antigravity/argv.json`
- `~/Library/Application Support/Antigravity/User/settings.json`
- `~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb`
- `~/Library/Application Support/Antigravity/User/globalStorage/storage.json`
- `~/Library/Application Support/Antigravity/User/antigravity-retry-toolkit-state.json`
- `~/Library/Application Support/Antigravity/logs/<timestamp>/cloudcode.log`
- `~/Library/Application Support/Antigravity/logs/<timestamp>/ls-main.log`
- `~/Library/Application Support/Antigravity/logs/<timestamp>/auth.log`
- `~/Library/Application Support/Antigravity/logs/<timestamp>/telemetry.log`
- `~/Library/Application Support/Antigravity/logs/<timestamp>/editSessions.log`

User settings observed locally:

```json
{
  "retryStatusBar.showWhenIdle": true,
  "retryStatusBar.idleText": "0",
  "jetski.cloudCodeUrl": "http://127.0.0.1:38475"
}
```

Interpretation:

- some high-level product state clearly lives in VS Code / Antigravity user data
- this binary is part of a larger local system that includes logs, caches, storage DBs, service-worker storage, and extension state
- the Go process is not the only state owner, but it is a central actor in that system

## Runtime Evidence From Logs

Observed in `~/Library/Application Support/Antigravity/logs/...`:

- `ls-main.log` references `cascade_manager.go`, `browser_liveness_utils.go`, and `interceptor.go`
- `window*/exthost/google.antigravity/Antigravity.log` shows live requests to:
  - `https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`
  - `https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`
- browser-related runtime logs repeatedly show:
  - `Connecting to browser via CDP: http://127.0.0.1:9222`
- trajectory-related runtime errors reference:
  - `~/.gemini/antigravity/conversations/<uuid>.pb`
- active runtime errors include:
  - `/exa.language_server_pb.LanguageServerService/HandleStreamingCommand (unknown): could not convert a single message before hitting truncation`

Interpretation:

- the binary is actively doing browser coordination, not just exposing dormant browser RPCs
- it really does invoke cloud-code-adjacent methods such as `loadCodeAssist` and model discovery in live runs
- trajectory state is concretely tied to protobuf conversation files under `~/.gemini/antigravity/conversations/`
- `HandleStreamingCommand` is not just present in the binary; it is exercised at runtime

## Recovered Service Surface

Recovered counts from strings:

- `LanguageServerService`: 202 handlers
- `ApiServerService`: 114 handlers
- `PredictionService`: 49 methods/handlers

This is already enough to say the binary is a product hub, not a single-purpose language service.

## Full Capability Map

### 1. Lifecycle / Core Control

Representative methods:

- `Heartbeat`
- `GetStatus`
- `Restart`
- `Exit`
- `ReconnectExtensionServer`
- `SignalExecutableIdle`
- `ManageSidecar`
- `SubscribeToSidecars`
- `GetSidecars`
- `GetSidecarEvents`

Interpretation:

- the process manages its own health and lifecycle
- it tracks sidecars and extension connectivity
- it likely supervises local helpers or workers

### 2. Account / Authentication / Enrollment

Representative methods:

- `FetchUserInfo`
- `GetUserStatus`
- `SetUserInfo`
- `GetTermsOfService`
- `AcceptTermsOfService`
- `RegisterGdmUser`
- `MigrateApiKey`
- `CompleteMcpOAuth`
- `DisconnectMcpOAuth`
- `GetTokenBase`

Strings and clues:

- `missing CSRF token`
- `invalid CSRF token`
- `token is unverifiable`
- `installation_id`

Interpretation:

- this process handles real auth/session state
- it is not just forwarding already-authenticated traffic

### 3. Model / Prediction / Quota

Representative methods:

- `GetAvailableModels`
- `GetModelStatuses`
- `GetModelResponse`
- `PredictionService/GenerateContent`
- `PredictionService/StreamGenerateContent`
- `PredictionService/RetrieveUserQuota`

Recovered REST-like path strings:

- `/v1internal:generateContent`
- `/v1internal:streamGenerateContent`
- `/{api_version}/{model=projects/*/locations/*/publishers/*/models/*}:generateContent`
- `/{api_version}/{model=projects/*/locations/*/publishers/*/models/*}:streamGenerateContent`
- `/{api_version}/{model=projects/*/locations/*/endpoints/*}:generateContent`
- `/{api_version}/{model=projects/*/locations/*/endpoints/*}:streamGenerateContent`

Quota fields recovered:

- `RetrieveUserQuotaRequest.Project`
- `RetrieveUserQuotaResponse.Buckets`
- `BucketInfo.Remaining`
- `BucketInfo.RemainingAmount`
- `BucketInfo.RemainingFraction`
- `BucketInfo.ResetTime`
- `BucketInfo.TokenType`
- `BucketInfo.ModelId`

Interpretation:

- the binary knows model discovery, generation, and quota surfaces end to end

### 4. Cascade / Conversation / Agent Orchestration

Representative methods:

- `StartCascade`
- `SendUserCascadeMessage`
- `HandleCascadeUserInteraction`
- `HandleStreamingCommand`
- `StreamAgentStateUpdates`
- `ResolveOutstandingSteps`
- `CancelCascadeInvocation`
- `CancelCascadeSteps`
- `ForceStopCascadeTree`
- `ForkConversation`
- `LoadReplayConversation`
- `SmartFocusConversation`
- `InitializeCascadePanelState`
- `RequestAgentStatePageUpdate`

Representative request fields already recovered:

- `HandleStreamingCommandRequest.RequestedModelId`
- `HandleStreamingCommandRequest.Metadata`
- `HandleStreamingCommandRequest.ExperimentConfig`
- `HandleStreamingCommandRequest.RequestSource`
- `SendUserCascadeMessageRequest.CascadeConfig`
- `SendUserCascadeMessageRequest.Metadata`
- `SendUserCascadeMessageRequest.ExperimentConfig`
- `SendUserCascadeMessageRequest.ClientType`
- `SendUserCascadeMessageRequest.MessageOrigin`

Interpretation:

- this is one of the main orchestration layers for chat, tool use, and agent flows

### 5. Memory / Trajectory / Replay

Representative methods:

- `GetUserMemories`
- `GetCascadeMemories`
- `UpdateCascadeMemory`
- `DeleteCascadeMemory`
- `GetUserTrajectory`
- `GetUserTrajectoryDebug`
- `GetUserTrajectoryDescriptions`
- `LoadTrajectory`
- `ConvertTrajectoryToMarkdown`
- `CreateTrajectoryShare`
- `GetAllCascadeTrajectories`
- `GetCascadeTrajectory`
- `GetCascadeTrajectorySteps`
- `DeleteCascadeTrajectory`
- `ReplayGroundTruthTrajectory`

Interpretation:

- this process stores, loads, shares, and replays agent/task history
- “trajectory” is a first-class product concept, not a debug-only artifact

### 6. Workspace / Repo / Filesystem / Git

Representative methods:

- `WatchDirectory`
- `ReadDir`
- `ReadFile`
- `WriteFile`
- `DeleteFileOrDirectory`
- `StatUri`
- `GetWorkspaceInfos`
- `GetWorkspaceEditState`
- `SetWorkingDirectories`
- `GetWorkingDirectories`
- `AddTrackedWorkspace`
- `RemoveTrackedWorkspace`
- `GetRepoInfos`
- `GetWorktreeDiff`
- `CreateWorktree`
- `DeleteWorktree`
- `CheckoutWorktree`
- `CreateCitcWorkspace`
- `GenerateCommitMessage`
- `GetPatchAndCodeChange`
- `GetRevertPreview`
- `UpdatePRForWorktree`

Interpretation:

- this is partly a repo/worktree manager
- it knows how to inspect and modify local files, worktrees, and patch state

### 7. Browser / Screenshot / Screen / Media

Representative methods:

- `SmartOpenBrowser`
- `OpenUrl`
- `AddToBrowserWhitelist`
- `GetAllBrowserWhitelistedUrls`
- `GetBrowserWhitelistFilePath`
- `GetBrowserOpenConversation`
- `SetBrowserOpenConversation`
- `BrowserValidateCascadeOrCancelOverlay`
- `CaptureScreenshot`
- `HandleScreenRecording`
- `StartScreenRecording`
- `SaveScreenRecording`

Strings indicate embedded front-end resources and overlay UI:

- `preact`
- CSS utility classes and animations
- overlay-related method names

Interpretation:

- the binary is tied to browser-side and overlay-side product flows
- it likely coordinates local UI helpers beyond plain text RPC

### 8. Audio / Transcription

Representative methods:

- `SendAudioChunk`
- `EndAudioSession`
- `GetTranscription`
- `StartAudioTranscription`
- `StreamAudioTranscription`

Interpretation:

- audio is a first-class modality here
- this is not a text-only coding assistant daemon

### 9. MCP / Plugin / Skills / Customization

Representative methods:

- `ListMcpPrompts`
- `ListMcpResources`
- `RefreshMcpServers`
- `GetMcpPrompt`
- `GetMcpServerStates`
- `GetMcpServerTemplates`
- `GetAllPlugins`
- `GetAvailableCascadePlugins`
- `GetCascadePluginById`
- `InstallCascadePlugin`
- `GetAllSkills`
- `GetSkillMarketplaceLink`
- `ScanSkillsConfigFile`
- `GenerateSkillInstallationCL`
- `CreateCustomizationFile`
- `ListCustomizationPathsByFile`
- `UpdateCustomization`
- `UpdateCustomizationPathsFile`

Interpretation:

- MCP and plugin ecosystems are deeply integrated
- customization is not bolted on; it is part of the native RPC surface

### 10. Experiments / Feature Flags / Static Config

Representative methods:

- `GetUnleashData`
- `ShouldEnableUnleash`
- `GetStaticExperimentStatus`
- `SetBaseExperiments`
- `UpdateDevExperiments`
- `UpdateEnterpriseExperimentsFromUrl`
- `SetOrVerifyStaticConfig`

Recovered strings:

- `baseExperimentConfig`
- `devExperimentConfig`
- `PromptExperimentConfig`
- `WithBaseExperimentConfig`

Interpretation:

- experiment and feature-flag state is a major subsystem
- this is likely how product behavior is segmented or rolled out

### 11. Analytics / Telemetry / Feedback / Observability

Representative methods:

- `RecordAnalyticsEvent`
- `RecordEvent`
- `RecordError`
- `RecordObservabilityData`
- `RecordChatFeedback`
- `RecordInteractiveCascadeFeedback`
- `RecordChatPanelSession`
- `RecordUserGrep`
- `RecordUserStepSnapshot`
- `RecordSearchResultsView`
- `RecordSearchDocOpen`
- `RecordCommitMessageSave`
- `RecordCompletions`
- `RecordCortexError`
- `RecordCortexCodingPlan`
- `RecordCortexCodingStep`
- `GetUserAnalyticsSummary`
- `DumpFlightRecorder`
- `DumpPprof`

Interpretation:

- telemetry is not secondary
- the binary contains explicit observability and profiling hooks

### 12. Rules / Workflows / Scripts / Team Controls

Representative methods:

- `GetAllWorkflows`
- `CopyBuiltinWorkflowToWorkspace`
- `GetAgentScripts`
- `SaveAgentScriptCommandSpec`
- `GetAllRules`
- `GetTeamOrganizationalControls`
- `GetAgentTeamMetadata`
- `SetupUniversitySandbox`
- `StartBattleMode`
- `EndBattleMode`

Interpretation:

- the product includes reusable workflows, scripts, and policy/team overlays

## Header / Metadata Clues

Recovered strings show the binary knows about Google-side request metadata and headers including:

- `x-goog-request-params`
- `x-goog-api-client`
- `X-Goog-User-Project`
- `X-Goog-Request-Reason`
- `google.internal.cloud.code.v1internal.ClientMetadata`
- `google3/third_party/golang/grpc/metadata/metadata.Pairs`

Recovered `ClientMetadata` fields include:

- `ide_type`
- `platform`
- `plugin_type`

Negative findings from simple string extraction:

- no direct hit for `x-client-data`
- no direct hit for `traceparent`

Interpretation:

- the process has the machinery to attach Google-flavored metadata locally
- but string presence alone does not prove which exact headers are emitted on each path

## Concrete Request / Response Areas Worth Tracking

### `HandleStreamingCommandRequest`

- `RequestedModelId`
- `Metadata`
- `ExperimentConfig`
- `RequestSource`
- `CommandText`
- `Document`
- `EditorOptions`
- `MentionedScope`
- `ParentCompletionId`
- `DiffType`
- `Diagnostics`
- `TerminalCommandData`
- `ClipboardEntry`
- `IntellisenseSuggestions`

### `SendUserCascadeMessageRequest`

- `CascadeId`
- `CascadeConfig`
- `Metadata`
- `ExperimentConfig`
- `ClientType`
- `MessageOrigin`
- `CustomAgentSpec`
- `Blocking`
- `PlannerResponse`
- `PropagateError`
- `Items`
- `Images`
- `Media`

### Model/config discovery

- `GetAvailableModelsRequest.ForceRefresh`
- `GetModelStatusesRequest.Metadata`
- `GetCascadeModelConfigsRequest.Metadata`
- `GetCascadeModelConfigsRequest.Filter`
- `GetCommandModelConfigsRequest.Metadata`

Responses include:

- `GetModelStatusesResponse.ModelStatusInfos`
- `GetCascadeModelConfigsResponse.ClientModelConfigs`
- `GetCascadeModelConfigsResponse.ClientModelSorts`
- `GetCascadeModelConfigsResponse.DefaultOverrideModelConfig`
- `GetCommandModelConfigsResponse.ClientModelConfigs`

## Non-Routing Working Conclusion

`language_server_macos_arm` appears to be a local product-control process with at least these responsibilities:

- extension/session lifecycle management
- account and auth mediation
- model discovery and generation orchestration
- quota querying
- cascade/chat/agent execution
- repo, file, and worktree operations
- trajectory and memory handling
- browser, screenshot, and screen-recording coordination
- audio and transcription
- MCP/plugin/skills integration
- experiments and static config
- telemetry, profiling, and feedback
- some embedded UI / overlay support

The most accurate high-level description so far:

- not “a language server” in the narrow LSP sense
- closer to a local application kernel for Antigravity/Jetski features

## Next Best Full-Analysis Targets

1. Dump a structured inventory of all `LanguageServerService` methods and group them by subsystem.
2. Recover request/response field shapes for the top 30-50 highest-value message types.
3. Inspect `ls-main.log`, `cloudcode.log`, and `auth.log` for runtime evidence of which RPCs are actually exercised.
4. Examine `User/globalStorage/state.vscdb` and `storage.json` for product state names that line up with the RPC surface.
5. Identify which embedded UI assets belong to browser/overlay/screenshot flows versus editor-native flows.
