# ChatGPT 双连接方案（提案）

状态：阶段 0–3 已实现并通过自动测试、构建、审计与打包检查；本地和 OAuth 真实客户端 smoke 尚未全部通过，因此不得宣称端到端可用。项目所有者已批准 OpenAI 官方 Sign in with ChatGPT Preview、本机单用户、DSH 凭据存储和独立 OAuth `codex app-server` 的窄范围例外。决策与限制见 `kb/reference/chatgpt-connection-decision.md`。

## 1. 目标与边界

在同一个 DSH 插件中提供两条明确分离的 ChatGPT 连接链路，并参照 `dsh-plugin-subscriptions` 的设置页组织方式管理连接状态：

| 设置页标签 | 模型选择器显示名 | Provider ID | 执行与认证 |
| --- | --- | --- | --- |
| 本地 ChatGPT | ChatGPT（本地） | `my-codex` | 现有本地 `codex app-server`，Codex 自行管理登录与执行 |
| ChatGPT OAuth | ChatGPT（OAuth Preview） | `my-codex-oauth` | OpenAI 官方 SIWC Preview；插件管理 OAuth，执行由独立配置的 `codex app-server` 承担 |

保留 `my-codex`、`llm-codex`、现有会话回放和本地额度接口的兼容性。两个 provider 可同时注册；用户选择的新会话首选方式不修改已有会话的 provider。禁止在进行中的 turn、待答工具调用或同一后端上下文内热切换；OAuth 失败不静默回退本地。

首版只支持一个 OAuth 账号，不做账号池、多账号自动轮换、代理测试、图片/视频生成、额度重置或模型编辑器。首版目标范围是认证、模型发现、文字/图片/文件输入、流式输出、DSH 工具与取消、结构化限额错误和状态展示。官方 Preview 没有公开额度摘要 API，设置页只链接 ChatGPT Settings Usage，不展示虚构的剩余额度。实际可交付范围以官方 Preview 契约和真实账号验收为准，不做功能等效或稳定性的虚假承诺。

### 已批准的窄范围例外

项目所有者已更新 `AGENTS.md`、`CLAUDE.md` 和 `kb/reference/security.md`：只允许 OpenAI 官方 SIWC open-source Preview 的动态客户端注册、文档化 scope、`auth.openai.com` OAuth/OIDC endpoint、公开 `api.openai.com/v1/models` 和 `/v1/responses`，并要求 `my-codex-oauth` 使用独立 `codex app-server`。私有 ChatGPT `backend-api`、固定第三方 client ID、未文档化 endpoint/scope、API key fallback、凭据泄漏和跨 provider 回退仍被禁止。

## 2. 设置页信息架构

入口建议为 DSH `settings.section` 中的「ChatGPT 连接」；使用 `settings.section.icon` 仅在宿主支持时增加图标。页面顶部显示当前会话实际来源（若可由宿主提供），再展示两个标签及各自状态；不要把首选方式误写成当前会话的执行方式。

```text
设置 / ChatGPT 连接

新会话首选方式   [本地 ChatGPT] [ChatGPT OAuth]
                   只影响新会话；已有会话继续使用原连接

[本地 ChatGPT] [ChatGPT OAuth]

本地 ChatGPT                         已连接 / 未登录 / 检查失败
使用本机 Codex 登录                  重新检查
模型：N 个                          额度：可用时显示摘要与刷新时间
未登录：显示 codex login 指引，不在插件里读取/复制凭据

ChatGPT OAuth                       未连接 / 授权中 / 已连接 / 过期 / 出错
连接 / 取消授权 / 断开连接           模型：N 个
用量：打开 ChatGPT Settings Usage      失败原因与重新连接操作
```

- **本地页签**只调用现有 app-server 的登录状态、模型目录与额度读取；“重新检查”不是登录按钮。不得展示 Codex 凭据或 token。
- **OAuth 页签**仅在授权中轮询完成状态；离开页面、取消授权或卸载插件时关闭监听、定时器和回调资源。显示可公开的账号别名/套餐时先做隐私审查，不返回 token 或原始上游错误体。
- **首选方式**是非秘密持久化偏好。OAuth 未连接时禁用选择或明确提示先连接；切换首选方式不应卸载任何正在执行的 adapter。
- **连接/断开**是用户专属权限操作。断开只清理插件自己的 OAuth 凭据和缓存，不触碰 Codex CLI 状态，也不删除会话日志；既有 OAuth 会话下次请求应提示重新连接，而非转给本地 provider。
- 标签提供 `role=tablist/tab/tabpanel`、键盘导航、焦点恢复、加载/失败/成功状态及简洁说明。复用 DSH 的 locale 与主题变量，不复制参考项目的整页 CSS 或复杂管理弹窗。
- 当前额度组件在 `client.js` 中只识别 `my-codex`，并使用单份五分钟缓存。该缓存继续只属于本地 provider；OAuth 页签不读取或展示它，只链接官方 Usage 页面并显示当前 OAuth 请求的结构化限额错误。

