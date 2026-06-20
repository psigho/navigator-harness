---
skill_id: conflict_resolution
type: rules
category: engine
triggers:
  keywords: [conflict, authority, precedence, override, rank, disagree, contradiction, wins, tie, resolve]
  error_patterns: ["conflicting instructions", "two skills disagree", "which rule wins", "map disagreement", "version mismatch"]
  languages: [all]
  platforms: [cross]
pairs_with: composition
depends_on: [routing, escalation]
priority: 2
description: The 9-rank authority hierarchy plus seven conflict categories, each with a concrete resolution rule and worked example.
---

# Conflict Resolution Engine

When two sources of guidance disagree, Navigator must resolve deterministically — the
same inputs must always pick the same winner, or the framework is not trustworthy. This
engine defines the **authority hierarchy** (who outranks whom) and the **category rules**
(how to resolve specific *kinds* of disagreement, which is sometimes finer-grained than
raw rank). Rank decides *whose word is law*; the category rules decide *what the law
actually says* when both sources are otherwise peers.

Resolution is never "average the two answers." It is: identify the conflict category,
apply that category's rule, and if the rule defers to rank, the higher rank wins
outright. If rank is tied AND the category rule does not break the tie, the conflict
**escalates** (see `escalation.md`) rather than being guessed.

## 1. The 9-Rank Authority Hierarchy (rank 1 wins)

```
1  anti-failure rules        — safety invariants; never overridden by anything below
2  user instructions         — the operator's explicit standing directives this session
3  project files             — build-order / CLAUDE.md / per-project contracts
4  debug skills              — diagnosis-and-fix skills (outrank build: a fix beats a plan)
5  build skills              — construction skills that emit code
6  reference files           — HTTP codes, stdlib tables, language references
7  pattern libraries         — error-handling patterns, CLI patterns, idioms
8  domain maps               — the per-domain map files that describe a domain's shape
9  resource index            — the tool/library catalog; lowest authority
```

Read literally: a rank-1 anti-failure rule beats a direct user instruction (rank 2) —
the engine will refuse an unsafe instruction rather than execute it, and surface the
refusal. A debug skill (rank 4) overrides a build skill (rank 5) because when a fix and a
construction step collide, the fix is closer to a known-bad symptom. A domain map (rank
8) loses to everything except the resource index — maps describe, they do not command.

Two ranks never collide *as ranks* without a category rule to break the tie, because each
rank holds at most one authoritative source per turn for a given claim. When two sources
share a rank (two build skills, two maps), the category rules below decide.

## 2. The Seven Conflict Categories

Every real conflict falls into one of seven categories. Each has a fixed resolution rule.

### 2.1 Safety conflict
**Rule:** The anti-failure rule wins, unconditionally, regardless of what it conflicts
with — including a direct user instruction. The unsafe action is refused and the refusal
is surfaced with the rule cited. Never silently comply, never silently drop the rule.
**Example:** User says "just disable the input validation to ship faster." The
`web_api_anti_failure` rule forbids unvalidated request bodies on write endpoints. Rank 1
beats rank 2 → the engine keeps validation, explains that the anti-failure rule blocks
removing it, and offers a faster-but-safe path (e.g. a thinner schema) instead.

### 2.2 Correctness conflict
**Rule:** When two sources give technically different *correct-vs-incorrect* answers,
prefer the source with a citation to authoritative reference (rank 6) or a reproducible
test, over the source asserting from memory — even if the asserting source is higher
rank. Correctness is settled by evidence, not seniority; escalate only if neither can
cite. **Example:** A build skill writes `return 200` for a successful POST that creates a
resource; `http_status_reference` (rank 6) states resource creation should be `201`. The
build skill is rank 5, higher than the reference's rank 6 — but this is a correctness
claim with a cited authority. The reference wins; the code becomes `201 Created`.

### 2.3 Style conflict
**Rule:** Style disagreements (naming, formatting, structure with no behavioral
difference) defer to, in order: the project file's stated conventions (rank 3), then the
pattern library (rank 7), then the build skill's default. Never escalate a pure-style
conflict — pick per this order and move on. **Example:** The pattern library uses
`snake_case` for handler names; a build skill template uses `camelCase`. The project file
says nothing. Rank 7 (pattern library) outranks the build skill's bare default for the
*style* dimension → `snake_case` wins. (Had the project file mandated `camelCase`, rank 3
would have won instead.)

