---
skill_id: composition
type: rules
category: engine
triggers:
  keywords: [compose, merge, combine, sources, contradiction, dedupe, citation, authority, frankenstein]
  languages: [all]
  platforms: [cross]
pairs_with: conflict_resolution
depends_on: [routing, conflict_resolution]
priority: 4
description: How to merge multiple skill sources into one coherent answer without contradiction, with authority-ranked conflict resolution and citation.
---

# COMPOSITION ENGINE

Composition is the act of fusing the output of more than one selected source — build skill,
debug skill, reference file, anti-failure rule, project file — into a SINGLE coherent
response. The router (see `routing.md`) decides WHICH sources fire; composition decides HOW
their content is woven together so the final answer never contradicts itself, never cites a
file it didn't read, and never silently drops a higher-authority constraint.

Composition runs AFTER source selection and BEFORE the quality gates (`quality_gates.md`).
It is the structural seam where most multi-source failures occur, so it is governed by five
hard rules and guarded against four named anti-patterns.

## THE 5 COMPOSITION CLASSES

A request resolves into exactly one class. The class determines how many sources merge and
in what order their content is laid down.

| Class | Name | Sources merged | Typical trigger |
|---|---|---|---|
| C1 | Single source | 1 skill, verbatim | "how do I open a file in python" |
| C2 | Source + guardrail | 1 build/debug + its anti-failure | "write a python script that reads a CSV" |
| C3 | Reference-augmented | 1 build + N reference/pattern files | "build a FastAPI route returning JSON" |
| C4 | Full build | build + anti-failure + reference + map + examples | "implement a REST API with auth" |
| C5 | Project resume | project file + build order + the active phase's build chain | "continue the CLI tool project" |

- **C1** is a pass-through: the selected skill body is emitted with no merge. Citation is the
  single skill_id. No conflict possible.
- **C2** layers the build/debug skill, then overlays its `pairs_with` anti-failure rule. The
  anti-failure rule outranks the build skill on any overlap (rank 1 vs rank 5).
- **C3** pulls in reference files (`dev_reference/`) and pattern libraries
  (`func_encyclopedia/`) to fill detail the build skill references but does not inline.
- **C4** is the maximal single-turn composition: every layer of the authority hierarchy that
  applies, merged top-down. This is where deduplication and conflict resolution matter most.
- **C5** is stateful: the project file (`build_orders/`) supplies the phase pointer, and the
  current phase's `depends_on` chain is composed as a C4 underneath it. See
  `skill_chaining.md` for the PROJECT-RESUME chain that drives C5.

## AUTHORITY HIERARCHY (rank 1 wins every overlap)

When two sources say different things about the same point, the lower rank number wins. This
is the same 9-rank table the whole framework uses; composition is where it is mechanically
applied during the merge.

1. Anti-failure rules        (`prototyping/anti_failure/*`)
2. User instructions         (the live request + session constraints)
3. Project files             (`prototyping/build_orders/*`)
4. Debug skills              (`skills/debug/*`)
5. Build skills              (`skills/build/*`)
6. Reference files           (`prototyping/dev_reference/*`)
7. Pattern libraries         (`prototyping/func_encyclopedia/*`)
8. Domain maps               (`maps/*`)
9. Resource index            (`tool_repo.md`)

