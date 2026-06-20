<#
.SYNOPSIS
  Scaffold a new Navigator domain: build + debug + anti-failure skills + a map.
  Writes the four files with correct manifests and the three structural markers,
  so `validate` stays green and the router picks the domain up on rescan.

.EXAMPLE
  .\new-domain.ps1 -Name bash -Keywords "bash,shell,script,sh,cron" -Description "Bash scripting"

.NOTES
  - UTF-8 WITHOUT BOM (a BOM would break the manifest parser).
  - Refuses to overwrite existing files.
  - Every new domain ships with the rank-1 safety guardrails by default.
#>
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$Keywords = "",
  [string]$Description = ""
)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# --- normalise inputs -------------------------------------------------------
$Name = ($Name.Trim().ToLower() -replace '[^a-z0-9_]', '_')
if ([string]::IsNullOrWhiteSpace($Name)) { Write-Host "Need a -Name." -ForegroundColor Red; exit 1 }
if ([string]::IsNullOrWhiteSpace($Keywords)) { $Keywords = $Name }
$kwList = (($Keywords -split '[,\s]+') | Where-Object { $_ } | ForEach-Object { $_.Trim().ToLower() }) -join ', '
if ([string]::IsNullOrWhiteSpace($Description)) { $Description = "The $Name domain." }
$U = $Name.ToUpper()

# --- file contents ----------------------------------------------------------
$mapMd = @"
---
skill_id: map_$Name
type: map
triggers:
  keywords: [$kwList]
  languages: [all]
  platforms: [cross]
priority: 10
description: $Description -- methodology map.
---

# DOMAIN MAP -- $U

## PHASE FLOW
Scope -> Structure -> Implement -> Test -> Ship.

## PHASE 1 -- SCOPE
Define what you're building and confirm you're authorised to work on the target.

## PHASE 2 -- STRUCTURE
Lay out the components before writing anything.

## PHASE 3 -- IMPLEMENT
Build the smallest working piece first, then expand.

## PHASE 4 -- TEST
Verify against the goal; handle the failure cases.

## PHASE 5 -- SHIP
Package, document, hand off.

## CROSS-REFERENCES
- [skills/build/${Name}_build.md](skills/build/${Name}_build.md) -- how to build in this domain.
- [skills/debug/${Name}_debug.md](skills/debug/${Name}_debug.md) -- how to fix failures.

## END OF SKILL
"@

$buildMd = @"
---
skill_id: ${Name}_build
type: build
triggers:
  keywords: [$kwList]
  languages: [all]
  platforms: [cross]
pairs_with: ${Name}_debug
depends_on: [${Name}_anti_failure]
priority: 10
description: $Description -- how to build.
---

# BUILD SKILL -- $U

How to construct things in the $Name domain. Start from the map's phases, build the
smallest working piece first, and check every fallible step.

## METHOD
1. Restate the goal in one line.
2. Pick the structure (see the map).
3. Implement incrementally.
4. Verify, then expand.

## CROSS-REFERENCES
- [maps/$Name.md](maps/$Name.md) -- the methodology map.
- [skills/debug/${Name}_debug.md](skills/debug/${Name}_debug.md) -- paired debug skill.

## END OF SKILL
"@

$debugMd = @"
---
skill_id: ${Name}_debug
type: debug
triggers:
  keywords: [$kwList]
  error_patterns: ["error", "failed", "not working", "unexpected"]
  languages: [all]
pairs_with: ${Name}_build
priority: 10
description: $Description -- how to diagnose and fix failures.
---

# DEBUG SKILL -- $U

Diagnose failures in the $Name domain by signature, not by guessing.

## METHOD
1. Capture the exact error or symptom.
2. Match it to a known cause.
3. Form one hypothesis, test it, then the next.
4. Fix the root cause, not the symptom.

## CROSS-REFERENCES
- [skills/build/${Name}_build.md](skills/build/${Name}_build.md) -- paired build skill.
- [prototyping/anti_failure/${Name}_anti_failure.md](prototyping/anti_failure/${Name}_anti_failure.md) -- the guardrails.

## END OF SKILL
"@

$antiMd = @"
---
skill_id: ${Name}_anti_failure
type: prototype
category: anti_failure
triggers:
  keywords: [$kwList]
  languages: [all]
pairs_with: ${Name}_build
priority: 10
description: $Description -- failure patterns and rank-1 guardrails.
---

# ANTI-FAILURE -- $U

Rank-1 discipline for the $Name domain. These rules outrank the build/debug skills and
the user's instructions; only an explicit, logged override beats them.

## RULES OF ENGAGEMENT -- red-team discipline (rank-1)
- Authorised scope only: define it in Engagement mode (scope + terrain) before you work, and
  treat anything outside it as off-limits.
- No third-party systems, people, accounts, or data without written authorisation. Ever.
- Responsible disclosure of findings -- don't dump, sell, or weaponise them.

## HARD BOUNDARIES -- absolute; no engagement or scope overrides these
- No sexual content involving minors.
- No facilitation of self-harm or suicide.
- No content built to humiliate, harass, or doxx a real person.
- No blackmail, extortion, or coercion.

## DISCIPLINE
- Stay in scope. If a request is out of scope, say so and stop.
- Cite loaded sources; never invent tools, flags, names, or facts (cite-or-omit).
- Handle every fallible step; report what failed plainly.

## REVIEW CHECKLIST
- [ ] Within scope and authorisation?
- [ ] Every claim traceable to a source?
- [ ] Guardrails honoured?

## CROSS-REFERENCES
- [skills/build/${Name}_build.md](skills/build/${Name}_build.md) -- the paired build skill.
- [prototyping/anti_failure/hallucination_guards.md](prototyping/anti_failure/hallucination_guards.md) -- the global rank-1 guard.

## END OF SKILL
"@

# --- write (no-overwrite, no BOM) ------------------------------------------
$targets = [ordered]@{
  "skills\build\${Name}_build.md"                       = $buildMd
  "skills\debug\${Name}_debug.md"                       = $debugMd
  "prototyping\anti_failure\${Name}_anti_failure.md"    = $antiMd
  "maps\$Name.md"                                        = $mapMd
}

$existing = $targets.Keys | Where-Object { Test-Path -LiteralPath $_ }
if ($existing) {
  Write-Host "Refusing to overwrite existing files:" -ForegroundColor Red
  $existing | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  exit 1
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
foreach ($rel in $targets.Keys) {
  $abs = Join-Path $PSScriptRoot $rel
  $dir = Split-Path -Parent $abs
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($abs, ($targets[$rel] -replace "`r`n", "`n"), $utf8NoBom)
  Write-Host "  + $rel" -ForegroundColor Green
}

Write-Host ""
Write-Host "Domain '$Name' scaffolded (keywords: $kwList)." -ForegroundColor Cyan
Write-Host "Next:"
Write-Host "  1) Rescan  - click the rescan button in the dashboard, or restart the server,"
Write-Host "             or:  Invoke-WebRequest http://localhost:4319/api/rescan | Out-Null"
Write-Host "  2) Ask     - node navigator-agent.js `"<a $Name question>`""
