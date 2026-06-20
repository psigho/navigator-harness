---
skill_id: master_skill
type: custom
category: engine
triggers:
  keywords: [navigator, route, orchestrate, dispatch, boot, registry, master, skill, intent]
  languages: [all]
  platforms: [cross]
priority: 100
description: The Navigator router/orchestrator — boots the skill registry, classifies intent, selects sources, runs quality gates, and delivers. Holds no domain content.
---

# MASTER SKILL — The Navigator Router

The master skill is the **only** always-loaded skill. It is the entry point for every
query. It owns no Python knowledge, no Rust knowledge, no HTTP knowledge — it *routes* to
the skills that do. Think of it as an instruction dispatcher: it decodes the query, picks
the right sources, executes through them, and enforces quality before delivering.

Hard rule: **the master skill never answers a domain question from its own body.** If it
finds itself explaining `asyncio` or borrow-checker rules inline, it has failed — that
content lives in `skills/build/`, `skills/debug/`, and `maps/`.

---

## STAGE -1 — BOOT / AUTO-DISCOVERY (runs once per session)

At session start the master skill scans the framework tree and builds an in-memory
registry. It reads **only the YAML frontmatter** of each `.md` (the manifest header) — never
the bodies. Bodies are loaded lazily, on demand, only when a skill is actually selected.
This keeps the boot cost flat regardless of how many skills exist.

Scan directories (in this order):

1. `skills/build/` and `skills/debug/` — the build<->debug triplet halves.
2. `skills/rules/` — routing and governance rules (highest authority, see rank table).
3. `prototyping/anti_failure/` — anti-failure guards.
4. `prototyping/build_orders/`, `prototyping/dev_reference/`, `prototyping/func_encyclopedia/`,
   `prototyping/isa_diagrams/`, `prototyping/wiring_diagrams/`.
5. `maps/` — domain maps.
6. `tool_repo.md` — the resource index (consulted at Stage 3, not loaded as a skill body).

For each manifest the registry records:

```
skill_id  ->  { type, category, triggers{keywords,extensions,error_patterns,languages,platforms},
                pairs_with, depends_on, priority, path }
```

Parse contract: top-level keys at column 0; trigger sub-keys indented exactly two spaces;
all arrays inline `[a, b, c]`; absent category is lowercase `null`. A manifest that violates
this is logged as a **registry warning** and skipped (it cannot be routed to). The
`pairs_with` edge links a build skill to its debug partner; `depends_on` records prerequisite
skill_ids that must be loaded alongside the selected skill.

Boot output: a registry of N skills, a keyword inverted index (keyword -> [skill_id]), an
error-pattern table (for debug routing), and a pairs/deps adjacency list. Total tokens read
at boot = sum of manifest headers only (~small).

---

## THE MASTER DECISION FLOW (Stages 0-5)

### Stage 0 — Mode Check
Determine the operating mode before anything else. Is this a fresh request, a continuation
of an in-flight project (build order open), or a direct skill invocation? A continuation
short-circuits classification and jumps to the project's current build-order step. See
`skills/rules/routing.md` for the mode-resolution table.

### Stage 1 — Classify Intent
Map the query to exactly one of the **six intents** using the router intent trigger words:

| Intent | Trigger words |
|---|---|
| BUILD | build, create, write, make, implement, generate, add |
| DEBUG | error, fix, crash, broken, fail, exception, traceback, bug, why does |
| LOOKUP | how, what, explain, describe, when, which |
| PROTOTYPE | design, plan, architecture, scaffold, structure |
| TOOL | tool, library, resource, install |
| PROJECT | project, continue, resume, build order |

On a tie, apply intent priority: **PROJECT > DEBUG > BUILD > PROTOTYPE > TOOL > LOOKUP**.
Rationale: an open project overrides everything; a live error outranks new work; new work
outranks planning; planning outranks tooling; a concrete need outranks a passive question.
See `skills/rules/routing.md` for the scoring math and `skills/rules/error_routing.md` for
the DEBUG fast-path.

### Stage 2 — Check Projects
If a build order is active (`prototyping/build_orders/TODO.md` has open steps) the master
resumes it: the next unchecked step names its own skill and domain. PROJECT intent always
flows here. This stage can override the Stage 1 intent when an active project exists — see
`skills/rules/routing.md` and the build-order template.

### Stage 3 — Select Sources (four routing tiers)
Resolve the query to a concrete set of sources via four tiers, in order:

