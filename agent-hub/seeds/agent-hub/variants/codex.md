## Codex 侧（本文件只追加到 Codex 渲染结果）

- 用 shell 工具执行命令；PowerShell 里用 `$env:USERPROFILE`，cmd 里用 `%USERPROFILE%`。
- 技能安装走本地 marketplace，一条命令即可（由用户执行，因为 `~/.codex` 不由 hub 写入）：

  ```powershell
  codex plugin marketplace add "$env:USERPROFILE\.agent-hub\build\codex-marketplace"
  codex plugin add agent-hub@agent-hub
  ```

- 只想让**单个项目**用上共享技能：在项目根执行 `node "<cli>" codex project <项目根>`，
  技能会写到 `<项目根>/.codex/skills/<name>`（Codex 会按项目发现）。
- `~/.codex/skills` 里已有的 200+ 技能维持原地不动，不属于 hub 管理范围。
