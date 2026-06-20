---
skill_id: build_order_template
type: prototype
category: build_order
status: template
triggers:
  keywords: [build order, project, continue, resume, phase, roadmap, plan, milestone, todo]
  languages: [all]
  platforms: [cross]
depends_on: [master_skill, skill_chaining, context_management]
priority: 8
description: Reusable template + parser contract for Navigator project-state (build-order) files.
---

# Build Order Template

A **build order** is Navigator's unit of *durable project state*. Where a build skill
answers "how do I make an X" and a debug skill answers "why is X broken", a build order
answers **"where are we in this project and what is the next concrete step"**. It is the
artifact the PROJECT intent (router words: `project, continue, resume, build order`) routes
to, and it outranks build/reference skills in the 9-rank authority ladder (rank 3:
project files). The runtime parses build orders to render progress bars, resume points,
and the cross-project dashboard, so the on-disk format is a hard contract — not prose.

This file is the canonical TEMPLATE. Copy it, change the frontmatter, and fill the phases.
Do not deviate from the heading and checkbox grammar described in PARSER CONTRACT below.

## EXTRA FRONTMATTER KEYS

Build orders extend the standard Navigator manifest with project-lifecycle keys. These are
read by the dashboard renderer and by `context_management.md` when it decides what to reload
on resume.

| key | values | meaning |
|---|---|---|
| `status` | `active` \| `paused` \| `complete` \| `template` | Lifecycle state. `template` means "scaffold, do not render as live work". The dashboard hides `template` and `complete` from the active queue. |
| `current_phase` | integer (1-based) | The phase the team is working IN right now. Must be `<= total_phases`. Drives the "you are here" marker. |
| `total_phases` | integer | Count of `## Phase N:` headings in the body. The parser cross-checks this; a mismatch is a quality-gate (gate 1, completeness) failure. |
| `required_tools` | inline array, e.g. `[python, pip, pytest]` | Tools/skills that must be available before this order can advance. The router warms these from `tool_repo.md`. |

`status: template` files (like this one) carry `current_phase: 0` and `total_phases: 0` by
convention, because a template has no live progress.

## PARSER CONTRACT (do not break)

The runtime parser is line-oriented and deliberately dumb so it stays fast and deterministic.
Two grammar rules are load-bearing:

1. **Phases are H2 headings with a STATUS in parentheses**, exactly:

   ```
   ## Phase 1: Foundation (COMPLETE)
   ## Phase 2: Core Logic (IN PROGRESS)
   ## Phase 3: Integration (PENDING)
   ```

   - Format: `## Phase <N>: <Title> (<STATUS>)`.
   - `<STATUS>` is one of `COMPLETE`, `IN PROGRESS`, `PENDING` (uppercase, inside parens).
   - The parser keys phases by `<N>`, so numbers must be contiguous starting at 1.

2. **Steps are GitHub-style task checkboxes**, exactly:

   ```
   - [x] done step
   - [ ] todo step
   ```

   - `- [x] ` (lowercase x) = done. `- [ ] ` (single space) = not done.
   - One step per line. No nested checkboxes — flatten sub-tasks into sibling lines or a new phase.
   - Progress for a phase = `checked / total` of the checkboxes under that H2 until the next H2.

Anything between an H2 and its first checkbox is treated as a phase note (rendered, not parsed).
The progress bar for the WHOLE order is the sum of checked steps over the sum of all steps.

## BODY FORMAT

Below the frontmatter and intro, a build order is just an ordered list of phases. Keep phases
small enough that one focused work session closes one phase. A phase that never reaches
COMPLETE across several sessions is a signal to split it (see `skill_chaining.md` on
decomposing work into resumable links).

## Phase 1: Foundation (COMPLETE)

Scaffold and prerequisites. Everything that must exist before real logic is written.

- [x] Create project skeleton and directory layout
- [x] Pin toolchain / dependencies in `required_tools`
- [x] Establish the test harness so later phases are verifiable
- [x] Commit an empty-but-runnable baseline

## Phase 2: Core Logic (IN PROGRESS)

The substantive work. Mark steps `[x]` as they land; the dashboard recomputes the bar live.

- [x] Implement the primary code path
- [ ] Handle the error / edge paths (see `error_handling_patterns`)
- [ ] Reach target unit-test coverage for the core module

## Phase 3: Integration (PENDING)

Wiring the core into its surroundings — I/O, adjacent modules, external services.

- [ ] Connect core to the interface layer
- [ ] Add integration tests across the seam
- [ ] Validate against a realistic end-to-end scenario

## Phase 4: Polish (PENDING)

Hardening, docs, and release readiness. The last 20% that makes it production-grade.

- [ ] Pass all five quality gates (completeness, correctness, safety, citation, compliance)
- [ ] Write user-facing docs / README section
- [ ] Final review and tag a release

## AUTHORING CHECKLIST

- [ ] `total_phases` equals the count of `## Phase N:` headings.
- [ ] `current_phase` points at the first non-COMPLETE phase.
- [ ] Exactly one STATUS per phase heading; STATUS is uppercase in parens.
- [ ] Every step is a `- [x]`/`- [ ]` checkbox; no other bullet style in phase bodies.
- [ ] Frontmatter `status` reflects reality (`active` once work starts; `complete` when all phases COMPLETE).

## CROSS-REFERENCES

- [master_skill](../../master_skill.md) — the orchestration core; routes the PROJECT intent here and reads `status`/`current_phase` to build the resume prompt.
- [skill_chaining](../../skills/rules/skill_chaining.md) — how a phase decomposes into a chain of build/debug skill calls; pair with build orders to sequence multi-skill work.
- [context_management](../../skills/rules/context_management.md) — what to reload on resume; build orders are the cheap state file that lets a session rehydrate without replaying history.
- [BUILD_ORDER_TODO](./TODO.md) — the live cross-project TODO that uses this exact phase+checkbox grammar.
- [project_example_cli_tool](./example_cli_tool.md) — a fully worked example order the UI parses end to end.

## END OF SKILL
