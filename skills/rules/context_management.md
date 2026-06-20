---
skill_id: context_management
type: rules
category: engine
triggers:
  keywords: [context, budget, window, token, load, unload, compress, boot, session, state, memory]
  error_patterns: ["context length exceeded", "maximum context length", "token limit", "prompt is too long", "RED budget"]
  languages: [all]
  platforms: [cross]
pairs_with: context_budget
depends_on: [routing, composition]
priority: 3
description: The context-window budgeting protocol — budget levels, load priority, unload/compression strategy, boot modes, and session-state tracking.
---

# Context Management Engine

Navigator runs inside a finite context window (~200K tokens). Every skill, reference
file, map, and diagram that is loaded consumes budget that could otherwise hold the
user's actual code and conversation. This engine governs **what is loaded, in what
order, and what is shed when the window fills**. It is rank-6/rank-9 machinery that
serves rank-1 anti-failure: a session that blows its context cannot honor safety rules
it can no longer see.

The governing invariant: **the active-domain anti-failure rules and the user's live
instructions are NEVER unloaded.** Everything else is negotiable.

## 1. Budget Levels

Budget is measured as `used_tokens / window_tokens`. Four bands drive behavior:

| Level  | Utilization | Posture | Allowed loads | Action on entry |
|--------|-------------|---------|---------------|-----------------|
| GREEN  | < 40%       | Liberal | Any skill, references, maps, diagrams | None — load freely |
| YELLOW | 40 – 65%    | Selective | Build/debug + anti-failure + 1 reference | Defer non-essential maps/diagrams |
| ORANGE | 65 – 80%    | Frugal | Anti-failure + the single active skill only | Compress completed work; drop pattern libraries |
| RED    | > 80%       | Survival | Anti-failure + live instruction only | Hard unload; summarize-and-evict; refuse new loads |

Crossing a boundary is an **event**, not a suggestion. On ORANGE entry the engine emits
a compression pass before answering the next turn. On RED entry it refuses to load any
new skill until utilization drops back below 80%, and routes via cached summaries.

Budget is recomputed after every skill load and every large tool result. The level only
ever ratchets *tighter* mid-turn; it relaxes only at the start of a new turn once
eviction has actually freed tokens.

## 2. Load Priority Order

When the router selects skills for a turn (see `routing.md`), they are loaded in this
exact order. Loading stops the moment the current budget band forbids the next class.

```
1. Anti-failure rules for the ACTIVE domain   (rank 1 — always, even in RED)
2. The selected build OR debug skill          (rank 4/5 — the work itself)
3. Composition / chaining rules               (only if the turn chains skills)
4. Pattern library entries                    (rank 7 — drop first under pressure)
5. Reference files (HTTP codes, stdlib, etc.) (rank 6 — load on demand, evict early)
6. Domain map for the active domain           (rank 8 — load once, summarize after)
7. ISA / wiring diagrams                       (rank 8 — load, screenshot to summary, evict)
8. Project / build-order file                 (rank 3 — kept resident if a project is open)
9. Resource / tool index                       (rank 9 — never resident; query-and-drop)
```

Note the inversion between *authority* and *load priority*: the resource index is the
lowest authority (rank 9) AND the last to load, but the project file is high authority
(rank 3) yet loads late because it is large — it is loaded once and kept resident rather
than reloaded each turn. Anti-failure is both highest authority and first to load: the
two orderings only agree at the top.

## 3. Unload / Compression Strategy

Three mechanisms reclaim budget, applied in this sequence when a band tightens:

**(a) Evict transient references.** Reference files (rank 6) and pattern libraries
(rank 7) are reloadable from disk. Once their answer is woven into the response they are
dropped entirely. They re-enter only if a later turn needs them.

**(b) Summarize-and-evict large artifacts.** Maps and diagrams are loaded, distilled to
a 5–15 line summary (the node list, the critical edges, the one decision they settled),
and the full text is evicted. The summary stays; the source does not. A diagram is read
*once per session* — re-reading it is a budget bug.

**(c) Compress completed work.** Finished sub-tasks (a build skill that already emitted
its file, a debug skill whose fix is applied) collapse to a one-line ledger entry:
`done: web_api_build → wrote routes.py (3 endpoints)`. Tool outputs older than the
current sub-task collapse to their exit status.

**Never unloaded, at any band including RED:**

- Anti-failure rules for the currently active domain.
- The user's standing instructions for this session (rank 2).
- The open project / build-order file's *goal and remaining-task list* (the summary, if
  not the full file).
- The active quality-gate checklist (`quality_gates.md` summary).
- The running session-state YAML (Section 5) — it is the recovery anchor.

