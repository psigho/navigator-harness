'use strict';
/*
 * navigator-server.js
 * ------------------------------------------------------------------------
 * NAVIGATOR FRAMEWORK — zero-dependency runtime backend (Node core only).
 *
 * This single file implements:
 *   - A recursive *.md scanner over the navigator/ tree (excluding README.md
 *     and anything under public/).
 *   - A small, tolerant YAML-frontmatter parser for the Navigator manifest
 *     schema (column-0 keys + 2-space-indented sub-keys under "triggers:",
 *     inline bracket arrays, null, integers, strings).
 *   - An in-memory registry built at startup, with a re-scan endpoint.
 *   - A data-driven router that classifies intent, matches domains, picks
 *     build/debug skills, layers anti-failure tiers, checks resources,
 *     builds an execution chain, and evaluates the 5 quality gates.
 *   - A context-budget model (200K tokens; reserved + loaded; GREEN/YELLOW/
 *     ORANGE/RED).
 *   - A build-order parser (## Phase N: Title (STATUS) + - [x]/- [ ] steps).
 *   - An engagement-mode passphrase gate.
 *   - The full set of 27 structural validation checks.
 *
 * No external packages. Node v18+ (developed against v24). Robust against
 * malformed files: a single bad manifest never crashes the scan.
 *
 * Routes:
 *   GET  /                       -> public/index.html
 *   GET  /app.js                 -> public/app.js
 *   GET  /styles.css             -> public/styles.css
 *   GET  /api/health
 *   GET  /api/registry
 *   GET  /api/route?q=QUERY
 *   GET  /api/validate
 *   GET  /api/context?load=id1,id2
 *   GET  /api/build-orders
 *   GET  /api/raw?id=SKILL_ID
 *   POST /api/engagement/activate
 *   GET  /api/rescan            (convenience: rebuild the registry)
 * ------------------------------------------------------------------------
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const isa = require('./navigator-isa');     // ISA virtual machine (EXEC opcode)

// ----------------------------------------------------------------------------
// Constants & paths
// ----------------------------------------------------------------------------

const ROOT = __dirname;                          // navigator/
const PUBLIC_DIR = path.join(ROOT, 'public');
const DEFAULT_PORT = Number(process.env.PORT) || 4319;
const PORT_TRIES = 6;                             // default + 5 fallbacks
const TOTAL_BUDGET = 200000;                      // context window tokens

// Intent trigger-word tables. These mirror the router contract exactly.
const INTENT_WORDS = {
  PROJECT:   ['project', 'continue', 'resume', 'build order'],
  DEBUG:     ['error', 'fix', 'crash', 'broken', 'fail', 'exception', 'traceback', 'bug', 'why does'],
  BUILD:     ['build', 'create', 'write', 'make', 'implement', 'generate', 'add'],
  PROTOTYPE: ['design', 'plan', 'architecture', 'scaffold', 'structure'],
  TOOL:      ['tool', 'library', 'resource', 'install'],
  LOOKUP:    ['how', 'what', 'explain', 'describe', 'when', 'which'],
};

// Tie-break priority (lower index == wins on equal score).
const INTENT_PRIORITY = ['PROJECT', 'DEBUG', 'BUILD', 'PROTOTYPE', 'TOOL', 'LOOKUP'];

// Domains are DERIVED from the scanned map_* files, not hardcoded — so a newly
// scaffolded domain (new-domain.ps1) becomes routable on the next rescan with
// no code change. Falls back to the demo domains before the first scan.
const DEMO_DOMAINS = ['python', 'rust', 'web_api'];
function getDomains() {
  if (!REGISTRY || !REGISTRY.skills) return DEMO_DOMAINS;
  const out = [];
  for (const s of REGISTRY.skills) {
    if (s.type === 'map' && /^map_/.test(s.skill_id)) out.push(s.skill_id.slice(4));
  }
  return out.length ? out : DEMO_DOMAINS;
}

// The 9-rank conflict authority ladder (rank 1 wins).
const CONFLICT_LADDER = [
  'anti-failure rules',
  'user instructions',
  'project files',
  'debug skills',
  'build skills',
  'reference files',
  'pattern libraries',
  'domain maps',
  'resource index',
];

// The 5 quality gates.
const QUALITY_GATES = ['completeness', 'correctness', 'safety (anti-failure)', 'citation', 'compliance'];

// Anti-failure skills that are ALWAYS mandatory regardless of query.
const MANDATORY_ANTI_FAILURE = ['hallucination_guards'];

// Rules-engine files that must exist (checks 9-17).
const RULES_FILES = [
  'routing', 'error_routing', 'composition', 'skill_chaining',
  'context_management', 'conflict_resolution', 'escalation',
  'quality_gates', 'engagement',
];

// MIME types for the static surface.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ----------------------------------------------------------------------------
// In-memory registry (rebuilt by scan()).
// ----------------------------------------------------------------------------

let REGISTRY = {
  scannedAt: null,
  skills: [],          // parsed manifest records
  bySkillId: new Map(),
  byRelpath: new Map(),
};

// ----------------------------------------------------------------------------
// Filesystem helpers
// ----------------------------------------------------------------------------

/**
 * Recursively walk a directory and yield every *.md file path.
 * Skips the public/ subtree entirely. Never throws on a bad entry.
 */
function walkMarkdown(dir, acc) {
  acc = acc || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return acc; // unreadable dir -> skip silently
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      // Never descend into public/.
      if (path.resolve(full) === path.resolve(PUBLIC_DIR)) continue;
      // Skip dot-dirs (e.g. .git, .claude) to keep the scan clean.
      if (ent.name.startsWith('.')) continue;
      walkMarkdown(full, acc);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
      // README.md and navigator_ISA.md are documentation, not framework skills.
      if (ent.name === 'README.md' || ent.name === 'navigator_ISA.md') continue;
      acc.push(full);
    }
  }
  return acc;
}

