---
name: steer
description: Send steering commands to active execution
---

# Steer — Steering Interface

Trigger this skill when the user wants to redirect, pause, correct, or
acknowledge guidance on an in-progress Attempt/Move — bidirectional
steering (spec sections 3.1, 4).

## How steering works here

Steering commands are issued from the control plane (the web UI's steering
panel) into a running Attempt. This skill's job on the Claude Code side is
to **acknowledge** steering already delivered into the current session —
Claude cannot inject a steering command into itself; a human uses the
Process OS web UI to originate one.

## Steps

1. Check the current session's hook-provided context
   (`additionalContext` from `SessionStart`/`PostToolUse`) for any pending
   steering messages — these carry a `steering_id`.
2. When the user is confirming they've applied a steering instruction, call
   `process.steering.ack` with that `steering_id`.
3. Confirm to the user what was acknowledged and how execution is adjusting
   as a result (pause, redirect, guidance applied).
4. When the user wants to *send* a new steering command rather than
   acknowledge one, point them to the Process OS web UI's steering panel on
   the relevant Move/Attempt — that's the origination point, not this
   skill.
5. If no pending steering command matches what the user describes, say so
   rather than guessing at a `steering_id`.

## Notes

Never fabricate a `steering_id` — `process.steering.ack` rejects an id that
isn't in the local pending-steering queue.
