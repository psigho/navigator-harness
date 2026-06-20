---
skill_id: compliance
type: prototype
category: anti_failure
triggers:
  keywords: [compliance, standard, convention, style, lint, format, spec, idiom, pep8, clippy, contract, deliver]
  error_patterns: ["does not conform", "lint error", "style violation", "convention mismatch", "schema invalid", "failed validation"]
  languages: [all]
  platforms: [cross]
priority: 4
description: Meet domain-specific standards, conventions, and contracts before delivery — match the ecosystem's idioms and the project's stated rules.
---

# COMPLIANCE

An **anti-failure rule** (conflict rank 1) governing the final question before any deliverable
ships: *does this conform to the standards that apply to it?* Code that works but ignores the
ecosystem's conventions, the project's stated rules, or the relevant domain standard is a
liability — it passes locally and fails the moment it meets the rest of the world.

## WHY THIS EXISTS

Every domain has a contract beyond "it runs". Python has PEP 8 and PEP 257; Rust has rustfmt
and clippy idioms; REST APIs have status-code semantics and content-type expectations; a
given project has its own AGENT_NOTES rules, naming schemes, and house style. A deliverable
that violates these costs the reviewer time, fails CI, or — for standards with real teeth
(security, accessibility, data-format) — actively breaks downstream consumers. Compliance is
the difference between "I produced output" and "I produced output that fits where it must go".

## THE COMPLIANCE LAYERS

Check conformance at four layers, narrowest authority last (later layers override earlier):

1. **Language idiom** — the ecosystem's normative style and lint rules.
   Python: PEP 8 (style), PEP 257 (docstrings), type hints where the project uses them.
   Rust: `cargo fmt` clean, `cargo clippy` clean, `Result`/`?` over panics in libraries.
   Web API: correct HTTP verbs and status codes, JSON content-types, consistent error shape.
2. **Project convention** — the house rules in the project's own docs (AGENT_NOTES.md,
   CONTRIBUTING, existing-code patterns). Match the surrounding code's naming, layout, and
   import ordering even when language idiom would allow otherwise.
3. **Interface contract** — declared schemas, API specs, function signatures other code
   depends on (this overlaps build_integrity.md's seam contracts).
4. **Domain standard** — format specs (JSON Schema, OpenAPI), security baselines, and
   accessibility requirements where the domain mandates them.

When two layers conflict, the more specific authority wins: project convention overrides bare
language idiom; a declared interface contract overrides project convention.

## PRE-DELIVERY CONFORMANCE SWEEP

Run before declaring any deliverable done:

- **Format clean.** The formatter for the language would make no changes (`black --check`,
  `cargo fmt --check`, prettier). If you can't run it, format to its known rules by hand.
- **Lint clean.** No lint errors at the project's configured level. Warnings either fixed or
  explicitly justified.
- **Convention match.** Naming, file layout, import order, and docstring style match the
  surrounding code, not your default.
- **Contract honored.** Signatures, schemas, and status codes match what consumers expect.
- **Standard satisfied.** Any applicable format/security/accessibility standard validated
  (schema validates, no obvious injection surface, semantic HTML where relevant).

## CONFORMANCE IS NOT COSMETIC

Some conventions look like style but carry correctness:
- HTTP status codes are a contract — returning `200` on an error breaks every client that
  checks status (see web_api_anti_failure / web_api maps).
- A JSON field named in the schema but absent in the payload silently breaks consumers.
- A library that panics where the ecosystem expects a `Result` is a different, worse API.
Treat these as correctness violations (quality gate 2), not just compliance polish.

## WHAT COMPLIANCE DOES NOT MEAN

It does not mean gold-plating or inventing rules the project never stated — that is its own
scope-creep failure (see scope_lanes.md). Apply the standards that *actually govern* this
deliverable, at the project's stated level. If a project has no stated style, default to the
language idiom (layer 1) and the surrounding code, not to a stricter regime of your own.

## QUALITY-GATE BINDING

This skill is the enforcement arm of quality gate 5 (compliance) and reinforces gate 4
(citation — claims about "the standard says X" must reference the actual standard). A
deliverable that fails the conformance sweep fails gate 5 and must not be presented as done.
See quality_gates.md.

## CROSS-REFERENCES
- [quality_gates.md](../../skills/rules/quality_gates.md) — gate 5 (compliance) and gate 4 (citation) are enforced by the conformance sweep.
- [escalation.md](../../skills/rules/escalation.md) — when the applicable standard is unknown or two standards genuinely conflict, escalate rather than pick arbitrarily.
- [conflict_resolution.md](../../skills/rules/conflict_resolution.md) — the layered authority order (project > idiom) mirrors the 9-rank conflict resolution.
- [build_integrity.md](./build_integrity.md) — interface-contract compliance overlaps with seam-contract integrity.
- [scope_lanes.md](./scope_lanes.md) — apply only the standards that govern the requested deliverable; do not invent extra rules.

## END OF SKILL
