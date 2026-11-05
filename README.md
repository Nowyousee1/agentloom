# agent-hub —— DSH ↔ Codex 共享技能 / MCP / 记忆

一个**单一真源 + 双端渲染**的共享层，让 DeepSeek Harness（本机 profile `desktop`）与 Codex CLI 0.157.1 用同一份技能、同一批 MCP 服务器、同一份**可读可写**的记忆。

写入策略（按你的要求演进过一次）：`~/.dsh` 可自由改；`~/.codex` **不碰技能目录**，只做两处有备份的增量——
`config.toml` 的 `[memories]` 模型名、`AGENTS.md` 顶部指向共享真源的一节。

## 1. 结构

```
C:\Users\lenovo\.agent-hub\                 ← 真源（唯一要维护的地方）
├─ hub.json                                 配置：两端路径、记忆源、注入参数
├─ state.json                               链接/渲染/索引状态
├─ skills\<name>\
│   ├─ skill.json                           name / description / targets / tags
│   ├─ core\SKILL.md                        两端共用正文（唯一要写的正文）
│   ├─ variants\dsh.md                      只追加到 DSH 渲染结果
│   └─ variants\codex.md                    只追加到 Codex 渲染结果
├─ build\skills\{dsh,codex}\<name>\SKILL.md 渲染产物（frontmatter + core + variant）
├─ build\codex-marketplace\                 Codex 本地 marketplace（plugin 0.2.0）
├─ build\mcp\{codex,dsh}\                   MCP 的两端产物
├─ memory\shared.md                         ★ 两端共享记忆真源（DSH 与 Codex 都读写）
├─ memory\index.json                        索引（shared.md + Codex AGENTS.md 只读解析）
├─ mcp\servers.json                         canonical MCP 定义（含 agent-hub 桥接）
├─ mcp\server.mjs                           零依赖 stdio MCP 服务器源码
└─ runtime\                                 给 Codex 用的运行时副本（mcp\ + src\）
```

两端的接入方式不同，这是关键：

| | DSH | Codex |
|---|---|---|
| 技能接入 | `~/.dsh/skills/<name>` 是指向 `build/skills/dsh/<name>` 的 **junction**（改真源→sync→立即生效） | `codex plugin add agent-hub@agent-hub`（已执行；缓存按版本号落在 `~/.codex/plugins/cache/agent-hub/agent-hub/0.2.0/`） |
| 已有技能 | 已装 `@michengai/dsh-skills-manager`，只读扫描 `~/.codex/skills`（Codex→DSH 方向早就通了） | `~/.codex/skills` 的 230 个技能原样保留，不归 hub 管 |
| 记忆 | 插件 `@local/dsh-agent-hub` 每次会话注入真源条目 + 截断区条目 | MCP 桥接的 `hub_memory_search/add/list` + `AGENTS.md` 里的使用规则 |
| 项目级 | — | `agent-hub codex project <项目根>` 写 `<项目根>/.codex/skills/` |

## 2. 为什么「技能要有两个版本」

**一个 core + 各端 variants**。同一个技能共用的部分写 `core/SKILL.md`；只有工具名/命令/路径写法不同，写进 `variants/dsh.md` 与 `variants/codex.md`。渲染时拼成两份 `SKILL.md`，互不污染。

已验证的隔离性：往 `variants/dsh.md` 加一行标记 → 只出现在 `build/skills/dsh/`，`build/skills/codex/` 里没有。

## 3. 记忆：两端共享真源（本版最大变化）

### 3.1 三条通路

| 通路 | 方向 | 机制 |
|---|---|---|
| `~/.agent-hub/memory/shared.md` | **双向** | DSH 插件注入 + `hub_memory_add` 工具；Codex 通过 MCP `agent-hub` 读写同一文件 |
| `~/.codex/AGENTS.md` 生成块 | **双向（自动）** | `sync` 用 `<!-- agent-hub:shared:start/end -->` 标记，把共享记忆的标题+摘要重写进 AGENTS.md，Codex 启动即加载；解析时先剥掉该块，避免自我喂养 |
| `~/.codex/AGENTS.md` 其余部分 | Codex → DSH（只读） | CLI 解析成索引条目，补 DSH 上下文里被截断的部分 |
| `~/.codex/memories_1.sqlite` | Codex → DSH（只读） | `stage1_outputs`（每条 rollout 一行）纳入索引，标题形如 `Codex 记忆 · <rollout-slug>`；`hub.json → memory.sqlite.enabled` 可关 |

实测闭环：

