# LanguageServerService Inventory

Recovered handler count: **202**.

This file lists every recovered `LanguageServerService` handler from `language_server_macos_arm`. `Request`/`Response` types are recovered or inferred from the binary naming pattern. `Likely purpose` is an inference from method names, recovered message fields, and available runtime logs.

## Lifecycle

| Method | Request | Response | Pattern | Likely purpose |
|---|---|---|---|---|
| `DumpFlightRecorder` | `DumpFlightRecorderRequest` | `DumpFlightRecorderResponse` | unary | Export internal runtime/flight-recorder diagnostics for debugging. |
| `DumpPprof` | `DumpPprofRequest` | `DumpPprofResponse` | unary | Export profiling data from the Go process for debugging or performance analysis. |
| `Exit` | `ExitRequest` | `ExitResponse` | unary | Handle exit as part of the local control plane. |
| `GetSidecarEvents` | `GetSidecarEventsRequest` | `GetSidecarEventsResponse` | unary | Read recent sidecar lifecycle or state-change events. |
| `GetSidecars` | `GetSidecarsRequest` | `GetSidecarsResponse` | unary | Return the currently known/managed sidecar instances. |
| `GetStatus` | `GetStatusRequest` | `GetStatusResponse` | unary | Read or compute status state. |
| `Heartbeat` | `HeartbeatRequest` | `HeartbeatResponse` | unary | Report liveliness/health for the local service. |
| `ManageSidecar` | `ManageSidecarRequest` | `ManageSidecarResponse` | unary | Manage the lifecycle or mode of a local sidecar process. |
| `ReconnectExtensionServer` | `ReconnectExtensionServerRequest` | `ReconnectExtensionServerResponse` | unary | Reconnect the extension host/server after a disconnect. |
| `Restart` | `RestartRequest` | `RestartResponse` | unary | Restart the local service or managed worker. |
| `SignalExecutableIdle` | `SignalExecutableIdleRequest` | `SignalExecutableIdleResponse` | unary | Signal that a managed executable is idle. |
| `SimulateSegFault` | `SimulateSegFaultRequest` | `SimulateSegFaultResponse` | unary | Simulate seg fault for testing or diagnostics. |
| `SubscribeToSidecars` | `SubscribeToSidecarsRequest` | `SubscribeToSidecarsResponse` | stream | Subscribe to sidecar lifecycle/state updates. |

## Auth/User

| Method | Request | Response | Pattern | Likely purpose |
|---|---|---|---|---|
| `AcceptTermsOfService` | `AcceptTermsOfServiceRequest` | `AcceptTermsOfServiceResponse` | unary | Accept and persist the current terms-of-service decision for the user. |
| `CompleteMcpOAuth` | `CompleteMcpOAuthRequest` | `CompleteMcpOAuthResponse` | unary | Finish an MCP OAuth exchange and bind the resulting auth state locally. |
| `DisconnectMcpOAuth` | `DisconnectMcpOAuthRequest` | `DisconnectMcpOAuthResponse` | unary | Disconnect mcp oauth integration or session. |
| `FetchUserInfo` | `FetchUserInfoRequest` | `FetchUserInfoResponse` | unary | Fetch the current signed-in user identity and profile data. |
| `GetTermsOfService` | `GetTermsOfServiceRequest` | `GetTermsOfServiceResponse` | unary | Read or compute terms of service state. |
| `GetTokenBase` | `GetTokenBaseRequest` | `GetTokenBaseResponse` | unary | Return token/account base state used by downstream auth flows. |
| `GetUserStatus` | `GetUserStatusRequest` | `GetUserStatusResponse` | unary | Read or compute user status state. |
| `MigrateApiKey` | `MigrateApiKeyRequest` | `MigrateApiKeyResponse` | unary | Migrate legacy API-key auth into the current auth path. |
| `RegisterGdmUser` | `RegisterGdmUserRequest` | `RegisterGdmUserResponse` | unary | Register gdm user with a local or remote service. |
| `SetUserInfo` | `SetUserInfoRequest` | `SetUserInfoResponse` | unary | Update local user/account metadata. |

## Models