参考实现：`C:\git\ai\resources\dsh-plugin-subscriptions\src\client\index.ts` 第 74-103 行的设置插槽、`SubscriptionsSection.tsx` 第 575-635 行的按需轮询及第 909-980 行的标签与状态操作。它的五服务商、多账号、代理配置、额度重置不属于本期范围。

## 3. Host 与 Client 架构

### Host

1. `CodexAdapter` 和 `AppServerClient` 维持现状，仍注册 `my-codex`。不要用一个 `if (mode)` 分支包装现有 `stream()`，也不要让 OAuth 解析现有的 Codex thread ID。
2. 增加独立 `OAuthAdapter`，注册 `my-codex-oauth`，并为它单独启动按官方 SIWC 文档配置的 `codex app-server`。该进程只接收 OAuth access token，使用公开 `https://api.openai.com/v1` Responses endpoint，不访问 ChatGPT `backend-api`。适配器拥有独立的 `listModels/resolveModel/stream`、线程、刷新后重启与 `thread/resume`、取消和限额错误处理；所有边界继续运行时校验并限制输入/输出大小、超时与并发。
3. 模式首选值不作为“只能激活一个 adapter”的开关。两个 provider 的生命周期独立；OAuth 未登录时目录返回空或明确认证错误，不能映射到 `my-codex`。
4. 原生 app-server 继续承担本地链路的权限/沙箱；OAuth app-server 的本地 shell/MCP/agent 能力与托管 Responses tools 是不同边界，不得宣称两条链路权限等价。DSH 工具仍通过 DSH 的工具执行与审批边界，并限制 schema、调用数、参数和结果大小；官方 Preview 不支持的托管工具不得暴露。
5. 本地额度读取维持现状并与 OAuth 状态隔离。OAuth 只处理官方结构化 usage-limit 错误并链接 ChatGPT Settings Usage，不新增未经文档支持的额度接口。成功状态只包含白名单字段，失败响应脱敏；不能把现有只读额度路由当成授权写入口。

### Client 与持久化

- `client.js` 扩展设置页插槽；`package.json` 的 `dsh.client.inject` 按实际使用的 settings/locale/connection 服务补齐。注册和事件监听使用 Cordis effect/组件清理，保留现有 composer 配额控件。
- 首选方式优先使用宿主支持的配置表单/编辑器；不能直接改写用户 profile 的 `cordis.patch.yml`。普通配置字段可能导致插件重启，所以须验证 volatile 配置或其他不重载活跃 provider 的持久化机制，再决定保存 API。若宿主不支持可靠地设置“新会话默认模型”，设置页只能承诺保存**首选方式**并引导用户在新会话选择模型，不能声称自动切换已完成。
- OAuth 凭据保存为 DSH credential record，使用 owner-only 本地文件、原子写和权限检查；项目所有者已接受其不是 OS keychain、同 UID 进程可读的限制。凭据不进入普通配置、浏览器 localStorage、日志、URL 持久历史或 `~/.codex`。刷新按 registration 单飞并原子替换 rotating token；断开时先尝试官方 revocation endpoint，再清理本地记录。
- 登录使用官方动态客户端注册、PKCE、OIDC nonce、不可预测 `state`、严格 `127.0.0.1` loopback redirect URI、超时/取消及一次性 code；不提供“粘贴裸 code”绕过 `state` 的路径。首版明确只支持受信任本机单用户，远程和多用户部署不在支持范围。

安装版 DSH `0.2.2-rc.5` 的设置页静态契约及 dsh-doc `references/configuration.md` 可用于实现前验证；当前会话没有 live inspect 能力，不能把 `configForms`、`configEditor` 或某个 RPC 路由的当前 profile 可用性视作已验证事实。

## 4. 会话、工具与失败语义

- **已有本地会话**：继续走 `my-codex`，保持 `threadId`、用户消息游标、`thread/resume` 和工具待答状态。不要改变已有 replayState 版本或将其传给 OAuth。
- **新 OAuth 会话**：使用独立 provider ID 和独立 replayState 命名空间/版本；只记录安全续接需要的标识，不持久化 token、原始响应或明文 reasoning。首版若无法可靠恢复则明确不支持跨重启恢复并安全报错，不能静默从头重放已执行工具的任务。
- **工具轮次**：在 DSH 已发出工具调用但尚未回传结果时，锁定原适配器、账号和调用 ID；结果缺失、重复、超限或类型不符时原子拒绝并取消上游 turn，不跨 provider 复用。
- **取消与重试**：用户取消必须停止对应上游请求和本地监听；401 最多在合适情况下刷新一次，429 遵从服务器重试信息与有上限的退避。副作用操作不得自动重发。状态错误不暴露 token、账号 ID 或上游响应体。
- **辅助请求**：compaction 等 `purpose` 不能污染主会话的游标或 pending calls。OAuth 路径需明确定义辅助请求的只读/无工具策略，并测试与现有本地策略一致的隔离效果。
- **切换首选方式**：只影响未来新会话；当前会话保持其 provider。若用户想在同一会话换来源，必须以显式“用新连接开启新上下文”操作与说明处理，不称为无缝迁移。

