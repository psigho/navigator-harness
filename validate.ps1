<#
.SYNOPSIS
    Structural validator for the NAVIGATOR framework markdown tree (PowerShell).

.DESCRIPTION
    Scans every *.md file under the navigator/ tree (excluding README.md and the
    public/ subtree) and reports the core structural checks that the live runtime
    also enforces:

      * every framework file carries a manifest frontmatter block
      * every file contains a "## CROSS-REFERENCES" heading
      * every file ends with a "## END OF SKILL" marker
      * every skill_id is globally unique
      * the three demo triplets (python / rust / web_api) are complete
        (build + debug + anti_failure present)
      * every pairs_with reference resolves to a real skill_id

    Prints a per-check pass/fail summary and exits non-zero if any check fails,
    so it can gate CI or a pre-commit hook on Windows.

.NOTES
    Pure PowerShell 5.1+ — no external modules. Run from anywhere; the script
    roots itself at its own folder.
#>

[CmdletBinding()]
param(
    # Root of the navigator tree. When omitted, the script roots itself at the
    # directory that physically contains validate.ps1 (resolved in the body —
    # NOT via a param() default, which binds unreliably in Windows PowerShell
    # 5.1 when a comment-based help block precedes param()).
    [string]$Root
)

$ErrorActionPreference = 'Stop'

# Resolve the script's own directory robustly. $PSScriptRoot is correct when
# the file is dot-sourced or run via -File; $MyInvocation.MyCommand.Path is the
# belt-and-braces fallback. Only fall back to the CWD if both are empty.
if (-not $Root) {
    if ($PSScriptRoot) {
        $Root = $PSScriptRoot
    } elseif ($MyInvocation.MyCommand.Path) {
        $Root = Split-Path -Parent $MyInvocation.MyCommand.Path
    } else {
        $Root = (Get-Location).Path
    }
}
$Root = (Resolve-Path -LiteralPath $Root).Path

Write-Host ""
Write-Host "NAVIGATOR structural validation" -ForegroundColor Cyan
Write-Host "root: $Root"
Write-Host ("-" * 60)

# ---------------------------------------------------------------------------
# Collect candidate files: *.md, excluding README.md and the public/ subtree.
# ---------------------------------------------------------------------------
$publicPath = Join-Path $Root 'public'
$files = Get-ChildItem -LiteralPath $Root -Recurse -File -Filter '*.md' -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -ne 'README.md' -and
        $_.Name -ne 'navigator_ISA.md' -and
        -not $_.FullName.StartsWith($publicPath, [System.StringComparison]::OrdinalIgnoreCase)
    }

if (-not $files -or $files.Count -eq 0) {
    Write-Host "No framework markdown files found under $Root" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# Parse each file: detect manifest, markers, and pull skill_id / type / fields.
# ---------------------------------------------------------------------------
$records = @()
foreach ($f in $files) {
    $text  = Get-Content -LiteralPath $f.FullName -Raw -ErrorAction SilentlyContinue
    if ($null -eq $text) { $text = '' }
    $lines = $text -split "`r?`n"

    # Frontmatter = content between the first two lines that are exactly '---'.
    $delimIdx = @()
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i].Trim() -eq '---') { $delimIdx += $i; if ($delimIdx.Count -eq 2) { break } }
    }
    $hasManifest = ($delimIdx.Count -eq 2)

    $skillId   = $null
    $type      = $null
    $pairsWith = $null

    if ($hasManifest) {
        $fm = $lines[($delimIdx[0] + 1)..($delimIdx[1] - 1)]
        foreach ($l in $fm) {
            if ($l -match '^skill_id:\s*(.+?)\s*$')   { $skillId   = $matches[1].Trim() }
            elseif ($l -match '^type:\s*(.+?)\s*$')    { $type      = $matches[1].Trim() }
            elseif ($l -match '^pairs_with:\s*(.+?)\s*$') { $pairsWith = $matches[1].Trim() }
        }
    }
    if (-not $skillId) { $skillId = [System.IO.Path]::GetFileNameWithoutExtension($f.Name) }

    $hasXref = ($text -match '(?m)^##\s+CROSS-REFERENCES\s*$')
    $hasEnd  = ($text -match '(?m)^##\s+END OF SKILL\s*$')

    $rel = $f.FullName.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')

    $records += [pscustomobject]@{
        Rel         = $rel
        SkillId     = $skillId
        Type        = $type
        PairsWith   = if ($pairsWith -eq 'null') { $null } else { $pairsWith }
        HasManifest = $hasManifest
        HasXref     = [bool]$hasXref
        HasEnd      = [bool]$hasEnd
    }
}

