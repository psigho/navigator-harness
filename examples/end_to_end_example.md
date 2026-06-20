---
skill_id: example_end_to_end
type: custom
category: null
triggers:
  keywords: [example, walkthrough, end to end, trace, demo, csv, cli]
  languages: [all]
  platforms: [cross]
priority: 7
description: A narrated end-to-end trace of one query through every Navigator decision-flow stage, naming the exact sources selected at each step.
---

# END-TO-END EXAMPLE — "build a python CLI that parses CSV"

This is a single query walked through the master decision flow stage by stage. At each step
we name the **exact sources** the router selects, so the abstract architecture in
`master_skill.md` becomes concrete.

> **Query:** *"build a python CLI that parses CSV"*

---

## STAGE -1 — BOOT (already done this session)
The registry is in memory. Relevant manifests discovered earlier (headers only):
`python_build` (pairs_with `python_debug`, depends_on `python_anti_failure`, `map_python`),
`web_api_build`, `rust_build`, the nine `skills/rules/*`, all `prototyping/anti_failure/*`,
and `map_python`. The keyword index already maps `python`, `py`, `cli`, `script`, `parse`,
`csv` to candidate skills. No bodies are loaded yet.

## STAGE 0 — MODE CHECK
No active build order, no direct skill invocation. -> **Fresh request mode.** Continue to
classification. Source consulted: `skills/rules/routing.md` (mode-resolution table).

## STAGE 1 — CLASSIFY INTENT
Tokenize the query. Matches:
- `build` -> BUILD trigger word.
- no DEBUG words (no error/fix/crash/traceback), no PROTOTYPE words (no design/plan).
- `cli`, `csv`, `parses` carry domain signal but no competing intent.

Single intent fires -> **BUILD**. No tie, so the priority ladder
(PROJECT > DEBUG > BUILD > PROTOTYPE > TOOL > LOOKUP) is not needed. Source:
`skills/rules/routing.md`.

## STAGE 2 — CHECK PROJECTS
`prototyping/build_orders/TODO.md` has no open steps -> no active project to resume. BUILD
intent stands. Sources: `prototyping/build_orders/TODO.md`,
`prototyping/build_orders/BUILD_ORDER_TEMPLATE.md` (in case we choose to scaffold one).

## STAGE 3 — SELECT SOURCES (four tiers)

**Tier 1 — Intent:** BUILD -> we need a `type: build` skill plus its `pairs_with` debug
partner on standby.

**Tier 2 — Domain:** match `triggers` against the query:
- `python`, `py`, `script` hit `python_build.triggers.keywords`; extension `.py` reinforces.
- no `rust`/`cargo` words, no `api`/`http`/`endpoint` words.
-> domain = **python**. Source: `maps/python.md` (`map_python`) for ecosystem context;
`skills/rules/routing.md` for the match math.

**Tier 3 — Skill selection:** within (BUILD x python) select **`python_build`**. Pull its
`depends_on`: `python_anti_failure`, `map_python`. Stage its `pairs_with`: **`python_debug`**
(loaded lazily, ready if execution fails). For the CLI/CSV shape, also attach the relevant
pattern libraries: `prototyping/func_encyclopedia/cli_patterns.md` (argument parsing, exit
codes) and `prototyping/func_encyclopedia/error_handling_patterns.md` (malformed-row handling).

**Tier 4 — Anti-failure:**
- *mandatory*: `hallucination_guards`, `tool_execution`, `compliance`.
- *domain-matched*: `python_anti_failure` (already pulled via depends_on).
- *context-triggered*: budget is GREEN, single domain, no fan-out -> only `build_integrity`
  attaches (it guards the eventual ship/test step). Sources: every file under
  `prototyping/anti_failure/`; `skills/rules/escalation.md`.

Selected source set so far:
`python_build` + `python_debug`(standby) + `map_python` + `python_anti_failure` +
`cli_patterns` + `error_handling_patterns` + `hallucination_guards` + `tool_execution` +
`compliance` + `build_integrity`.

## STAGE 4 — RESOURCE CHECK
Consult `tool_repo.md`. `python_build`'s CLI+test path needs: `python3` (probe
`python3 --version`), `pip`, `venv`, and `pytest` for the test gate; `ruff` for lint. Probe
results: all present -> proceed. If `pytest` were missing, the router would block here and
report `pip install pytest` rather than crash at the test step. Source: `tool_repo.md`;
gate dependency in `skills/rules/quality_gates.md`.

## STAGE 5 — EXECUTE -> GATES -> DELIVER

**Execute** (`python_build` body now loaded on demand): scaffold `csvcli/` with a `src`
layout, a `pyproject.toml` console-script entry point, an `argparse`/`click` command surface
(per `cli_patterns`), a CSV parser using `csv.DictReader` with explicit encoding and a
malformed-row strategy (per `error_handling_patterns`), and a `tests/` file.

**Auto-route-to-debug on failure:** suppose `pytest` reports a `UnicodeDecodeError` on a
sample file. The executing skill's `pairs_with` partner `python_debug` takes the error; the
boot-time error-pattern table matches `UnicodeDecodeError` to the encoding-handling fix; the
build step is patched (explicit `encoding="utf-8-sig"`) and retried. Retry count = 1 of 3.
If three retries failed, the **Abort Protocol** (`skills/rules/escalation.md`) would stop the
loop and hand back the partial artifact + blocking error. Sources:
`skills/rules/error_routing.md`, `python_debug`, `skills/rules/escalation.md`.

**Quality Gates** (`skills/rules/quality_gates.md`):
1. *completeness* — CLI runs, parses, has `--help`, exits non-zero on bad input. PASS.
2. *correctness* — `pytest` green; sample CSV parses to expected rows. PASS.
3. *safety/anti-failure* — `python_anti_failure` checks (no bare `except`, file handles via
   `with`, no shell-injection in path handling). PASS.
4. *citation* — artifact annotated with the skill_ids that produced it. PASS.
5. *compliance* — `compliance` guard confirms scope stayed within "python CLI / CSV". PASS.

**Deliver** (`skills/rules/engagement.md`): return the project tree, the run command, and a
citation trail: produced by `python_build` (+`cli_patterns`, `error_handling_patterns`),
guarded by `python_anti_failure` + mandatory guards, one debug pass via `python_debug`, all
five gates green.

---

## STAGE-TO-SOURCE SUMMARY

| Stage | Decision | Sources named |
|---|---|---|
| -1 Boot | registry built | all manifests (headers) |
| 0 Mode | fresh request | `routing` |
| 1 Intent | BUILD | `routing` |
| 2 Projects | none active | `build_orders/TODO`, `BUILD_ORDER_TEMPLATE` |
| 3 Sources | python_build set | `map_python`, `python_anti_failure`, `cli_patterns`, `error_handling_patterns`, mandatory guards, `build_integrity` |
| 4 Resources | tools present | `tool_repo` |
| 5 Execute/Gates | shipped, 1 debug pass | `python_build`, `python_debug`, `error_routing`, `escalation`, `quality_gates`, `engagement` |

## CROSS-REFERENCES
- [master_skill](../master_skill.md) — the decision flow this traces (`master_skill`).
- [routing](../skills/rules/routing.md) — intent + domain match used in Stages 1-3 (`routing`).
- [routing_examples](../skills/examples/routing_examples.md) — more per-intent traces (`routing_examples`).
- [quality_gates](../skills/rules/quality_gates.md) — the five gates at Stage 5 (`quality_gates`).
- [tool_repo](../tool_repo.md) — the Stage 4 lookup (`tool_repo`).

## END OF SKILL
