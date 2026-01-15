Audit a swarm agent's session log to verify what they actually did.

Usage: /audit-swarm <custom-title|session-id|path>

Examples:
  /audit-swarm AUDITTEST
  /audit-swarm bcf4063c-4b57-411a-90ce-5a7858fc197b
  /audit-swarm "C:/Users/Aracos/.claude/projects/.../session.jsonl"

This command finds the agent's session log and runs the audit script to show:
- Timeline of actions (files read, commands run, messages sent)
- Verification checks (read role prompt, read phase prompt, sent completion)
- Any detected issues

## Instructions

Run the audit script with the provided argument:

```bash
audit-swarm "$ARGUMENTS"
```

The script automatically detects whether the argument is:
- A **custom title** (e.g., `AUDITTEST`) - searches all sessions for matching `customTitle`
- A **session UUID** (e.g., `bcf4063c-...`) - finds the session by ID
- A **file path** - uses the path directly

Add `--json` flag for JSON output:
```bash
audit-swarm "$ARGUMENTS" --json
```

> **Note**: The `audit-swarm` function is available via BASH_ENV when spawned by spawn-agent.js. If not available, use: `node $AGENT_SETUP_PATH/prompts/scripts/audit-agent-log.js "$ARGUMENTS"`

## Naming Sessions for Easy Lookup

To name a session for later auditing, use `/rename <name>` in the agent's conversation before it ends. Then you can audit it by name:

```
/audit-swarm MyAgentTask
```

$ARGUMENTS