$allIds = $records | ForEach-Object { $_.SkillId }

# ---------------------------------------------------------------------------
# Check helpers.
# ---------------------------------------------------------------------------
$failCount = 0
function Report-Check {
    param([string]$Name, [bool]$Ok, [string]$Detail)
    if ($Ok) {
        Write-Host ("[PASS] {0}" -f $Name) -ForegroundColor Green
    } else {
        Write-Host ("[FAIL] {0}" -f $Name) -ForegroundColor Red
        if ($Detail) { Write-Host ("       {0}" -f $Detail) -ForegroundColor DarkYellow }
        $script:failCount++
    }
}

# 1. Manifests.
$noManifest = $records | Where-Object { -not $_.HasManifest } | ForEach-Object { $_.Rel }
Report-Check "All files have a manifest" ($noManifest.Count -eq 0) ("Missing: " + ($noManifest -join ', '))

# 2. CROSS-REFERENCES.
$noXref = $records | Where-Object { -not $_.HasXref } | ForEach-Object { $_.Rel }
Report-Check "All files have ## CROSS-REFERENCES" ($noXref.Count -eq 0) ("Missing: " + ($noXref -join ', '))

# 3. END OF SKILL.
$noEnd = $records | Where-Object { -not $_.HasEnd } | ForEach-Object { $_.Rel }
Report-Check "All files have ## END OF SKILL" ($noEnd.Count -eq 0) ("Missing: " + ($noEnd -join ', '))

# 4. Unique skill_id.
$dupes = $records | Group-Object SkillId | Where-Object { $_.Count -gt 1 }
$dupeDetail = ($dupes | ForEach-Object { "$($_.Name) x$($_.Count)" }) -join ', '
Report-Check "skill_id values are globally unique" ($dupes.Count -eq 0) ("Duplicates: " + $dupeDetail)

# 5-7. Triplet completeness for the three demo domains.
foreach ($domain in @('python', 'rust', 'web_api')) {
    $hasBuild = $allIds -contains "${domain}_build"
    $hasDebug = $allIds -contains "${domain}_debug"
    $hasAnti  = $allIds -contains "${domain}_anti_failure"
    $missing  = @()
    if (-not $hasBuild) { $missing += 'build' }
    if (-not $hasDebug) { $missing += 'debug' }
    if (-not $hasAnti)  { $missing += 'anti_failure' }
    Report-Check ("Triplet complete: {0}" -f $domain) ($missing.Count -eq 0) ("Missing: " + ($missing -join ', '))
}

# 8. pairs_with resolution.
$idSet = @{}
foreach ($id in $allIds) { $idSet[$id] = $true }
$brokenPairs = @()
foreach ($r in $records) {
    if ($r.PairsWith -and -not $idSet.ContainsKey($r.PairsWith)) {
        $brokenPairs += "$($r.SkillId) -> $($r.PairsWith)"
    }
}
Report-Check "Every pairs_with resolves" ($brokenPairs.Count -eq 0) ("Unresolved: " + ($brokenPairs -join ', '))

# ---------------------------------------------------------------------------
# Summary.
# ---------------------------------------------------------------------------
Write-Host ("-" * 60)
$totalFiles = $records.Count
if ($failCount -eq 0) {
    Write-Host ("OK  -  {0} files scanned, all structural checks passed." -f $totalFiles) -ForegroundColor Green
    exit 0
} else {
    Write-Host ("FAIL - {0} check group(s) failed across {1} files." -f $failCount, $totalFiles) -ForegroundColor Red
    exit 1
}