| Method | Request | Response | Pattern | Likely purpose |
|---|---|---|---|---|
| `GetAvailableModels` | `GetAvailableModelsRequest` | `GetAvailableModelsResponse` | unary | Fetch the currently available model catalog for the local product surface. |
| `GetCascadeModelConfigData` | `GetCascadeModelConfigDataRequest` | `GetCascadeModelConfigDataResponse` | unary | Read richer per-cascade model configuration metadata. |
| `GetCascadeModelConfigs` | `GetCascadeModelConfigsRequest` | `GetCascadeModelConfigsResponse` | unary | Read model options/configuration used for cascade-style interactions. |
| `GetCommandModelConfigs` | `GetCommandModelConfigsRequest` | `GetCommandModelConfigsResponse` | unary | Read model options/configuration used for command-style interactions. |
| `GetLoadCodeAssist` | `GetLoadCodeAssistRequest` | `GetLoadCodeAssistResponse` | unary | Load or initialize code-assist state from cloud code. |
| `GetModelResponse` | `GetModelResponseRequest` | `GetModelResponseResponse` | unary | Execute or fetch a model response through the language-server surface. |
| `GetModelStatuses` | `GetModelStatusesRequest` | `GetModelStatusesResponse` | unary | Return per-model status/availability information. |
| `SetCloudCodeURL` | `SetCloudCodeURLRequest` | `SetCloudCodeURLResponse` | unary | Override the cloud code endpoint used by the local process. |

## Cascade/Agent

