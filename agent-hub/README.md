# agent-hub CLI

零依赖 Node（≥22）命令行：维护 `~/.agent-hub` 这个单一真源，并把技能 / MCP / 记忆渲染到 DeepSeek Harness 与 Codex。

完整说明（架构、目录、验证记录、边界）见 [../README.md](../README.md)。

## 常用

```powershell
node bin/agent-hub.mjs init [--force]     # 首次初始化（建目录、种子技能、渲染、接 DSH、建记忆索引）
node bin/agent-hub.mjs sync               # 日常：渲染 + 接 DSH + Codex marketplace + 记忆索引 + MCP
node bin/agent-hub.mjs status             # 总览（技能 / junction / 记忆 / Codex 产物）
node bin/agent-hub.mjs paths              # JSON 输出全部关键路径
```

技能：

```powershell
node bin/agent-hub.mjs skill list
node bin/agent-hub.mjs skill new my-skill --description="什么时候用这个技能"
node bin/agent-hub.mjs skill adopt <已有技能目录> [--name=...]
node bin/agent-hub.mjs skill validate
```

记忆与 MCP：

```powershell
node bin/agent-hub.mjs memory index                    # 重建索引（含 shared.md 真源）
node bin/agent-hub.mjs memory search "CAN2 邮箱"
node bin/agent-hub.mjs memory digest --limit=8
node bin/agent-hub.mjs memory list                     # 只看两端共享真源
node bin/agent-hub.mjs memory add --title="..." --body="..." --kind=lesson --scope=global --tags=a,b
node bin/agent-hub.mjs memory remove --title="..."
node bin/agent-hub.mjs mcp import-codex
node bin/agent-hub.mjs mcp list
```

## 记忆：两端共享真源

- 真源文件 `~/.agent-hub/memory/shared.md`，H2 标题 = 一条记忆，标题下的 `- key: value` 是元数据
  （`kind` / `scope` / `tags` / `created` / `updated` / `authority`），其余是正文。
- DSH 侧由插件 `@local/dsh-agent-hub` 每次会话注入（共享条目永远排在最前、永远参与检索）；
  Codex 侧通过 MCP 服务器 `agent-hub` 的 `hub_memory_search` / `hub_memory_add` / `hub_memory_list` 读写。
- `skill` / `memory` / `mcp` 之外，索引还并入 Codex 侧 `~/.codex/AGENTS.md` 的只读解析结果
  （用于补 DSH 上下文里被截断的条目），以及 `~/.codex/memories_1.sqlite → stage1_outputs`
  （Codex 自己抽取的记忆，标题 `Codex 记忆 · <slug>`；`hub.json → memory.sqlite.enabled=false` 可关）。
  `memory.dshBudgetBytes` 默认 `"auto"`，从 profile `cordis.patch.yml` 的 `agent-instructions maxBytes` 自动读预算。
  sqlite 读取用 Node 24 内置的 `node:sqlite`（实验特性，失败就静默跳过，不影响其它来源）。

### Codex 自动读到共享记忆：AGENTS.md 生成块

Codex 只会自动加载 `AGENTS.md`，不会自己打开 `shared.md`。所以 `sync`（`src/codex-agents.mjs`
的 `syncCodexAgentsBlock`）会在 `~/.codex/AGENTS.md` 里维护一段**生成块**：

```
<!-- agent-hub:shared:start -->
## 跨 harness 共享记忆（agent-hub，DSH 与 Codex 共用）
…真源路径 + 工具清单 + 每条共享记忆的标题与 160 字摘要…
<!-- agent-hub:shared:end -->
```

- 只改两个标记之间的内容，Codex 自己往同一个文件追加的 milestone 不受影响；首次写入前留
  `AGENTS.md.bak-agenthub`。`hub.json → memory.injectIntoCodexAgents=false` 可关，
  `memory.codexAgentsPath` 可换目标文件。
- **反向坑（已修）**：这段生成块本身也是 `AGENTS.md` 里的一个 H2 —— 如果不排除，它会被记忆索引
  当成 Codex milestone 再吃回来，形成自我喂养。`src/memory.mjs` 的 `stripGeneratedBlock()`
  在解析 `agents-md` 来源前先剥掉整块。
