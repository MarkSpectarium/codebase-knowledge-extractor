Spawn a new Claude Code agent in a new WezTerm pane.

Usage: /spawn-agent <model> [options]

Models: opus, sonnet, haiku (or: o, s, h)

Options:
  --task "..."      Send an initial task after spawning
  --tab <pane-id>   Spawn in the same tab as this pane
  --auto-tab        Auto-manage tabs (split if <4 panes, new tab if >=4)
  --new-window      Spawn in a new window
  --claim           Claim the new pane as managed by you
  --cwd <path>      Working directory for the agent
  --yolo            Autonomous mode (skip all permission prompts)
  --continue        Continue the most recent conversation
  --resume <id>     Resume a specific session by ID

Examples:
  /spawn-agent sonnet
  /spawn-agent opus --task "Review the auth module" --claim
  /spawn-agent haiku --yolo --tab 0 --task "Run tests"   # Split in same tab as pane 0
  /spawn-agent opus --yolo --auto-tab --task "Do something"  # Auto-pick tab based on pane count
  /spawn-agent opus --yolo --cwd /path/to/worktree --task "Implement feature"

Tab organization:
  - With --auto-tab: Automatic! Fills current tab to 4 panes, then creates new tabs.
  - Manual (--tab): First 3 agents use --tab <your-pane-id>, 4th fills to 4,
    5th creates new tab, 6th-8th use --tab <5th-agent-pane-id>, repeat.

Run: spawn-agent $ARGUMENTS

> **Note**: The `spawn-agent` function is available via BASH_ENV when spawned by spawn-agent.js. If not available, use: `node $AGENT_SETUP_PATH/prompts/scripts/spawn-agent.js $ARGUMENTS`
