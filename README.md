# dsh-ichuny-codex

[English](README.en.md) | 简体中文

在 DeepSeek Harness 中使用本机已登录的 Codex。`@ipedia/dsh-ichuny-codex` 把 Codex 作为 `My Codex` 模型提供者接入 DSH，让对话、模型选择和额度查看留在同一个工作界面中。插件通过本机 `codex app-server` 通信，不另建登录流程，也不读取或保存 Codex 凭据。

## 能做什么

- **使用已有 ChatGPT 登录**：认证由 Codex CLI 负责；插件只读取登录状态和模型列表。当前适配器要求 `chatgpt` 登录，不支持 API-key 账户模式。
- **在 DSH 中对话**：支持文本和模型推理内容的流式输出，以及图片输入、文件句柄输入和请求取消。图片与文件需要 DSH 提供附件服务。
- **接入 DSH 工具**：当 DSH 请求携带工具时，Codex 可发起工具调用，由 DSH 执行并返回文本结果；此功能需要持久化 DSH 会话，并使用 Codex app-server 的实验性 API。
- **查看 Codex 额度**：选中 `My Codex` 时，Web 界面可显示 5 小时窗口的剩余额度；点击可查看套餐、每周额度和余额。额度数据由插件自己的本地路由提供。

插件默认使用依赖中固定版本的 Codex 原生程序，不依赖全局 `codex` 命令的版本。它直接启动子进程，不通过 shell 执行命令；不添加遥测或直连 OpenAI HTTP API。

## 安装

### 快速安装

已发布版本可直接通过 npm 包名安装到 DSH `web` profile：

```powershell
dsh plugin --profile web add @ipedia/dsh-ichuny-codex --ignore-scripts --workspace-root
```

安装完成后重启 `dsh web`，在模型选择器中选择 `My Codex`。上述命令安装 npm 的 `latest`；`1.7.15` 发布后可使用 `@ipedia/dsh-ichuny-codex@1.7.15` 并添加 `--save-exact` 固定版本。发布前请按下文从源码构建并安装本地包。

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

安装后**重启对应 DSH profile**，在模型选择器中选择 `My Codex`。补丁条目为 `llm-codex`，实际 provider ID 是 `my-codex`。浏览器刷新不能替代宿主进程重启。

### 运行条件

- Node.js 22.19 或更高版本；peer 声明支持 DSH `0.2.2-rc.1`、`0.2.2-rc.3` 和 `0.2.2-rc.5`。项目自身仍兼容 Node.js 22.19；DSH rc.5 宿主要求 Node.js 24.9 或更高版本。rc.1 固定的旧 Zod 版本仍有高危安全公告，建议使用 rc.5。
- 安装依赖时保持 optional dependencies 启用，以便安装 `@openai/codex@0.169.0` 对应平台的原生程序。
- 运行 DSH 的同一系统用户已通过 Codex CLI 完成 ChatGPT 登录。可运行 `codex login status` 检查；全局 CLI 仅用于检查登录，不决定插件内置程序的版本。

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

文本对话无需附件服务。图片由 DSH 附件存储读取并转成 data URL；文件以只读路径描述交给 Codex，而不是由插件直接读取任意文件。动态工具由 DSH 执行，支持文本以及来自 DSH 附件存储的图片工具结果（如 `read_image`）；图片经请求投影后作为 Codex `inputImage` 回传，文本不丢失，整批编码后内容以 UTF-8 计不超过 4 MiB。同轮已到达的并发调用会一同交给 DSH，之后才到达的调用留到下一步，只有确实交给 DSH 的调用才要求在本次续接中回传结果。重复、缺失、超限或非文本结果会拒绝已暴露调用的待答批次。已完成的 Codex turn 若遇到 DSH 工具目录增删或 schema 变动，会在下一轮通过 `thread/resume` 更新工具声明；等待工具结果期间保留原目录直至该轮完成。每个 DSH 会话在插件进程中复用同一个 Codex thread；成功完成的 turn 才推进消息游标，失败的 turn 可重试同一条用户输入。下一轮仅发送游标之后的新 `user` 消息；若只有 DSH 工具目录或系统提示改变，则用一句短指令续接，不重发整段历史。DSH 的 `purpose: compaction` 摘要请求即使沿用同一个 DSH session ID，也会使用独立、只读的临时 Codex thread，不注册 DSH 动态工具；摘要完成后销毁临时状态，不触碰主 thread 的工具结果或消息游标。完全没有新输入或上下文变化的普通重复请求仍拒绝为 `EMPTY_INPUT`。新建 thread 时系统提示进入 Codex thread 指令。成功完成的回复把非敏感的 thread ID 和消息游标保存在 DSH replay 元数据中，插件重启后会尝试 `thread/resume`；旧版本已完成的回复没有此元数据，或压缩后游标与回复边界都消失时，无法安全恢复。恢复失败会报错，不会静默新建另一个 thread。

用户开发请求会排在同轮由 DSH 注入的时间、技能目录等上下文之后，使人工任务成为 Codex 当前输入的最后指令；有 `run_code` 工具时，Codex thread 会收到先尝试工具、不得虚构工具失败的桥接指令。插件不能强制模型必然调用工具，是否实际开始开发应以 DSH 工具调用和文件改动为准。若 `thread/resume` 返回不同的 thread ID，插件会报 `SESSION_THREAD_MISMATCH`，避免丢失既有开发任务后仍输出看似成功的回复。

Web 额度控件仅在选择 `my-codex` 时出现。插件通过 `/api/dsh-ichuny-codex/rate-limits` 返回选定的额度字段，成功响应不包含账户 ID；错误消息会经过凭据样式脱敏后返回，但部署到非受信任环境前仍应审查访问控制。额度详情由 Codex 返回的数据决定，无法获取时控件会隐藏。

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

`npm test` 运行 [vitest.config.ts](vitest.config.ts) 选中的全部 12 个现存 spec 文件，包含 adapter、动态工具和 Cordis 组合测试。构建、打包和这些自动测试不替代目标 DSH 宿主的实际对话验证；发布 rc.5 兼容版本前必须在 rc.5 宿主完成 `My Codex` 真实回复验证。实现边界与进一步的排障说明见 [架构](kb/reference/architecture.md)、[配置](kb/reference/configuration.md) 和 [常见问题](kb/troubleshooting/common-issues.md)。

Apache-2.0 许可及原作者归属见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
