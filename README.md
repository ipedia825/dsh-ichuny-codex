# dsh-ichuny-codex

`@ipedia/dsh-ichuny-codex` 是一个 DeepSeek Harness provider 插件。它把 DSH 的 `my-codex` provider 请求转发到本机 `codex app-server`，通过 JSON-RPC over stdio 使用 Codex CLI 已有的登录状态。

插件不读取或保存 Codex 凭据，不实现 OAuth，不调用 OpenAI HTTP API，也不添加遥测服务。

## 运行要求

- Node.js 22.19 或更高版本
- DeepSeek Harness `0.2.2-rc.1`
- 安装插件时可下载 `@openai/codex@0.169.0` 及当前平台原生程序（保持 optional dependencies 启用）
- Codex CLI 已完成登录；认证仍由 Codex CLI 自己管理，与同一用户的全局 CLI 共用登录状态

检查本机环境（全局 `codex` 命令只用于检查登录状态，不决定插件所用 CLI 版本）：

```powershell
node --version
dsh --version
codex --version
codex login status
codex app-server --help
```

## 从源码安装

```powershell
npm ci --ignore-scripts --legacy-peer-deps
npm run verify
npm run typecheck
npm run lint
npm test
npm run build
```

在 Windows 上，如果 npm 的用户级 cache 被策略限制，可以将 cache 放在仓库目录：

```powershell
npm install --ignore-scripts --legacy-peer-deps --cache .npm-cache
```

生成本地插件包：

```powershell
$plugin = npm pack --ignore-scripts --silent
dsh plugin --profile web add "file:$((Get-Location).Path)\$plugin" --save-exact --ignore-scripts --workspace-root
```

安装后重启对应 DSH profile。补丁会注册 `llm-codex`，实际 provider ID 为 `my-codex`，显示名称为 `My Codex`。

## 从 GitHub 源码安装

仓库不提交 `lib/`、`node_modules/` 或打包生成的 `.tgz`。因此应在克隆后先构建、再安装本地打包产物；不要把 GitHub 仓库地址直接当成已构建的 npm 插件包。Node.js 需为 22.19 或更高版本，安装时保持 Codex 的 optional platform dependencies 启用。

```powershell
git clone https://github.com/ipedia825/dsh-ichuny-codex.git
cd dsh-ichuny-codex
npm ci --ignore-scripts --legacy-peer-deps
npm run verify
npm run typecheck
npm test
npm run build
npm run package:check
$plugin = npm pack --ignore-scripts --silent
dsh plugin --profile web add "file:$((Get-Location).Path)\$plugin" --save-exact --ignore-scripts --workspace-root
```

安装完成后重启对应 DSH profile。包内包含 `lib/`、`client.js`、`cordis.patch.yml`、LICENSE 和 NOTICE。`npm test` 当前只运行 [vitest.config.ts](vitest.config.ts) 列出的 3 个测试文件；构建或打包通过不等于已做真实 DSH/Codex 客户端验证。

## 配置

插件配置通过 DSH 的插件配置机制传入：

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `command` | `bundled` | 默认从本插件固定的 `@openai/codex@0.169.0` 解析原生程序；也可填可执行文件绝对路径 |
| `cwd` | 当前目录 | Codex thread 的工作目录 |
| `sandbox` | `workspace-write` | Codex 沙箱模式 |
| `approvalPolicy` | `untrusted` | Codex 审批策略 |
| `requestTimeoutMs` | `30000` | 单个 RPC 请求超时 |

当前版本支持文本对话、图片输入、文件输入、动态 DSH tools 和模型流式输出。图片会从 DSH attachment store 读取并以内联 data URL 发送给 Codex；文件会转换为只读文件句柄文本，Codex 可通过其工作区工具读取。若 profile 没有挂载 attachment store，文本对话仍可用，但图片和文件请求会返回明确错误。动态 DSH tools 通过 Codex experimental app-server API 暴露，必须使用持久化 DSH session，工具调用会先作为 `tool-call` 流块返回，收到对应 tool result 后继续原 Codex turn。

适配器提供 `readRateLimits()`，读取 Codex app-server 的 `account/rateLimits/read`，包括订阅计划、5 小时和 7 天窗口使用百分比、重置时间和可用重置额度。当前 DSH 0.2.2 的 `LlmAdapter` 没有通用额度展示接口，因此该数据可供宿主集成或诊断调用，不能自动出现在 DSH Web 的现有模型选择器中。

默认的 `bundled` 模式使用插件安装目录中的 Codex 平台包，不依赖全局 npm 路径，也不调用 `.cmd`/`.ps1` 或 shell。缺少可选平台包时请求会明确失败；重新安装插件并启用 optional dependencies，或将 `command` 设为原生程序的绝对路径。更新全局 Codex 不会改变插件固定的 CLI 版本；要升级插件内 CLI，须修改依赖版本并重新验证 app-server 协议。

插件只把允许的环境变量传给 Codex 子进程，并直接启动 `codex app-server`，不会通过 shell 执行命令。

## Web 额度显示

插件包含自己的 Web client，不修改 DSH 宿主源码。它通过 `conversation.composer.dock` 插槽在上下文使用比例旁显示 Codex 5 小时窗口剩余百分比；点击后显示订阅计划、5 小时和一周窗口剩余额度与重置时间，以及整体余额状态。额度仅在当前会话选择 `my-codex` provider 时显示；通过模型选择器的 `ModelDirectory.store` 读取当前或待切换模型，切换到其他 provider 会立即隐藏，切回 My Codex 会重新查询。切换到另一 My Codex 会话时会先显示最近 5 分钟的额度快照，同时后台刷新，避免额度信息短暂消失。client 通过插件自有的 `/api/dsh-ichuny-codex/rate-limits` 路由读取脱敏数据，账户 ID 和其他账户标识不会发送到浏览器。

详情面板与上下文弹层同为 264px 宽，紧凑展示套餐、5 小时、每周和额度余额，各额度行带色块，不提供“管理用量”入口。鼠标悬停或键盘聚焦 5 小时、每周的剩余百分比时显示相对重置时间，例如“1小时50分钟后重置”或“5天5小时后重置”；面板正文不显示重置时间。

安装或升级插件后需要重启 `dsh web`，浏览器刷新不会重新加载已运行进程中的 client plugin manifest。


- `src/index.ts`：Cordis 插件入口、配置解析和 provider 注册
- `src/adapter.ts`：DSH 消息与 Codex turn 的映射
- `src/app-server/`：JSON-RPC、stdio transport、协议验证和敏感信息脱敏
- `src/session-permissions.ts`：可选的 DSH 会话权限映射
- `cordis.patch.yml`：DSH profile 的插件注册补丁

## 验证

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

`npm run build` 生成的 `lib/` 是构建产物，不应手工编辑。真实 Codex turn 需要本机 Codex 登录状态，并应在隔离的 DSH profile 中验证。

## 安全边界

- 认证、token 刷新和凭据存储完全由 Codex CLI 负责。
- app-server 输入输出均经过 JSON 校验。
- 错误和日志会过滤凭据样式的值。
- 插件没有自定义网络客户端、遥测或远程日志。
- DSH 和 Cordis 保持 peer dependency，由宿主提供。

## 许可证

Apache-2.0，详见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
