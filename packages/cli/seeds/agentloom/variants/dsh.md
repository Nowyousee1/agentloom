## DSH 侧（本文件只追加到 DSH 渲染结果）

- 跑命令用 `pwsh` 工具，别拼 bash；路径用 Windows 原生写法（`C:\Users\...`）。
- 查/改文件用 `read` / `write` / `edit`；找文件用 `glob`，搜内容用 `grep`（不要 `find` / `rg` 子进程）。
- 提交用 `git_commit_push`（插件托管凭据与审计），不要手敲 `git commit` / `git push`。
- 新建的技能要等技能清单下一次加载才出现；当次运行想验证，就直接读渲染产物确认 frontmatter 与正文正确。
- 想确认 DSH 到底扫到什么：`node "<cli>" status`，再用 `read` 看 `~/.agentloom/build/skills/dsh/<name>/SKILL.md`。