## 5. 上游接口与风险决策

项目所有者已批准使用 OpenAI 官方 Sign in with ChatGPT open-source Preview，采用动态客户端注册、公开 `api.openai.com/v1` Responses endpoint 和独立 OAuth app-server。参考项目中的固定 OAuth client ID、私有 ChatGPT backend、私有模型或额度接口不属于获准方案，禁止移植。

已接受的风险边界：

1. SIWC 当前是 Preview，不承诺长期稳定；实现和每次发行前都重新核对官方文档。
2. DSH 本地凭据存储为 owner-only 文件，不是 OS keychain；首版部署限受信任本机单用户。
3. 刷新 token 会轮换，必须按 registration 串行化并原子更新；OAuth app-server 在刷新后单独重启并恢复自己的 thread。
4. 官方 Preview 没有额度摘要 API，且列出明确不支持的 hosted tools；UI 和验收只能承诺已由官方契约及真实账号验证的能力。

完整决策和官方来源见 `kb/reference/chatgpt-connection-decision.md`。

## 6. 分阶段交付与验收

| 阶段 | 工作 | 完成标准 |
| --- | --- | --- |
| 0：决策 | 已确认官方 SIWC Preview、独立 OAuth app-server、本机单用户、owner-only 凭据存储和能力降级 | 决策记录与窄范围治理例外已完成；私有 endpoint、API key fallback 和凭据泄漏仍禁止 |
| 1：设置外壳 | 两个页签、本地状态、首选偏好及存储失败提示 | 本地 `my-codex` 无回归；首选值不会重启/中断活跃 turn；组件与插槽卸载清理通过测试 |
| 2：OAuth 接入 | Host 协议、DSH flow、凭据 schema、PKCE/OIDC、单飞刷新/撤销、authenticated controller 与 Client action 已实现 | 登录/取消/过期/刷新竞争/重启均有测试；没有 token 泄漏或 Codex 凭据访问 |
| 3：会话能力 | 独立 OAuth provider/app-server、流式文本/推理/图片/文件、工具、取消、replay v2 与 refresh generation 已实现；真实限额/错误恢复待 smoke | 并发工具、断线、401/429、重启、切换首选及旧会话继续使用均通过契约/集成测试 |
| 4：发行验证 | 构建、审计、打包、隔离 DSH profile 和真实账号 smoke | 本地与 OAuth 分别完成登录、模型发现、流式对话、工具/取消、限额错误及恢复验收；OAuth Usage 链接可达；保留实际证据 |

实现变更须同时更新 `tests/`、`kb/reference/architecture.md`、`kb/reference/configuration.md`、`kb/reference/security.md`、安装说明与发布后验收流程；执行 `AGENTS.md` 所列 verify、typecheck、lint、coverage、build、audit、权限/依赖/签名审计和 package:check。自动测试或打包成功不等于真实 DSH 组合与真实账户可用。

## 7. 已决事项与剩余门槛

- 已批准官方 SIWC Preview，OAuth 执行改为独立 `codex app-server`，不实现私有 ChatGPT HTTP 适配器。
- 已批准只保存“新会话首选方式”并引导用户选择模型，不承诺自动修改默认模型。
- 已批准首版单账号、本机单用户和 owner-only DSH 凭据文件。
- 已接受 OAuth 无公开额度摘要 API，改为 Usage 链接和结构化限额错误。
- 项目所有者已完成窄范围治理例外：只允许官方 SIWC endpoint、scope 和独立 OAuth app-server；私有 endpoint、API key fallback、固定第三方 client ID 与凭据泄漏仍被禁止。

## 依据

- 当前项目：`src/index.ts` 第 18-32、52-112 行；`src/adapter.ts` 第 26、105-146、149-183、317-343、556-584 行；`client.js` 第 64-105、193-209 行；`package.json` 第 63-75 行；`tests/composition.spec.ts` 第 137-155、267-280 行。
- 当前契约：`AGENTS.md` 第 30-42 行；`kb/reference/architecture.md` 第 14-36 行；`kb/reference/security.md` 第 14-36 行；`kb/procedures/sop-release.md` 第 14-22 行。
- 参考项目：`C:\git\ai\resources\dsh-plugin-subscriptions\src\client\index.ts` 第 66-103 行；`src/client/SubscriptionsSection.tsx` 第 495-635、909-980 行；`src/auth/oauth-flow.ts` 第 1-70 行；`src/providers/codex.ts` 第 64-69、128-167、504-575、1143-1161 行；`src/auth/store.ts` 第 427-472 行。
- 已安装 DSH `0.2.2-rc.5`：`dsh-doc/references/ui-plugin.md`、`practices.md`、`configuration.md`、`user-actions.md`。这些是静态资料，本方案尚未验证当前 profile 的 live 插槽和鉴权边界。