/** Convert an absolute path to a posix relpath under navigator/. */
function toRelpath(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

// ----------------------------------------------------------------------------
// Manifest frontmatter parser
// ----------------------------------------------------------------------------

/**
 * Parse a single scalar/array value token from the frontmatter.
 *   "[a, b, c]" -> ['a','b','c']  (quotes stripped, items trimmed)
 *   "null"      -> null
 *   "10"        -> 10  (integer)
 *   anything    -> trimmed string
 */
function parseValue(raw) {
  const v = (raw || '').trim();
  if (v === '') return '';
  if (v === 'null') return null;
  if (v.startsWith('[')) {
    // Inline bracket array. Strip the brackets and split on commas.
    const inner = v.replace(/^\[/, '').replace(/\]$/, '');
    if (inner.trim() === '') return [];
    return inner.split(',').map((item) => {
      let t = item.trim();
      // Strip surrounding single or double quotes.
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        t = t.slice(1, -1);
      }
      return t;
    }).filter((s) => s.length > 0);
  }
  // Pure integer?
  if (/^-?\d+$/.test(v)) return Number(v);
  // Strip surrounding quotes on a scalar string.
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Extract and parse the manifest frontmatter from a markdown body.
 * Frontmatter is delimited by the first two lines that are EXACTLY '---'.
 * Returns { manifest, hasManifest } where manifest carries the schema fields.
 * Tolerant: unknown keys are kept; malformed lines are skipped.
 */
function parseManifest(body) {
  const lines = body.split(/\r?\n/);
  // Locate the two delimiter lines.
  let firstDelim = -1;
  let secondDelim = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (firstDelim === -1) {
        firstDelim = i;
      } else {
        secondDelim = i;
        break;
      }
    } else if (firstDelim === -1 && lines[i].trim() !== '') {
      // Content before any delimiter means there's no leading frontmatter.
      break;
    }
  }
  if (firstDelim === -1 || secondDelim === -1) {
    return { manifest: emptyManifest(), hasManifest: false };
  }

  const fm = lines.slice(firstDelim + 1, secondDelim);
  const manifest = emptyManifest();
  const triggers = { keywords: [], extensions: [], error_patterns: [], languages: [], platforms: [] };
  let inTriggers = false;

  for (const line of fm) {
    if (line.trim() === '') continue;
    // A 2-space-indented sub-key only counts while inside "triggers:".
    const isIndented = /^\s{2}\S/.test(line) && !/^\s{2}\s/.test(line.replace(/^\s{2}/, '$&'));
    const indentMatch = line.match(/^(\s*)(\S[^:]*):\s*(.*)$/);
    if (!indentMatch) continue;
    const indent = indentMatch[1].length;
    const key = indentMatch[2].trim();
    const rawVal = indentMatch[3];

    if (indent === 0) {
      inTriggers = (key === 'triggers');
      if (key === 'triggers') {
        // Sub-keys follow on indented lines.
        continue;
      }
      // Top-level scalar/array key.
      manifest[key] = parseValue(rawVal);
    } else if (inTriggers && indent === 2) {
      // Trigger sub-key.
      triggers[key] = parseValue(rawVal);
    }
    // Deeper indentation is ignored (schema forbids it).
  }

  manifest.triggers = normalizeTriggers(triggers);
  return { manifest, hasManifest: true };
}

function emptyManifest() {
  return {
    skill_id: null,
    type: null,
    category: null,
    triggers: { keywords: [], extensions: [], error_patterns: [], languages: [], platforms: [] },
    pairs_with: null,
    depends_on: [],
    priority: 10,
    description: null,
  };
}

/** Ensure every trigger field is an array (never undefined/scalar). */
function normalizeTriggers(t) {
  const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [String(x)]);
  return {
    keywords: arr(t.keywords),
    extensions: arr(t.extensions),
    error_patterns: arr(t.error_patterns),
    languages: arr(t.languages),
    platforms: arr(t.platforms),
  };
}

// ----------------------------------------------------------------------------
// Structural markers
// ----------------------------------------------------------------------------

function hasCrossRefs(body) {
  return /^##\s+CROSS-REFERENCES\s*$/m.test(body);
}
function hasEndMarker(body) {
  return /^##\s+END OF SKILL\s*$/m.test(body);
}

// ----------------------------------------------------------------------------
// Scan: build the registry
// ----------------------------------------------------------------------------

function scan() {
  const files = walkMarkdown(ROOT, []);
  const skills = [];
  const bySkillId = new Map();
  const byRelpath = new Map();

  for (const abs of files) {
    let body = '';
    try {
      body = fs.readFileSync(abs, 'utf8');
    } catch (_) {
      continue; // unreadable file -> skip
    }
    let parsed;
    try {
      parsed = parseManifest(body);
    } catch (_) {
      parsed = { manifest: emptyManifest(), hasManifest: false };
    }
    const m = parsed.manifest;
    const relpath = toRelpath(abs);
    const bytes = Buffer.byteLength(body, 'utf8');
    const lines = body.split(/\r?\n/).length;

    // Fall back to the filename stem if skill_id is missing (keeps the row
    // visible in the registry; validation will flag the missing manifest).
    const stem = path.basename(abs, '.md');

    const record = {
      skill_id: m.skill_id || stem,
      type: m.type || null,
      category: (m.category === undefined ? null : m.category),
      triggers: m.triggers,
      pairs_with: m.pairs_with || null,
      depends_on: Array.isArray(m.depends_on) ? m.depends_on : (m.depends_on ? [m.depends_on] : []),
      priority: typeof m.priority === 'number' ? m.priority : 10,
      description: m.description || null,
      manifest_status: m.status || null,
      relpath,
      lines,
      bytes,
      hasManifest: parsed.hasManifest,
      hasCrossRefs: hasCrossRefs(body),
      hasEndMarker: hasEndMarker(body),
      _abs: abs,
      _body: body,
    };
    skills.push(record);
    // First writer wins for the id map; duplicates handled by validation.
    if (!bySkillId.has(record.skill_id)) bySkillId.set(record.skill_id, record);
    byRelpath.set(relpath, record);
  }

  REGISTRY = { scannedAt: new Date().toISOString(), skills, bySkillId, byRelpath };
  return REGISTRY;
}

/** Accessors injected into the ISA virtual machine (and used by the CLI agent). */
function getRegistry() { return REGISTRY; }
function getSkill(id) {
  return REGISTRY && REGISTRY.bySkillId ? (REGISTRY.bySkillId.get(id) || null) : null;
}
/** The dependency bundle the ISA interpreter needs to run a query. */
function isaDeps() {
  return { getRegistry, getSkill, classifyIntent, matchDomains, getEngagement };
}

// ----------------------------------------------------------------------------
// Registry stats & triplets
// ----------------------------------------------------------------------------

/** Find a domain's build/debug/anti-failure skill by convention. */
function findDomainTriplet(domain) {
  const skills = REGISTRY.skills;
  const build = skills.find((s) => s.skill_id === `${domain}_build`) || null;
  const debug = skills.find((s) => s.skill_id === `${domain}_debug`) || null;
  const anti = skills.find((s) => s.skill_id === `${domain}_anti_failure`) || null;
  return {
    domain,
    build: build ? build.skill_id : null,
    debug: debug ? debug.skill_id : null,
    antiFailure: anti ? anti.skill_id : null,
    complete: !!(build && debug && anti),
  };
}

