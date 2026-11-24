# dsh-ichuny-codex

[English](README.en.md) | 简体中文

`@ipedia/dsh-ichuny-codex` 在 DeepSeek Harness 中提供两条独立的 ChatGPT 连接：`ChatGPT（本地）` 使用当前系统用户已登录的 Codex CLI，`ChatGPT（OAuth Preview）` 使用官方 Sign in with ChatGPT 授权和独立的 Codex app-server。两个 provider 可同时使用，已有会话不会因修改首选方式而切换来源。

## 能做什么

- **本地连接**：沿用 Codex CLI 的 `chatgpt` 登录、模型目录、工具与沙箱；插件不读取或复制 Codex 认证文件，也不支持 API-key 账户模式。
- **OAuth Preview 连接**：在「设置 → ChatGPT 连接」通过官方 SIWC 授权；独立的 `my-codex-oauth` provider 使用单独的 app-server、凭据记录和会话回放，不访问 ChatGPT 私有接口，也不会在失败时自动回退本地。首版仅支持受信任本机单用户、一个 OAuth 账号。
- **对话与 DSH 工具**：两种连接均经 app-server 流式输出文本与推理、接收图片和文件、支持取消和 DSH 工具回传；附件需要 DSH 附件服务，动态工具需要持久化会话和实验性 app-server API。OAuth 不承诺与本地 Codex 的沙箱、内建工具或托管工具等价。
- **连接管理**：设置页显示本地状态、可见模型数量与重新检查；OAuth 页签提供连接、取消授权、断开及官方 Usage 入口。非秘密首选方式仅引导新会话选模型，不会自动修改已有会话；OAuth 未连接时不能选为首选。
- **用量边界**：底部百分比、5 小时/每周额度和余额仅适用于 `my-codex`。官方 SIWC Preview 没有公开剩余额度摘要 API；OAuth 可从设置页查看官方 ChatGPT Usage，达到用量限制时由请求错误提示，不显示虚构百分比。

默认使用固定依赖中的 Codex 原生程序；两个 app-server 均直接启动、不经过 shell。仅 SIWC 授权流程访问官方 `auth.openai.com`，OAuth 子进程仅配置公开 `api.openai.com/v1`；不添加遥测、私有 ChatGPT 接口或 API-key 回退。

## 安装

### 快速安装

已发布版本可直接通过 npm 包名安装到 DSH `web` profile：

```powershell
dsh plugin --profile web add @ipedia/dsh-ichuny-codex --ignore-scripts --workspace-root
```

安装后重启 `dsh web`。本地连接可直接选 `ChatGPT（本地）`；OAuth 先到「设置 → ChatGPT 连接」完成授权，再选择 `ChatGPT（OAuth Preview）` 模型。上述命令安装 npm `latest`；确认 `1.8.0` 上架后可用 `@ipedia/dsh-ichuny-codex@1.8.0 --save-exact` 固定版本。

### 从源码安装

GitHub 仓库不提交生成的 `lib/`，从源码安装时需先构建并打包；不要直接把仓库 URL 当作已构建的插件包。下面以 Windows PowerShell 为例：

```powershell
git clone https://github.com/ipedia825/dsh-ichuny-codex.git
cd dsh-ichuny-codex
npm ci --ignore-scripts --legacy-peer-deps
npm run verify
npm run build
$plugin = npm pack --ignore-scripts --silent
dsh plugin --profile web add "file:$((Get-Location).Path)\$plugin" --save-exact --ignore-scripts --workspace-root
```

安装后**重启对应 DSH profile**。补丁包含 `llm-codex` 与独立 OAuth controller；provider ID 分别为 `my-codex` 和 `my-codex-oauth`。仅刷新浏览器不能替代 Host 重启。

### 运行条件

- Node.js 22.19 或更高版本；本版本要求 DSH `0.2.2-rc.5` 的 credentials、authorization 和 Typert 扩展接口。DSH rc.5 宿主要求 Node.js 24.9 或更高版本。旧 rc.1/rc.3 profile 不在本版本兼容范围内。
- 安装依赖时保持 optional dependencies 启用，以便安装 `@openai/codex@0.169.0` 对应平台的原生程序。
- 本地连接需要运行 DSH 的同一系统用户通过 Codex CLI 登录 ChatGPT，可运行 `codex login status` 检查；OAuth 使用设置页独立授权，不复用 CLI 凭据。

如果 Codex 平台包缺失，重新安装并启用 optional dependencies，或在插件配置中将 `command` 设为 Codex 原生可执行文件的绝对路径。不要传入 shell 命令或 `.cmd`/`.ps1` 包装器。

