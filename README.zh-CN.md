# Antigravity Retry Toolkit 中文说明

[English README](README.md) | 中文

用一个本地 proxy 和状态栏扩展，在 macOS 上处理 Antigravity 的 `429` / `503` 重试失败，并把过程清楚显示出来。

这是一个面向 macOS 上 Antigravity 用户的小工具包。它的目标是：当大模型后端或网络入口出现短时失败时，自动重试，并把重试状态显示出来，而不是让用户只能反复手动点 retry。

Antigravity Retry Toolkit 给 Antigravity 增加两类能力：

- 对短时云端容量故障自动重试。
- 在状态栏显示重试状态、最近错误和 quota 类失败。

这个仓库已经按可以直接发布到 GitHub 的方式组织。

## 适合谁

- 你在 macOS 上使用 Antigravity
- 你经常遇到 `429`、`503` 或短时连接失败
- 你想让系统自动重试，而不是手动反复点 retry
- 你希望在 Antigravity 里直接看到重试状态

## 不适合谁

- 不愿意修改 Antigravity 用户设置的用户
- 需要托管服务而不是本地 proxy 的用户
- 还没有验证过的 Windows 或 Linux 环境

## 3 步快速上手

1. 安装本地 retry proxy
2. 把 `jetski.cloudCodeUrl` 指向 `http://127.0.0.1:38475`
3. 在 Antigravity 中安装 `extension/retry-status-bar-0.2.24.vsix`

