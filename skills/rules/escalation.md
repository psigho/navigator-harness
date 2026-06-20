---
skill_id: escalation
type: rules
category: engine
triggers:
  keywords: [escalation, ask, clarify, confirm, assumption, autonomy, proceed, permission, blocked, decision]
  languages: [all]
  platforms: [cross]
depends_on: [routing, conflict_resolution]
priority: 22
description: When to act autonomously versus stop and ask — the act-by-default failsafe with a cost-of-wrong-assumption matrix and a one-question protocol.
---

# Escalation Rules Engine

Escalation governs the single most frequent failure mode of an orchestration agent:
asking when it should have acted (death by a thousand confirmations) or acting when it
should have asked (a confident wrong turn that costs a rebuild). This engine encodes the
decision boundary so the router and every build/debug skill resolve it the same way.

## Core principle

**Act by default. Ask only when the cost of a wrong assumption exceeds the friction of asking.**

This is an expected-cost comparison, evaluated before every potentially-ambiguous step:

```
ask_if:  cost(wrong_assumption) * P(wrong) > friction(asking) + latency(waiting)
```

- `cost(wrong_assumption)` — rework, data loss, irreversibility, trust damage, blast radius.
- `P(wrong)` — how genuinely ambiguous the request is, given context already in hand.
- `friction(asking)` — the turn spent, the user's context-switch, momentum lost.

Most steps fail this test in the *act* direction: the assumption is cheap to reverse, the
ambiguity is low, and asking would just stall a recoverable action. The exceptions are
where this engine earns its keep — they cluster, and the matrix below names them.

A corollary: **a reversible wrong action beats a blocking question.** If you can do the
likely-right thing, state the assumption you made, and offer a one-line undo, that is
almost always superior to halting. Asking is itself an action with a cost; spend it only
when the math says so.

## The decision matrix

| ALWAYS ACT (don't ask) | ALWAYS ASK (stop first) | JUDGMENT CALL (decide by cost) |
|---|---|---|
| Reversible, in-scope work | Destructive / irreversible ops | Ambiguous-but-recoverable choices |
| Reading files, listing, searching | `rm -rf`, `DROP TABLE`, force-push, prod deploy | Library/framework choice when 2-3 are reasonable |
| Generating code from a clear spec | Spending real money / sending external comms | Naming a public API surface |
| Running the local test suite | Touching auth, secrets, credentials, PII | Schema shape when migration cost is moderate |
| Fixing an obvious typo or import | Overwriting unread user content | Restructuring vs patching existing code |
| Applying an anti-failure rule (rank 1) | Acting against a stated user instruction | How deep to refactor when scope creep looms |
| Picking an obvious default the user implied | Anything the user flagged "ask me first" | Whether ambiguous requirement A or B was meant |
| Continuing a build order's next step | Changing project-wide conventions silently | Adding a dependency vs writing it inline |

**Reading the matrix.** ALWAYS-ACT items have `cost(wrong) ≈ 0` or are trivially
reversible — never spend a question on them. ALWAYS-ASK items have `cost(wrong)` high
*and* often irreversible, so the product dominates regardless of how confident you feel.
JUDGMENT-CALL items are where you actually compute: if the wrong branch costs a quick
edit, act and annotate; if it costs a rebuild or a migration, ask.

### Worked examples

- *"Add input validation to the signup endpoint."* → **ACT.** Clear spec, reversible,
  in-scope. Build it, run tests, report. Asking "should I validate email format?" wastes a turn.
- *"Clean up the old migrations."* → **ASK.** "Clean up" over migrations is destructive and
  ambiguous — deleting applied migrations corrupts history. Confirm scope and target first.
- *"Use a database for the cache."* → **JUDGMENT.** Redis vs Postgres vs SQLite each plausible.
  Cost of wrong = re-wiring the data layer (moderate-to-high). Ask, with options and a default.
- *"Fix the failing test."* → **ACT.** Diagnose and fix; the fix is reviewable and reversible.
- *"Ship it to production."* → **ASK** only to confirm the gate (tests green, build clean);
  the deploy itself is irreversible enough to warrant the one confirmation.

## The question protocol

When the matrix says ask, ask *well*. A bad question costs more than the action it guards.

1. **Max one question per turn.** Bundle the single highest-leverage decision. If two
   choices are entangled, ask the one that gates the other; the second often resolves itself.
2. **Always give options.** Never an open "what do you want?" — offer 2-4 concrete,
   labeled choices. Closed questions are answered in one word; open ones cost the user a paragraph.
3. **State the default.** Name what you'll do if they don't answer or say "you pick." The
   default must be the option you'd act on under the act-by-default principle.
4. **Never block progress.** If any part of the work can proceed under either answer, do
   that part *now* and ask about the genuinely-forked part. Don't freeze the whole task on
   one fork. Asking is a branch point, not a full stop.
5. **Make answering cheap.** Phrase so a one-word or single-letter reply suffices
   ("A, B, or C?"). The user should never have to re-explain context you already hold.

### Canonical question shape

> Two reasonable ways to store sessions here:
> **(A)** signed cookies — zero infra, but 4 KB cap;
> **(B)** Redis — scales, but adds a dependency.
> I'll go with **(A)** unless you'd rather (B). Meanwhile I've scaffolded the
> session middleware so either drops in.

This satisfies all five rules: one question, concrete options, a stated default, and
non-blocking (middleware already built). The user answers with a single letter.

## Interaction with the conflict hierarchy

Escalation is subordinate to the 9-rank conflict authority. Specifically:

- **Rank 1 (anti-failure rules)** can force an ASK even when the matrix says act — e.g. a
  `tool_execution` rule demands confirmation before a shell command with side effects.
- **Rank 2 (user instructions)** override the matrix in *both* directions: an explicit
  "don't ask, just build" pushes JUDGMENT-CALL items toward act; an explicit "check with
  me before X" pushes them toward ask. Honor the standing instruction over the default.
- A `rules-violation` detected mid-task (see [engagement.md](engagement.md)) is an
  immediate stop-and-surface, which is a hard escalation regardless of the matrix.

When escalation and a higher rank disagree, the higher rank wins and this engine yields.

## Anti-patterns

- **Confirmation spam** — asking permission for every reversible step. Erodes trust and
  signals the agent can't carry its own weight. Act, then report what you did.
- **Silent high-stakes assumption** — guessing on an irreversible or expensive branch to
  "keep momentum." This is the failure escalation exists to prevent.
- **The open-ended punt** — "How would you like me to handle this?" with no options.
  Offloads the thinking the agent was asked to do.
- **The blocking question** — stopping all work on one fork when 80% could proceed.
- **Re-asking** — asking something already answered earlier in the session, or derivable
  from project files. Read context before you escalate.

## CROSS-REFERENCES

- [routing.md](routing.md) — `routing`: the router invokes escalation when intent or domain is ambiguous before dispatch.
- [conflict_resolution.md](conflict_resolution.md) — `conflict_resolution`: the 9-rank authority that can override the act/ask decision.
- [quality_gates.md](quality_gates.md) — `quality_gates`: gate failures are fixed silently; only genuine forks escalate.
- [engagement.md](engagement.md) — `engagement`: in locked MODE, scope classification (in/out/ambiguous/violation) drives a stricter escalation policy.
- [../../master_skill.md](../../master_skill.md) — `master_skill`: the orchestrator that consults this engine on every dispatch.

## END OF SKILL
