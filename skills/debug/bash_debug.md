---
skill_id: bash_debug
type: debug
triggers:
  keywords: [bash, shell, script, sh, cron, pipe, terminal]
  error_patterns: ["error", "failed", "not working", "unexpected"]
  languages: [all]
pairs_with: bash_build
priority: 10
description: Bash scripting and shell automation -- how to diagnose and fix failures.
---

# DEBUG SKILL -- BASH

Diagnose failures in the bash domain by signature, not by guessing.

## METHOD
1. Capture the exact error or symptom.
2. Match it to a known cause.
3. Form one hypothesis, test it, then the next.
4. Fix the root cause, not the symptom.

## CROSS-REFERENCES
- [skills/build/bash_build.md](skills/build/bash_build.md) -- paired build skill.
- [prototyping/anti_failure/bash_anti_failure.md](prototyping/anti_failure/bash_anti_failure.md) -- the guardrails.

## END OF SKILL