function buildStats() {
  const skills = REGISTRY.skills;
  const byType = {};
  for (const s of skills) {
    const t = s.type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
  }
  const antiFailureCount = skills.filter((s) => s.category === 'anti_failure').length;
  const mapCount = skills.filter((s) => s.type === 'map').length;
  const rulesCount = skills.filter((s) => s.type === 'rules').length;
  const triplets = getDomains().map(findDomainTriplet);
  const tripletComplete = triplets.filter((t) => t.complete).length;

  return {
    stats: {
      totalFiles: skills.length,
      byType,
      antiFailureCount,
      mapCount,
      rulesCount,
      tripletComplete,
      tripletTotal: getDomains().length,
    },
    triplets,
  };
}

/** Public registry payload (strips internal _abs/_body fields). */
function registryPayload() {
  const { stats, triplets } = buildStats();
  const skills = REGISTRY.skills.map(publicSkill);
  return { stats, skills, triplets };
}

function publicSkill(s) {
  return {
    skill_id: s.skill_id,
    type: s.type,
    category: s.category,
    triggers: s.triggers,
    pairs_with: s.pairs_with,
    depends_on: s.depends_on,
    priority: s.priority,
    description: s.description,
    relpath: s.relpath,
    lines: s.lines,
    bytes: s.bytes,
    hasCrossRefs: s.hasCrossRefs,
    hasEndMarker: s.hasEndMarker,
  };
}

// ----------------------------------------------------------------------------
// Tokenizer for query matching
// ----------------------------------------------------------------------------

function tokenize(q) {
  return (q || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// ----------------------------------------------------------------------------
// Router: the heart of the data-driven decision engine
// ----------------------------------------------------------------------------

function classifyIntent(query) {
  const q = (query || '').toLowerCase();
  const tokens = new Set(tokenize(query));
  const candidates = [];

  for (const intent of Object.keys(INTENT_WORDS)) {
    const matched = [];
    for (const w of INTENT_WORDS[intent]) {
      // Multi-word triggers ("build order", "why does") matched as substrings.
      if (w.includes(' ')) {
        if (q.includes(w)) matched.push(w);
      } else if (tokens.has(w)) {
        matched.push(w);
      }
    }
    candidates.push({ intent, score: matched.length, matched });
  }

  // Sort: higher score first; ties broken by stated priority order.
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return INTENT_PRIORITY.indexOf(a.intent) - INTENT_PRIORITY.indexOf(b.intent);
  });

  // If nobody matched, default to LOOKUP (the lowest-commitment intent).
  const top = candidates[0];
  const selected = top && top.score > 0 ? top.intent : 'LOOKUP';
  return { selected, candidates };
}

/**
 * Match query tokens against the keyword sets of scanned map + build skills
 * for each domain. Returns a scored, sorted list of matched domains.
 */
