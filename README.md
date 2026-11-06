# agentloom

[![CI](https://github.com/Nowyousee1/agentloom/actions/workflows/ci.yml/badge.svg)](https://github.com/Nowyousee1/agentloom/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/Nowyousee1/agentloom?label=release)](https://github.com/Nowyousee1/agentloom/releases)
[![npm CLI](https://img.shields.io/npm/v/@nowyousee1/agentloom?label=npm%20CLI)](https://www.npmjs.com/package/@nowyousee1/agentloom)
[![npm DSH plugin](https://img.shields.io/npm/v/dsh-agentloom?label=npm%20DSH)](https://www.npmjs.com/package/dsh-agentloom)
[![CLI package](https://img.shields.io/badge/CLI-release%20tarball-2ea44f)](https://github.com/Nowyousee1/agentloom/releases/latest/download/agentloom-cli.tgz)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin%20tarball-2ea44f)](https://github.com/Nowyousee1/agentloom/releases/latest/download/dsh-agentloom.tgz)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.5-339933.svg)](https://nodejs.org)

**English** | [简体中文](#简体中文)

**One source of truth for skills, MCP servers and memory across AI coding agents.**

agentloom keeps the state you would otherwise duplicate per harness — reusable skills, MCP server
definitions, and the memories that make an agent useful — in a single local directory, and renders
it into whatever each harness expects. Today that means **DeepSeek Harness ⇄ Codex**, with the
per-harness differences kept in explicit overlay files rather than in divergent copies.

```
~/.agentloom/skills/<name>/{core, variants/dsh.md, variants/codex.md}
        │
        ├── ~/.dsh/skills/<name>        (junction / symlink)   → DeepSeek Harness
        └── build/codex-marketplace     (Codex plugin + MCP)   → Codex CLI

~/.agentloom/memory/shared.md  ⇄  DSH injected context
                               ⇄  ~/.codex/AGENTS.md (marked block)
                               ⇄  MCP tools `loom_memory_*`
```

## Where to find it

| What you are looking for | Where it is |
| --- | --- |
| This repository | `github.com/Nowyousee1/agentloom` — search GitHub for **`agentloom`** or the topics `agent-skills`, `shared-memory`, `mcp`, `codex`, `deepseek-harness` |
| CLI package | `npm i -g @nowyousee1/agentloom`; the installed command is `agentloom`. The [GitHub release tarball](https://github.com/Nowyousee1/agentloom/releases/latest/download/agentloom-cli.tgz) remains available as an offline fallback |
| DSH plugin | `npm i -g dsh-agentloom`, or install the [GitHub release tarball](https://github.com/Nowyousee1/agentloom/releases/latest/download/dsh-agentloom.tgz) |
| npm registry names | [`@nowyousee1/agentloom`](https://www.npmjs.com/package/@nowyousee1/agentloom) and [`dsh-agentloom`](https://www.npmjs.com/package/dsh-agentloom) |
| Inside DeepSeek Harness | plugin manager → `dsh-agentloom`; plugin entry `include:dsh-agentloom`; MCP tools are the 7 `loom_*` tools |
| Inside Codex | `codex plugin list` → `agentloom@agentloom`; MCP server name `agentloom` |
| On this machine | source of truth `~/.agentloom`, config `~/.agentloom/hub.json`, generated Codex plugin `~/.agentloom/build/codex-marketplace` |
| Health check | `agentloom doctor` — one row per wire, `✖` exits non-zero |

## Why

- **Skills drift.** The same procedure gets copied into two harnesses and then fixed in only one.
  agentloom authors it once: shared `core`, plus a `variants/<target>.md` for the parts that really
  differ (tool names, shell idioms).
- **Memory does not cross.** A decision recorded in one harness is invisible to the other. agentloom
  keeps a writable shared store and mirrors it into the places each harness actually reads, so the
  knowledge shows up without the model having to remember to call a tool.
- **MCP definitions get retyped.** agentloom owns the definitions once and emits per-harness views,
  without copying credentials into artifacts that get committed.

## Quick start

```bash
# requires Node.js >= 22.5.0
npm i -g @nowyousee1/agentloom
agentloom init
agentloom doctor                              # is everything actually wired up?
agentloom sync                                # idempotent: re-render, re-link, rebuild, re-index

# Codex side (one time; agentloom prints the exact lines for your machine)
codex plugin marketplace add ~/.agentloom/build/codex-marketplace
codex plugin add agentloom@agentloom
```

Add a skill:

```bash
agentloom skill new my-skill --description="When to use it"
$EDITOR ~/.agentloom/skills/my-skill/core/SKILL.md        # shared by both harnesses
$EDITOR ~/.agentloom/skills/my-skill/variants/codex.md    # Codex-only details
agentloom sync
```

Bring existing Codex skills under management:

```bash
agentloom skill import --from=codex --dry-run
agentloom skill import --from=codex --filter=stm32
```

Share a conclusion with both agents:

```bash
agentloom memory add --title="Prefer pnpm over npm here" \
  --body="pnpm is the only package manager installed on the build machine." \
  --kind=preference --scope=global --tags=tooling
agentloom sync
```

## What works, and how it was verified

| Capability | Mechanism | Evidence |
| --- | --- | --- |
| One skill source, two harnesses | `core` + `variants/<target>.md`, rendered per target | a DSH-only marker appears in the DSH render and is absent from the Codex render |
| DSH sees the skills | links in `~/.dsh/skills` | `agentloom doctor` reports `links 2/2`; links repair themselves after a hub rename |
| Codex sees the skills | Codex marketplace plugin | `codex plugin list` shows `agentloom@agentloom installed, enabled` |
| Both harnesses read the memory | `memory/shared.md` + AGENTS.md block + MCP | a memory written from DSH is listed by a `codex exec` call to `loom_memory_list` |
| Codex sees memory without calling a tool | marked block in `~/.codex/AGENTS.md` | a Codex run with *no tools allowed* quotes the preferences from that block |
| MCP definitions are shared | `mcp/servers.json` → per-harness `.mcp.json` | the Codex plugin ships only the agentloom bridge, never third-party tokens |
| Idempotent | every write is guarded | `agentloom sync` twice: second run reports `unchanged` for every link and block |

## Commands

```
agentloom init [--force]         create the hub, seed skills, link, build the index
agentloom sync                   the whole pipeline (render → link → MCP → Codex → memory → index)
agentloom status                 human-readable overview
agentloom doctor                 health checks with ✓ / ! / ✖ and a fix hint per failure
agentloom paths                  all key paths as JSON
agentloom skill list|show|new|adopt|validate
agentloom skill import --from=codex [--filter=s] [--limit=N] [--dry-run] [--force]
agentloom link dsh [name...] [--force]
agentloom unlink <name...>
agentloom codex build|project <dir>|info
agentloom memory index|search <q>|digest|sources
agentloom memory add --title=T --body=B [--kind=preference] [--scope=global] [--tags=a,b]
agentloom memory list|remove --title=T
agentloom mcp list|add <name> --json=...|remove <name>|sync
```

`agentloom doctor` is the first thing to run when something looks wrong; it checks the Node version,
hub config, DSH links, Codex skill inventory, the MCP bridge and its runtime copy, the Codex plugin
version versus its cache, the AGENTS.md mirror block, index freshness, leftover legacy directories
and any DSH compatibility patches.

## Repository layout

```
packages/cli            the agentloom CLI + MCP server + DSH compatibility patches
packages/dsh-plugin     DeepSeek Harness bridge: injection + loom_* tools + Config schema
docs/ARCHITECTURE.md    how the pieces fit, ordering constraints, failure modes
docs/COMPATIBILITY.md   verified versions, host-shim details, migration notes
```

## The DeepSeek Harness plugin

`packages/dsh-plugin` is a Cordis plugin. It injects a system-prompt section containing the shared
memories plus the memory entries the host's `AGENTS.md` budget currently truncates away, and
registers `loom_status`, `loom_sync`, `loom_memory_search`, `loom_memory_list`, `loom_memory_add`
and `loom_skill_list`. Its `Config` schema exposes `enabled`, `limit`, `chars` and `staleWarning`, so
injection behaviour is adjustable from the settings page instead of through environment variables.

The injection budget is `"auto"`: agentloom reads `agent-instructions.maxBytes` from the profile's
`cordis.patch.yml`. "Invisible" therefore means invisible to *this* harness, not to a hard-coded
guess.

## The MCP server

`packages/cli/mcp/server.mjs` is a dependency-free stdio JSON-RPC server. Codex (or any MCP client)
gets:

| Tool | Mutates | Purpose |
| --- | --- | --- |
| `loom_memory_search` | no | search the index, defaulting to entries the current context cannot see |
| `loom_memory_list` | no | list the shared (both-sides-writable) memories |
| `loom_memory_add` | yes | add or update a shared memory by title |
| `loom_skill_list` | no | list source skills with their targets |
| `loom_skill_show` | no | show one skill's core and variants |
| `loom_status` | no | hub, links, memory and marketplace state |
| `loom_sync` | yes | run the full sync pipeline |

Read-only tools carry `annotations.readOnlyHint`, which is what lets Codex call them without an
approval prompt. Codex runs the copy under `~/.agentloom/runtime/`, so re-run `agentloom sync` after
changing the server code.

## Design rules

1. **Files, not a database.** Everything under `~/.agentloom` is inspectable and diffable.
2. **Derived state is disposable.** `build/`, `runtime/` and `memory/index.json` can be deleted and
   rebuilt with `agentloom sync`.
3. **Never destroy what it does not own.** Links are pruned only when agentloom created them; writes
   into `~/.codex` are additive, marked and backed up once.
4. **Idempotent by construction.** Text patches guard both the source and the target anchor; sync
   reports `unchanged` instead of rewriting.
5. **Explain the difference.** Per-harness behaviour lives in named overlays, so a reader can see
   what differs without diffing two copies.

## Uninstall

```bash
agentloom unlink $(ls ~/.dsh/skills)      # remove the links it created (real dirs are kept)
codex plugin remove agentloom@agentloom   # Codex side
rm -rf ~/.agentloom
```

The marked block in `~/.codex/AGENTS.md` can be deleted by hand; the backup from the first write is
`AGENTS.md.bak-agenthub`.

## Documentation

| Document | Answers |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how the pieces fit, the sync order, failure modes, extension points |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | exact harness versions, the two patched plugins, migration from 0.2.x |
| [docs/FAQ.md](docs/FAQ.md) | one harness only, data location, junctions, stale links, uninstall |
| [docs/PUBLISHING.md](docs/PUBLISHING.md) | maintainer release checklist and the secrets it needs |
| [CONTRIBUTING.md](CONTRIBUTING.md) | the five invariants, dev setup, test matrix |
| [SECURITY.md](SECURITY.md) | threat model, what is guaranteed and what is not |
| [CHANGELOG.md](CHANGELOG.md) | what changed in each version |

## Status

The current release is published to both npm and GitHub Releases. Verified end-to-end on Windows 11
with DeepSeek Harness (desktop) and Codex CLI 0.157.1. The design is intentionally conservative: no
background daemon, no network listener, no runtime dependencies.

## License

MIT. See [LICENSE](LICENSE).

---

## 简体中文

[English](#agentloom) | **简体中文**

**为多个 AI 编码代理维护同一份技能、MCP 服务器定义与共享记忆。**

不同的 AI 编码代理通常各自维护技能目录、指令文件和 MCP 配置。同一个工作流被复制两遍后，往往
只有一端会持续更新；一条结论写在一个代理里，另一个代理也看不到。agentloom 把技能、MCP 定义和
记忆收敛到本地唯一的真源 `~/.agentloom`，再按各端需要的格式渲染。端之间的真实差异放在显式的
variant 文件里，而不是靠两份副本长期手工同步。

目前支持 **DeepSeek Harness ⇄ Codex**，但目录和渲染模型并不绑定某一个客户端。

```text
~/.agentloom/skills/<name>/{core, variants/dsh.md, variants/codex.md}
        │
        ├── ~/.dsh/skills/<name>        （junction / 软链接）   → DeepSeek Harness
        └── build/codex-marketplace     （Codex 插件 + MCP）    → Codex

~/.agentloom/memory/shared.md  ⇄  DSH 注入内容
                               ⇄  ~/.codex/AGENTS.md（标记块）
                               ⇄  MCP 工具 loom_memory_*
```

### 解决什么问题

- **技能漂移**：同一个流程不再复制两份。两端共用正文放在 `core/SKILL.md`，只把工具名、Shell
  写法等真实差异放进 `variants/dsh.md` 或 `variants/codex.md`。
- **记忆不互通**：共享记忆从任意一端写入，再同步到 DSH 的注入内容、Codex 的 `AGENTS.md` 标记块
  和 `loom_memory_*` MCP 工具。
- **MCP 配置重复**：MCP 服务器只在 `mcp/servers.json` 定义一次，再生成各端配置。凭据不会被打包
  进提交到仓库的插件产物。

### 安装

需要 Node.js 22.5 或更高版本。

```bash
# npm（推荐）
npm i -g @nowyousee1/agentloom
agentloom init
agentloom doctor
agentloom sync

# 无法访问 npm 时，也可以直接安装 GitHub Release 附件
npm i -g https://github.com/Nowyousee1/agentloom/releases/latest/download/agentloom-cli.tgz
```

Codex 侧首次安装：

```bash
# agentloom 会在本机输出对应的绝对路径
codex plugin marketplace add ~/.agentloom/build/codex-marketplace
codex plugin add agentloom@agentloom
```

在 DeepSeek Harness 中安装 `dsh-agentloom` 插件后，通常需要重启一次 DSH 让 Cordis 插件生效。
插件提供 `loom_status`、`loom_sync`、`loom_memory_search`、`loom_memory_list`、
`loom_memory_add` 和 `loom_skill_list` 工具。

### 常用操作

新建共享技能：

```bash
agentloom skill new my-skill --description="什么时候使用这个技能"
$EDITOR ~/.agentloom/skills/my-skill/core/SKILL.md
$EDITOR ~/.agentloom/skills/my-skill/variants/dsh.md
$EDITOR ~/.agentloom/skills/my-skill/variants/codex.md
agentloom sync
```

接管现有 Codex 技能：

```bash
agentloom skill import --from=codex --dry-run
agentloom skill import --from=codex --filter=stm32
```

写入一条两端可见的共享结论：

```bash
agentloom memory add \
  --title="本机优先使用 pnpm" \
  --body="构建机上只安装了 pnpm。" \
  --kind=preference --scope=global --tags=tooling
agentloom sync
```

### 命令一览

```text
agentloom init [--force]         初始化 hub、种子技能、链接与索引
agentloom sync                   完整流水线（渲染 → 链接 → MCP → Codex → 记忆 → 索引）
agentloom status                 查看当前状态
agentloom doctor                 健康检查；出现 ✖ 时返回非零退出码
agentloom paths                  以 JSON 输出关键路径
agentloom skill list|show|new|adopt|validate
agentloom skill import --from=codex [--filter=s] [--limit=N] [--dry-run] [--force]
agentloom link dsh [name...] [--force]
agentloom unlink <name...>
agentloom codex build|project <dir>|info
agentloom memory index|search <q>|digest|sources
agentloom memory add --title=T --body=B [--kind=preference] [--scope=global] [--tags=a,b]
agentloom memory list|remove --title=T
agentloom mcp list|add <name> --json=...|remove <name>|sync
```

遇到问题时先运行 `agentloom doctor`。它会检查 Node 版本、hub 配置、DSH 链接、Codex 技能清单、
MCP 桥接及其运行时副本、Codex 插件版本与缓存、`AGENTS.md` 镜像块、索引新鲜度、历史遗留目录
以及 DSH 兼容补丁。

### 已验证能力

| 能力 | 机制 | 证据 |
| --- | --- | --- |
| 一份技能真源，两端使用 | `core` + 按端渲染的 variants | DSH 专属标记只出现在 DSH 产物中 |
| DSH 自动看到技能 | `~/.dsh/skills` 链接 | `agentloom doctor` 报告 `links 2/2` |
| Codex 自动看到技能 | Codex marketplace 插件 | `codex plugin list` 显示 `agentloom@agentloom` |
| 两端读写同一份记忆 | `shared.md` + AGENTS.md 标记块 + MCP | 任一端写入后，另一端可检索到 |
| Codex 不调用工具也能看到关键记忆 | `AGENTS.md` 标记块 | 禁止工具调用的 Codex 会话仍能引用该内容 |
| MCP 定义可共享 | `servers.json` → 各端配置 | 插件产物不包含第三方凭据 |
| 同步幂等 | 每次写入都有锚点与所有权检查 | 连续执行两次 `sync`，第二次全部为 `unchanged` |

### 设计原则

1. **文件优先，不引入数据库。** `~/.agentloom` 下的内容都可以审查、Diff 和版本控制。
2. **派生状态可以随时重建。** `build/`、`runtime/` 和 `memory/index.json` 都能由 `sync` 重建。
3. **不删除不属于自己的内容。** 只有 agentloom 创建的链接和确认的派生文件才会被清理。
4. **构造上保持幂等。** 文本补丁同时校验锚点与目标，重复执行不会重复写入。
5. **差异必须显式。** 端相关行为放在有名字的 overlay 中，不用阅读两份分叉副本才能看懂。

### 卸载

```bash
agentloom unlink $(ls ~/.dsh/skills)      # 只移除 agentloom 创建的链接
codex plugin remove agentloom@agentloom
rm -rf ~/.agentloom
```

`~/.codex/AGENTS.md` 中的标记块可以手工删除；首次写入前的备份文件名为 `AGENTS.md.bak-agenthub`。

### 文档

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 组件关系、同步顺序、失败模式与扩展点 |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | 已验证的宿主版本、兼容补丁与迁移说明 |
| [docs/FAQ.md](docs/FAQ.md) | 只使用一端、数据位置、失效链接、卸载等常见问题 |
| [docs/PUBLISHING.md](docs/PUBLISHING.md) | 维护者发布清单与所需 secret |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 开发环境、五条不变量与测试矩阵 |
| [SECURITY.md](SECURITY.md) | 威胁模型、保证与非保证范围 |
| [CHANGELOG.md](CHANGELOG.md) | 每个版本的变更记录 |

### 状态与许可

当前版本同时发布到 npm 与 GitHub Releases。已在 Windows 11、DeepSeek Harness 桌面版和 Codex CLI
上完成端到端验证。项目刻意保持简单：没有后台守护进程，不监听网络端口，也没有运行时依赖。

MIT，详见 [LICENSE](LICENSE)。