If RED persists after (a)–(c), the engine escalates per `escalation.md`: it surfaces the
budget state to the user and asks to split the task, rather than silently dropping a
safety rule to make room. **Dropping a rank-1 rule to fit more work is the one move that
is categorically forbidden.**

## 4. Boot Modes

A session enters through one of three modes. The mode picks the initial load set and the
expected starting budget.

**COLD** — fresh session, no prior state. Load only the router (`routing.md`) and the
engagement rules (`engagement.md`). No domain skills, no maps. Budget starts ~5%. The
first user turn triggers domain detection and the Section-2 load order. Use COLD for a
brand-new task with no project file.

**WARM** — resuming a known project. Load the project / build-order file first, replay
its session-state YAML to restore the ledger, then load the anti-failure rules for the
project's primary domain. Budget starts ~15–20% (project context is resident). Use WARM
when a build-order file exists and the user says "continue" / "resume".

**RECOVERY** — re-entry after a context overflow, crash, or hard eviction. Load *only*
the last good session-state YAML and the active-domain anti-failure rules. Do not reload
maps, diagrams, or pattern libraries — rebuild them lazily on demand. Verify the ledger
against the project file before resuming work (a RECOVERY boot assumes the in-memory
state was lost mid-turn and may be inconsistent). Budget starts ~10%. RECOVERY is the
mode the engine self-selects when it detects it crossed RED and had to evict resident
state.

## 5. Session-State Tracking Format

The engine maintains a single YAML block as the canonical, never-evicted record of where
the session is. It is rewritten (not appended) at the end of every turn that changes
state, and it is the exact payload a RECOVERY or WARM boot replays.

```yaml
session:
  boot_mode: WARM            # COLD | WARM | RECOVERY
  budget_level: YELLOW       # GREEN | YELLOW | ORANGE | RED
  utilization: 0.52          # used / window, recomputed post-load
  active_domain: web_api     # python | rust | web_api | null
  resident:                  # what is currently loaded and must survive eviction
    - anti_failure: web_api_anti_failure
    - skill: web_api_build
    - project: example_cli_tool        # summary only if ORANGE+
    - quality_gates: summary
  evictable:                 # loaded now, first to go when band tightens
    - reference: http_status_reference
    - map: map_web_api (summary)
  ledger:                    # compressed completed work
    - "done: web_api_build → wrote routes.py (3 endpoints)"
    - "done: web_api_debug → fixed 422 on POST /items"
  pending:                   # remaining task list (mirrors build-order file)
    - "add auth middleware"
    - "write integration test for /items"
  last_gate: passed          # result of last quality-gate run
  recovery_anchor: turn_14   # last turn where state was known-consistent
```

Rules for the block: `resident` lists nothing that may be unloaded; if an item moves to
`resident` it is removed from `evictable`. `utilization` drives `budget_level` — they must
agree or the block is stale. On RECOVERY, the engine trusts `pending` and `ledger` but
re-derives `utilization` and `resident` from scratch (the old numbers reflect a window
that no longer exists).

## 6. Worked Example — A Budget Tightening

1. Turn 8, GREEN (32%). User asks to build a REST endpoint. Router loads
   `web_api_anti_failure` → `web_api_build` → `map_web_api` → `http_status_reference`.
2. Turn 9, the build skill emits `routes.py`; a large pandas dataframe dump from a tool
   pushes utilization to 67% → **ORANGE**.
3. On ORANGE entry the engine runs compression: `http_status_reference` is evicted (its
   201/422 answer is already in `routes.py`), `map_web_api` collapses to its 8-line
   summary, the dataframe dump collapses to "shape (1.2M, 14)". Utilization drops to 49%
   → back to YELLOW at the next turn.
4. The session-state YAML is rewritten: `http_status_reference` leaves `evictable`,
   `map_web_api` is tagged `(summary)`, the build is added to `ledger`. Anti-failure and
   the project summary never moved.

## CROSS-REFERENCES
- [composition.md](composition.md) — how chained skills declare what they need resident; the load order here honors composition's hand-off contracts.
- [conflict_resolution.md](conflict_resolution.md) — the 9-rank authority that the load-priority order mirrors but deliberately inverts for large files.
- [../../prototyping/anti_failure/context_budget.md](../../prototyping/anti_failure/context_budget.md) — the anti-failure rule (rank 1) that this engine implements; budget bands and "never unload anti-failure" originate there.
- [escalation.md](escalation.md) — what to do when RED persists after full compression: surface and split, never drop a safety rule.
- [../../master_skill.md](../../master_skill.md) — the boot entrypoint that selects COLD/WARM/RECOVERY and hands control to this engine.

## END OF SKILL
