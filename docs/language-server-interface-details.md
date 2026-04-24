# `language_server_macos_arm` Interface Details

This document supplements the full method inventory in `docs/language-server-service-inventory.md`.

Scope:

- focus on the highest-value interfaces we can say something concrete about today
- include recovered request/response fields where symbol data exists
- include runtime evidence where local logs prove the interface is exercised
- distinguish clearly between:
  - directly recovered fields
  - inferred purpose
  - runtime-observed usage

Limits:

- this is still static reverse engineering plus local log correlation
- it is not a full proto dump
- many response types only expose a subset of fields through recoverable getters

## Confidence Model

- `Recovered fields`: directly visible from `Get...` proto accessors or embedded type strings in the binary
- `Runtime evidence`: observed in local logs under `~/Library/Application Support/Antigravity/logs/20260423T170953`
- `Purpose`: inferred from method/type names plus runtime correlation

## Shared Message Types

### `ClientMetadata`

Recovered fields:

- `IdeType`
- `IdeVersion`
- `PluginVersion`
- `Platform`
- `UpdateChannel`
- `DuetProject`
- `PluginType`
- `IdeName`

Interpretation:

- this is a common identity/context envelope for cloud-code-facing requests
- it captures the local IDE, plugin, platform, and update-channel identity of the client

### `ExperimentConfig`

Recovered fields:

- `Experiments`
- `ForceEnableExperiments`
- `ForceDisableExperiments`
- `ForceEnableExperimentsWithVariants`
- `ForceEnableExperimentStrings`
- `ForceDisableExperimentStrings`
- `DevMode`

Interpretation:

- this is the main local experiment/feature-flag override container
- it appears in model, cascade, command, and config-update flows

### `PromptExperimentConfig`

Recovered evidence:

- type names for `PromptExperimentConfig`
- field reference `promptExperimentConfig`

Interpretation:

- this looks like a prompt-scoped evaluation/configuration layer separate from the broader `ExperimentConfig`

## Model / Cloud-Code Interfaces

### `SetCloudCodeURL`

Pattern:

- unary

Request:

- `SetCloudCodeURLRequest.Url`

Response:

- no concrete response fields recovered yet

Purpose:

- overrides the cloud-code endpoint used by the local process

Why this matters:

- this confirms the binary is not hard-wired to a single remote host
- the local process itself exposes a first-class endpoint override API

### `GetAvailableModels`

Pattern:

- unary

Request:

- `GetAvailableModelsRequest.ForceRefresh`

Response:

- `GetAvailableModelsResponse.Response`

Runtime evidence:

- `cloudcode.log` repeatedly records `POST v1internal:fetchAvailableModels`

Purpose:

- fetches or refreshes the currently available model catalog for the product

Interpretation:

- the language server is directly involved in model discovery, not just downstream invocation

### `GetModelStatuses`

Pattern:

- unary

Request:

- `GetModelStatusesRequest.Metadata`

Response:

- `GetModelStatusesResponse.ModelStatusInfos`

Purpose:

- returns per-model availability or state information

Interpretation:

- there is a model-status surface separate from the raw model list
- `Metadata` suggests the query may be contextual rather than globally static

### `GetCascadeModelConfigs`

Pattern:

- unary

Request:

- `GetCascadeModelConfigsRequest.Metadata`
- `GetCascadeModelConfigsRequest.Filter`
- oneof present: `XXX_OneofWrappers`

Response:

- `GetCascadeModelConfigsResponse.ClientModelConfigs`
- `GetCascadeModelConfigsResponse.ClientModelSorts`
- `GetCascadeModelConfigsResponse.DefaultOverrideModelConfig`
- oneof present: `XXX_OneofWrappers`

Purpose:

- returns model configuration and ranking information for cascade/chat workflows

Interpretation:

- cascade model selection is configurable and sorted, not a single static default

### `GetCommandModelConfigs`

Pattern:

- unary

Request:

- `GetCommandModelConfigsRequest.Metadata`

Response:

- `GetCommandModelConfigsResponse.ClientModelConfigs`

Purpose:

- returns model configuration for command-style interactions

Interpretation:

- command workflows and cascade workflows appear to have separate model-config surfaces

### `GetLoadCodeAssist`

Pattern:

- unary

Request/Response:

- field-level shapes not yet recovered beyond the message names

Runtime evidence:

- `cloudcode.log` repeatedly records `POST v1internal:loadCodeAssist`

Purpose:

- initializes or refreshes code-assist state from the cloud-code backend

Interpretation:

- this is a live, recurring path in normal startup/refresh behavior

## Cascade / Conversation / Agent Interfaces

### `StartCascade`

Pattern:

- unary

Request:

- `StartCascadeRequest.BaseTrajectoryIdentifier`
- `StartCascadeRequest.SourceMetadata`
- `StartCascadeRequest.Source`
- `StartCascadeRequest.TrajectoryType`
- `StartCascadeRequest.AgentScriptItem`
- `StartCascadeRequest.CascadeId`
- `StartCascadeRequest.WorkspaceUris`
- `StartCascadeRequest.OverrideWorkspaceUris`
- `StartCascadeRequest.ParentConversationId`
- `StartCascadeRequest.CitcWorkspaceDetails`
- `StartCascadeRequest.CustomAgentSpec`
- `StartCascadeRequest.Metadata`
- `StartCascadeRequest.ExperimentConfig`
- oneof present: `XXX_OneofWrappers`

Response:

- `StartCascadeResponse.CascadeId`

Related nested type:

- `StartCascadeRequest.CitcWorkspaceDetails`

Purpose:

- creates a new cascade session with workspace, parent-conversation, and experiment context

Interpretation:

- a cascade is a first-class session object, not just an ad hoc chat prompt
- trajectory and workspace concepts are built into creation

### `SendUserCascadeMessage`

Pattern:

- unary

Request:

- `SendUserCascadeMessageRequest.Metadata`
- `SendUserCascadeMessageRequest.CascadeId`
- `SendUserCascadeMessageRequest.Items`
- `SendUserCascadeMessageRequest.Images`
- `SendUserCascadeMessageRequest.ArtifactComments`
- `SendUserCascadeMessageRequest.FileDiffComments`
- `SendUserCascadeMessageRequest.FileComments`
- `SendUserCascadeMessageRequest.Media`
- `SendUserCascadeMessageRequest.CascadeConfig`
- `SendUserCascadeMessageRequest.CustomAgentSpec`
- `SendUserCascadeMessageRequest.ExperimentConfig`
- `SendUserCascadeMessageRequest.Blocking`
- `SendUserCascadeMessageRequest.AdditionalSteps`
- `SendUserCascadeMessageRequest.ClientType`
- `SendUserCascadeMessageRequest.PropagateError`
- `SendUserCascadeMessageRequest.PlannerResponse`
- `SendUserCascadeMessageRequest.MessageOrigin`

Response:

- no concrete response fields recovered yet

Runtime evidence:

- the binary contains explicit logging text: `Received SendUserCascadeMessageRequest: %v`

Purpose:

- sends a rich user message into an existing cascade session

Interpretation:

- this is not a plain text chat RPC
- it supports media, file comments, diff comments, additional steps, planner hints, and client-origin tagging

### `HandleStreamingCommand`

Pattern:

- streaming
- evidence exists for both gRPC streaming and Connect server-streaming surfaces

Request:

- `HandleStreamingCommandRequest.Metadata`
- `HandleStreamingCommandRequest.Document`
- `HandleStreamingCommandRequest.EditorOptions`
- `HandleStreamingCommandRequest.RequestedModelId`
- `HandleStreamingCommandRequest.SelectionStartLine`
- `HandleStreamingCommandRequest.SelectionEndLine`
- `HandleStreamingCommandRequest.CommandText`
- `HandleStreamingCommandRequest.RequestSource`
- `HandleStreamingCommandRequest.MentionedScope`
- `HandleStreamingCommandRequest.ActionPointer`
- `HandleStreamingCommandRequest.ParentCompletionId`
- `HandleStreamingCommandRequest.DiffType`
- `HandleStreamingCommandRequest.Diagnostics`
- `HandleStreamingCommandRequest.SupercompleteTriggerCondition`
- `HandleStreamingCommandRequest.TerminalCommandData`
- `HandleStreamingCommandRequest.ExperimentConfig`
- `HandleStreamingCommandRequest.IgnoreSupercompleteDebounce`
- `HandleStreamingCommandRequest.ClipboardEntry`
- `HandleStreamingCommandRequest.IntellisenseSuggestions`

Response:

- `HandleStreamingCommandResponse.CompletionId`
- `HandleStreamingCommandResponse.PromptId`
- `HandleStreamingCommandResponse.Diff`
- `HandleStreamingCommandResponse.LatencyInfo`
- `HandleStreamingCommandResponse.SelectionStartLine`
- `HandleStreamingCommandResponse.SelectionEndLine`
- `HandleStreamingCommandResponse.Score`
- `HandleStreamingCommandResponse.CharacterDiff`
- `HandleStreamingCommandResponse.ComboDiff`
- `HandleStreamingCommandResponse.FilterReason`
- `HandleStreamingCommandResponse.JumpPosition`
- `HandleStreamingCommandResponse.RequestInfo`
- `HandleStreamingCommandResponse.StopReason`
- `HandleStreamingCommandResponse.Trajectory`
- `HandleStreamingCommandResponse.RawText`
- `HandleStreamingCommandResponse.TraceId`
- `HandleStreamingCommandResponse.ClosestChangedLine`
- oneof present: `XXX_OneofWrappers`

Runtime evidence:

- `ls-main.log` contains a live failure on `/exa.language_server_pb.LanguageServerService/HandleStreamingCommand`

Purpose:

- drives the main streaming command/completion/edit pipeline for interactive coding operations

Interpretation:

- this is one of the core interactive RPCs in the product
- it mixes editor context, model choice, diagnostics, experiments, terminal data, and completion ancestry in one request
- the response is incremental and can carry diff-oriented as well as raw-text-oriented results

## Quota / Prediction Interface

### `PredictionService.RetrieveUserQuota`

Pattern:

- unary

Request:

- `RetrieveUserQuotaRequest.Project`

Response:

- `RetrieveUserQuotaResponse.Buckets`
- for each bucket:
  - `BucketInfo.Remaining`
  - `BucketInfo.RemainingAmount`
  - `BucketInfo.RemainingFraction`
  - `BucketInfo.ResetTime`
  - `BucketInfo.TokenType`
  - `BucketInfo.ModelId`

Purpose:

- returns quota state broken down into one or more model/token buckets

Interpretation:

- quota is modeled as structured buckets rather than a single flat counter
- the response shape is already rich enough to support per-model quota displays or gating

## Transport Notes

Recovered transport evidence shows:

- typed Connect responses for:
  - `StartCascade`
  - `SetCloudCodeURL`
  - `SendUserCascadeMessage`
  - `GetModelStatuses`
  - `GetCascadeModelConfigs`
  - `GetCommandModelConfigs`
  - `GetAvailableModels`
- gRPC generic client/server stream types for:
  - `HandleStreamingCommand`

Interpretation:

- the binary supports both unary typed RPCs and streaming RPCs using more than one transport abstraction
- this is consistent with a large local product control plane rather than a narrow LSP implementation

## What We Can Reliably Say Today

- we can now give a request type, response type, transport pattern, and likely purpose for the entire recovered `LanguageServerService`
- for a smaller high-value subset, we can also name specific request/response fields
- for a few interfaces, we can additionally prove real runtime use from local logs

## What Still Needs Deeper Recovery

- full proto field maps for all 202 methods
- enum value meanings for many request/response fields
- concrete response fields for methods like `SendUserCascadeMessage`
- call ordering between extension host, local language server, and cloud code for every workflow