| Method | Request | Response | Pattern | Likely purpose |
|---|---|---|---|---|
| `AcknowledgeCascadeCodeEdit` | `AcknowledgeCascadeCodeEditRequest` | `AcknowledgeCascadeCodeEditResponse` | unary | Confirm that a cascade-proposed code edit was seen, applied, or dismissed. |
| `BrowserValidateCascadeOrCancelOverlay` | `BrowserValidateCascadeOrCancelOverlayRequest` | `BrowserValidateCascadeOrCancelOverlayResponse` | unary | Coordinate a browser-side validation flow and either continue or cancel a cascade overlay interaction. |
| `CancelCascadeInvocation` | `CancelCascadeInvocationRequest` | `CancelCascadeInvocationResponse` | unary | Cancel in-flight cascade invocation work. |
| `CancelCascadeSteps` | `CancelCascadeStepsRequest` | `CancelCascadeStepsResponse` | unary | Cancel in-flight cascade steps work. |
| `DeleteCascadeMemory` | `DeleteCascadeMemoryRequest` | `DeleteCascadeMemoryResponse` | unary | Delete cascade memory from local or remote state. |
| `DeleteCascadeTrajectory` | `DeleteCascadeTrajectoryRequest` | `DeleteCascadeTrajectoryResponse` | unary | Delete cascade trajectory from local or remote state. |
| `DeleteQueuedUserInputStep` | `DeleteQueuedUserInputStepRequest` | `DeleteQueuedUserInputStepResponse` | unary | Delete queued user input step from local or remote state. |
| `ForceBackgroundResearchRefresh` | `ForceBackgroundResearchRefreshRequest` | `ForceBackgroundResearchRefreshResponse` | unary | Force-refresh background research state outside the normal scheduling flow. |
| `ForceStopCascadeTree` | `ForceStopCascadeTreeRequest` | `ForceStopCascadeTreeResponse` | unary | Force-stop a cascade tree and its child work regardless of normal shutdown state. |
| `ForkConversation` | `ForkConversationRequest` | `ForkConversationResponse` | unary | Fork conversation into a new branch of work or conversation state. |
| `GetAllCascadeTrajectories` | `GetAllCascadeTrajectoriesRequest` | `GetAllCascadeTrajectoriesResponse` | unary | Read or compute all cascade trajectories state. |
| `GetAvailableCascadePlugins` | `GetAvailableCascadePluginsRequest` | `GetAvailableCascadePluginsResponse` | unary | Read or compute available cascade plugins state. |
| `GetBrowserOpenConversation` | `GetBrowserOpenConversationRequest` | `GetBrowserOpenConversationResponse` | unary | Read which conversation should currently be opened in the browser surface. |
| `GetCascadeMemories` | `GetCascadeMemoriesRequest` | `GetCascadeMemoriesResponse` | unary | Load memory items associated with a cascade or conversation. |
| `GetCascadeNuxes` | `GetCascadeNuxesRequest` | `GetCascadeNuxesResponse` | unary | Read or compute cascade nuxes state. |
| `GetCascadePluginById` | `GetCascadePluginByIdRequest` | `GetCascadePluginByIdResponse` | unary | Read or compute cascade plugin by id state. |
| `GetCascadeTrajectory` | `GetCascadeTrajectoryRequest` | `GetCascadeTrajectoryResponse` | unary | Read or compute cascade trajectory state. |
| `GetCascadeTrajectoryGeneratorMetadata` | `GetCascadeTrajectoryGeneratorMetadataRequest` | `GetCascadeTrajectoryGeneratorMetadataResponse` | unary | Read or compute cascade trajectory generator metadata state. |
| `GetCascadeTrajectorySteps` | `GetCascadeTrajectoryStepsRequest` | `GetCascadeTrajectoryStepsResponse` | unary | Read or compute cascade trajectory steps state. |
| `HandleCascadeUserInteraction` | `HandleCascadeUserInteractionRequest` | `HandleCascadeUserInteractionResponse` | unary | Handle an interactive user event within an active cascade. |
| `HandleStreamingCommand` | `HandleStreamingCommandRequest` | `HandleStreamingCommandResponse` | stream | Run a server-streaming command workflow for interactive coding/chat operations. |
| `InitializeCascadePanelState` | `InitializeCascadePanelStateRequest` | `InitializeCascadePanelStateResponse` | unary | Initialize the panel/UI state for a cascade session. |
| `InstallCascadePlugin` | `InstallCascadePluginRequest` | `InstallCascadePluginResponse` | unary | Install a cascade plugin into the local environment. |
| `LoadReplayConversation` | `LoadReplayConversationRequest` | `LoadReplayConversationResponse` | unary | Load a replayable conversation artifact into active state. |
| `RecordInteractiveCascadeFeedback` | `RecordInteractiveCascadeFeedbackRequest` | `RecordInteractiveCascadeFeedbackResponse` | unary | Persist feedback about an interactive cascade run. |
| `RequestAgentStatePageUpdate` | `RequestAgentStatePageUpdateRequest` | `RequestAgentStatePageUpdateResponse` | unary | Request a UI/state-page update for current agent state. |
| `ResolveOutstandingSteps` | `ResolveOutstandingStepsRequest` | `ResolveOutstandingStepsResponse` | unary | Resolve pending steps in an active cascade/agent plan. |
| `RevertToCascadeStep` | `RevertToCascadeStepRequest` | `RevertToCascadeStepResponse` | unary | Move active state back to a prior cascade step. |
| `SearchConversations` | `SearchConversationsRequest` | `SearchConversationsResponse` | unary | Search stored conversations or cascade history. |
| `SendActionToChatPanel` | `SendActionToChatPanelRequest` | `SendActionToChatPanelResponse` | unary | Send an action/result into the chat panel surface. |
| `SendAgentMessage` | `SendAgentMessageRequest` | `SendAgentMessageResponse` | unary | Send a message into an active agent session. |
| `SendAllQueuedMessages` | `SendAllQueuedMessagesRequest` | `SendAllQueuedMessagesResponse` | unary | Flush queued messages into the active flow. |
| `SendStepsToBackground` | `SendStepsToBackgroundRequest` | `SendStepsToBackgroundResponse` | unary | Move selected steps/work into background execution. |
| `SendUserCascadeMessage` | `SendUserCascadeMessageRequest` | `SendUserCascadeMessageResponse` | unary | Send a top-level user message into a cascade/chat workflow. |
| `SetBrowserOpenConversation` | `SetBrowserOpenConversationRequest` | `SetBrowserOpenConversationResponse` | unary | Set which conversation the browser surface should open. |
| `SmartFocusConversation` | `SmartFocusConversationRequest` | `SmartFocusConversationResponse` | unary | Apply product-specific logic to focus the most relevant conversation. |
| `StartCascade` | `StartCascadeRequest` | `StartCascadeResponse` | unary | Start a new cascade session. |
| `StreamCascadePanelReactiveUpdates` | `StreamCascadePanelReactiveUpdatesRequest` | `StreamCascadePanelReactiveUpdatesResponse` | stream | Stream reactive updates for the cascade panel UI. |
| `StreamCascadeReactiveUpdates` | `StreamCascadeReactiveUpdatesRequest` | `StreamCascadeReactiveUpdatesResponse` | stream | Stream reactive updates for a running cascade. |
| `StreamCascadeSummariesReactiveUpdates` | `StreamCascadeSummariesReactiveUpdatesRequest` | `StreamCascadeSummariesReactiveUpdatesResponse` | stream | Stream reactive updates for cascade summaries. |
| `UpdateCascadeMemory` | `UpdateCascadeMemoryRequest` | `UpdateCascadeMemoryResponse` | unary | Update memory content associated with a cascade. |
| `UpdateConversationAnnotations` | `UpdateConversationAnnotationsRequest` | `UpdateConversationAnnotationsResponse` | unary | Update stored annotations attached to a conversation. |

## Trajectory/Memory

