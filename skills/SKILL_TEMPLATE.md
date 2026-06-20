---
skill_id: skill_template
type: custom
category: null
triggers:
  keywords: [template, manifest, frontmatter, schema, format, spec, author, new skill]
  languages: [all]
  platforms: [cross]
priority: 8
description: The authoritative manifest-format specification — every frontmatter field, the inline-array rule, the three structural markers, and a filled example.
---

# SKILL TEMPLATE — Authoritative Manifest Spec

Every framework `.md` is a *skill*. The runtime router reads only the YAML frontmatter at
boot, so the frontmatter is **parser-critical**: a malformed header makes the skill
un-routable. This file is the contract every new skill must satisfy.

---

## THE FRONTMATTER FIELDS

The file's first line is a line containing only three dashes. Then the keys below at
column 0. Then a closing three-dash line.

- **skill_id** (REQUIRED) — globally-unique `snake_case` id. Must match the filename stem,
  except domain maps which use `map_<domain>` (e.g. file `maps/python.md` -> `map_python`).
- **type** (REQUIRED) — one of: `build | debug | map | prototype | rules | custom`.
- **category** (optional) — one of:
  `null | anti_failure | dev_ref | func_pattern | wiring | isa | build_order | engine`.
  Use lowercase `null` when there is no category.
- **triggers** (REQUIRED for build/debug/map) — a mapping with these sub-keys, each indented
  EXACTLY two spaces under the `triggers:` line:
  - **keywords** (REQUIRED for build/debug/map) — inline array of routing words.
  - **extensions** (optional) — inline array of file extensions, e.g. `[.py, .rs]`.
  - **error_patterns** (optional; debug skills SHOULD set this) — inline array of
    *literal* substrings seen in real errors, e.g. `["ModuleNotFoundError", "cannot borrow"]`.
  - **languages** (optional) — inline array from `[python, rust, all]`.
  - **platforms** (optional) — inline array from `[linux, win, cross]`.
- **pairs_with** (optional) — partner `skill_id`, used to link a build skill to its debug
  skill (and vice versa) so the router can auto-route to debug on failure.
- **depends_on** (optional) — inline array of prerequisite `skill_id`s loaded alongside this one.
- **priority** (optional) — integer, default `10`. Higher wins ties within a tier.
- **description** (REQUIRED) — one-line statement of purpose.

### THE INLINE-ARRAY RULE (parser-critical)
All arrays MUST be inline bracket form on a single line: `[a, b, c]`. Block-style
`- item` lists inside frontmatter are a **parse error** and the skill will be skipped at
boot. Top-level keys stay at column 0; the trigger sub-keys are indented exactly two
spaces. `category: null` is lowercase.

---

## THE THREE STRUCTURAL MARKERS (every framework .md has all three)

1. **The manifest frontmatter block** at the very top (the fields above).
2. A heading line exactly: `## CROSS-REFERENCES` — followed by markdown links to related
   files (relative paths under `navigator/`), each with a short reason and the partner's
   `skill_id` in backticks.
3. The final content line of the file, exactly: `## END OF SKILL`.

A file missing any marker is non-conformant. README.md is the sole exception — it is plain
docs with no manifest and no markers.

---

## FILLED EXAMPLE MANIFEST (shown indented, not fenced)

The block below is a complete, conformant header for an imagined Python build skill. Copy
its shape exactly — note the column-0 keys, the two-space trigger indent, the inline arrays,
the `pairs_with` link to its debug partner, and the one-line description.

    ---
    skill_id: python_build
    type: build
    category: func_pattern
    triggers:
      keywords: [python, py, pip, venv, pytest, asyncio, pandas, script]
      extensions: [.py]
      languages: [python]
      platforms: [cross]
    pairs_with: python_debug
    depends_on: [python_anti_failure, map_python]
    priority: 10
    description: Build production-grade Python — project layout, venv, packaging, tests.
    ---

And the matching tail every file ends with (the second and third markers):

    ## CROSS-REFERENCES
    - [python_debug](../debug/python_debug.md) — error partner via pairs_with (`python_debug`).
    - [map_python](../../maps/python.md) — domain map of the Python ecosystem (`map_python`).

    ## END OF SKILL

---

## AUTHORING CHECKLIST

- [ ] `skill_id` matches filename stem (or `map_<domain>` for maps).
- [ ] `type` and `description` present; `category` valid or `null`.
- [ ] build/debug/map skills declare `triggers.keywords`.
- [ ] debug skills declare `error_patterns`.
- [ ] every array is inline `[ ]`; no block lists in frontmatter.
- [ ] trigger sub-keys indented exactly two spaces.
- [ ] build<->debug linked via `pairs_with` both ways.
- [ ] `## CROSS-REFERENCES` block present with reasons + skill_ids.
- [ ] last line is exactly `## END OF SKILL`.

## CROSS-REFERENCES
- [master_skill](../master_skill.md) — boot reads exactly these manifests (`master_skill`).
- [routing](rules/routing.md) — how triggers.keywords drive domain match (`routing`).
- [error_routing](rules/error_routing.md) — how error_patterns drive DEBUG routing (`error_routing`).
- [routing_examples](examples/routing_examples.md) — manifests in action across intents (`routing_examples`).

## END OF SKILL
