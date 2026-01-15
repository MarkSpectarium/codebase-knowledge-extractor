---
description: Trim Claude Code history.jsonl to last 50 entries (fixes EBADF lock errors)
model: haiku
allowed-tools: Bash
---

Run this bash command to trim the history file:

```
rm -f "$USERPROFILE/.claude/history.jsonl.lock" && tail -n 50 "$USERPROFILE/.claude/history.jsonl" > "$USERPROFILE/.claude/history_new.jsonl" && mv "$USERPROFILE/.claude/history_new.jsonl" "$USERPROFILE/.claude/history.jsonl"
```

After running, output ONLY: "History trimmed to 50 entries." Nothing else.