| Method | Request | Response | Pattern | Likely purpose |
|---|---|---|---|---|
| `ConvertTrajectoryToMarkdown` | `ConvertTrajectoryToMarkdownRequest` | `ConvertTrajectoryToMarkdownResponse` | unary | Convert trajectory to markdown into another representation. |
| `CreateReplayWorkspace` | `CreateReplayWorkspaceRequest` | `CreateReplayWorkspaceResponse` | unary | Create a workspace for replaying or inspecting recorded trajectories. |
| `CreateTrajectoryShare` | `CreateTrajectoryShareRequest` | `CreateTrajectoryShareResponse` | unary | Create a shareable export or link for a saved trajectory. |
| `GetUserMemories` | `GetUserMemoriesRequest` | `GetUserMemoriesResponse` | unary | Load user-level memory items independent of a single cascade. |
| `GetUserTrajectory` | `GetUserTrajectoryRequest` | `GetUserTrajectoryResponse` | unary | Load a recorded user trajectory artifact. |
| `GetUserTrajectoryDebug` | `GetUserTrajectoryDebugRequest` | `GetUserTrajectoryDebugResponse` | unary | Load a debug-oriented view of a recorded trajectory. |
| `GetUserTrajectoryDescriptions` | `GetUserTrajectoryDescriptionsRequest` | `GetUserTrajectoryDescriptionsResponse` | unary | Return descriptions/metadata for stored trajectories. |
| `LoadTrajectory` | `LoadTrajectoryRequest` | `LoadTrajectoryResponse` | unary | Load a stored trajectory into active memory/UI state. |
| `ReplayGroundTruthTrajectory` | `ReplayGroundTruthTrajectoryRequest` | `ReplayGroundTruthTrajectoryResponse` | unary | Replay a trajectory against stored ground-truth data. |
| `StreamUserTrajectoryReactiveUpdates` | `StreamUserTrajectoryReactiveUpdatesRequest` | `StreamUserTrajectoryReactiveUpdatesResponse` | stream | Stream reactive updates for user trajectory state. |

## Workspace/File

