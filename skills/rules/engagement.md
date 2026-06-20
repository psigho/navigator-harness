---
skill_id: engagement
type: rules
category: engine
triggers:
  keywords: [engagement, mode, locked, passphrase, scope, terrain, coverage, assessment, persistence, in-scope, out-of-scope]
  error_patterns: ["scope violation", "out of engagement scope", "engagement not active"]
  languages: [all]
  platforms: [cross]
depends_on: [routing, escalation, quality_gates]
priority: 23
description: The locked operational MODE failsafe — passphrase activation, the terrain coverage tracker, scope enforcement, state persistence, and the three sub-modes. Framework mechanism only.
---

# Engagement Mode Engine

Engagement Mode is Navigator's **locked operational failsafe**: a deliberate, opt-in state
in which the framework runs against a *bounded* objective with strict scope discipline,
methodology coverage tracking, and persistent state across turns. Outside this mode
Navigator behaves as a general assistant. Inside it, every dispatch is checked against a
declared scope and recorded against a coverage map.

This file describes the **mechanism only** — the state machine, the data layout, the
classification rules. It defines no operational tooling and no domain-specific content. The
"terrain" the engine tracks is purely *methodology coverage*: which parts of a declared
plan have been visited, not anything about a target. Engagement is a discipline layer, not
a capability.

## Activation — passphrase only

Engagement Mode **cannot** be entered by inference, by keyword, or by the router guessing
intent. It activates on **exactly one trigger**: the user supplies the literal passphrase.

```
ACTIVATION PASSPHRASE:  navigator-engage
```

- The router never auto-enters this mode. A request that *sounds* like a bounded objective
  ("do a full pass over X") stays in normal mode unless the passphrase is present.
- On receiving `navigator-engage`, the engine initializes engagement state (below), then
  prompts once for the **objective** and **scope boundary** before doing any work.
- Deactivation is explicit too: the user says `navigator-disengage` (or equivalent), which
  finalizes the report and tears down the active state. The mode does not silently lapse.
- Re-supplying the passphrase mid-engagement is a no-op acknowledgment, not a reset.

This single-trigger design is the failsafe: the stricter, stateful behavior is never
entered by accident, and a casual phrasing can never escalate Navigator into it.

## The terrain system — coverage as map

While engaged, the framework's **domain maps** (`maps/python.md`, `maps/rust.md`,
`maps/web_api.md`) are repurposed from navigation aids into a **methodology / coverage
tracker** called *terrain*. Terrain answers one question: *of the plan I declared, how much
have I actually covered, and with what result?*

Each terrain node is a unit of the declared methodology with a coverage state:

| State | Meaning |
|---|---|
| `untouched` | Declared in scope, not yet visited |
| `in_progress` | Currently being worked |
| `covered` | Visited, result recorded |
| `blocked` | Cannot proceed — dependency, missing input, or a fork awaiting the user |
| `deferred` | Explicitly postponed within this engagement |

Terrain is *additive and monotonic within an engagement*: a node never silently regresses
from `covered` to `untouched`. Coverage percentage = `covered / (total in-scope nodes)`,
surfaced on request and at finalization. The map view lets the user see at a glance what
methodology remains, mirroring how domain maps show unexplored areas in normal mode.

## Scope enforcement

Every action proposed while engaged is classified against the declared scope boundary
*before* execution. There are four verdicts:

| Verdict | Definition | Engine response |
|---|---|---|
| **in-scope** | Within the declared objective and boundary | Proceed; record to terrain |
| **out-of-scope** | Outside the boundary | Refuse the action; note it; do **not** execute |
| **ambiguous** | Boundary unclear for this action | Escalate one question (per `escalation`); default = treat as out-of-scope |
| **rules-violation** | Action would break a rank-1 anti-failure rule or a standing instruction | Hard stop; surface immediately; never execute |

Key disciplines:

- **Out-of-scope is refused, not silently skipped.** The engine records the request and the
  refusal so the final report is honest about what was *asked but not in bounds*.
- **Ambiguous defaults to out-of-scope.** Under engagement the cost asymmetry flips: acting
  outside an agreed boundary is worse than asking, so the escalation default tightens (see
  [escalation.md](escalation.md) — engagement raises the bar for autonomous action).
