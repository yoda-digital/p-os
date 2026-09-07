---
name: connect
description: Pair this device with your Process OS account
---

# Connect — Device Pairing

Trigger this skill when the user asks to connect, pair, log in, or set up
Process OS for the first time, or when a `SessionStart` hook reports
"Not paired. Run /process:connect to pair this device."

## What pairing does

The Process MCP server and hooks run locally, but act on the user's behalf
against a control plane (the Process OS web app). Pairing links this
Claude Code install to a Process OS account so the `process.*` tools can
read and write real Cases, Moves, and Evidence (spec section 8).

## Steps

1. Check whether the device is already paired by calling `process.case.get`.
   A Case, or a "no case bound" message, means pairing already succeeded —
   report that and stop.
2. Run the pairing flow script from the repository root:
   ```bash
   node plugin/claude-code/dist/pairing/flow.js
   ```
   If it fails because `dist/` doesn't exist yet, build the plugin first
   (`pnpm --filter @pos/plugin-claude-code build`) and retry.
3. The script prints a 6-character pairing code and a pairing URL
   (`<control_plane_url>/pair`). Show both to the user exactly as printed
   and tell them to:
   - Open the URL in a browser where they are already signed in to
     Process OS.
   - Enter the code (case-insensitive) and confirm.
4. The script polls automatically and blocks until the code is confirmed,
   expires (5 minutes), or the poll times out. Wait for it to finish —
   don't run it again while it's still polling.
5. On success the script stores the device identity (device id, user id,
   organization id, auth token) in local SQLite. Confirm to the user that
   the device is paired and that `process.*` MCP tools are now available.
6. If the code expires before confirmation, re-run the script for a fresh
   code.

## Notes

- Pairing codes are one-time use and expire in 5 minutes (spec section 8.2).
- Re-running this skill when already paired is safe: the script detects the
  existing device identity and exits immediately without issuing a new code.