| Method | Request | Response | Pattern | Likely purpose |
|---|---|---|---|---|
| `AddTrackedWorkspace` | `AddTrackedWorkspaceRequest` | `AddTrackedWorkspaceResponse` | unary | Add tracked workspace to local or server-managed state. |
| `CheckoutWorktree` | `CheckoutWorktreeRequest` | `CheckoutWorktreeResponse` | unary | Checkout or switch worktree state. |
| `CopyBuiltinWorkflowToWorkspace` | `CopyBuiltinWorkflowToWorkspaceRequest` | `CopyBuiltinWorkflowToWorkspaceResponse` | unary | Copy builtin workflow to workspace into a workspace-local form. |
| `CreateCitcWorkspace` | `CreateCitcWorkspaceRequest` | `CreateCitcWorkspaceResponse` | unary | Create a CITC-style workspace and return its local metadata. |
| `CreateCustomizationFile` | `CreateCustomizationFileRequest` | `CreateCustomizationFileResponse` | unary | Create customization file resources or local artifacts. |
| `CreateWorktree` | `CreateWorktreeRequest` | `CreateWorktreeResponse` | unary | Create worktree resources or local artifacts. |
| `DeleteFileOrDirectory` | `DeleteFileOrDirectoryRequest` | `DeleteFileOrDirectoryResponse` | unary | Delete file or directory from local or remote state. |
| `DeleteWorktree` | `DeleteWorktreeRequest` | `DeleteWorktreeResponse` | unary | Delete worktree from local or remote state. |
| `GenerateCommitMessage` | `GenerateCommitMessageRequest` | `GenerateCommitMessageResponse` | unary | Generate a commit message from repo diff/context. |
| `GetBrowserWhitelistFilePath` | `GetBrowserWhitelistFilePathRequest` | `GetBrowserWhitelistFilePathResponse` | unary | Read or compute browser whitelist file path state. |
| `GetCodeFrequencyForRepo` | `GetCodeFrequencyForRepoRequest` | `GetCodeFrequencyForRepoResponse` | unary | Read or compute code frequency for repo state. |
| `GetPatchAndCodeChange` | `GetPatchAndCodeChangeRequest` | `GetPatchAndCodeChangeResponse` | unary | Produce patch/code-change artifacts for the current task or trajectory state. |
| `GetRepoInfos` | `GetRepoInfosRequest` | `GetRepoInfosResponse` | unary | Read or compute repo infos state. |
| `GetRevertPreview` | `GetRevertPreviewRequest` | `GetRevertPreviewResponse` | unary | Preview how reverting to a prior step or patch state would look. |
| `GetWorkingDirectories` | `GetWorkingDirectoriesRequest` | `GetWorkingDirectoriesResponse` | unary | Read or compute working directories state. |
| `GetWorkspaceEditState` | `GetWorkspaceEditStateRequest` | `GetWorkspaceEditStateResponse` | unary | Read or compute workspace edit state state. |
| `GetWorkspaceInfos` | `GetWorkspaceInfosRequest` | `GetWorkspaceInfosResponse` | unary | Read or compute workspace infos state. |
| `GetWorktreeDiff` | `GetWorktreeDiffRequest` | `GetWorktreeDiffResponse` | unary | Read or compute worktree diff state. |
| `ListCustomizationPathsByFile` | `ListCustomizationPathsByFileRequest` | `ListCustomizationPathsByFileResponse` | unary | List customization definitions relevant to a given file/path. |
| `ReadDir` | `ReadDirRequest` | `ReadDirResponse` | unary | Read directory contents through the language-server file abstraction. |
| `ReadFile` | `ReadFileRequest` | `ReadFileResponse` | unary | Read file contents through the language-server file abstraction. |
| `RecordCommitMessageSave` | `RecordCommitMessageSaveRequest` | `RecordCommitMessageSaveResponse` | unary | Record commit message save telemetry, analytics, or feedback. |
| `RemoveTrackedWorkspace` | `RemoveTrackedWorkspaceRequest` | `RemoveTrackedWorkspaceResponse` | unary | Remove tracked workspace from tracked state. |
| `ScanSkillsConfigFile` | `ScanSkillsConfigFileRequest` | `ScanSkillsConfigFileResponse` | unary | Scan a skills configuration file and refresh in-memory definitions. |
| `SearchCode` | `SearchCodeRequest` | `SearchCodeResponse` | unary | Search code using local or indexed search facilities. |
| `SearchFiles` | `SearchFilesRequest` | `SearchFilesResponse` | unary | Search files using local or indexed file search facilities. |
| `SetWorkingDirectories` | `SetWorkingDirectoriesRequest` | `SetWorkingDirectoriesResponse` | unary | Set the working directories used by the local process. |
| `StatUri` | `StatUriRequest` | `StatUriResponse` | unary | Return metadata/stat information for a URI/path. |
| `UpdateCustomizationPathsFile` | `UpdateCustomizationPathsFileRequest` | `UpdateCustomizationPathsFileResponse` | unary | Update the file that stores customization-to-path mappings. |
| `UpdatePRForWorktree` | `UpdatePRForWorktreeRequest` | `UpdatePRForWorktreeResponse` | unary | Update a pull request associated with a worktree. |
| `WatchDirectory` | `WatchDirectoryRequest` | `WatchDirectoryResponse` | stream | Watch a directory and stream back file-system changes. |
| `WriteFile` | `WriteFileRequest` | `WriteFileResponse` | unary | Write file contents through the language-server file abstraction. |

## Browser/Screen

| Method | Request | Response | Pattern | Likely purpose |
|---|---|---|---|---|
| `AddToBrowserWhitelist` | `AddToBrowserWhitelistRequest` | `AddToBrowserWhitelistResponse` | unary | Add to browser whitelist to local or server-managed state. |
| `CaptureScreenshot` | `CaptureScreenshotRequest` | `CaptureScreenshotResponse` | unary | Capture screenshot data for runtime or debugging use. |
| `GetAllBrowserWhitelistedUrls` | `GetAllBrowserWhitelistedUrlsRequest` | `GetAllBrowserWhitelistedUrlsResponse` | unary | Read or compute all browser whitelisted url s state. |
| `HandleScreenRecording` | `HandleScreenRecordingRequest` | `HandleScreenRecordingResponse` | unary | Handle screen-recording state or events during a workflow. |
| `ListPages` | `ListPagesRequest` | `ListPagesResponse` | unary | List available pages items. |
| `OpenUrl` | `OpenUrlRequest` | `OpenUrlResponse` | unary | Open a URL in a browser or browser-like embedded surface. |
| `SaveScreenRecording` | `SaveScreenRecordingRequest` | `SaveScreenRecordingResponse` | unary | Persist a completed screen recording artifact. |
| `SkipBrowserSubagent` | `SkipBrowserSubagentRequest` | `SkipBrowserSubagentResponse` | unary | Skip or dismiss a browser subagent interaction. |
| `SmartOpenBrowser` | `SmartOpenBrowserRequest` | `SmartOpenBrowserResponse` | unary | Open a browser target using product-specific heuristics/context. |
| `StartScreenRecording` | `StartScreenRecordingRequest` | `StartScreenRecordingResponse` | unary | Start screen recording for the current workflow. |