- **rules-violation overrides the objective.** No engagement objective can authorize
  breaking a rank-1 rule; the conflict hierarchy still governs (see
  [conflict_resolution.md](conflict_resolution.md)). The objective is rank-2 at most.

## Engagement state persistence

Engagement state survives across turns and is the single source of truth for the mode. It
is a structured record (illustrative layout):

```
engagement/
  STATE.md                  # mode flag, objective, scope boundary, sub-mode, timestamps
  terrain/                  # coverage tracker
    coverage.json           # per-node state map (untouched/in_progress/covered/blocked/deferred)
    notes/<node>.md         # per-node working notes and recorded results
  scope/
    boundary.md             # the declared in/out boundary, verbatim as agreed
    refusals.md             # out-of-scope requests logged with timestamps
  reports/
    <submode>-output.md     # accumulated findings in the active sub-mode's format
  log.md                    # append-only turn-by-turn action ledger
```

Persistence rules:

- `STATE.md` is read at the start of every engaged turn — it is how the engine knows it is
  still engaged and what the boundary is. If `STATE.md` is absent, the mode is *not* active.
- The `log.md` ledger is append-only; it is the audit trail the final report is built from.
- Terrain `coverage.json` is the canonical coverage state; the map view is rendered from it.
- On `navigator-disengage`, the engine compiles `reports/` + `log.md` + terrain into a final
  report, then marks `STATE.md` inactive. Nothing is deleted — the record persists for review.

## Sub-modes

Engagement runs in one of three sub-modes, chosen at activation, governing how results are
shaped. The sub-mode sets the output format; the scope and terrain mechanics are identical
across all three.

1. **Per-item reports.** Each terrain node, as it reaches `covered`, emits a standalone
   report fragment. Best for incremental, list-shaped objectives where each unit is
   independently meaningful. Output accumulates one fragment per item.
2. **Formal assessment.** A single structured document built up across the engagement, with
   a fixed section skeleton declared at activation. Per-node results feed sections rather
   than standing alone. Best for objectives that demand one coherent deliverable.
3. **Objective-based.** Organized around the declared objective's success criteria rather
   than around terrain nodes. Terrain still tracks coverage, but the report is framed as
   "criteria met / not met / blocked." Best when the objective has explicit pass conditions.

The sub-mode is recorded in `STATE.md` and can be changed only by explicit user instruction
mid-engagement (a rank-2 standing instruction); it never changes on its own.

## Interaction with the rest of the framework

- **Router** — while engaged, the router still classifies intent, but dispatch results are
  additionally scope-checked and recorded to terrain before delivery.
- **Escalation** — engagement tightens the act/ask boundary: ambiguous → out-of-scope by
  default, and any rules-violation is a hard escalation.
- **Quality gates** — gate 5 (compliance) reads the active scope boundary from `STATE.md`;
  an out-of-scope artifact fails compliance and is not delivered.
- **Maps** — repurposed as the terrain coverage view for the duration of the engagement.

## Framework-level boundary (explicit)

This engine is a *control* mechanism. It contains and references **no** operational tooling,
**no** domain-offensive content, and **no** target-specific methodology. "Terrain" is
coverage bookkeeping over a user-declared plan; "scope" is a boundary the user sets; the
sub-modes are output formats. Everything operational lives outside Navigator entirely and
is out of this framework's mandate.

## CROSS-REFERENCES

- [routing.md](routing.md) — `routing`: intent dispatch is scope-checked and terrain-recorded while engaged.
- [escalation.md](escalation.md) — `escalation`: engagement tightens the act/ask default (ambiguous → out-of-scope).
- [quality_gates.md](quality_gates.md) — `quality_gates`: gate 5 reads the engagement scope boundary for compliance.
- [conflict_resolution.md](conflict_resolution.md) — `conflict_resolution`: the objective is rank-2 at most; rank-1 rules override it.
- [../../maps/python.md](../../maps/python.md) — `map_python`: a domain map repurposed as a terrain coverage tracker in engagement.
- [../../maps/web_api.md](../../maps/web_api.md) — `map_web_api`: terrain coverage view for web_api engagements.
- [../../master_skill.md](../../master_skill.md) — `master_skill`: holds the passphrase gate and engagement state lifecycle.

## END OF SKILL