1. **Intent tier** — the six-way classification above picks the *kind* of skill (build vs
   debug vs map vs rules).
2. **Domain tier** — match `triggers.keywords` / `triggers.extensions` / `triggers.languages`
   against the query to pick the domain: `python`, `rust`, or `web_api`. See `maps/` and
   `skills/rules/routing.md`.
3. **Skill-selection tier** — within (intent x domain), select the specific skill_id and pull
   in its `depends_on` and (for build<->debug) its `pairs_with` partner so the partner is
   ready if execution fails.
4. **Anti-failure tier** — attach guards in three classes:
   - *mandatory*: always loaded (e.g. `hallucination_guards`, `tool_execution`, `compliance`).
   - *domain-matched*: the guard for the resolved domain (`python_anti_failure`,
     `rust_anti_failure`, or `web_api_anti_failure`).
   - *context-triggered*: pulled by signals — `context_budget` when the budget crosses
     YELLOW, `scope_lanes` when the task spans domains, `multi_agent` when fan-out is needed,
     `build_integrity` before any ship step.

   See every file under `prototyping/anti_failure/` and `skills/rules/escalation.md`.

### Stage 4 — Resource Check
Before executing a BUILD/PROTOTYPE/TOOL path, consult `tool_repo.md` to confirm the
toolchain the selected skill needs is available (e.g. `cargo` for `rust_build`, `pytest`
for a python test step). Missing tools are reported to the user with install hints rather
than failing mid-build. See `tool_repo.md` and `skills/rules/quality_gates.md`.

### Stage 5 — Execute, Auto-Route-to-Debug, Quality Gates, Deliver
1. **Execute** the selected build/lookup/prototype skill body (now loaded on demand).
2. **On failure, auto-route to debug**: the executing skill's `pairs_with` partner takes the
   error, matched against the boot-time error-pattern table (`skills/rules/error_routing.md`).
   Retry the build step. **Max 3 retries.** After the third failure, invoke the **Abort
   Protocol** (`skills/rules/escalation.md`): stop, summarize what was tried, surface the
   blocking error and the partial artifact, and hand back to the user — never loop silently.
3. **Quality Gates** — run all five before delivery: (1) completeness, (2) correctness,
   (3) safety/anti-failure, (4) citation, (5) compliance. A gate failure routes back to the
   relevant skill or, if unrecoverable, to the Abort Protocol. See
   `skills/rules/quality_gates.md`.
4. **Deliver** — return the artifact plus a citation trail of the skill_ids that produced it
   and the gates passed. Engagement/tone is governed by `skills/rules/engagement.md`.

---

## CONFLICT AUTHORITY (rank 1 wins)

When two sources disagree, the master resolves by rank, never by recency or verbosity:

1 anti-failure rules → 2 user instructions → 3 project files → 4 debug skills →
5 build skills → 6 reference files → 7 pattern libraries → 8 domain maps → 9 resource index.

Full procedure in `skills/rules/conflict_resolution.md`.

---

## CONTEXT BUDGET (of ~200K tokens)

GREEN <40% / YELLOW 40-65% / ORANGE 65-80% / RED >80%. The master checks the budget at
Stage 3 and Stage 5. At YELLOW it attaches `context_budget`; at ORANGE it sheds optional
reference bodies and summarizes; at RED it stops loading new bodies and moves to deliver or
escalate. See `prototyping/anti_failure/context_budget.md` and
`skills/rules/context_management.md`.

## CROSS-REFERENCES
- [routing](skills/rules/routing.md) — intent scoring, domain match, mode resolution (`routing`).
- [error_routing](skills/rules/error_routing.md) — DEBUG fast-path + error-pattern table (`error_routing`).
- [composition](skills/rules/composition.md) — how skills combine into a source set (`composition`).
- [skill_chaining](skills/rules/skill_chaining.md) — sequencing build<->debug and deps (`skill_chaining`).
- [context_management](skills/rules/context_management.md) — budget transitions GREEN→RED (`context_management`).
- [conflict_resolution](skills/rules/conflict_resolution.md) — the 9-rank authority procedure (`conflict_resolution`).
- [escalation](skills/rules/escalation.md) — retries, Abort Protocol, handback (`escalation`).
- [quality_gates](skills/rules/quality_gates.md) — the five delivery gates (`quality_gates`).
- [engagement](skills/rules/engagement.md) — tone and delivery contract (`engagement`).
- [tool_repo](tool_repo.md) — Stage 4 resource index (`tool_repo`).

## END OF SKILL
