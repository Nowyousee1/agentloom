"""检查 Codex 记忆流水线状态：jobs 状态分布、stage1 产出、最近错误。

用法: python agent-hub/tools/codex-mem-status.py
"""
import os
import sqlite3

db = os.path.expanduser("~/.codex/memories_1.sqlite")
con = sqlite3.connect(db)
cur = con.cursor()

print("jobs by status:", cur.execute("select status, count(*) from jobs group by status").fetchall())
print("stage1 rows:", cur.execute("select count(*) from stage1_outputs").fetchone()[0])

print("--- 最近 6 条 job ---")
for kind, status, err, retry in cur.execute(
    "select kind, status, coalesce(last_error,''), coalesce(retry_remaining,-1) from jobs order by finished_at desc limit 6"
):
    print(f"{kind:28s} {status:9s} retry={retry} {(err or '')[:180]}")

print("--- stage1 样本 ---")
for row in cur.execute("select thread_id, substr(raw_memory,1,160) from stage1_outputs limit 3"):
    print(row[0], "|", (row[1] or "").replace("\n", " ")[:160])