- DSH → Codex（主动调用）：在 DSH 里 `hub_memory_add` 写入 → Codex 会话调 `hub_memory_list` 能原样列出（真机验证，输出以 `MCP-OK` 收尾）。
- DSH → Codex（**零工具调用**）：`sync` 后跑 `codex exec "只凭启动时加载的 AGENTS.md 回答…"`，Codex 复述出共享记忆块标题与「一切自己做完，只在重大决定时问」的大意 → 证明它不调工具也能看到。
- Codex → DSH：Codex 自己的 stage1 记忆（`# Copied Codex's 221 KB global AGENTS.md…` 等）出现在 DSH 注入块里。


共享条目的元数据格式：H2 标题 = 一条记忆，标题下 `- kind: ...` / `- scope: ...` / `- tags: ...` / `- created: ...` / `- updated: ...`，其余为正文。
**同标题再写一次是更新，不是新增**（不会出现重复条目）。

### 3.2 为什么会出现「Codex 说它记过、DSH 搜不到」

排查结论：Codex 自己的记忆流水线此前 **100% 失败**——`memories_1.sqlite` 的 47 个 `memory_stage1` + 1 个 `memory_consolidate_global` 全是 `error`，`last_error` 原文：

```
The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed gpt-5.6-luna.
```

Codex 默认用 `gpt-5.6-luna` 做记忆抽取，而本机 DeepSeek 端点只认 `deepseek-flash` / `deepseek-v4-pro`，于是 stage1 永远不出、记忆既不落库也不进 `AGENTS.md` —— 所以任何文件里都搜不到，但 Codex 会话里「感觉」有。

处理：
1. `config.toml` 的 `[memories]` 加 `extract_model = "deepseek-flash"` 与 `consolidation_model = "deepseek-flash"`（备份 `config.toml.bak-agenthub-20261105-201207`）；
2. 把 48 条 error 任务重置为 `pending`（备份 `memories_1.sqlite.bak-agenthub`）；
3. 让一个**活着的** Codex 进程去消费队列——记忆 worker 只在 codex 会话进程内运行，短命的 `codex exec`
   会在领活（lease 3600s）后立刻退出，把 job 挂成孤儿。修复后实测 `jobs: done 1 …`、`stage1 rows: 1`，
   证明模型名修好即可产出记忆。

### 3.3 预算自动检测

`hub.json → memory.dshBudgetBytes` 默认 `"auto"`：CLI 读 `<DSH_HOME>/profiles/<profile>/cordis.patch.yml` 里
`agent-instructions` 的 `maxBytes`（本机 262144），按字节切出 `~/.dsh/AGENTS.md` 的可见前缀。
当前 183 条索引里 175 条可见、8 条不可见；harness 改预算时索引自动跟随。

> 复盘：早期把预算写死 65536，把 80 条报成「不可见」（其实 harness 已注入），导致第一版插件多注入 75 条重复记忆。

## 4. 两个交付物

### 4.1 `agent-hub` CLI（`agent-hub/`）

零依赖 Node ≥22：

```powershell
node .\agent-hub\bin\agent-hub.mjs init [--force]
node .\agent-hub\bin\agent-hub.mjs sync              # 渲染 + 接 DSH + MCP 桥接 + Codex marketplace + 索引
node .\agent-hub\bin\agent-hub.mjs status
node .\agent-hub\bin\agent-hub.mjs skill new|adopt|list|show|validate
node .\agent-hub\bin\agent-hub.mjs link dsh [name...] / unlink <name...>
node .\agent-hub\bin\agent-hub.mjs codex build|project <dir>|info
node .\agent-hub\bin\agent-hub.mjs memory index|search|digest|sources|list|add|remove
node .\agent-hub\bin\agent-hub.mjs mcp list|import-codex|add|remove|sync
```

安全设计：

- 只接管自己建的 junction；遇到同名真实目录或指向别处的链接，跳过并报告。
- `assertWritable()` 拒绝任何落在 `~/.codex` 下的写入（对 `~/.codex` 的两处增量由我手工加备份完成）。
- 渲染是原地覆盖（不删目录）——junction 目标目录可能被宿主持有句柄，删了会 `EPERM`。
- `mcp/servers.json` 里 `codex.include=false` 的条目只进 DSH；生成的 Codex 插件 `.mcp.json`
  **只带桥接**，不再把 `canmv-k230`（含 Authorization 头）之类复制进插件目录。

### 4.2 `@local/dsh-agent-hub` 插件（`dsh-agent-hub/`）

