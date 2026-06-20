#!/usr/bin/env bash
#
# validate.sh — POSIX structural validator for the NAVIGATOR framework tree.
#
# Mirror of validate.ps1. Scans every *.md under the navigator/ tree (excluding
# README.md and the public/ subtree) and reports:
#
#   * every framework file carries a manifest frontmatter block
#   * every file contains a "## CROSS-REFERENCES" heading
#   * every file ends with a "## END OF SKILL" marker
#   * every skill_id is globally unique
#   * the python / rust / web_api triplets are complete (build+debug+anti_failure)
#   * every pairs_with reference resolves to a real skill_id
#
# Prints a per-check pass/fail summary and exits non-zero on any failure, so it
# can gate CI or a pre-commit hook. Pure POSIX sh + coreutils; no node required.
#
# Usage: ./validate.sh [ROOT]   (ROOT defaults to the script's own directory)

set -u

# ---------------------------------------------------------------------------
# Resolve the root directory (defaults to the script location).
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$SCRIPT_DIR}"
ROOT="$(cd "$ROOT" && pwd)"

# Colors (disabled when not a TTY).
if [ -t 1 ]; then
  C_GREEN='\033[0;32m'; C_RED='\033[0;31m'; C_YEL='\033[0;33m'; C_CYAN='\033[0;36m'; C_OFF='\033[0m'
else
  C_GREEN=''; C_RED=''; C_YEL=''; C_CYAN=''; C_OFF=''
fi

printf '\n'
printf '%bNAVIGATOR structural validation%b\n' "$C_CYAN" "$C_OFF"
printf 'root: %s\n' "$ROOT"
printf -- '------------------------------------------------------------\n'

# ---------------------------------------------------------------------------
# Gather candidate files into a temp list (exclude README.md and public/).
# ---------------------------------------------------------------------------
TMPLIST="$(mktemp)"
trap 'rm -f "$TMPLIST" "$IDS_FILE" 2>/dev/null' EXIT

find "$ROOT" -type f -name '*.md' \
  ! -name 'README.md' \
  ! -name 'navigator_ISA.md' \
  ! -path "$ROOT/public/*" \
  | sort > "$TMPLIST"

FILE_COUNT="$(wc -l < "$TMPLIST" | tr -d ' ')"
if [ "$FILE_COUNT" -eq 0 ]; then
  printf '%bNo framework markdown files found under %s%b\n' "$C_RED" "$ROOT" "$C_OFF"
  exit 1
fi

# Accumulators.
MISSING_MANIFEST=""
MISSING_XREF=""
MISSING_END=""
BROKEN_PAIRS=""
IDS_FILE="$(mktemp)"   # one skill_id per line (for uniqueness + resolution)
: > "$IDS_FILE"

# Collect all ids first (needed for pairs_with resolution).
while IFS= read -r f; do
  [ -z "$f" ] && continue
  # skill_id: from the first matching frontmatter line; fall back to filename stem.
  sid="$(grep -m1 -E '^skill_id:[[:space:]]*' "$f" 2>/dev/null | sed -E 's/^skill_id:[[:space:]]*//' | tr -d '\r' | sed -E 's/[[:space:]]+$//')"
  if [ -z "$sid" ]; then
    sid="$(basename "$f" .md)"
  fi
  printf '%s\n' "$sid" >> "$IDS_FILE"
done < "$TMPLIST"

