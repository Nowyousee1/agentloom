# agent-hub：DSH ↔ Codex 的共享层

本机维护着一套跨 harness 的单一真源，**改一处、两端同时生效**；不存在两份要手工对齐的副本。

## 目录与职责

| 路径 | 是什么 |
|---|---|
| `~/.agent-hub/skills/<name>/skill.json` | 元数据：`name` / `description` / `targets` / `tags` |
| `~/.agent-hub/skills/<name>/core/SKILL.md` | **两端共用正文**，唯一需要维护的内容 |
| `~/.agent-hub/skills/<name>/variants/dsh.md` | 只追加到 DSH 渲染结果的差异（工具名、路径写法） |
| `~/.agent-hub/skills/<name>/variants/codex.md` | 只追加到 Codex 渲染结果的差异 |
| `~/.agent-hub/build/skills/dsh/<name>/SKILL.md` | 渲染产物：frontmatter + core + dsh variant |
| `~/.agent-hub/build/skills/codex/<name>/SKILL.md` | 渲染产物：frontmatter + core + codex variant |
| `~/.dsh/skills/<name>` | 指向 `build/skills/dsh/<name>` 的 junction —— **不要直接编辑**，会被下次渲染覆盖 |
| `~/.agent-hub/build/codex-marketplace/` | 生成的 Codex 本地 marketplace（`~/.codex` 保持只读，由用户执行一次安装命令） |
| `~/.agent-hub/build/memory/index.json` | 从 Codex 侧 `AGENTS.md` 等来源抽出的记忆索引 |
| `~/.agent-hub/mcp/servers.json` | canonical MCP 服务器定义，渲染成两端格式 |

CLI 位置记录在 `~/.agent-hub/hub.json` 的 `cli.path`；下文用 `<cli>` 指代它，
实际调用形如 `node "<cli>" status`。

## 常用操作

- 总览：`node "<cli>" status`
- 新建共享技能：`node "<cli>" skill new my-skill --description="一句话说清什么时候用"`
- 收编既有技能（从任一端的目录）：`node "<cli>" skill adopt <技能目录> [--name=...]`
- 只改 core / variants 后让两端生效：`node "<cli>" sync`
- 校验全部技能：`node "<cli>" skill validate`
- 记忆检索：`node "<cli>" memory search 关键词`；注入用摘要在 `node "<cli>" memory digest`
- 记忆重建（Codex 的 AGENTS.md 更新后）：`node "<cli>" memory index`

## 硬规则

1. **正文只写进 `core/SKILL.md`，端相关差异只写进 `variants/<target>.md`**；不要把一个端专属的命令塞进 core。
2. 渲染产物与 `~/.dsh/skills/<name>` 都是生成物：要改内容请改 `~/.agent-hub/skills/<name>/`，再 `sync`。
3. `description` 是路由依据：写「什么时候用」而不是「这个技能是什么」。一句话，含触发词。
4. 新增技能名必须 kebab-case（`^[a-z0-9][a-z0-9-]*$`），否则 `skill validate` 报错。
5. 不要写 `~/.codex` 下任何文件：Codex 侧一律通过「生成 marketplace + 用户执行一条命令」或项目级 `<project>/.codex/skills` 交付。

## 判定标准

交付前跑 `node "<cli>" sync && node "<cli>" status`：链接数、渲染产物、记忆条数都对得上，才算完成。