- 注入段 `agent-hub-shared-memory`：**先**注入 `shared.md` 的全部条目（标「共享真源」，永远排最前、永远参与检索），**再**注入 `AGENTS.md` 里 DSH 看不到的条目。
- 工具：`hub_status`、`hub_sync`、`hub_memory_search`（默认只搜不可见部分 + 全部共享真源）、`hub_memory_add`、`hub_memory_list`、`hub_skill_list`。
- 导出 `Config`（`enabled` / `limit` / `chars` / `staleWarning`），所以出现在设置页；`Config.listConfigs` 报 `status:"schema"`。
- 注入参数优先级：`AGENT_HUB_INJECT*` 环境变量 > 插件 Config > `hub.json → inject`。
- 改插件代码后：`plugin_manager set_plugin` 关→开该 entry 才会重新 import（ESM 缓存），或重启 DSH。

## 5. MCP 桥接（Codex 已吃上）

`mcp/server.mjs` 是零依赖 stdio JSON-RPC 2.0 服务器（stdout 只写协议消息，日志一律 stderr），
`sync` 把它与 `src/*.mjs` 复制进 `~/.agent-hub/runtime/`，并在 `mcp/servers.json` 注册 `agent-hub`
（`command` 用 `process.execPath`，`enabled: true`，`startup_timeout_sec: 30`，`tool_timeout_sec: 120`）。

7 个工具：`hub_memory_search`、`hub_memory_add`、`hub_memory_list`、`hub_skill_list`、`hub_skill_show`、
`hub_status`、`hub_sync`。

实测：`codex plugin add agent-hub@agent-hub` → `Installed plugin root: ...\plugins\cache\agent-hub\agent-hub\0.2.0`；
`codex plugin list` 显示 `installed, enabled 0.2.0`；`codex mcp list` 能看到 `agent-hub`
（`D:\Node.js\node.exe` + `runtime\mcp\server.mjs`）。

canonical 定义里另有 3 个从 Codex 导入的服务器（`easyeda` stdio、`canmv-k230` streamable-http、`node_repl` stdio），
均为 `codex.include=false`，只供 DSH。

## 6. Codex 侧的改动清单（都有备份、都可回滚）

| 文件 | 改动 | 备份 |
|---|---|---|
| `~/.codex/config.toml` | `[memories]` 增 `extract_model` / `consolidation_model` = `deepseek-flash`、`min_rollout_idle_hours = 0` 等 | `config.toml.bak-agenthub-20261105-201207` |
| `~/.codex/AGENTS.md` | 顶部维护生成块 `<!-- agent-hub:shared:start -->…<!-- agent-hub:shared:end -->`：真源位置、MCP 工具清单、每条共享记忆的标题 + 160 字摘要；每次 `sync` 重写，只动标记之间 | `AGENTS.md.bak-agenthub` / `.bak-agenthub-20261105` |
| `~/.codex/memories_1.sqlite` | 48 条 error job 重置为 pending | `memories_1.sqlite.bak-agenthub` |
| `~/.codex/plugins/cache/agent-hub/agent-hub/0.2.0/` | Codex 自己装的插件缓存（marketplace 生成物） | 由 `codex plugin add` 管理 |

## 7. 验证记录

- 技能出现在 DSH 会话技能目录（`agent-hub`、`stm32-keil-flash`），`~/.dsh/skills/*` 为 junction，`hub_status` 报 2/2 ✅
- 变体隔离（dsh-only 标记不出现在 codex 渲染）✅
- `hub_sync` 在宿主进程内跑通、幂等 ✅
- 记忆检索命中「CAN2 发送邮箱卡死」「--cpp11 中断向量」等 DSH 上下文里没有的条目 ✅
- **共享记忆双向闭环**：`hub_memory_add` 写入 → 索引 183 条 → 下一回合注入块出现「真源 …shared.md（共 3 条）」且条目带「（共享真源）」排最前 ✅
- **MCP 桥接**：`initialize` 回 `agent-hub 0.2.0`、`tools/list` 7 工具、`tools/call hub_status` 正常；Codex `mcp list` 已列为可用服务器 ✅
- **Codex 真机调用桥接**：`codex exec` 里 `mcp: agent-hub/hub_memory_list started → completed`，输出三条共享记忆（DSH 写的），以 `MCP-OK` 收尾 ✅
- **Codex 记忆流水线**：模型名修好后 job 出现 `done`、`stage1_outputs` 从 0 增到 40+ 行，抽取出的 rollout 记忆（如 `drv8251a-thermal-pad-grounding`）已进 DSH 索引与注入块 ✅
- **at-file 端到端**：`@相对路径` 真的被展开成 `<workspace-reference path="…" kind="file" />`（用 subagent 探针实测 PROBE-SEEN）✅
  注意 `resolveMention` 对**绝对路径直接跳过**（`if (isAbsolute(token)) return`），必须写相对 cwd 的路径。