## 使用与配置

插件通过 DSH 的插件配置机制接受以下字段：

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `command` | `bundled` | 使用内置 Codex 原生程序，或指定原生可执行文件路径 |
| `cwd` | DSH 会话当前工作目录；无可用会话服务时退回宿主启动目录 | Codex thread 的工作目录；显式配置优先于 DSH 会话目录 |
| `sandbox` | `workspace-write` | Codex 沙箱模式：`read-only`、`workspace-write`、`danger-full-access` |
| `approvalPolicy` | `untrusted` | Codex 审批策略：`never`、`on-request`、`untrusted` |
| `requestTimeoutMs` | `30000` | 单个 app-server 请求超时，范围 1000–300000 毫秒 |
| `preferredConnection` | `local` | 非秘密的 volatile 新会话偏好：`local` 或 `oauth`；不切换现有会话 |

文本对话无需附件服务。图片由 DSH 附件存储读取并转成 data URL；文件以只读路径描述交给 Codex，而不是由插件直接读取任意文件。动态工具由 DSH 执行，支持文本以及来自 DSH 附件存储的图片工具结果（如 `read_image`）；图片经请求投影后作为 Codex `inputImage` 回传，文本不丢失，整批编码后内容以 UTF-8 计不超过 4 MiB。同轮已到达的并发调用会一同交给 DSH，之后才到达的调用留到下一步，只有确实交给 DSH 的调用才要求在本次续接中回传结果。重复、缺失、超限或非文本结果会拒绝已暴露调用的待答批次。已完成的 Codex turn 若遇到 DSH 工具目录增删或 schema 变动，会在下一轮通过 `thread/resume` 更新工具声明；等待工具结果期间保留原目录直至该轮完成。每个 DSH 会话在插件进程中复用同一个 Codex thread；成功完成的 turn 才推进消息游标，失败的 turn 可重试同一条用户输入。下一轮仅发送游标之后的新 `user` 消息；若只有 DSH 工具目录或系统提示改变，则用一句短指令续接，不重发整段历史。DSH 的 `purpose: compaction` 摘要请求即使沿用同一个 DSH session ID，也会使用独立、只读的临时 Codex thread，不注册 DSH 动态工具；摘要完成后销毁临时状态，不触碰主 thread 的工具结果或消息游标。完全没有新输入或上下文变化的普通重复请求仍拒绝为 `EMPTY_INPUT`。新建 thread 时系统提示进入 Codex thread 指令。成功完成的回复把非敏感的 thread ID 和消息游标保存在 DSH replay 元数据中，插件重启后会尝试 `thread/resume`；旧版本已完成的回复没有此元数据，或压缩后游标与回复边界都消失时，无法安全恢复。恢复失败会报错，不会静默新建另一个 thread。

用户开发请求会排在同轮由 DSH 注入的时间、技能目录等上下文之后，使人工任务成为 Codex 当前输入的最后指令；有 `run_code` 工具时，Codex thread 会收到先尝试工具、不得虚构工具失败的桥接指令。插件不能强制模型必然调用工具，是否实际开始开发应以 DSH 工具调用和文件改动为准。若 `thread/resume` 返回不同的 thread ID，插件会报 `SESSION_THREAD_MISMATCH`，避免丢失既有开发任务后仍输出看似成功的回复。

Web 额度百分比仅在选择 `my-codex` 时出现。`/api/dsh-ichuny-codex/rate-limits` 和 `/api/dsh-ichuny-codex/connection-status` 都只返回本地链路的脱敏字段；不得将本地额度误标为 OAuth 额度。OAuth 用量请从设置页打开官方 ChatGPT Usage；不支持远程或多用户 Web 部署。

## 开发与验证

```powershell
npm run verify
npm run typecheck
npm run lint
npm test
npm run build
npm run audit
npm run audit:permissions
npm run package:check
```

`npm test` 运行 [vitest.config.ts](vitest.config.ts) 收集的全部 spec，覆盖双 provider、SIWC、动态工具和 Cordis 组合。验证记录包括本地真实模型/流式/额度检查及隔离 rc.5 profile 的 OAuth 授权、选模与一轮文本会话；OAuth 图片、工具、取消、刷新和断开仍以自动测试为主，未完成逐项真实客户端验收，不能宣称全部端到端能力已验证。实现边界与进一步的排障说明见 [架构](kb/reference/architecture.md)、[配置](kb/reference/configuration.md) 和 [常见问题](kb/troubleshooting/common-issues.md)。

Apache-2.0 许可及原作者归属见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