# ---------------------------------------------------------------------------
# Per-file structural checks.
# ---------------------------------------------------------------------------
while IFS= read -r f; do
  [ -z "$f" ] && continue
  rel="${f#"$ROOT"/}"

  # Manifest: count leading '---' delimiter lines (need at least two).
  delim_count="$(awk 'NR<=200 && $0=="---"{c++} END{print c+0}' "$f")"
  if [ "${delim_count:-0}" -lt 2 ]; then
    MISSING_MANIFEST="$MISSING_MANIFEST $rel"
  fi

  # CROSS-REFERENCES heading.
  if ! grep -qE '^##[[:space:]]+CROSS-REFERENCES[[:space:]]*$' "$f"; then
    MISSING_XREF="$MISSING_XREF $rel"
  fi

  # END OF SKILL marker.
  if ! grep -qE '^##[[:space:]]+END OF SKILL[[:space:]]*$' "$f"; then
    MISSING_END="$MISSING_END $rel"
  fi

  # pairs_with resolution.
  pw="$(grep -m1 -E '^pairs_with:[[:space:]]*' "$f" 2>/dev/null | sed -E 's/^pairs_with:[[:space:]]*//' | tr -d '\r' | sed -E 's/[[:space:]]+$//')"
  if [ -n "$pw" ] && [ "$pw" != "null" ]; then
    if ! grep -qxF "$pw" "$IDS_FILE"; then
      sid="$(grep -m1 -E '^skill_id:[[:space:]]*' "$f" 2>/dev/null | sed -E 's/^skill_id:[[:space:]]*//' | tr -d '\r' | sed -E 's/[[:space:]]+$//')"
      [ -z "$sid" ] && sid="$(basename "$f" .md)"
      BROKEN_PAIRS="$BROKEN_PAIRS ${sid}->${pw}"
    fi
  fi
done < "$TMPLIST"

# ---------------------------------------------------------------------------
# Reporting helper.
# ---------------------------------------------------------------------------
FAILS=0
report() {
  # $1 = ok(0/1)  $2 = name  $3 = detail
  if [ "$1" -eq 0 ]; then
    printf '%b[PASS]%b %s\n' "$C_GREEN" "$C_OFF" "$2"
  else
    printf '%b[FAIL]%b %s\n' "$C_RED" "$C_OFF" "$2"
    [ -n "$3" ] && printf '       %b%s%b\n' "$C_YEL" "$3" "$C_OFF"
    FAILS=$((FAILS + 1))
  fi
}

# 1. Manifests.
if [ -n "$MISSING_MANIFEST" ]; then report 1 "All files have a manifest" "Missing:$MISSING_MANIFEST"; else report 0 "All files have a manifest" ""; fi
# 2. CROSS-REFERENCES.
if [ -n "$MISSING_XREF" ]; then report 1 "All files have ## CROSS-REFERENCES" "Missing:$MISSING_XREF"; else report 0 "All files have ## CROSS-REFERENCES" ""; fi
# 3. END OF SKILL.
if [ -n "$MISSING_END" ]; then report 1 "All files have ## END OF SKILL" "Missing:$MISSING_END"; else report 0 "All files have ## END OF SKILL" ""; fi

# 4. Unique skill_id.
DUPES="$(sort "$IDS_FILE" | uniq -d | tr '\n' ' ')"
if [ -n "$(printf '%s' "$DUPES" | tr -d ' ')" ]; then
  report 1 "skill_id values are globally unique" "Duplicates: $DUPES"
else
  report 0 "skill_id values are globally unique" ""
fi

# 5-7. Triplet completeness.
for domain in python rust web_api; do
  miss=""
  grep -qxF "${domain}_build"        "$IDS_FILE" || miss="$miss build"
  grep -qxF "${domain}_debug"        "$IDS_FILE" || miss="$miss debug"
  grep -qxF "${domain}_anti_failure" "$IDS_FILE" || miss="$miss anti_failure"
  if [ -n "$miss" ]; then
    report 1 "Triplet complete: $domain" "Missing:$miss"
  else
    report 0 "Triplet complete: $domain" ""
  fi
done

# 8. pairs_with resolution.
if [ -n "$BROKEN_PAIRS" ]; then
  report 1 "Every pairs_with resolves" "Unresolved:$BROKEN_PAIRS"
else
  report 0 "Every pairs_with resolves" ""
fi

# ---------------------------------------------------------------------------
# Summary.
# ---------------------------------------------------------------------------
printf -- '------------------------------------------------------------\n'
if [ "$FAILS" -eq 0 ]; then
  printf '%bOK  -  %s files scanned, all structural checks passed.%b\n' "$C_GREEN" "$FILE_COUNT" "$C_OFF"
  exit 0
else
  printf '%bFAIL - %s check group(s) failed across %s files.%b\n' "$C_RED" "$FAILS" "$FILE_COUNT" "$C_OFF"
  exit 1
fi