function matchDomains(query) {
  const tokens = new Set(tokenize(query));
  const out = [];

  for (const domain of getDomains()) {
    // Gather the domain's keyword vocabulary from its map + build skills.
    const vocab = new Set();
    const sources = REGISTRY.skills.filter((s) => {
      if (s.type === 'map' && s.skill_id === `map_${domain}`) return true;
      if (s.type === 'build' && s.skill_id === `${domain}_build`) return true;
      return false;
    });
    for (const s of sources) {
      for (const k of s.triggers.keywords) vocab.add(k.toLowerCase());
    }
    // The domain name itself always counts as a keyword.
    vocab.add(domain.toLowerCase());

    const matched = [];
    for (const kw of vocab) {
      // Keyword may be multi-token; match if any of its tokens appear.
      const parts = kw.split(/\s+/);
      if (parts.some((p) => tokens.has(p))) matched.push(kw);
    }
    if (matched.length > 0) {
      out.push({ domain, score: matched.length, matched: [...new Set(matched)] });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Detect a project-resume signal and resolve a build-order id if present. */
function checkProject(query, intent) {
  const q = (query || '').toLowerCase();
  const projectSignals = ['project', 'continue', 'resume', 'build order'];
  const matched = projectSignals.some((w) => q.includes(w)) || intent === 'PROJECT';
  let id = null;
  if (matched) {
    // Resolve to a real project build-order under the canonical directory,
    // preferring an actual project file over the template.
    const order = findProjectBuildOrder();
    id = order ? order.skill_id : null;
  }
  return { matched, id };
}

/**
 * Anti-failure tiering:
 *   mandatory      -> always-on guardrails (hallucination_guards).
 *   domainMatched  -> the top matched domain's anti_failure skill.
 *   contextTriggered -> context_budget for long/multi-source queries;
 *                       scope_lanes for broad queries.
 */
function antiFailureTier(query, domains, sources) {
  const has = (id) => REGISTRY.bySkillId.has(id) || REGISTRY.skills.some((s) => s.skill_id === id);
  const mandatory = MANDATORY_ANTI_FAILURE.filter(has);

  const domainMatched = [];
  if (domains.length > 0) {
    const id = `${domains[0].domain}_anti_failure`;
    if (has(id)) domainMatched.push(id);
  }

  const contextTriggered = [];
  const tokenCount = tokenize(query).length;
  const sourceCount =
    sources.maps.length + sources.antiFailure.length + sources.references.length +
    sources.patterns.length + (sources.buildSkill ? 1 : 0) + (sources.debugSkill ? 1 : 0);
  const longOrMultiSource = tokenCount >= 12 || sourceCount >= 4;
  const broad = domains.length >= 2 || tokenCount >= 16;

  if (longOrMultiSource && has('context_budget')) contextTriggered.push('context_budget');
  if (broad && has('scope_lanes')) contextTriggered.push('scope_lanes');

  return { mandatory, domainMatched, contextTriggered };
}

/** Resolve the source skills (maps, build, debug, references, patterns). */
function selectSources(intent, domains, project) {
  const maps = [];
  let buildSkill = null;
  let debugSkill = null;
  const antiFailure = [];
  const references = [];
  const patterns = [];

  const topDomain = domains.length ? domains[0].domain : null;

  // Domain maps for every matched domain.
  for (const d of domains) {
    const mapId = `map_${d.domain}`;
    if (REGISTRY.skills.some((s) => s.skill_id === mapId)) maps.push(mapId);
  }

  if (topDomain) {
    const build = REGISTRY.skills.find((s) => s.skill_id === `${topDomain}_build`);
    const debug = REGISTRY.skills.find((s) => s.skill_id === `${topDomain}_debug`);

    if (intent === 'DEBUG') {
      debugSkill = debug ? debug.skill_id : null;
      // Pull in the paired build skill for context if declared.
      if (debug && debug.pairs_with && REGISTRY.skills.some((s) => s.skill_id === debug.pairs_with)) {
        buildSkill = debug.pairs_with;
      } else if (build) {
        buildSkill = build.skill_id;
      }
    } else if (intent === 'BUILD' || intent === 'PROTOTYPE' || intent === 'PROJECT') {
      buildSkill = build ? build.skill_id : null;
      if (build && build.pairs_with && REGISTRY.skills.some((s) => s.skill_id === build.pairs_with)) {
        debugSkill = build.pairs_with;
      }
    } else {
      // LOOKUP / TOOL: prefer the map; offer build as secondary.
      buildSkill = build ? build.skill_id : null;
    }

    // Domain anti-failure file as a source as well.
    const anti = REGISTRY.skills.find((s) => s.skill_id === `${topDomain}_anti_failure`);
    if (anti) antiFailure.push(anti.skill_id);
  }

  // Mandatory anti-failure always present in the source set.
  for (const id of MANDATORY_ANTI_FAILURE) {
    if (REGISTRY.skills.some((s) => s.skill_id === id) && !antiFailure.includes(id)) {
      antiFailure.push(id);
    }
  }

  // Reference files: surface dev-reference docs for LOOKUP intent.
  if (intent === 'LOOKUP' || intent === 'TOOL') {
    for (const s of REGISTRY.skills) {
      if (s.category === 'dev_ref') references.push(s.skill_id);
    }
  }

  // Pattern libraries: surface func-pattern encyclopedias for BUILD/PROTOTYPE.
  if (intent === 'BUILD' || intent === 'PROTOTYPE') {
    for (const s of REGISTRY.skills) {
      if (s.category === 'func_pattern') patterns.push(s.skill_id);
    }
  }

  return { maps, buildSkill, debugSkill, antiFailure, references, patterns };
}

/** Required resources (tools) and which are missing from tool_repo.md. */
function resourceCheck(intent, domains) {
  const required = [];
  const topDomain = domains.length ? domains[0].domain : null;

  // Map a domain to the canonical toolchain it depends on.
  const TOOLS = {
    python: ['python3', 'pip', 'venv'],
    rust: ['cargo', 'rustc'],
    web_api: ['curl'],
  };
  if (topDomain && TOOLS[topDomain]) required.push(...TOOLS[topDomain]);
  if (intent === 'DEBUG') required.push('a reproducer'); // not a tool, but a gate

  // "missing" = required strings that tool_repo.md does not mention.
  const repo = REGISTRY.skills.find((s) => s.skill_id === 'tool_repo');
  const repoText = repo ? repo._body.toLowerCase() : '';
  const missing = required.filter((r) => !repoText.includes(r.toLowerCase()));
  return { required, missing };
}

/** Build a human-readable execution chain for the decision. */
function buildChain(intent, domains, sources, antiTier, project) {
  const chain = [];
  chain.push('Mode check: standard routing (no transition detected)');
  chain.push(`Classify intent: ${intent}`);
  chain.push(project.matched ? `Project resume detected: ${project.id || 'unresolved'}` : 'No active project context');

  const dlabel = domains.length ? domains.map((d) => d.domain).join(', ') : 'none';
  chain.push(`Match domains: ${dlabel}`);

  // Anti-failure always loads first (rank-1 authority).
  const allAnti = [...antiTier.mandatory, ...antiTier.domainMatched, ...antiTier.contextTriggered];
  if (allAnti.length) chain.push(`Load anti-failure guardrails: ${allAnti.join(', ')}`);

  if (sources.maps.length) chain.push(`Consult domain map(s): ${sources.maps.join(', ')}`);
  if (intent === 'DEBUG' && sources.debugSkill) chain.push(`Apply debug skill: ${sources.debugSkill}`);
  if (sources.buildSkill && intent !== 'DEBUG') chain.push(`Apply build skill: ${sources.buildSkill}`);
  if (sources.references.length) chain.push(`Cite references: ${sources.references.join(', ')}`);
  if (sources.patterns.length) chain.push(`Borrow patterns: ${sources.patterns.join(', ')}`);

  chain.push('Resource check: verify required tools before acting');
  chain.push('Quality gates: completeness -> correctness -> safety -> citation -> compliance');
  chain.push('Deliver');
  return chain;
}

/** Evaluate which of the 5 quality gates apply to this query. */
function evaluateGates(intent, domains, sources) {
  return QUALITY_GATES.map((gate) => {
    let applies = true;
    if (gate === 'citation') {
      // Citation gate applies when references or maps are in play.
      applies = sources.references.length > 0 || sources.maps.length > 0;
    }
    if (gate === 'safety (anti-failure)') {
      applies = sources.antiFailure.length > 0;
    }
    return { gate, applies };
  });
}

function routeQuery(query) {
  const q = query || '';
  const intentRes = classifyIntent(q);
  const intent = intentRes.selected;
  const domains = matchDomains(q);
  const project = checkProject(q, intent);
  const sources = selectSources(intent, domains, project);
  const antiTier = antiFailureTier(q, domains, sources);
  const resources = resourceCheck(intent, domains);
  const chain = buildChain(intent, domains, sources, antiTier, project);
  const qualityGates = evaluateGates(intent, domains, sources);

  // Mode / transition detection: did the user pivot domains mid-stream? We
  // only have a single query here, so transition is always false; the note
  // explains the failsafe to the frontend.
  const mode = {
    transition: false,
    note: 'Single-shot route; transition detection engages across multi-turn sessions.',
  };

  let deliverNote;
  if (intent === 'DEBUG' && domains.length) {
    deliverNote = `Route to ${sources.debugSkill || 'debug skill'} under ${antiTier.mandatory.join(', ')} guardrails; reproduce, isolate, fix, verify.`;
  } else if (intent === 'BUILD' && domains.length) {
    deliverNote = `Route to ${sources.buildSkill || 'build skill'}; scaffold to spec, then run quality gates before delivery.`;
  } else if (domains.length) {
    deliverNote = `Consult ${sources.maps[0] || 'domain map'} for orientation; escalate to a build/debug skill on a concrete task.`;
  } else {
    deliverNote = 'No domain matched; answer from general references under hallucination guards, or ask a scoping question.';
  }

  return {
    query: q,
    mode,
    intent: intentRes,
    project,
    domains,
    sources,
    antiFailureTier: antiTier,
    resourceCheck: resources,
    chain,
    qualityGates,
    deliverNote,
  };
}

// ----------------------------------------------------------------------------
// Context-budget model
// ----------------------------------------------------------------------------

function tokensFor(skill) {
  return Math.ceil(skill.bytes / 4);
}

function levelFor(fraction) {
  if (fraction > 0.80) return 'RED';
  if (fraction >= 0.65) return 'ORANGE';
  if (fraction >= 0.40) return 'YELLOW';
  return 'GREEN';
}

function contextReport(loadIds) {
  // Reserved set: all rules files + hallucination_guards + master_skill.
  const reservedSet = new Map();
  for (const s of REGISTRY.skills) {
    if (s.type === 'rules' || s.skill_id === 'hallucination_guards' || s.skill_id === 'master_skill') {
      reservedSet.set(s.skill_id, s);
    }
  }
  const reserved = [...reservedSet.values()].map((s) => ({ id: s.skill_id, tokens: tokensFor(s) }));
  const reservedTokens = reserved.reduce((a, r) => a + r.tokens, 0);

  const wanted = (loadIds || []).filter(Boolean);
  const loaded = [];
  for (const id of wanted) {
    const s = REGISTRY.bySkillId.get(id);
    if (s && !reservedSet.has(id)) {
      loaded.push({ id: s.skill_id, tokens: tokensFor(s) });
    }
  }
  const loadedTokens = loaded.reduce((a, r) => a + r.tokens, 0);

  const used = reservedTokens + loadedTokens;
  const fraction = used / TOTAL_BUDGET;
  return {
    totalBudget: TOTAL_BUDGET,
    reservedTokens,
    loadedTokens,
    percent: Math.round(fraction * 1000) / 10,
    level: levelFor(fraction),
    reserved,
    loaded,
  };
}

// ----------------------------------------------------------------------------
// Build-order parser
// ----------------------------------------------------------------------------

/**
 * Parse a build-order markdown file.
 *   Phases:  ## Phase N: Title (STATUS)
 *   Steps:   - [x] done   |   - [ ] todo
 * Returns the structured order with per-phase step lists and a percentComplete.
 */
function parseBuildOrder(skill) {
  const lines = skill._body.split(/\r?\n/);
  const phases = [];
  let current = null;
  let totalSteps = 0;
  let doneSteps = 0;

  const phaseRe = /^##\s+Phase\s+(\d+)\s*:\s*(.+?)\s*\(([^)]+)\)\s*$/i;
  const stepRe = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/;

  for (const line of lines) {
    const pm = line.match(phaseRe);
    if (pm) {
      current = { title: pm[2].trim(), status: pm[3].trim().toUpperCase(), steps: [] };
      phases.push(current);
      continue;
    }
    const sm = line.match(stepRe);
    if (sm && current) {
      const done = sm[1].toLowerCase() === 'x';
      current.steps.push({ text: sm[2].trim(), done });
      totalSteps++;
      if (done) doneSteps++;
    }
  }

  // Determine current phase: first non-DONE/COMPLETE phase, else the last.
  let currentPhase = 1;
  for (let i = 0; i < phases.length; i++) {
    const st = phases[i].status.toUpperCase();
    if (st !== 'DONE' && st !== 'COMPLETE' && st !== 'COMPLETED') {
      currentPhase = i + 1;
      break;
    }
    currentPhase = Math.min(i + 2, phases.length || 1);
  }

  // Overall status: honor an explicit lifecycle status from the manifest
  // (notably "template" so the reusable template is not shown as a live
  // project), otherwise derive it from step completion.
  let status = 'in_progress';
  if (skill.manifest_status === 'template') status = 'template';
  else if (totalSteps > 0 && doneSteps === totalSteps) status = 'complete';
  else if (doneSteps === 0) status = 'not_started';

  return {
    skill_id: skill.skill_id,
    status,
    current_phase: currentPhase,
    total_phases: phases.length,
    description: skill.description,
    percentComplete: totalSteps ? Math.round((doneSteps / totalSteps) * 1000) / 10 : 0,
    phases,
  };
}

/**
 * Resolve the canonical "active project" build-order. Prefers a real project
 * file (skill_id starting with "project_") under prototyping/build_orders/,
 * then any non-template order there, then any order at all. Returns null if
 * none exist.
 */
function findProjectBuildOrder() {
  const inDir = REGISTRY.skills.filter((s) => s.relpath.startsWith('prototyping/build_orders/'));
  return (
    inDir.find((s) => /^project_/.test(s.skill_id)) ||
    inDir.find((s) => !/template/i.test(s.skill_id) && !/TEMPLATE/i.test(s.relpath)) ||
    inDir[0] ||
    null
  );
}

function buildOrdersReport() {
  // Canonical build-order files live under prototyping/build_orders/. We scope
  // to that directory so that other files which merely carry the build_order
  // *category* (e.g. domain maps that advertise a related build order) are not
  // mistaken for orders themselves. A legacy type:build_order is also honored.
  const orders = REGISTRY.skills
    .filter((s) => s.relpath.startsWith('prototyping/build_orders/') || s.type === 'build_order')
    .map(parseBuildOrder);
  return { orders };
}

// ----------------------------------------------------------------------------
// The 27 validation checks
// ----------------------------------------------------------------------------

function runValidation() {
  const checks = [];
  const skills = REGISTRY.skills;
  const idExists = (id) => skills.some((s) => s.skill_id === id);
  const fileExists = (relpath) => skills.some((s) => s.relpath === relpath);

  const add = (id, name, status, detail) => checks.push({ id, name, status, detail });

  // 1 — all framework .md have a manifest.
  {
    const offenders = skills.filter((s) => !s.hasManifest).map((s) => s.relpath);
    add(1, 'All framework files have a manifest', offenders.length ? 'fail' : 'pass',
      offenders.length ? `Missing manifest: ${offenders.join(', ')}` : `${skills.length} files carry frontmatter`);
  }
  // 2 — all have ## CROSS-REFERENCES.
  {
    const offenders = skills.filter((s) => !s.hasCrossRefs).map((s) => s.relpath);
    add(2, 'All files have ## CROSS-REFERENCES', offenders.length ? 'fail' : 'pass',
      offenders.length ? `Missing CROSS-REFERENCES: ${offenders.join(', ')}` : 'All files cross-reference siblings');
  }
  // 3 — all have ## END OF SKILL.
  {
    const offenders = skills.filter((s) => !s.hasEndMarker).map((s) => s.relpath);
    add(3, 'All files have ## END OF SKILL', offenders.length ? 'fail' : 'pass',
      offenders.length ? `Missing END marker: ${offenders.join(', ')}` : 'All files terminate with the end marker');
  }
  // 4 — all skill_id values globally unique.
  {
    const seen = new Map();
    const dupes = [];
    for (const s of skills) {
      if (seen.has(s.skill_id)) dupes.push(`${s.skill_id} (${seen.get(s.skill_id)} & ${s.relpath})`);
      else seen.set(s.skill_id, s.relpath);
    }
    add(4, 'skill_id values are globally unique', dupes.length ? 'fail' : 'pass',
      dupes.length ? `Duplicates: ${dupes.join('; ')}` : `${seen.size} unique skill ids`);
  }
  // 5 — master_skill.md present.
  add(5, 'master_skill.md present', idExists('master_skill') ? 'pass' : 'fail',
    idExists('master_skill') ? 'master_skill found' : 'master_skill missing');
  // 6 — tool_repo.md present.
  add(6, 'tool_repo.md present', idExists('tool_repo') ? 'pass' : 'fail',
    idExists('tool_repo') ? 'tool_repo found' : 'tool_repo missing');
  // 7 — skills/rules/routing.md present.
  add(7, 'skills/rules/routing.md present', fileExists('skills/rules/routing.md') ? 'pass' : 'fail',
    fileExists('skills/rules/routing.md') ? 'routing rules present' : 'routing.md missing');
  // 8 — skills/SKILL_TEMPLATE.md present.
  add(8, 'skills/SKILL_TEMPLATE.md present', fileExists('skills/SKILL_TEMPLATE.md') ? 'pass' : 'fail',
    fileExists('skills/SKILL_TEMPLATE.md') ? 'template present' : 'SKILL_TEMPLATE.md missing');

  // 9-17 — each rules-engine file present (one check per file).
  RULES_FILES.forEach((name, idx) => {
    const rel = `skills/rules/${name}.md`;
    const present = fileExists(rel);
    add(9 + idx, `Rules engine: ${name}.md present`, present ? 'pass' : 'fail',
      present ? `${rel} present` : `${rel} missing`);
  });

  // 18-20 — domain triplets complete.
  const triplets = getDomains().map(findDomainTriplet);
  triplets.forEach((t, i) => {
    const missing = [];
    if (!t.build) missing.push('build');
    if (!t.debug) missing.push('debug');
    if (!t.antiFailure) missing.push('anti-failure');
    add(18 + i, `${t.domain} triplet complete`, t.complete ? 'pass' : 'fail',
      t.complete ? `${t.domain}: build+debug+anti-failure present` : `${t.domain} missing: ${missing.join(', ')}`);
  });

  // 21 — every pairs_with resolves.
  {
    const broken = [];
    for (const s of skills) {
      if (s.pairs_with && !idExists(s.pairs_with)) broken.push(`${s.skill_id} -> ${s.pairs_with}`);
    }
    add(21, 'Every pairs_with resolves to an existing skill_id', broken.length ? 'fail' : 'pass',
      broken.length ? `Unresolved: ${broken.join(', ')}` : 'All pairs_with links resolve');
  }
  // 22 — every depends_on resolves.
  {
    const broken = [];
    for (const s of skills) {
      for (const dep of s.depends_on) {
        if (!idExists(dep)) broken.push(`${s.skill_id} -> ${dep}`);
      }
    }
    add(22, 'Every depends_on resolves', broken.length ? 'fail' : 'pass',
      broken.length ? `Unresolved: ${broken.join(', ')}` : 'All depends_on links resolve');
  }
  // 23 — every debug skill declares error_patterns.
  {
    const debugSkills = skills.filter((s) => s.type === 'debug');
    const offenders = debugSkills.filter((s) => !s.triggers.error_patterns || s.triggers.error_patterns.length === 0)
      .map((s) => s.skill_id);
    let status = offenders.length ? 'fail' : 'pass';
    if (debugSkills.length === 0) status = 'warn';
    add(23, 'Every debug skill declares error_patterns', status,
      debugSkills.length === 0 ? 'No debug skills found' :
        offenders.length ? `Missing error_patterns: ${offenders.join(', ')}` : `${debugSkills.length} debug skills declare error patterns`);
  }
  // 24 — every build skill has a pairs_with debug partner.
  {
    const buildSkills = skills.filter((s) => s.type === 'build');
    const offenders = [];
    for (const s of buildSkills) {
      if (!s.pairs_with) { offenders.push(`${s.skill_id} (none)`); continue; }
      const partner = skills.find((p) => p.skill_id === s.pairs_with);
      if (!partner || partner.type !== 'debug') offenders.push(`${s.skill_id} -> ${s.pairs_with}`);
    }
    let status = offenders.length ? 'fail' : 'pass';
    if (buildSkills.length === 0) status = 'warn';
    add(24, 'Every build skill pairs with a debug partner', status,
      buildSkills.length === 0 ? 'No build skills found' :
        offenders.length ? `Bad pairing: ${offenders.join(', ')}` : `${buildSkills.length} build skills paired with debug`);
  }
  // 25 — maps/ directory non-empty.
  {
    const mapFiles = skills.filter((s) => s.relpath.startsWith('maps/'));
    add(25, 'maps/ directory non-empty', mapFiles.length ? 'pass' : 'fail',
      mapFiles.length ? `${mapFiles.length} map files` : 'maps/ has no markdown');
  }
  // 26 — prototyping/anti_failure has >= 8 general (non-domain) guardrails.
  {
    const domainAnti = new Set(getDomains().map((d) => `${d}_anti_failure`));
    const general = skills.filter((s) =>
      s.relpath.startsWith('prototyping/anti_failure/') && !domainAnti.has(s.skill_id));
    add(26, 'anti_failure has >= 8 general guardrails', general.length >= 8 ? 'pass' : 'fail',
      `${general.length} general guardrails found (need >= 8)`);
  }
  // 27 — build_orders has the template plus >= 1 project file.
  {
    const orderFiles = skills.filter((s) => s.relpath.startsWith('prototyping/build_orders/'));
    const hasTemplate = orderFiles.some((s) => /template/i.test(s.skill_id) || /TEMPLATE/i.test(s.relpath));
    const projectFiles = orderFiles.filter((s) => !/template/i.test(s.skill_id) && !/TEMPLATE/i.test(s.relpath));
    const ok = hasTemplate && projectFiles.length >= 1;
    add(27, 'build_orders has template + >= 1 project', ok ? 'pass' : 'fail',
      `template=${hasTemplate}, projects=${projectFiles.length}`);
  }

  const passed = checks.filter((c) => c.status === 'pass').length;
  return { passed, total: checks.length, checks };
}

// ----------------------------------------------------------------------------
// Engagement-mode passphrase gate
// ----------------------------------------------------------------------------

/**
 * Extract a domain map's own methodology phases for use as engagement terrain.
 * Map files express phases as headings like "## PHASE 1 — ENVIRONMENT SETUP"
 * (em/en-dash or hyphen). The unnumbered "## PHASE FLOW" summary is skipped
 * because the pattern requires a phase number.
 */
function mapTerrainPhases(domain) {
  const map = REGISTRY.bySkillId.get(`map_${domain}`);
  if (!map || !map._body) return [];
  const re = /^##\s+PHASE\s+\d+\s*[—–-]+\s*(.+?)\s*$/gim;
  const phases = [];
  let m;
  while ((m = re.exec(map._body)) !== null) {
    // Title-case the heading for display; drop any "(HARD GATE)"-style suffix note.
    const title = m[1].replace(/\s+/g, ' ').trim();
    phases.push(title);
  }
  return phases;
}

// Engagement state persists to navigator/.engagement/state.json so a session
// survives restarts (per the blueprint's engagement-state contract). The
// activation passphrase is configurable via NAV_ENGAGE_PASSPHRASE.
const ENGAGE_DIR = path.join(ROOT, '.engagement');
const ENGAGE_FILE = path.join(ENGAGE_DIR, 'state.json');
const ENGAGE_PASSPHRASE = process.env.NAV_ENGAGE_PASSPHRASE || 'navigator-engage';
const SUB_MODES = ['per-item', 'assessment', 'objective'];

function defaultEngagement() {
  return { active: false, startedAt: null, scope: '', subMode: 'assessment', terrain: [], findings: [], _seq: 0 };
}

let ENGAGEMENT = null;

function loadEngagement() {
  if (ENGAGEMENT) return ENGAGEMENT;
  try {
    ENGAGEMENT = Object.assign(defaultEngagement(), JSON.parse(fs.readFileSync(ENGAGE_FILE, 'utf8')));
  } catch (_) {
    ENGAGEMENT = defaultEngagement();
  }
  return ENGAGEMENT;
}

function saveEngagement() {
  try {
    fs.mkdirSync(ENGAGE_DIR, { recursive: true });
    fs.writeFileSync(ENGAGE_FILE, JSON.stringify(ENGAGEMENT, null, 2));
  } catch (_) { /* best-effort persistence */ }
}

/** Build terrain from all maps, preserving done-flags whose titles still match. */
function buildTerrain(prev) {
  const prevByMap = {};
  (prev || []).forEach((t) => { prevByMap[t.map] = t; });
  return getDomains().map((domain) => {
    const map = `map_${domain}`;
    const old = prevByMap[map];
    const phases = mapTerrainPhases(domain).map((title) => ({
      title,
      done: !!(old && (old.phases || []).some((p) => p.title === title && p.done)),
    }));
    return { map, domain, phases };
  });
}

function engCoverage(e) {
  let total = 0, done = 0;
  (e.terrain || []).forEach((t) => (t.phases || []).forEach((p) => { total++; if (p.done) done++; }));
  return { done, total, percent: total ? Math.round((done / total) * 1000) / 10 : 0 };
}

/** Public, sanitized engagement snapshot (never echoes the passphrase). */
function engagementState() {
  const e = loadEngagement();
  return {
    ok: true, active: e.active, locked: !e.active,
    startedAt: e.startedAt, scope: e.scope, subMode: e.subMode, subModes: SUB_MODES,
    terrain: e.terrain, findings: e.findings, coverage: engCoverage(e),
  };
}

/** Lightweight accessor for the ISA EXEC opcode. */
function getEngagement() {
  const e = loadEngagement();
  return { active: e.active, scope: e.scope, subMode: e.subMode };
}

function activateEngagement(body) {
  const passphrase = body && typeof body.passphrase === 'string' ? body.passphrase : '';
  if (passphrase !== ENGAGE_PASSPHRASE) {
    return { ok: false, message: 'Locked. Engagement mode requires the activation passphrase.' };
  }
  const e = loadEngagement();
  e.active = true;
  if (!e.startedAt) e.startedAt = new Date().toISOString();
  e.terrain = buildTerrain(e.terrain);
  if (typeof body.scope === 'string' && body.scope.trim()) e.scope = body.scope.trim();
  saveEngagement();
  return Object.assign({ message: 'Engagement mode active.' }, engagementState());
}

function deactivateEngagement() {
  const e = loadEngagement();
  e.active = false;
  saveEngagement();
  return Object.assign({ message: 'Engagement suspended (state preserved).' }, engagementState());
}

function setEngagementScope(body) {
  const e = loadEngagement();
  if (!e.active) return { ok: false, message: 'Engagement not active.' };
  if (typeof body.scope === 'string') e.scope = body.scope.slice(0, 4000);
  if (SUB_MODES.includes(body.subMode)) e.subMode = body.subMode;
  saveEngagement();
  return engagementState();
}

function toggleTerrain(body) {
  const e = loadEngagement();
  if (!e.active) return { ok: false, message: 'Engagement not active.' };
  const t = (e.terrain || []).find((x) => x.map === body.map);
  const i = Number(body.phaseIndex);
  if (t && t.phases[i]) {
    t.phases[i].done = typeof body.done === 'boolean' ? body.done : !t.phases[i].done;
    saveEngagement();
  }
  return engagementState();
}

function addFinding(body) {
  const e = loadEngagement();
  if (!e.active) return { ok: false, message: 'Engagement not active.' };
  const title = (body.title || '').toString().trim();
  if (!title) return { ok: false, message: 'Finding needs a title.' };
  e._seq = (e._seq || 0) + 1;
  e.findings.unshift({
    id: e._seq, ts: new Date().toISOString(),
    title: title.slice(0, 200), note: (body.note || '').toString().slice(0, 2000),
    phase: (body.phase || '').toString().slice(0, 120), domain: (body.domain || '').toString().slice(0, 40),
  });
  saveEngagement();
  return engagementState();
}

function deleteFinding(body) {
  const e = loadEngagement();
  if (!e.active) return { ok: false, message: 'Engagement not active.' };
  e.findings = (e.findings || []).filter((f) => f.id !== Number(body.id));
  saveEngagement();
  return engagementState();
}

function resetEngagement() {
  ENGAGEMENT = defaultEngagement();
  saveEngagement();
  return Object.assign({ message: 'Engagement reset.' }, engagementState());
}

// ----------------------------------------------------------------------------
// HTTP plumbing
// ----------------------------------------------------------------------------

function sendJson(res, status, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + path.basename(filePath));
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Inspector assets change as the framework evolves; never let a browser
      // serve a stale app.js/index.html (a cached bundle hides new views).
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return resolve({});
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// ----------------------------------------------------------------------------
// Request handler
// ----------------------------------------------------------------------------

async function handler(req, res) {
  let parsed;
  try {
    parsed = url.parse(req.url, true);
  } catch (_) {
    return sendJson(res, 400, { error: 'bad url' });
  }
  const pathname = parsed.pathname;
  const query = parsed.query || {};

  try {
    // ---- Static surface ----------------------------------------------------
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      return sendStatic(res, path.join(PUBLIC_DIR, 'index.html'));
    }
    if (req.method === 'GET' && pathname === '/app.js') {
      return sendStatic(res, path.join(PUBLIC_DIR, 'app.js'));
    }
    if (req.method === 'GET' && pathname === '/styles.css') {
      return sendStatic(res, path.join(PUBLIC_DIR, 'styles.css'));
    }
    if (req.method === 'GET' && (pathname === '/learn' || pathname === '/learn.html')) {
      return sendStatic(res, path.join(PUBLIC_DIR, 'learn.html'));
    }

    // ---- JSON API ----------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        scannedAt: REGISTRY.scannedAt,
        fileCount: REGISTRY.skills.length,
      });
    }

    if (req.method === 'GET' && pathname === '/api/rescan') {
      scan();
      return sendJson(res, 200, { ok: true, scannedAt: REGISTRY.scannedAt, fileCount: REGISTRY.skills.length });
    }

    if (req.method === 'GET' && pathname === '/api/registry') {
      return sendJson(res, 200, registryPayload());
    }

    if (req.method === 'GET' && pathname === '/api/route') {
      const q = typeof query.q === 'string' ? query.q : '';
      return sendJson(res, 200, routeQuery(q));
    }

    if (req.method === 'GET' && pathname === '/api/validate') {
      return sendJson(res, 200, runValidation());
    }

    if (req.method === 'GET' && pathname === '/api/context') {
      const load = typeof query.load === 'string' && query.load.length
        ? query.load.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      return sendJson(res, 200, contextReport(load));
    }

    if (req.method === 'GET' && pathname === '/api/build-orders') {
      return sendJson(res, 200, buildOrdersReport());
    }

    if (req.method === 'GET' && pathname === '/api/raw') {
      const id = typeof query.id === 'string' ? query.id : '';
      const s = REGISTRY.bySkillId.get(id);
      if (!s) return sendJson(res, 404, { error: 'unknown skill_id', id });
      return sendJson(res, 200, { skill_id: s.skill_id, relpath: s.relpath, markdown: s._body });
    }

    if (req.method === 'POST' && pathname === '/api/engagement/activate') {
      return sendJson(res, 200, activateEngagement(await readBody(req)));
    }
    if (req.method === 'GET' && pathname === '/api/engagement/state') {
      return sendJson(res, 200, engagementState());
    }
    if (req.method === 'POST' && pathname === '/api/engagement/deactivate') {
      return sendJson(res, 200, deactivateEngagement());
    }
    if (req.method === 'POST' && pathname === '/api/engagement/scope') {
      return sendJson(res, 200, setEngagementScope(await readBody(req)));
    }
    if (req.method === 'POST' && pathname === '/api/engagement/terrain') {
      return sendJson(res, 200, toggleTerrain(await readBody(req)));
    }
    if (req.method === 'POST' && pathname === '/api/engagement/finding') {
      return sendJson(res, 200, addFinding(await readBody(req)));
    }
    if (req.method === 'POST' && pathname === '/api/engagement/finding/delete') {
      return sendJson(res, 200, deleteFinding(await readBody(req)));
    }
    if (req.method === 'POST' && pathname === '/api/engagement/reset') {
      return sendJson(res, 200, resetEngagement());
    }

    // ---- ISA agent ---------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/isa/program') {
      return sendJson(res, 200, isa.buildProgram(isaDeps()));
    }

    if (req.method === 'POST' && pathname === '/api/isa/exec') {
      const body = await readBody(req);
      const q = typeof body.query === 'string' ? body.query : '';
      const mode = body.mode === 'offline' ? 'offline' : 'live';
      const provider = typeof body.provider === 'string' && body.provider ? body.provider : undefined;
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
      if (!q.trim()) return sendJson(res, 400, { error: 'empty query' });
      const result = await isa.executeISA(q, { mode, provider, model }, isaDeps());
      return sendJson(res, 200, result);
    }

    // ---- Fallthrough -------------------------------------------------------
    return sendJson(res, 404, { error: 'not found', path: pathname });
  } catch (err) {
    // Never crash the process on a single bad request.
    return sendJson(res, 500, { error: 'internal', detail: String(err && err.message || err) });
  }
}