- **Codex 零工具调用也能看到共享记忆**：`sync` 写出 AGENTS.md 生成块后，`codex exec`（不给工具）能复述块标题与「一切自己做完，只在重大决定时问」的大意 ✅

### 7.1 顺带修好的两个导入失败插件

`plugin_manager` 原本报 `dsh-at-file` 与 `@harleendance/dsh-skill-evolution` 导入失败（不是本任务引入，
但同属「插件缺失」）。根因是本机宿主 `@deepseek-ai/dsh-settings` 0.2.1-rc.5 比这两个插件预期的新旧不一：

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| `does not provide an export named 'settingsNamespace'` | 宿主没有这两个 helper | `patches/settings-compat/settings-compat.mjs` 自实现，改写 import 指向它 |
| `does not provide an export named 'installSettingsSection'` | 同上；且 `setSource` 的入参要能 `current()` 调用 | shim 传「可调用对象」，兼顾 getter 与取值两种风格 |
| `typert: ... strict codec has no create() factory` | 新宿主 typert-registry 要求 codec 带 `create()` | `typert-compat.mjs` 在注册前补齐 codec 工厂与恒等编解码 |
| `TypeError: current is not a function` | 上面那条 shim 传对象而非可调用值 | 同上，已修 |

结果：两条 entry 均 `application: "applied"`、`warnings: []`；`skill_center_*` 五个工具实测可用。
补丁脚本幂等，已用干净副本（`DSH_PROFILE_DIR` 指向临时目录）验证「首跑打补丁 → 再跑无变化 →
`--check` exit 0 → `node --check` 通过 → import 无重复」。细节见 [agent-hub/README.md](agent-hub/README.md#插件兼容补丁)。

## 8. 风险清单（都已在代码或流程里处理）

1. **junction 让宿主包 import 失败**：插件目录是 junction，node 按真实路径解析就看不到 profile 的
   `node_modules`。`loadSchema()` 先用裸模块名，失败再扫 `profiles/*/node_modules/@deepseek-ai/schemastery`。
2. **默认检索会过滤「已可见」条目**：共享真源条目在 DSH 里算可见，必须给 `origin === 'hub'` 开例外，
   否则刚写进去的记忆立刻搜不到。
3. **`shared.md` 的 mtime 未参与过期判定**：`indexIsStale` 现在同时比 `cfg.memory.sources` 与 `index.sources`。
4. **Codex 插件按版本号缓存**：只改 marketplace 内容不升 `CODEX_PLUGIN_VERSION`，Codex 会继续用旧快照
   （旧 `.mcp.json` 里没有桥接）。改插件布局必须升版本并重跑 `codex plugin add`。
5. **凭据扩散**：早期生成插件 `.mcp.json` 会把 `canmv-k230` 的 Authorization 头一起复制进插件目录，
   现在只导出 `codex.include !== false` 的服务器。
6. **记忆 worker 附着在会话进程上**：短命 `codex exec` 领活后退出会把 job 挂成孤儿（lease 1 小时）；
   要清队列得让 codex 进程活久一点。
7. **单条 rollouts 超过 1M 上下文**：2 条 job 必然失败（`requested 1284402/1473659 tokens`），只能忽略或删。
8. **MCP 工具不带 `readOnlyHint` 时 Codex 一律拒调**：实测报
   `MCP tool call requires approval, but approval policy is never`。`mcp/server.mjs` 现在给 7 个工具都加了
   `annotations`（5 个只读工具 `readOnlyHint: true`，`hub_memory_add` / `hub_sync` 为 `false`）。
   注意：Codex 用的是 `~/.agent-hub/runtime/` 里的副本，改完 server 要跑 `sync` 才会生效（`.mcp.json` 没变，不必升插件版本）。
9. **往 AGENTS.md 写生成块会自我喂养**：那段块的 H2 标题本身会被记忆索引当成 Codex milestone 再吃回来
   （实测索引里多出一条「跨 harness 共享记忆…」）。`src/memory.mjs` 的 `stripGeneratedBlock()` 在解析
   `agents-md` 来源前先按标记剥掉整块，重建索引后该条目消失（`codex-agents` 177 条）。
   改这块渲染逻辑时务必保留剥离步骤。

## 9. 已知边界 / 下一步

- DSH 的 Cordis 插件**无法**在 Codex 内运行；跨端能力只有「技能 + MCP 服务器」。想让 Codex 用上更多 DSH 插件工具，就继续把工具包成 MCP（桥接里已有 7 个）。
- at-file 的 `@` **选择器 UI**（下拉候选）由客户端 bundle 提供，需页面重新拉 boot graph 才会出现；语义层（host 展开）已验证。
- 索引随时间会过期：注入块会提示「源比索引新」，届时 `hub_sync`。
