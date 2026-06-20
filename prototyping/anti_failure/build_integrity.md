---
skill_id: build_integrity
type: prototype
category: anti_failure
triggers:
  keywords: [build, multi-file, interface, import, signature, orphan, reference, consistency, refactor, module, contract]
  error_patterns: ["ImportError", "ModuleNotFoundError", "undefined reference", "cannot find symbol", "NameError", "no method named", "unresolved import"]
  languages: [all]
  platforms: [cross]
priority: 4
description: Keep a multi-file build internally consistent — shared interfaces match, every reference resolves, no orphaned or dangling symbols.
---

# BUILD INTEGRITY

An **anti-failure rule** (conflict rank 1) that governs builds spanning more than one file.
A single file can be locally perfect and the project still be broken because file A imports
a name file B never exported, or two files disagree on a function's signature. Build
integrity is the property that the whole set of files *fits together*: every cross-file
reference resolves, every shared contract is honored on both sides, and nothing dangles.

## WHY THIS EXISTS

The framework writes files one at a time, often across parallel builder agents. Each agent
sees its own file clearly and the others only through their declared interfaces. Drift is
the default outcome unless something actively checks the seams. The failure mode is
insidious: each file passes its own review, the build only breaks when the pieces are
assembled. By then the cause is three files away from the symptom.

## THE INTEGRITY INVARIANTS

A build is integral when ALL of these hold:

1. **Every import resolves.** Each `import x` / `use y` / `require(z)` names something that
   actually exists and is actually exported by the target.
2. **Signatures match at every call site.** A function called with N args is defined to take
   N args (accounting for defaults/variadics). Return shapes match what callers destructure.
3. **No orphaned definitions.** A public symbol that nothing references is either dead code
   to remove or a wiring gap to fix — flag it, never leave it ambiguous.
4. **No dangling references.** A referenced symbol that nothing defines is a hard error,
   not a "TODO later".
5. **Shared types agree.** If files A and B both touch a record/struct/dict shape, they
   agree on field names and types. One canonical definition, imported — never re-declared.
6. **One source of truth per constant.** Config keys, route paths, error codes, and version
   strings live in exactly one place and are imported, not copy-pasted.

## THE SEAM MAP

Before writing a multi-file build, enumerate the **seams** — every place where one file
depends on another. For each seam record: the *provider* file + exported symbol, the
*consumer* file + the reference, and the *contract* (signature / type / shape). The seam map
is the checklist you verify against at the end. A seam with a provider but no consumer is a
candidate orphan; a consumer with no provider is a dangling reference.

```
seam: parse_config  (provider: config.py::load → dict[str,str])
                     (consumer:  app.py imports load, calls load(path))
                     (contract:  load(path: str) -> dict[str, str])
```

## VERIFICATION SWEEP (run before declaring a build done)

- **Static resolve.** For each import/use across the build, confirm the named symbol is
  defined and exported in the target file. Walk the seam map top to bottom.
- **Call-site arity check.** For each cross-file call, match arg count and keyword names to
  the definition.
- **Orphan scan.** List every public symbol; for each, confirm at least one reference
  (or an explicit "public API, intentionally unreferenced" note).
- **Type-shape diff.** For each shared record, diff field sets across the files that touch it.
- **Constant dedup.** Grep for any literal that appears in 2+ files (routes, keys, codes);
  collapse to one import.

This sweep is mechanical and cheap — it is the multi-file analogue of a compiler's link
step. The framework runs it even for interpreted languages where the runtime would not
catch the break until the offending line executes.

## INTERACTION WITH PARALLEL BUILDERS

When multiple builder agents write concurrently, each agent owns a file but NOT the seams it
shares. The seam map is the shared contract. An agent that changes an exported signature
must treat it as breaking every consumer of that seam — either it updates them or it leaves
the interface stable. "I made my file better" is not a defense if it broke a seam another
agent depends on. This is the build-time face of scope_lanes.md: stay inside your file's
declared interface.

## QUALITY-GATE BINDING

Build integrity is the substance of quality gate 1 (completeness) and gate 2 (correctness):
a build with a dangling reference is incomplete, and one with a signature mismatch is
incorrect. A build cannot pass those gates with an unresolved seam. See quality_gates.md.

## CROSS-REFERENCES
- [quality_gates.md](../../skills/rules/quality_gates.md) — gates 1 (completeness) and 2 (correctness) are satisfied by the integrity invariants.
- [escalation.md](../../skills/rules/escalation.md) — an unresolvable seam (consumer with no possible provider) is an escalation, not a guess.
- [conflict_resolution.md](../../skills/rules/conflict_resolution.md) — when two files disagree on a contract, this rank-1 rule forces one canonical definition.
- [tool_execution.md](./tool_execution.md) — the execution ledger records which files were written, feeding the orphan/dangling scan.
- [scope_lanes.md](./scope_lanes.md) — parallel builders honor seam contracts rather than reshaping shared interfaces.

## END OF SKILL