如果你想看完整命令和截图，直接跳到 [快速开始](#快速开始)。

## 常见问题

这个工具主要用于处理 Antigravity 中频繁出现的以下问题：

- `Agent terminated due to error`
- `429 rate limiting`
- `503 server overload`
- 连接失败或短时传输错误
- 需要反复手动 retry，但看不清当前到底发生了什么

## 为什么需要它

Antigravity 默认体验里，短时上游失败会严重打断使用：

- Agent 可能因为一次临时 `503` 或容量错误直接停止。
- 手动 retry 重复、低效，也容易丢失上下文。
- 内置界面没有清楚显示当前第几次尝试、哪个模型失败、请求是否已经恢复。

这个工具通过一个本地 retry proxy 和一个轻量状态栏扩展来解决这些问题。

## 你会得到什么

- 对 `503`、传输错误、可重试 `429` 等临时上游失败自动重试。
- 对硬 quota 耗尽类错误立即透传，让真实额度问题继续可见。
- 在 Antigravity 内显示实时重试状态：尝试次数、当前错误、模型、接口、最近重试历史，以及手动停止入口。
- 支持多窗口、多会话状态隔离，避免一个窗口的重试状态污染另一个窗口。
- 提供本地开发脚本，用于打包、安装、验证和 reload 扩展。
- 非侵入式集成：不修改 `Antigravity.app` 内部文件，只通过本地 proxy、用户级设置和单独安装的扩展工作。

## 当前状态

- 当前版本：`0.2.24`
- 目标平台：macOS
- Retry proxy：已在本地验证
- 多窗口、多会话状态隔离：已在本地验证
- 已通过真实重试流验证，包括临时 `503` 重试和 quota 风格 `429` 处理
- VSIX 外部安装后的自动扩展 reload：已在本地验证

## 已知限制和风险

- 目前只在本地 macOS 环境验证，尚未验证 Windows 或 Linux。
- 已验证真实临时 `503` 和 quota 风格 `429`，但还没有覆盖大量上游失败类型或长时间生产流量。
- 多窗口、多会话隔离已本地验证，但没有在持续高并发下做压力测试。
- Proxy 当前没有独立的最大并发控制。过高本地并发仍可能增加上游限流，而不是提高恢复率。
- 重试状态保存在内存中。如果 proxy 进程重启，正在进行的 retry 历史和 UI 状态会丢失。
- 集成依赖 Antigravity 内部行为，例如 `jetski.cloudCodeUrl`、本地扩展安装行为和当前窗口/上下文信号。未来 Antigravity 版本可能改变这些集成点。
- VSIX 外部安装后的自动窗口 reload 已本地验证，但还没有完整的 headless 端到端 UI 测试套件。

## 截图

Before：Antigravity 可能因为临时上游错误停止，只留下手动 retry 循环。

<img width="452" height="258" alt="Antigravity transient error example" src="https://github.com/user-attachments/assets/6ffd520a-5710-4b3a-88dc-db533da0471a" />

After：扩展会在 Antigravity 内直接显示实时 retry 状态、会话 ID、模型名称和最近 retry 事件。

<img width="1033" height="400" alt="Retry status tooltip and status bar" src="https://github.com/user-attachments/assets/b51d8ecc-125f-48c0-8699-c7bb0d5e2f22" />

## 工作原理

### Retry proxy

源码：

- [proxy/antigravity-cloudcode-proxy.js](proxy/antigravity-cloudcode-proxy.js)

行为：

- 重试 `503`、临时 `429` 和传输失败。
- 对硬 quota 耗尽立即透传。
- 暴露 `__health` 和 `__status`。
- 在内存中保存最近 retry 事件，供状态栏扩展读取。

### 状态栏扩展

源码：

- [extension/package.json](extension/package.json)
- [extension/extension.js](extension/extension.js)

已打包 VSIX：

- [extension/retry-status-bar-0.2.24.vsix](extension/retry-status-bar-0.2.24.vsix)

行为：

- 用 `1`、`2`、`3` 显示重试尝试次数。
- 对硬 quota 失败显示 `Quota Exceeded`。
- 重试成功后显示 `Recovered`。
- 空闲时可以显示 `0`。
- 在 tooltip 和 output channel 中显示最近事件。
- 可以从 tooltip 或命令面板手动停止当前会话的 retry。
- 增加常驻 `Toolkit On` / `Toolkit Off` 状态栏开关，不打开命令面板也能启用或暂停整个工具包。

## 快速开始

### 1. 安装本地 retry proxy

```bash
cd scripts
chmod +x install-proxy.sh uninstall-proxy.sh
./install-proxy.sh
```

### 2. 让 Antigravity 指向本地 proxy

在 Antigravity 用户设置里加入：

```json
{
  "jetski.cloudCodeUrl": "http://127.0.0.1:38475"
}
```

`jetski.cloudCodeUrl` 是 Antigravity 控制 cloud code 请求后端 URL 的设置。这里把它重定向到本地 retry proxy。

### 3. 安装状态栏扩展

在 Antigravity 中：

1. 运行 `Extensions: Install from VSIX...`
2. 选择 `extension/retry-status-bar-0.2.24.vsix`
3. 运行 `Developer: Reload Window`

### 4. 手动停止一次 retry

如果你想停止当前会话的 retry 循环：

1. 从命令面板运行 `Retry Status Bar: Stop Current Retry`
2. 或者在 retry 活跃时点击状态 tooltip 里的 `Stop retry`

这个操作只停止当前会话的本地 retry 循环，不会 patch 或修改 `Antigravity.app`。

### 5. 启用或停用整个工具包

如果你需要一个统一开关：

```bash
./scripts/toolkit-control.sh on
./scripts/toolkit-control.sh off
./scripts/toolkit-control.sh status
./scripts/toolkit-control.sh restart
./scripts/toolkit-control.sh uninstall
```

各命令含义：

- `on`：启动本地 proxy，并把 Antigravity 的 `jetski.cloudCodeUrl` 指向 `http://127.0.0.1:38475`。
- `off`：停止本地 proxy，并恢复之前的 `jetski.cloudCodeUrl`。
- `status`：显示 Antigravity 设置当前是否指向 toolkit proxy，以及 proxy 是否已加载。
- `restart`：重启 proxy，并保持工具包启用。
- `uninstall`：恢复之前的 `jetski.cloudCodeUrl`，移除 proxy launch agent，删除 toolkit 状态/日志文件，并从 `~/.antigravity/extensions` 卸载 retry status bar 扩展。

## 仓库结构

- `proxy/`：本地 retry proxy 源码。
- `scripts/`：安装、卸载、打包、reload 和验证脚本。
- `extension/`：Antigravity / VS Code 状态栏扩展源码和已打包 VSIX。
- `dist/`：预构建发布包。

## 本地开发循环

如果需要稳定的“改代码 -> 打包 -> 安装 -> 冒烟测试”循环，运行：

```bash
cd /Users/wister.xue/Desktop/workspace/antigravity-retry-toolkit
chmod +x scripts/*.sh
./scripts/dev-loop.sh
```

这个脚本会：

- 对 proxy、extension 和安装脚本做语法检查。
- 打包最新 VSIX。
- 直接把 VSIX 安装到 `~/.antigravity/extensions`。
- 重新安装本地 proxy launch agent。
- 验证 `__health` 和 `__status`。
- 保留一个独立验证入口：`scripts/verify-dev-loop.sh`。

如果只想安装预构建 VSIX，不重新打包：

```bash
./scripts/install-extension.sh extension/retry-status-bar-0.2.24.vsix
```

如果想得到 pass/fail 验证报告，并自动 reload Antigravity 窗口：

```bash
./scripts/verify-dev-loop.sh --reload-windows
```

如果想让 reload 步骤在默认 `30s` 之前快速失败：

```bash
RETRY_TOOLKIT_WINDOW_RELOAD_TIMEOUT_SECONDS=5 ./scripts/verify-dev-loop.sh --reload-windows
```

当前限制：

- `scripts/reload-antigravity-windows.sh` 只会通过 macOS accessibility 自动化尝试 reload 已打开的 Antigravity 窗口。在某些 Antigravity 构建中，窗口切换可能卡住，所以即使扩展内自动 reload 路径可用，`verify-dev-loop.sh --reload-windows` 仍可能失败。

自动 reload 说明：

- 从 `0.2.14` 开始，运行中的扩展会监听 `~/.antigravity/extensions/extensions.json`。
- 如果检测到 `wister-xue.retry-status-bar` 已安装版本发生变化，会触发 `workbench.action.reloadWindow`。
- 该行为已在 `v0.2.24` release prep 中本地验证。

## 可配置 retry 设置

Proxy 从环境变量读取配置：

- `ANTIGRAVITY_PROXY_PORT`
- `ANTIGRAVITY_PROXY_TARGET_HOST`
- `ANTIGRAVITY_PROXY_MAX_ATTEMPTS`
- `ANTIGRAVITY_PROXY_BASE_DELAY_MS`
- `ANTIGRAVITY_PROXY_MAX_DELAY_MS`
- `ANTIGRAVITY_PROXY_STATUS_HOLD_MS`
- `ANTIGRAVITY_PROXY_QUOTA_STATUS_HOLD_MS`
- `ANTIGRAVITY_PROXY_EVENT_HISTORY_LIMIT`
- `ANTIGRAVITY_PROXY_ATTEMPT_HISTORY_LIMIT`
- `ANTIGRAVITY_PROXY_ATTEMPT_LOG_PATH`
- `ANTIGRAVITY_PROXY_DEBUG_REQUEST_IDENTIFIERS`

默认安装脚本会把这些值写入生成的 `launchd` plist。
默认情况下，retry 延迟上限是 `5000ms`，所以即使上游响应建议 `15s` 后重试，本地 proxy 最多等待 `5s`。
设置 `ANTIGRAVITY_PROXY_DEBUG_REQUEST_IDENTIFIERS=1` 后，会记录候选请求标识，例如 `cascadeId`、`conversationId`、`sessionId`、`requestId`、`threadId` 和 `chatId`，但不会 dump 完整请求体。

## 诊断上游热点

Proxy 会在以下位置保留短期的 per-attempt 诊断历史：

- `GET /__status`
- 扩展诊断 dump
- 默认 JSONL 文件：`~/Library/Logs/antigravity-cloudcode-proxy-attempts.jsonl`

每次 attempt 会记录：

- 安全的请求头 allowlist，例如 `user-agent`、`x-goog-api-client`、`x-client-data`、`traceparent`、`grpc-timeout` 和 `x-request-id`
- 选中的 upstream IP 和端口
- DNS / connect / TLS / first-byte / total timing
- socket 是否复用
- HTTP 版本
- 少量 upstream 响应头 allowlist，例如 `retry-after`、`x-envoy-upstream-service-time`、`server`、`via` 和 `alt-svc`

这些信息不能证明 Google 把某次请求路由到某台具体过载机器，但足够回答更窄的问题：

- 失败是否集中在少数 upstream IP 上？
- 失败 attempt 是否有明显更高的 `x-envoy-upstream-service-time` 或 `firstByteMs`？
- retry 是否在同一连接模式下失败，但 fresh resolution 后成功？
- 这个问题是硬 quota 风格 `429`，还是短时容量/传输问题？

## 发布产物

仓库包含一个预构建发布 zip：

- [dist/antigravity-retry-toolkit.zip](dist/antigravity-retry-toolkit.zip)

GitHub Release：

- [v0.2.24](https://github.com/wisterx-spec/antigravity-retry-toolkit/releases/tag/v0.2.24)

## License

- [MIT](LICENSE)

## CI

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) 会在 GitHub Actions 上运行 shell 语法检查、JavaScript 语法检查和 VSIX 打包。

## 备注

- 这个仓库不包含 floating overlay 版本。
- Retry proxy 和扩展已经本地测试，但还没有完整的 headless 端到端 UI 测试套件。