Resolution procedure for an overlapping point:
1. Identify the two (or more) sources asserting different content on the same point.
2. Compare ranks. The lowest rank number is authoritative.
3. Emit the authoritative content. The losing content is DROPPED, not merged.
4. If the drop changes meaning materially, emit a one-line composition note so the reader
   knows a lower-authority alternative existed and why it lost (this is the "no silent
   contradiction" rule made visible).
5. Ties in rank (two build skills, say) escalate to `conflict_resolution.md`; composition
   does not invent a tiebreak.

## THE 5 COMPOSITION RULES

1. **No silent contradiction.** Two merged sources must never produce mutually exclusive
   instructions in the final output. On any overlap, resolve by authority rank and DROP the
   loser; never emit both. If the drop is material, surface a one-line note. A response that
   tells the reader to do X in one paragraph and not-X in another has failed gate 2
   (correctness) and is a composition defect, not a style issue.

2. **Reference-before-generation.** Any factual claim that a reference or pattern file covers
   (HTTP status semantics, stdlib signatures, idiomatic error handling) MUST be sourced from
   that file, not generated from model memory. If the relevant reference file was selected,
   read it and quote it; do not paraphrase from recall. This is the direct mechanism that
   feeds gate 4 (citation) and is the framework's primary hallucination guard at compose
   time.

3. **Cross-reference integrity.** Every `## CROSS-REFERENCES` link a composed source emits
   must point at a file that actually exists in the framework tree and was (or could be)
   loaded. Composition must not synthesize a citation to a file it never opened, and must not
   carry forward a stale link from a source whose target was renamed. A broken or invented
   cross-reference is a phantom citation and fails gate 4.

4. **Deduplication.** When two sources cover the same ground (e.g. both the build skill and
   its anti-failure rule explain venv activation), emit the point ONCE, at the highest
   authority phrasing, and reference rather than repeat. Duplicated content inflates the
   context budget (`context_management.md`) and creates drift risk — two copies that later
   diverge become a silent contradiction.

5. **Citation.** The composed answer ends by naming every source that contributed material,
   by `skill_id`. The reader (and the quality gate) can then audit which files shaped the
   output. A composition that used a source but did not cite it fails gate 4 even if the
   content was correct.

## THE 4 ANTI-PATTERNS

These are the named failure modes composition exists to prevent. Each maps to a rule above.

- **Frankenstein composition.** Stitching fragments from many sources into a body that has no
  single coherent voice or order — steps from the build skill interleaved with unrelated
  reference trivia and half a debug procedure, producing output that technically contains
  everything and coheres as nothing. Guard: pick a class (C1–C5), lay sources down in
  authority order, dedupe. If the merge needs more than ~4 sources to answer one question,
  the router over-selected — narrow scope, do not stitch.

- **Authority inversion.** Letting a lower-authority source override a higher one — e.g. a
  build skill's convenience shortcut silently overriding an anti-failure rule's hard
  prohibition. This is the most dangerous anti-pattern because it defeats the safety layer.
  Guard: the rank table is mechanical; rank 1 always wins; never let "the build skill is more
  specific" rationalize overriding an anti-failure rule.

- **Phantom cross-references.** Emitting links or citations to files that were never read, do
  not exist, or were renamed — manufacturing the appearance of grounding. Guard: cross-
  reference integrity (rule 3); only cite what was loaded; verify the relative path resolves
  under `navigator/`.

- **Source amnesia.** Losing track mid-compose of which source asserted a given point, then
  being unable to cite it or — worse — re-deriving it from memory and introducing a
  contradiction with the source's actual text. Guard: tag each claim with its origin
  skill_id as it is laid down, so the closing citation block is a record, not a reconstruction.

## WORKED MICRO-EXAMPLE (C4)

Request: "implement a REST API endpoint that returns JSON and handle errors."
- Sources selected by router: `web_api_build` (5), `web_api_anti_failure` (1),
  `http_status_reference` (6), `error_handling_patterns` (7), `map_web_api` (8).
- Merge order (authority top-down): anti-failure constraints first (e.g. "never return a
  stack trace in the response body"), then the build skill's endpoint skeleton, then status
  codes pulled verbatim from the reference (rule 2), then the error-handling pattern, deduped
  against anything the build skill already said.
- Overlap: build skill suggests returning 200 with an `error` field; anti-failure rule
  requires correct status codes. Authority inversion guard fires — rank 1 wins, endpoint
  returns 4xx/5xx. One-line note emitted.
- Close: cite all five skill_ids.

## CROSS-REFERENCES

- [routing.md](./routing.md) — decides which sources are selected before composition begins.
- [error_routing.md](./error_routing.md) — supplies the debug skill that composition layers in C2/C4 error-recovery merges.
- [conflict_resolution.md](./conflict_resolution.md) — handles same-rank ties composition cannot break alone (`pairs_with`).
- [quality_gates.md](./quality_gates.md) — gates 2/4/5 audit the composed output for contradiction, citation, and compliance.
- [context_management.md](./context_management.md) — deduplication feeds the budget levels that govern how many sources may merge.
- [../../prototyping/anti_failure/hallucination_guards.md](../../prototyping/anti_failure/hallucination_guards.md) — reference-before-generation is the compose-time arm of the hallucination guard.

## END OF SKILL
