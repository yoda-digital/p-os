---
name: process
description: Show current Case, Moves, and what needs attention
---

# Process — Current State

Trigger this skill when the user asks "what am I working on", "what's the
status", "show me the process", or wants a snapshot of the Case bound to
this session.

## Steps

1. Call `process.case.get` (no arguments if a Case is already bound to this
   session; pass `case_id` if the user names a specific Case). Report the
   Case id, title, lifecycle state, and the bound Move/Attempt if any.
2. Call `process.move.list` for the same Case to enumerate Moves with their
   current state (readiness, execution, verification, attention).
3. Summarize for the user in three groups:
   - **In progress** — Moves currently executing.
   - **Needs attention** — Moves with `attention` set, blocked
     dependencies, or pending Decisions.
   - **Done** — satisfied Moves, mentioned briefly.
4. If nothing is bound to this session (`process.case.get` returns a
   "no case bound" message), say so and suggest `process.case.search` to
   find an existing Case or `process.move.propose` to start tracking new
   work.
5. Keep the summary short and scannable — this is a status check, not a
   full report.

## Related skills

- `why` — explain *why* any of this state exists.
- `steer` — acknowledge a steering command redirecting active work.
- `context` — the full Context Capsule, including DO NOT REPEAT and DELTA.