- 实测（`codex exec`，不给工具）：Codex 能复述块标题与其中「一切自己做完」那条偏好 →
  说明它启动时就加载到了。

## MCP 服务器（给 Codex 用）

`mcp/server.mjs` 是零依赖 stdio JSON-RPC 服务器（stdout 只走协议消息，日志全走 stderr），
`sync` 会把它和 `src/*.mjs` 复制到 `~/.agent-hub/runtime/`，并在 `mcp/servers.json` 里注册
`agent-hub` 桥接（`codex.include: true`）。生成 Codex 插件时 `.mcp.json` **只带 `codex.include !== false`
的服务器**，避免把 `canmv-k230` 之类带 Authorization 的配置复制进插件目录。

工具：`hub_memory_search`、`hub_memory_add`、`hub_memory_list`、`hub_skill_list`、`hub_skill_show`、
`hub_status`、`hub_sync`。

每个工具都带 MCP `annotations`：只读的五个标 `readOnlyHint: true`（否则 Codex 会以
`MCP tool call requires approval, but approval policy is never` 拒调），写操作标 `false`。
Codex 执行的是 `~/.agent-hub/runtime/mcp/server.mjs` 副本，**改完 server 必须 `sync`**。

改动插件布局（技能目录、`.mcp.json` 结构）后必须升 `src/codex.mjs` 的 `CODEX_PLUGIN_VERSION`：
Codex 按版本号缓存已装插件（`~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`），
版本不变会继续用旧快照。

## Codex 侧安装（已在本机执行过）

```powershell
codex plugin marketplace add "$env:USERPROFILE\.agent-hub\build\codex-marketplace"
codex plugin add agent-hub@agent-hub
codex mcp list          # 应能看到 agent-hub
codex plugin list       # 应显示 installed, enabled
```

改完插件内容后重跑 `sync` + `codex plugin add agent-hub@agent-hub` 让缓存落到新版本目录。

## 插件兼容补丁

本机宿主是 `@deepseek-ai/dsh-settings` 0.2.1-rc.5，而 `dsh-at-file@0.6.3` 与
`@harleendance/dsh-skill-evolution` 是对更新宿主构建的，直接安装会导入失败。`patches/settings-compat/`
把这两处差异补在**已安装的 profile 产物**上（不动 npm 包本身）：

```powershell
node patches/settings-compat/apply.mjs           # 打补丁（幂等，可重复跑）
node patches/settings-compat/apply.mjs --check   # 只检查；需要打补丁时 exit 1
```

- `settings-compat.mjs` —— 补宿主缺失的 `settingsNamespace()` / `installSettingsSection()`。
  后者把配置包成**可调用对象**（`() => resolved` 且带属性），同时满足 getter 风格 `current()`
  与取值风格 `source.enabled`；持久化落在 `%DSH_HOME%\settings\<ns>.json`。
- `typert-compat.mjs` —— 新宿主 `dsh-typert-registry` 的 `validateCodec()` 要求 strict codec 带
  `create()` 工厂（报错原文 `typert: ... strict codec has no create() factory`），这里给
  `result` / `parameters[].codec` / `uplink.codec` / `invocation.codec` 统一补上并补恒等 decode/encode。
- 每个被改的 `lib/index.js` 首次打补丁时留一份 `index.js.bak-settings-compat` 作为原始副本。
- 脚本支持 `DSH_PROFILE_DIR=<临时目录>`，可用干净副本做自测而不碰真实安装。
- 幂等性靠「`from` 在、`to` 不在」双守卫：`at-file` 的 import 行既是第 1 条改写的产物又是第 3 条的锚点，
  只判 `from` 会重复插入 import 导致重复绑定。
- **插件升级后要重跑 `apply.mjs`**；若某条锚点不再匹配，脚本会报 `needs patch` 而不是静默跳过。

## 约定

- 只改 `~/.agent-hub/skills/<name>/`，不要手改 `build/` 或 `~/.dsh/skills/<name>`。
- 正文进 `core/SKILL.md`；端相关差异进 `variants/dsh.md` / `variants/codex.md`。
- 对 `~/.codex` 的写入**一律先备份**、只做增量：`config.toml`（`[memories]` 的模型名）、
  `AGENTS.md`（指向共享真源的一节）。技能目录仍不碰——Codex 侧走它自己的 marketplace 缓存。