## Audio

| Method | Request | Response | Pattern | Likely purpose |
|---|---|---|---|---|
| `EndAudioSession` | `EndAudioSessionRequest` | `EndAudioSessionResponse` | unary | End the active audio session session or mode. |
| `GetTranscription` | `GetTranscriptionRequest` | `GetTranscriptionResponse` | unary | Fetch or produce a transcription result for captured audio. |
| `SendAudioChunk` | `SendAudioChunkRequest` | `SendAudioChunkResponse` | unary | Send one chunk of audio into a transcription/audio session. |
| `StreamAudioTranscription` | `StreamAudioTranscriptionRequest` | `StreamAudioTranscriptionResponse` | stream | Stream incremental transcription messages from an audio session. |

## MCP/Plugins

| Method | Request | Response | Pattern | Likely purpose |
|---|---|---|---|---|
| `GenerateSkillInstallationCL` | `GenerateSkillInstallationCLRequest` | `GenerateSkillInstallationCLResponse` | unary | Generate change-list content for installing or updating skills. |
| `GetAllPlugins` | `GetAllPluginsRequest` | `GetAllPluginsResponse` | unary | Read or compute all plugins state. |
| `GetAllRules` | `GetAllRulesRequest` | `GetAllRulesResponse` | unary | Read or compute all rules state. |
| `GetAllSkills` | `GetAllSkillsRequest` | `GetAllSkillsResponse` | unary | Read or compute all skills state. |
| `GetAllWorkflows` | `GetAllWorkflowsRequest` | `GetAllWorkflowsResponse` | unary | Read or compute all workflows state. |
| `GetMcpPrompt` | `GetMcpPromptRequest` | `GetMcpPromptResponse` | unary | Resolve and return a specific MCP prompt definition. |
| `GetMcpServerStates` | `GetMcpServerStatesRequest` | `GetMcpServerStatesResponse` | unary | Return current MCP server status/health state. |
| `GetMcpServerTemplates` | `GetMcpServerTemplatesRequest` | `GetMcpServerTemplatesResponse` | unary | Return MCP server template/configuration definitions. |
| `GetSkillMarketplaceLink` | `GetSkillMarketplaceLinkRequest` | `GetSkillMarketplaceLinkResponse` | unary | Return the marketplace URL or link target for skills. |
| `ListMcpPrompts` | `ListMcpPromptsRequest` | `ListMcpPromptsResponse` | unary | List MCP-provided prompt definitions. |
| `ListMcpResources` | `ListMcpResourcesRequest` | `ListMcpResourcesResponse` | unary | List MCP-provided resources/connectors. |
| `RefreshMcpServers` | `RefreshMcpServersRequest` | `RefreshMcpServersResponse` | unary | Refresh MCP server registrations/configuration from local state. |
| `SetupUniversitySandbox` | `SetupUniversitySandboxRequest` | `SetupUniversitySandboxResponse` | unary | Set up an education/sandbox mode for the product. |
| `UpdateCustomization` | `UpdateCustomizationRequest` | `UpdateCustomizationResponse` | unary | Update a customization definition or object. |

## Experiments/Config

| Method | Request | Response | Pattern | Likely purpose |
|---|---|---|---|---|
| `GetStaticExperimentStatus` | `GetStaticExperimentStatusRequest` | `GetStaticExperimentStatusResponse` | unary | Return current static experiment/config enablement state. |
| `GetUnleashData` | `GetUnleashDataRequest` | `GetUnleashDataResponse` | unary | Fetch feature-flag/unleash state for this install or user. |
| `SetBaseExperiments` | `SetBaseExperimentsRequest` | `SetBaseExperimentsResponse` | unary | Set the base experiment configuration for the local process. |
| `SetOrVerifyStaticConfig` | `SetOrVerifyStaticConfigRequest` | `SetOrVerifyStaticConfigResponse` | unary | Set or verify static local configuration/state. |
| `ShouldEnableUnleash` | `ShouldEnableUnleashRequest` | `ShouldEnableUnleashResponse` | unary | Decide whether unleash/feature flags should be enabled. |
| `UpdateDevExperiments` | `UpdateDevExperimentsRequest` | `UpdateDevExperimentsResponse` | unary | Update developer experiment configuration. |
| `UpdateEnterpriseExperimentsFromUrl` | `UpdateEnterpriseExperimentsFromUrlRequest` | `UpdateEnterpriseExperimentsFromUrlResponse` | unary | Load enterprise experiment settings from a URL source. |

## Telemetry/Feedback

