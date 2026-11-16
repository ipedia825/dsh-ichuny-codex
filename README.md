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

目前仓库提供**从源码构建并安装本地包**的流程。GitHub 仓库不包含 `lib/`，所以不能将仓库 URL 直接当作已构建的插件包安装。下面以 Windows PowerShell 和 DSH `web` profile 为例：

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

- Node.js 22.19 或更高版本；当前依赖以 DSH `0.2.2-rc.1` 为目标。其他 DSH 版本需要单独验证。
- 安装依赖时保持 optional dependencies 启用，以便安装 `@openai/codex@0.169.0` 对应平台的原生程序。
- 运行 DSH 的同一系统用户已通过 Codex CLI 完成 ChatGPT 登录。可运行 `codex login status` 检查；全局 CLI 仅用于检查登录，不决定插件内置程序的版本。

如果 Codex 平台包缺失，重新安装并启用 optional dependencies，或在插件配置中将 `command` 设为 Codex 原生可执行文件的绝对路径。不要传入 shell 命令或 `.cmd`/`.ps1` 包装器。

## 使用与配置

插件通过 DSH 的插件配置机制接受以下字段：

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `command` | `bundled` | 使用内置 Codex 原生程序，或指定原生可执行文件路径 |
| `cwd` | 当前工作目录 | Codex thread 的工作目录 |
| `sandbox` | `workspace-write` | Codex 沙箱模式：`read-only`、`workspace-write`、`danger-full-access` |
| `approvalPolicy` | `untrusted` | Codex 审批策略：`never`、`on-request`、`untrusted` |
| `requestTimeoutMs` | `30000` | 单个 app-server 请求超时，范围 1000–300000 毫秒 |

文本对话无需附件服务。图片由 DSH 附件存储读取并转成 data URL；文件以只读路径描述交给 Codex，而不是由插件直接读取任意文件。动态工具由 DSH 执行，当前只向 Codex 转发文本工具结果。Codex 线程仅保存在插件进程内，重启后不会自动恢复原有线程。

Web 额度控件仅在选择 `my-codex` 时出现。插件通过 `/api/dsh-ichuny-codex/rate-limits` 返回选定的额度字段，成功响应不包含账户 ID；该路由的错误响应仍可能包含原始错误消息，部署到非受信任环境前应审查这一边界。额度详情由 Codex 返回的数据决定，无法获取时控件会隐藏。

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

`npm test` 目前只运行 [vitest.config.ts](vitest.config.ts) 选中的 3 个测试文件。构建、打包与这些测试通过不代表已完成真实 DSH 组合测试或 Codex 登录后的端到端烟测。实现边界与进一步的排障说明见 [架构](kb/reference/architecture.md)、[配置](kb/reference/configuration.md) 和 [常见问题](kb/troubleshooting/common-issues.md)。

Apache-2.0 许可及原作者归属见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
