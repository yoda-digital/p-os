---
name: why
description: Explain why any process state exists — trace the causal chain
---

# Why — Causal Explanation

Trigger this skill whenever the user asks "why is this...", "why did...",
"what caused...", or needs the reasoning or history behind a Case, Move,
Decision, Assertion, or Rule.

## Steps

1. Identify the ref to explain: a Case, Move, Decision, Assertion, or Rule
   id. If the user names something rather than an id ("why is the deploy
   Move blocked?"), resolve the id first via `process.move.list`,
   `process.case.get`, or `process.case.search`.
2. Call `process.why.explain` with:
   - `ref` — the resolved id.
   - `question` (optional) — the specific angle the user asked about, e.g.
     "why is this blocked?". Pass it through verbatim when the user's
     question is more specific than "why does this exist".
3. Present the response as a short plain-language answer first, then the
   causal chain (events/decisions/rules in order) as a compact timeline —
   not a raw dump of the tool's JSON.
4. Call out any unresolved Decisions or missing Evidence surfaced in the
   causal chain — they're often the real answer to "why".
5. If no cached explanation exists and the control plane is unreachable,
   say so plainly rather than guessing at a causal chain.

## Notes

`process.why.explain` traces the actual event-sourced history (spec
sections 3.1, 7). Never fabricate a causal chain from general reasoning
when the tool has no answer.