| Method | Request | Response | Pattern | Likely purpose |
|---|---|---|---|---|
| `CaptureConsoleLogs` | `CaptureConsoleLogsRequest` | `CaptureConsoleLogsResponse` | unary | Capture console logs data for runtime or debugging use. |
| `GetUserAnalyticsSummary` | `GetUserAnalyticsSummaryRequest` | `GetUserAnalyticsSummaryResponse` | unary | Return a summary view of user/product analytics state. |
| `ProvideCompletionFeedback` | `ProvideCompletionFeedbackRequest` | `ProvideCompletionFeedbackResponse` | unary | Send user feedback about a completion result. |
| `RecordAnalyticsEvent` | `RecordAnalyticsEventRequest` | `RecordAnalyticsEventResponse` | unary | Record analytics event telemetry, analytics, or feedback. |
| `RecordChatFeedback` | `RecordChatFeedbackRequest` | `RecordChatFeedbackResponse` | unary | Record chat feedback telemetry, analytics, or feedback. |
| `RecordChatPanelSession` | `RecordChatPanelSessionRequest` | `RecordChatPanelSessionResponse` | unary | Record chat panel session telemetry, analytics, or feedback. |
| `RecordError` | `RecordErrorRequest` | `RecordErrorResponse` | unary | Record error telemetry, analytics, or feedback. |
| `RecordEvent` | `RecordEventRequest` | `RecordEventResponse` | unary | Record event telemetry, analytics, or feedback. |
| `RecordLints` | `RecordLintsRequest` | `RecordLintsResponse` | unary | Record lints telemetry, analytics, or feedback. |
| `RecordObservabilityData` | `RecordObservabilityDataRequest` | `RecordObservabilityDataResponse` | unary | Persist observability/diagnostic telemetry from the local product. |
| `RecordSearchDocOpen` | `RecordSearchDocOpenRequest` | `RecordSearchDocOpenResponse` | unary | Record search doc open telemetry, analytics, or feedback. |
| `RecordSearchResultsView` | `RecordSearchResultsViewRequest` | `RecordSearchResultsViewResponse` | unary | Record search results view telemetry, analytics, or feedback. |
| `RecordSidecarEvent` | `RecordSidecarEventRequest` | `RecordSidecarEventResponse` | unary | Record sidecar event telemetry, analytics, or feedback. |
| `RecordUserGrep` | `RecordUserGrepRequest` | `RecordUserGrepResponse` | unary | Record usage around user grep/search behavior. |
| `RecordUserStepSnapshot` | `RecordUserStepSnapshotRequest` | `RecordUserStepSnapshotResponse` | unary | Persist a snapshot of user step state within a trajectory/cascade. |

## Product

| Method | Request | Response | Pattern | Likely purpose |
|---|---|---|---|---|
| `EndBattleMode` | `EndBattleModeRequest` | `EndBattleModeResponse` | unary | End the active battle mode session or mode. |
| `FocusUserPage` | `FocusUserPageRequest` | `FocusUserPageResponse` | unary | Bring focus to user page in the UI or workflow. |
| `GetAgentScripts` | `GetAgentScriptsRequest` | `GetAgentScriptsResponse` | unary | Read or compute agent scripts state. |
| `GetAgentTeamMetadata` | `GetAgentTeamMetadataRequest` | `GetAgentTeamMetadataResponse` | unary | Read or compute agent team metadata state. |
| `GetProfileData` | `GetProfileDataRequest` | `GetProfileDataResponse` | unary | Read or compute profile data state. |
| `GetTeamOrganizationalControls` | `GetTeamOrganizationalControlsRequest` | `GetTeamOrganizationalControlsResponse` | unary | Read or compute team organizational controls state. |
| `StartBattleMode` | `StartBattleModeRequest` | `StartBattleModeResponse` | unary | Enter battle-mode or evaluation-style workflow mode. |
| `WellSupportedLanguages` | `WellSupportedLanguagesRequest` | `WellSupportedLanguagesResponse` | unary | Return the currently well-supported languages. |

## Other

