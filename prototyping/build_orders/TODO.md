---
skill_id: build_order_todo
type: prototype
category: build_order
status: active
triggers:
  keywords: [todo, backlog, tasks, project, continue, resume, build order, what next]
  languages: [all]
  platforms: [cross]
depends_on: [master_skill, skill_chaining, context_management]
priority: 9
description: Live cross-project Navigator TODO, expressed as a phase+checkbox build order.
---

# Navigator TODO (Cross-Project)

This is the **live** backlog for the Navigator framework itself, kept in the same
phase+checkbox grammar every build order uses so the dashboard can render it with no special
casing. It is `status: active` and intentionally high `priority` (9) so the PROJECT intent
surfaces it first when the user says "what's next" or "continue" without naming a project.

Unlike a single-project order, this TODO spans the whole framework: each phase is a *theme*
of work, and steps are concrete, independently-shippable tasks. When a theme's steps all
reach `[x]`, promote the heading's STATUS to COMPLETE and move the next theme to IN PROGRESS.
Keep `current_phase` pointed at the first non-COMPLETE phase.

Rules for editing this file (so the parser and the team stay in sync):

- Add new work as a `- [ ]` line under the most-fitting phase; do not invent bullet styles.
- One task per line; if a task needs sub-steps, it is probably its own phase or its own order.
- When a task is genuinely done (merged + verified, not just written), flip `[ ]` to `[x]`.
- Never delete a completed task mid-cycle — completed steps are what the progress bar counts.

## Phase 1: Router and Manifest Core (COMPLETE)

The intent router, manifest schema, and the parser that reads frontmatter + phases. Without
this, nothing else routes. See `routing.md` and `master_skill.md`.

- [x] Define the manifest YAML frontmatter schema and parser-critical format rules
- [x] Implement intent detection (BUILD / DEBUG / LOOKUP / PROTOTYPE / TOOL / PROJECT)
- [x] Implement intent-priority tie-break (PROJECT > DEBUG > BUILD > PROTOTYPE > TOOL > LOOKUP)
- [x] Implement domain keyword matching for python / rust / web_api
- [x] Wire the 9-rank conflict-authority ladder into selection

## Phase 2: Skill Library Buildout (IN PROGRESS)

The actual build/debug/rules skills the router dispatches to. This is the bulk of the value
and is filled out domain by domain. Pair build skills with their debug partners via
`pairs_with` (see `skill_chaining.md`).

- [x] Author build skills for python, rust, web_api
- [x] Author paired debug skills with `error_patterns` for each domain
- [x] Author the rules layer (routing, error_routing, composition, conflict_resolution)
- [ ] Author the remaining rules (escalation, quality_gates, engagement)
- [ ] Cross-link every build skill to its debug partner and domain map
- [ ] Backfill `error_patterns` from real tracebacks for higher debug-routing precision

## Phase 3: Anti-Failure and Safety (PENDING)

The rank-1 anti-failure layer plus the guardrails that keep long sessions honest: context
budget, hallucination guards, scope lanes. These outrank everything, so they ship before the
framework is called production-grade. See `context_budget.md` and `hallucination_guards.md`.

- [ ] Finalize per-domain anti-failure files (python / rust / web_api)
- [ ] Wire context-budget levels (GREEN/YELLOW/ORANGE/RED) into the runtime
- [ ] Enforce the 5 quality gates at response-assembly time
- [ ] Add scope-lane checks so a session cannot silently widen its mandate

## Phase 4: Examples and Docs (PENDING)

The reference material another engineer studies: end-to-end walkthroughs, routing examples,
maps, and the README. Polish phase — the framework works without it, but adoption needs it.

- [ ] Write the end-to-end example tying router → skill → anti-failure → quality gate
- [ ] Expand routing examples covering ambiguous and multi-domain queries
- [ ] Finish domain maps for python / rust / web_api
- [ ] Write the top-level README and quick-start

## CROSS-REFERENCES

- [master_skill](../../master_skill.md) — surfaces this TODO for bare "continue"/"what next" requests and reads its `current_phase` for the resume prompt.
- [skill_chaining](../../skills/rules/skill_chaining.md) — turns a single TODO step into an ordered chain of skill invocations.
- [context_management](../../skills/rules/context_management.md) — decides which referenced skills to preload when resuming a phase from this backlog.
- [build_order_template](./BUILD_ORDER_TEMPLATE.md) — the grammar this file obeys.
- [project_example_cli_tool](./example_cli_tool.md) — a single-project order for comparison with this cross-project one.

## END OF SKILL