### 2.4 Platform conflict
**Rule:** When guidance differs by OS/platform, the source whose `triggers.platforms`
matches the *actual* execution platform wins; a cross-platform source yields to a
platform-specific one for that platform. Detect the platform from the environment, do not
assume. **Example:** A generic CLI pattern says "write temp files to `/tmp`." The active
platform is Windows. The `python_anti_failure` rule notes Windows has no `/tmp`. The
platform-specific rule wins → use `tempfile.gettempdir()` / an explicit Windows path. The
cross-platform default is overridden for this run only.

### 2.5 Version conflict
**Rule:** When two sources assume different versions of a tool/library/language, the
source matching the project's *pinned* version (from the project file or a lockfile) wins.
If no pin exists, prefer the newer documented version and record the assumption in the
session ledger so it can be corrected. Never blend two versions' APIs. **Example:** One
pattern uses `asyncio.get_event_loop()` (pre-3.10 idiom); another uses `asyncio.run()`.
The project pins Python 3.12. The 3.12-compatible source (`asyncio.run()`) wins; the
deprecated idiom is rejected.

### 2.6 Scope conflict
**Rule:** When a skill wants to act outside the task's declared scope lane (e.g. a build
skill starts refactoring unrelated files), the scope boundary wins — the out-of-scope
action is suppressed and, if genuinely useful, flagged for a separate task rather than
performed inline. The narrower, explicitly-scoped instruction beats the broader impulse.
**Example:** Asked to "add one endpoint," a build skill proposes also rewriting the auth
layer it noticed was weak. Scope-lane rule (see `scope_lanes` anti-failure) wins: add the
endpoint only; surface the auth observation as a follow-up, do not perform it.

### 2.7 Map disagreement
**Rule:** When two domain maps (rank 8) — or a map and a build/debug skill — describe a
domain's shape differently, the map loses to any executable source (a skill that actually
ran, a reference with a citation). Between two maps, prefer the one whose domain matches
the active domain exactly over a map borrowed from a neighboring domain. Maps are
advisory cartography, not ground truth; never let a map override a passing test.
**Example:** `map_web_api` shows the request flowing through middleware before routing,
but the actual framework (per its cited docs) routes first, then applies middleware. The
reference-backed framework behavior wins; the map is noted as stale and its summary
corrected in-session.

## 3. Resolution Procedure

```
1. Detect the disagreement and name its category (2.1 – 2.7).
2. Apply that category's rule.
   - If the rule names a winner directly → done.
   - If the rule defers to rank → higher rank (Section 1) wins outright.
3. If rank is tied AND the category rule did not break the tie → escalate
   (escalation.md): surface both positions, ask the user, do NOT guess.
4. Record the resolution in the session ledger so the same conflict
   resolves identically if it recurs this session.
```

Two hard constraints sit above the procedure: (a) a safety conflict (2.1) short-circuits
everything — it is resolved before any other category is even considered; (b) the engine
never fabricates authority to win a conflict (e.g. claiming "the user already approved" to
override a safety rule) — manufactured user-state is itself an anti-failure violation and
must be surfaced.

## 4. Worked End-to-End Example

A turn produces four simultaneous disagreements while writing a `POST /orders` handler:

| # | Disagreement | Category | Winner | Why |
|---|--------------|----------|--------|-----|
| 1 | User: "skip validation"; anti-failure: "validate write bodies" | Safety (2.1) | anti-failure | rank 1 short-circuits |
| 2 | Build skill: `200`; reference: `201` for creation | Correctness (2.2) | reference (`201`) | cited authority beats memory |
| 3 | Pattern lib: `snake_case`; template: `camelCase` | Style (2.3) | pattern lib | rank 7 > build default for style |
| 4 | Map: middleware-then-route; framework docs: route-then-middleware | Map (2.7) | framework docs | executable/cited beats map |

Final handler: validated body (1), returns `201 Created` (2), `snake_case` handler name
(3), wired route-first per the framework (4). Every choice is deterministic and the same
inputs would resolve identically on replay — which is the entire point of the engine.

## CROSS-REFERENCES
- [composition.md](composition.md) — how chained skills declare which source is authoritative for each produced artifact; composition relies on this hierarchy at hand-off boundaries.
- [escalation.md](escalation.md) — invoked when rank is tied and no category rule breaks the tie; the only sanctioned response to a genuine deadlock.
- [../../prototyping/anti_failure/context_budget.md](../../prototyping/anti_failure/context_budget.md) — the rank-1 class that always wins a safety conflict (2.1); see also sibling anti-failure files for domain-specific safety rules.
- [../../master_skill.md](../../master_skill.md) — the orchestrator that invokes this engine whenever two loaded sources disagree.

## END OF SKILL