| Method | Request | Response | Pattern | Likely purpose |
|---|---|---|---|---|
| `AcknowledgeCodeActionStep` | `AcknowledgeCodeActionStepRequest` | `AcknowledgeCodeActionStepResponse` | unary | Acknowledge a code-action step inside a larger guided flow. |
| `DeleteMediaArtifact` | `DeleteMediaArtifactRequest` | `DeleteMediaArtifactResponse` | unary | Delete media artifact from local or remote state. |
| `GetAllCustomAgentConfigs` | `GetAllCustomAgentConfigsRequest` | `GetAllCustomAgentConfigsResponse` | unary | Read or compute all custom agent configs state. |
| `GetArtifactSnapshots` | `GetArtifactSnapshotsRequest` | `GetArtifactSnapshotsResponse` | unary | Read or compute artifact snapshots state. |
| `GetChangelog` | `GetChangelogRequest` | `GetChangelogResponse` | unary | Fetch or render product changelog content. |
| `GetCodeValidationStates` | `GetCodeValidationStatesRequest` | `GetCodeValidationStatesResponse` | unary | Read or compute code validation states state. |
| `GetDebugDiagnostics` | `GetDebugDiagnosticsRequest` | `GetDebugDiagnosticsResponse` | unary | Return internal debug/diagnostic state for inspection. |
| `GetMatchingContextScopeItems` | `GetMatchingContextScopeItemsRequest` | `GetMatchingContextScopeItemsResponse` | unary | Read or compute matching context scope items state. |
| `GetRevisionArtifact` | `GetRevisionArtifactRequest` | `GetRevisionArtifactResponse` | unary | Read or compute revision artifact state. |
| `GetUserSettings` | `GetUserSettingsRequest` | `GetUserSettingsResponse` | unary | Read or compute user settings state. |
| `GetWebDocsOptions` | `GetWebDocsOptionsRequest` | `GetWebDocsOptionsResponse` | unary | Return web/docs retrieval options available to the product. |
| `ImportFromCursor` | `ImportFromCursorRequest` | `ImportFromCursorResponse` | unary | Import state or artifacts from Cursor into Antigravity/Jetski state. |
| `JetboxDeleteSummary` | `JetboxDeleteSummaryRequest` | `JetboxDeleteSummaryResponse` | unary | Delete a Jetbox-managed summary artifact. |
| `JetboxGetLatestVersion` | `JetboxGetLatestVersionRequest` | `JetboxGetLatestVersionResponse` | unary | Fetch the latest available Jetbox version/state. |
| `JetboxSubscribeToGcertState` | `JetboxSubscribeToGcertStateRequest` | `JetboxSubscribeToGcertStateResponse` | unary | Subscribe to Jetbox gcert-related state updates. |
| `JetboxSubscribeToOAuthState` | `JetboxSubscribeToOAuthStateRequest` | `JetboxSubscribeToOAuthStateResponse` | unary | Subscribe to Jetbox OAuth state updates. |
| `JetboxSubscribeToState` | `JetboxSubscribeToStateRequest` | `JetboxSubscribeToStateResponse` | unary | Subscribe to core Jetbox state updates. |
| `JetboxSubscribeToSummaries` | `JetboxSubscribeToSummariesRequest` | `JetboxSubscribeToSummariesResponse` | unary | Subscribe to Jetbox summary updates. |
| `JetboxWriteState` | `JetboxWriteStateRequest` | `JetboxWriteStateResponse` | unary | Write Jetbox state from the local process. |
| `JetboxWriteSummary` | `JetboxWriteSummaryRequest` | `JetboxWriteSummaryResponse` | unary | Write a Jetbox summary artifact from the local process. |
| `RefreshContextForIdeAction` | `RefreshContextForIdeActionRequest` | `RefreshContextForIdeActionResponse` | unary | Refresh contextual state before handling an IDE-triggered action. |
| `ResetOnboarding` | `ResetOnboardingRequest` | `ResetOnboardingResponse` | unary | Reset onboarding to a default state. |
| `RunCommand` | `RunCommandRequest` | `RunCommandResponse` | unary | Run a local or remote command as part of the workflow. |
| `SaveAgentScriptCommandSpec` | `SaveAgentScriptCommandSpecRequest` | `SaveAgentScriptCommandSpecResponse` | unary | Persist a command spec used by an agent script. |
| `SaveMediaAsArtifact` | `SaveMediaAsArtifactRequest` | `SaveMediaAsArtifactResponse` | unary | Persist captured media into the artifact store. |
| `SetUserSettings` | `SetUserSettingsRequest` | `SetUserSettingsResponse` | unary | Persist user settings through the language-server surface. |
| `SkipOnboarding` | `SkipOnboardingRequest` | `SkipOnboardingResponse` | unary | Skip the onboarding flow for the current user/install. |
| `StreamAgentStateUpdates` | `StreamAgentStateUpdatesRequest` | `StreamAgentStateUpdatesResponse` | stream | Stream incremental agent state updates. |
| `StreamTerminalShellCommand` | `StreamTerminalShellCommandRequest` | `StreamTerminalShellCommandResponse` | stream | Stream output and state for a shell command execution. |
