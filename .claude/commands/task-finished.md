Signal task completion to the Technical Director.

Your task is complete. Send a completion message to the TD pane that dispatched you.

**Important:** If you already sent a completion message using the correct format (e.g., `ISSUE_X_COMPLETE: ...` or `TASK_COMPLETE: ...`), you do NOT need to send another one. This skill is only needed if you haven't already notified the TD.

Run this command to notify the TD:
```bash
send-to-pane <TD-pane-id> "TASK_COMPLETE: <brief summary of what you did>"
```

Replace `<TD-pane-id>` with the pane ID you were told to report back to.
Replace `<brief summary>` with a one-line summary of what you accomplished.

Example:
```bash
send-to-pane 0 "TASK_COMPLETE: Created test-output.txt with required content"
```

If you encountered issues or workarounds, mention them in your summary.

> **Note**: The `send-to-pane` function is automatically available via BASH_ENV when spawned by spawn-agent.js.
