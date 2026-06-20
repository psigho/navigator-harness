---
skill_id: context_budget
type: prototype
category: anti_failure
triggers:
  keywords: [context, budget, window, tokens, overflow, exhaustion, compaction, compression, memory, loading]
  error_patterns: ["context length exceeded", "maximum context length", "token limit", "prompt is too long", "exceeds the maximum"]
  languages: [all]
  platforms: [cross]
priority: 3
description: Prevent context-window exhaustion through loading discipline, budget tracking, and timely compression triggers.
---

# Anti-Failure: Context Budget

The single most common silent failure in a skill-orchestration runtime is not a crash — it is
**slow context-window exhaustion**. The router keeps loading skills, reference files, build orders,
and conversation history until the prompt no longer fits, at which point either the call hard-fails
or the harness silently truncates the *oldest* content — which is usually the anti-failure rules
and the user's original instructions. By the time the symptom appears, the safety guarantees are
already gone. This skill prevents that.

## Budget model

NAVIGATOR assumes a ~200K-token working window. It is partitioned into four operating levels:

| Level  | Utilization | Posture |
|--------|-------------|---------|
| GREEN  | < 40%       | Load freely. Normal operation. |
| YELLOW | 40-65%      | Load deliberately. Prefer summaries over full files. |
| ORANGE | 65-80%      | Compress now. Evict completed skills. No speculative loads. |
| RED    | > 80%       | Emergency. Checkpoint state to a build order, then compact. |

The level is a function of *everything in the window*: the system prompt, loaded skills, reference
files, tool outputs, and the full back-and-forth transcript. Tool outputs (file reads, command
stdout) are the fastest-growing and most-overlooked contributor — a single unbounded directory
listing or log dump can move you a whole level.

## Loading discipline (the core rules)

1. **Load on demand, not on suspicion.** Never preload a skill because it "might" be relevant. The
   router resolves intent first, then loads only the winning build/debug skill plus its declared
   `depends_on`. Hallucination guards are the one always-on exception (see below).
2. **One domain lane at a time.** Do not hold `python_build`, `rust_build`, and `web_api_build`
   resident simultaneously unless the task genuinely spans all three. Each domain map already
   summarizes its lane; load the map, not every skill in it.
3. **Reference files are reads, not residents.** Pull the exact section you need from
   `dev_reference/*` and `func_encyclopedia/*`, quote it, and let it age out. Do not keep an entire
   stdlib reference pinned.
4. **Tool output is rented space.** Cap reads with line ranges. Pipe long command output through a
   filter before it enters the window. A 4,000-line log you scanned once does not need to stay.
5. **Mandatory-load skills stay pinned regardless of level.** `hallucination_guards` and the active
   conflict-resolution rules are never evicted to make room. If they would have to be evicted to
   continue, you are already in RED and must checkpoint instead.

## Compression triggers (when to act, not just observe)

Crossing a boundary is the trigger; the action is mandatory, not advisory.

- **GREEN → YELLOW:** Replace any *fully consumed* file read in the transcript with a one-line note
  of what it contained and where it lives. The content is on disk; the window does not need a copy.
- **YELLOW → ORANGE:** Evict every skill whose task is complete. Collapse resolved debug threads to
  a single "fixed: <cause> → <fix>" line. Stop all speculative loading immediately.
- **ORANGE → RED:** Stop forward work. Write current state — completed steps, the next step, open
  decisions, and active constraints — into a build order file (`build_orders/TODO.md` pattern).
  Then request/perform compaction. The build order is the recovery anchor on the other side.

## Checkpoint-before-compact (the critical invariant)

Compaction is lossy. The rule that prevents data loss: **never compact without a durable
checkpoint already on disk.** A checkpoint captures (a) the build order / step pointer, (b) every
active anti-failure and user constraint verbatim, (c) unresolved decisions, and (d) the citation
trail for any asserted facts. After compaction, the first action is to re-read the checkpoint and
re-pin the mandatory-load skills. This is the same discipline `skill_drift` uses for re-anchoring —
the two skills share the checkpoint artifact.

## Worked example

A `web_api_build` task has produced 11 endpoints, three 600-line file reads, and a 2,000-line test
log. Utilization hits 72% → ORANGE.

- Evict the two file reads whose endpoints are already shipped (note: "auth.py read — JWT middleware
  at L40-95"). 
- Collapse the test log to "pytest: 2 failures, both fixed (missing await, wrong status code)."
- Decline to load `rust_build` even though the user mentioned a future Rust port — that is YELLOW-only
  speculation, forbidden at ORANGE.
- Result: utilization falls to ~48%, back into YELLOW, no information actually needed was lost.

## Anti-patterns

- **Loading the whole skill tree "to be safe."** This *causes* the exhaustion it fears.
- **Discovering RED at call-time.** If your first signal is a "context length exceeded" error, your
  budget tracking failed. Track continuously; act at boundaries.
- **Compacting to free space mid-task with no checkpoint.** You will lose the user's constraints and
  silently violate them afterward.
- **Letting tool output accumulate unbounded.** Always cap, filter, and age out command output.

## CROSS-REFERENCES
- [skills/rules/context_management.md](../../skills/rules/context_management.md) — runtime budget levels and the compaction protocol this skill enforces.
- [prototyping/anti_failure/skill_drift.md](skill_drift.md) — shares the checkpoint artifact; re-anchoring after the compaction this skill triggers.
- [skills/rules/composition.md](../../skills/rules/composition.md) — composition order that determines what is safe to evict first.
- [skills/rules/quality_gates.md](../../skills/rules/quality_gates.md) — gate 1 (completeness) can fail if compaction dropped required content.

## END OF SKILL
