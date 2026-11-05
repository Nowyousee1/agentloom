# @local/dsh-agent-hub

把 `~/.agent-hub`（DSH ↔ Codex 共享层）接进 DeepSeek Harness 的 Host 插件。

## 它做什么

1. **注入共享记忆**：先注入 `~/.agent-hub/memory/shared.md`（两端可写真源，DSH 与 Codex 共用），再补上 `~/.codex/AGENTS.md` 里**当前 DSH 上下文看不到**的条目（DSH 注入 AGENTS.md 时按 `agent-instructions` 的 `maxBytes` 截断，本机 profile 是 262144 字节）。「不可见」由 CLI 按 profile patch 的真实预算算出（`memory.dshBudgetBytes: "auto"`），harness 调预算时不用改这边。
2. **写共享记忆**：`hub_memory_add` 直接写 `shared.md` 并重建索引，写进去的条目 Codex 侧也能读到（同标题=更新，不重复）。
3. **工具**：
   - `hub_status` —— 共享技能、DSH junction 是否正确、记忆条数/不可见条数/两端真源条数、Codex 产物路径与安装状态。
   - `hub_sync` —— 在宿主进程里跑 `agent-hub sync`（渲染 + 接 DSH + 重建 Codex marketplace + 重建记忆索引 + MCP 桥接）。
   - `hub_memory_search` —— 默认只搜「DSH 看不到」的条目；`include_visible=true` 连可见条目一起搜。**hub 真源条目永远参与检索**（不算「已可见」而跳过）。
   - `hub_memory_add` / `hub_memory_list` —— 写/列 `shared.md` 里的共享条目。
   - `hub_skill_list` —— 列出共享技能真源及其目标端。

## 配置（设置页可见）

插件导出 `Config`，四个字段：

| 键 | 默认 | 作用 |
|---|---|---|
| `enabled` | `true` | 关掉注入（工具仍然可用） |
| `limit` | `10` | 注入摘要最多几条 |
| `chars` | `2600` | 注入摘要总字符上限 |
| `staleWarning` | `true` | 源文件比索引新时在注入块顶部提示先 `hub_sync` |

优先级：环境变量（`AGENT_HUB_INJECT` / `AGENT_HUB_INJECT_LIMIT` / `AGENT_HUB_INJECT_CHARS`）> 插件 Config > `~/.agent-hub/hub.json` 的 `inject` 段。`AGENT_HUB_HOME` 可换真源目录。

注入段名 `agent-hub-shared-memory`，order 96（与 `plugin-memory` 的 recall 段相邻）。渲染期任何异常都降级为空串，不影响会话。

## 踩过的坑（改这个插件前先看）

1. **junction 让裸模块 import 失败**：`~/.dsh/profiles/desktop/node_modules/@local/dsh-agent-hub` 是指向工作区的 junction，node 解析真实路径后看不到宿主 `node_modules`，`import('@deepseek-ai/schemastery')` 会失败。`loadSchema()` 因此先试裸名，再遍历 `<DSH_HOME>/profiles/*/node_modules/@deepseek-ai/schemastery/lib/index.mjs` 用 `file://` URL 兜底。
2. **模块顶层不能提前引用后面的常量**：首版 `loadSchema()` 用了文件后面才声明的 `HOME`，重载直接 `ReferenceError: Cannot access 'HOME' before initialization`。用 `os.homedir()`。
3. **搜索默认过滤「已可见」**：`shared.md` 的条目也会出现在 harness 注入里（`visibleInDsh` 为真），若不特判 `origin === 'hub'`，用户搜共享记忆会搜不到。
4. **stale 判定要看 `index.sources`**：只比 `cfg.memory.sources` 时，改 `shared.md` 不会触发过期提示；`index.sources` 里有 `hub-shared` 才能覆盖到。
5. **工具输出别叠字**：`hub_memory_add` 曾把 CLI 的「✓ …」再包一层，界面出现两行重复。

## 开发

- 纯 ESM，零依赖，只用 node 内建模块；`inject = ['tools', 'systemPrompt']`。
- 安装：`plugin_manager install_bundle`（target 指向本目录），entry id 为 `include:dsh-agent-hub`。
- **改完代码要关→开该 entry 才会重新 import**（ESM 模块缓存），或重启 DSH：

  ```json
  plugin_manager { "action": "set_plugin", "target": "include:dsh-agent-hub", "enabled": false }
  plugin_manager { "action": "set_plugin", "target": "include:dsh-agent-hub", "enabled": true }
  ```

- 验证 Config 是否挂上：`cordis_inspect_query { platform: "host", provider: "Config", method: "listConfigs", input: { entry: "include:dsh-agent-hub" } }`，`status: "schema"` 才算导出成功（`absent` 表示没有 Config 节点）。

## 边界

- 不直接写 `~/.codex` 的配置：Codex 侧安装（`codex plugin add`）由 `agent-hub` CLI 侧配合完成，插件本身只调 `sync`。
- 不与其它记忆插件抢名字：工具名统一 `hub_*`，注入段名唯一；冲突时 `tools.register` 抛错会被捕获并记日志，不会崩会话。
- 与 `@harleendance/dsh-skill-evolution` 的记忆（`~/.dsh/skill-evolution/memory.json`）是两套东西，不要混。