// ----------------------------------------------------------------------------
// Startup: scan, then bind to the first free port in [PORT, PORT+5].
// ----------------------------------------------------------------------------

function listenWithFallback(server, basePort, triesLeft) {
  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && triesLeft > 1) {
      const next = basePort + 1;
      console.error(`[navigator] port ${basePort} in use, trying ${next} ...`);
      setImmediate(() => listenWithFallback(server, next, triesLeft - 1));
    } else {
      console.error('[navigator] failed to bind:', err && err.message);
      process.exit(1);
    }
  });
  server.listen(basePort, () => {
    const addr = server.address();
    const p = addr && addr.port ? addr.port : basePort;
    console.log(`[navigator] registry scanned: ${REGISTRY.skills.length} skill files`);
    console.log(`[navigator] runtime up -> http://localhost:${p}`);
  });
}

function main() {
  // Stay alive even if a stray async error escapes a request handler. A local
  // inspector should log and keep serving — not die and leave the browser tab
  // throwing "Failed to fetch". (Only installed when run as a server, not when
  // required as a module by the CLI agent.)
  process.on('uncaughtException', (err) => {
    console.error('[navigator] uncaught exception (kept alive):', err && err.stack ? err.stack : err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('[navigator] unhandled rejection (kept alive):', err && err.stack ? err.stack : err);
  });
  scan();
  const server = http.createServer((req, res) => { handler(req, res); });
  listenWithFallback(server, DEFAULT_PORT, PORT_TRIES);
}

// Export internals for testability; run when invoked directly.
module.exports = {
  scan, parseManifest, parseValue, routeQuery, classifyIntent, matchDomains,
  contextReport, runValidation, parseBuildOrder, activateEngagement,
  getRegistry, getSkill, isaDeps,
};

if (require.main === module) {
  main();
}
