# agentloom（中文说明）

[![CI](https://github.com/Nowyousee1/agentloom/actions/workflows/ci.yml/badge.svg)](https://github.com/Nowyousee1/agentloom/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agentloom?label=agentloom)](https://www.npmjs.com/package/agentloom)
[![npm plugin](https://img.shields.io/npm/v/dsh-agentloom?label=dsh-agentloom)](https://www.npmjs.com/package/dsh-agentloom)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**为多个 AI 编码代理维护同一份技能、MCP 服务器与记忆。**

DeepSeek Harness 与 Codex 各自有自己的技能目录、指令文件与 MCP 配置。同一个流程被复制两遍之后，
通常只有一边会被维护；一条结论写在一端，另一端永远看不到。agentloom 把「真源」收到一个本地目录，
再按各端需要渲染出去，端之间的差异写在显式的 overlay 文件里，而不是两份逐渐分叉的副本。

```
~/.agentloom/skills/<name>/{core, variants/dsh.md, variants/codex.md}
        │
        ├── ~/.dsh/skills/<name>        （junction / 软链接）   → DeepSeek Harness
        └── build/codex-marketplace     （Codex 插件 + MCP）    → Codex CLI

~/.agentloom/memory/shared.md  ⇄  DSH 注入内容
                               ⇄  ~/.codex/AGENTS.md（标记块）
                               ⇄  MCP 工具 loom_memory_*
```

## 怎么找到它

| 你要找的东西 | 在哪里 |
| --- | --- |
| 仓库本身 | `github.com/Nowyousee1/agentloom`；GitHub 搜 **`agentloom`**，或 topics：`agent-skills`、`shared-memory`、`mcp`、`codex`、`deepseek-harness` |
| npm 上的 CLI | [`agentloom`](https://www.npmjs.com/package/agentloom) → `npm i -g agentloom`（或 `npx agentloom`） |
| npm 上的 DSH 插件 | [`dsh-agentloom`](https://www.npmjs.com/package/dsh-agentloom) |
| DeepSeek Harness 内 | 插件管理器里找 `dsh-agentloom`；entry 为 `include:dsh-agentloom`；MCP 工具是 7 个 `loom_*` |
| Codex 内 | `codex plugin list` 显示 `agentloom@agentloom`；MCP 服务器名 `agentloom` |
| 本机 | 真源 `~/.agentloom`，配置 `~/.agentloom/hub.json`，生成的 Codex 插件 `~/.agentloom/build/codex-marketplace` |
| 自检 | `agentloom doctor`：每条接线一行，有 `✖` 时退出码非 0 |

## 快速开始

```bash
# 需要 Node.js >= 22.5.0
node packages/cli/bin/agentloom.mjs init
agentloom doctor        # 体检：链接、桥接、Codex 侧是否真的接上
agentloom sync          # 幂等：重渲染、重连、重建插件与索引

# Codex 侧只需一次（agentloom 会打印本机对应的两条命令）
codex plugin marketplace add ~/.agentloom/build/codex-marketplace
codex plugin add agentloom@agentloom
```

新建技能：`agentloom skill new my-skill --description="什么时候用它"`，把两端共用的内容写进
`core/SKILL.md`，只属于某一端的细节写进 `variants/dsh.md` / `variants/codex.md`，然后 `agentloom sync`。

接管已有 Codex 技能：先 `agentloom skill import --from=codex --dry-run` 看清单，再去掉 `--dry-run`；
`--filter=stm32` 可以只导入一部分。

写一条两端都能看到的结论：

```bash
agentloom memory add --title="本机优先用 pnpm" \
  --body="构建机上只装了 pnpm。" --kind=preference --scope=global --tags=tooling
agentloom sync
```

## 三条通路，各自解决什么

| 通路 | 机制 | 验证方式 |
| --- | --- | --- |
| 技能 | 单一真源 + 按端渲染，DSH 侧用链接 | `doctor` 报 `links 2/2`；hub 改名后链接自动修复 |
| MCP 定义 | `mcp/servers.json` → 各端 `.mcp.json` | Codex 插件只带 agentloom 桥接，第三方凭据不外扩散 |
| 记忆 | `memory/shared.md` + AGENTS.md 标记块 + MCP 工具 | DSH 写入 → `codex exec` 调 `loom_memory_list` 能列出 |

记忆为什么需要三处：DSH 读自己的注入内容，Codex 只自动加载 `~/.codex/AGENTS.md`，
而 MCP 工具只有模型主动调用才有效。三处一起做，才既「自动可见」又能按需检索与写入。

## 命令一览

```
agentloom init [--force]      初始化 hub、种子技能、链接、索引
agentloom sync                全流程（渲染 → 链接 → MCP → Codex → 记忆 → 索引）
agentloom status              总览
agentloom doctor              体检（✓ / ! / ✖ + 修复提示），有 ✖ 时退出码 1
agentloom paths               关键路径（JSON）
agentloom skill list|show|new|adopt|import --from=codex|validate
agentloom link dsh [name...] [--force]   /   agentloom unlink <name...>
agentloom codex build|project <dir>|info
agentloom memory index|search <q>|digest|sources
agentloom memory add --title=T --body=B [--kind=preference] [--scope=global] [--tags=a,b]
agentloom memory list|remove --title=T
agentloom mcp list|add <name> --json=...|remove <name>|sync
```

## 仓库结构

```
packages/cli            CLI + MCP server + DSH 兼容补丁
packages/dsh-plugin     DeepSeek Harness 插件：注入 + loom_* 工具 + Config schema
docs/ARCHITECTURE.md    组件、执行顺序与失败模式
docs/COMPATIBILITY.md   已验证版本、宿主 shim 细节、迁移步骤
docs/FAQ.md             只有一端、数据在哪、链接失效、卸载等常见问题
docs/PUBLISHING.md      维护者发版清单（占位 URL、NPM_TOKEN、发版命令、禁止提交项）
```

## 已知边界

- DSH 插件的包名变过（`@local/dsh-agent-hub` → `dsh-agentloom`）。包装好之后需要 **重启一次 DSH**，
  `plugin_manager` 会返回 `restart-required` / `package-moved`，这是预期行为。
- Cordis 插件无法在 Codex 内运行。跨端共享的是技能、MCP 定义与记忆，不是插件代码本身。
- 记忆冲突策略是「同标题后写覆盖」，没有三方合并；删除需要在一端删掉后重新 `sync`。
- 已安装的 Codex 插件按 `marketplace/plugin/version` 缓存，修改插件内容后必须升版本再重装。

## 卸载

```bash
agentloom unlink $(ls ~/.dsh/skills)      # 只删它自己建的链接，真实目录保留
codex plugin remove agentloom@agentloom
rm -rf ~/.agentloom
```

`~/.codex/AGENTS.md` 里的标记块可以手工删除；首次写入前的备份是 `AGENTS.md.bak-agenthub`。

## 许可

MIT，见 [LICENSE](LICENSE)。英文说明见 [README.md](README.md)；行为约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，
安全模型见 [SECURITY.md](SECURITY.md)，变更见 [CHANGELOG.md](CHANGELOG.md)。
