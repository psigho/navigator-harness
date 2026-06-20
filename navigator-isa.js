'use strict';
/**
 * navigator-isa.js — the Navigator INSTRUCTION SET ARCHITECTURE, executed.
 *
 * This is a small virtual machine. It runs the Navigator routing program as a
 * stream of opcodes over a register file, exactly as the ISA document
 * specifies (BOOT -> CLASSIFY -> ROUTE -> EXECUTE -> VERIFY -> EMIT). Each
 * instruction is a deterministic operation on context-window state; the model
 * (or this interpreter) is the execution unit, Navigator is the program.
 *
 * Dependencies are INJECTED by the caller (the server or the CLI agent) so this
 * module never has to require the server back (no circular import):
 *   deps = { getRegistry, getSkill, classifyIntent, matchDomains }
 * The EXEC opcode optionally calls an LLM via ./navigator-llm.
 *
 * Public API:
 *   buildProgram(deps)            -> static program + register/opcode metadata
 *   executeISA(query, opts, deps) -> { trace, registers, out, verify, ... }
 */

const llm = require('./navigator-llm');

// ---------------------------------------------------------------------------
// Register & opcode metadata (for the dashboard's ISA console)
// ---------------------------------------------------------------------------

const REGISTER_SPEC = [
  ['QRY', 'current user query string'],
  ['INT', 'classified intent (BUILD|DEBUG|PROTOTYPE|TOOL|LOOKUP)'],
  ['DOM', 'classified domain(s) — list'],
  ['SKL', 'selected skill(s) — list'],
  ['MAP', 'selected map(s) — list'],
  ['TOOL', 'selected tool(s) — list'],
  ['PROTO', 'selected prototyping reference(s) — list'],
  ['CTX', 'conversation context (prior domain, prior errors)'],
  ['RETRY', 'build retry counter (0..3)'],
  ['ERR', 'last error captured'],
  ['CONF', 'confidence score (0..100)'],
  ['OUT', 'output buffer'],
  ['FLG', 'comparison / match flag (set by MATCH and VERIFY)'],
  ['TRACE', 'decision trace log'],
];

const OPCODE_SPEC = [
  ['CLASSIFY', 'run classification on a register'],
  ['MATCH', 'pattern-match a register against a keyword set -> FLG'],
  ['SELECT', 'select skill/map/tool/proto by criteria'],
  ['COMPOSE', 'compose source context from selected registers'],
  ['EXEC', 'execute a skill (live LLM or offline composer) -> OUT'],
  ['VERIFY', 'run a verification check -> FLG'],
  ['MOV', 'set a register to a value'],
  ['OR', 'append a value to a list register'],
  ['XOR', 'clear a register'],
  ['INC', 'increment a register'],
  ['TRACE', 'append an event to the decision trace'],
  ['EMIT', 'emit a register to output'],
  ['CALL', 'call a subroutine'],
  ['RET', 'return from a subroutine'],
  ['JMP', 'unconditional jump'],
  ['JE', 'jump if register equals value'],
  ['JG', 'jump if register greater than value'],
  ['ASK', 'request clarification (non-blocking here)'],
  ['ABORT', 'abort with reason'],
  ['HALT', 'stop processing'],
];

// Intent keyword groups, in ISA priority order (first match wins).
const INTENT_KW = {
  BUILD: ['build', 'create', 'write', 'make', 'implement', 'generate', 'add', 'scanner'],
  DEBUG: ['error', 'fix', 'crash', 'broken', 'fail', 'exception', 'traceback', 'bug', 'debug', 'why does'],
  PROTOTYPE: ['design', 'plan', 'architecture', 'scaffold', 'structure', 'prototype'],
  TOOL: ['tool', 'library', 'resource', 'install'],
};

// Per-domain toolchains (the resource index, condensed for the TOOL register).
const TOOLCHAINS = {
  python: ['python3', 'pip', 'venv', 'pytest'],
  rust: ['cargo', 'rustc', 'clippy'],
  web_api: ['curl', 'httpie', 'openapi'],
};

// ---------------------------------------------------------------------------
// Program assembly
// ---------------------------------------------------------------------------

function domainsFromRegistry(deps) {
  const reg = deps.getRegistry();
  if (!reg || !reg.skills) return ['python', 'rust', 'web_api'];
  const out = [];
  for (const s of reg.skills) {
    if (s.type === 'map' && /^map_/.test(s.skill_id)) out.push(s.skill_id.replace(/^map_/, ''));
  }
  return out.length ? out : ['python', 'rust', 'web_api'];
}

function ins(label, op, args, note) {
  return { label: label || null, op, args: args || [], note: note || '' };
}

/**
 * Assemble the Navigator program. Domain-check instructions are generated from
 * the live registry, so dropping in a new map literally adds opcodes.
 */
function assembleProgram(deps) {
  const domains = domainsFromRegistry(deps);
  const P = [];

  // --- entry ---------------------------------------------------------------
  P.push(ins('_run', 'CALL', ['_classify_intent']));
  P.push(ins(null, 'CALL', ['_classify_domain']));
  P.push(ins(null, 'CALL', ['_route']));
  P.push(ins(null, 'CALL', ['_execute']));
  P.push(ins(null, 'CALL', ['_verify']));
  P.push(ins(null, 'EMIT', ['OUT']));
  P.push(ins(null, 'HALT', []));

  // --- intent classification ----------------------------------------------
  P.push(ins('_classify_intent', 'MATCH', ['BUILD_KW', 'QRY']));
  P.push(ins(null, 'JE', ['FLG', '1', '_set_build']));
  P.push(ins(null, 'MATCH', ['DEBUG_KW', 'QRY']));
  P.push(ins(null, 'JE', ['FLG', '1', '_set_debug']));
  P.push(ins(null, 'MATCH', ['PROTO_KW', 'QRY']));
  P.push(ins(null, 'JE', ['FLG', '1', '_set_proto']));
  P.push(ins(null, 'MATCH', ['TOOL_KW', 'QRY']));
  P.push(ins(null, 'JE', ['FLG', '1', '_set_tool']));
  P.push(ins(null, 'JMP', ['_set_lookup']));
  P.push(ins('_set_build', 'MOV', ['INT', 'BUILD']));
  P.push(ins(null, 'TRACE', ['intent=BUILD']));
  P.push(ins(null, 'RET', []));
  P.push(ins('_set_debug', 'MOV', ['INT', 'DEBUG']));
  P.push(ins(null, 'TRACE', ['intent=DEBUG']));
  P.push(ins(null, 'RET', []));
  P.push(ins('_set_proto', 'MOV', ['INT', 'PROTOTYPE']));
  P.push(ins(null, 'TRACE', ['intent=PROTOTYPE']));
  P.push(ins(null, 'RET', []));
  P.push(ins('_set_tool', 'MOV', ['INT', 'TOOL']));
  P.push(ins(null, 'TRACE', ['intent=TOOL']));
  P.push(ins(null, 'RET', []));
  P.push(ins('_set_lookup', 'MOV', ['INT', 'LOOKUP']));
  P.push(ins(null, 'TRACE', ['intent=LOOKUP']));
  P.push(ins(null, 'RET', []));

  // --- domain classification (generated per live domain) -------------------
  P.push(ins('_classify_domain', 'XOR', ['DOM', 'DOM']));
  domains.forEach((d, i) => {
    const chk = i === 0 ? '_classify_domain_chk0' : `_chk_${d}`;
    // first check carries no extra label beyond the loop entry
    P.push(ins(i === 0 ? null : chk, 'MATCH', [`${d.toUpperCase()}_KW`, 'QRY']));
    P.push(ins(null, 'JE', ['FLG', '1', `_add_${d}`]));
  });
  P.push(ins(null, 'JMP', ['_domain_done']));
  domains.forEach((d, i) => {
    const next = i + 1 < domains.length ? `_chk_${domains[i + 1]}` : '_domain_done';
    P.push(ins(`_add_${d}`, 'OR', ['DOM', d]));
    P.push(ins(null, 'TRACE', [`domain+=${d}`]));
    P.push(ins(null, 'JMP', [next]));
  });
  P.push(ins('_domain_done', 'JE', ['DOM', '0', '_ask_domain']));
  P.push(ins(null, 'RET', []));
  P.push(ins('_ask_domain', 'ASK', ['which domain does this apply to?']));
  P.push(ins(null, 'RET', []));

  // --- routing branch ------------------------------------------------------
  P.push(ins('_route', 'JE', ['INT', 'BUILD', '_route_build']));
  P.push(ins(null, 'JE', ['INT', 'DEBUG', '_route_debug']));
  P.push(ins(null, 'JE', ['INT', 'PROTOTYPE', '_route_proto']));
  P.push(ins(null, 'JE', ['INT', 'TOOL', '_route_tool']));
  P.push(ins(null, 'JE', ['INT', 'LOOKUP', '_route_lookup']));
  P.push(ins(null, 'ABORT', ['unknown_intent']));

  P.push(ins('_route_build', 'SELECT', ['SKL', 'build']));
  P.push(ins(null, 'SELECT', ['PROTO', 'anti_failure']));
  P.push(ins(null, 'SELECT', ['PROTO', 'func_encyclopedia']));
  P.push(ins(null, 'SELECT', ['PROTO', 'dev_reference']));
  P.push(ins(null, 'SELECT', ['MAP', 'DOM']));
  P.push(ins(null, 'SELECT', ['TOOL', 'DOM']));
  P.push(ins(null, 'MOV', ['RETRY', '0']));
  P.push(ins(null, 'RET', []));

  P.push(ins('_route_debug', 'SELECT', ['SKL', 'debug']));
  P.push(ins(null, 'SELECT', ['PROTO', 'anti_failure']));
  P.push(ins(null, 'SELECT', ['PROTO', 'dev_reference']));
  P.push(ins(null, 'SELECT', ['MAP', 'DOM']));
  P.push(ins(null, 'RET', []));

  P.push(ins('_route_proto', 'SELECT', ['PROTO', 'all']));
  P.push(ins(null, 'SELECT', ['MAP', 'DOM']));
  P.push(ins(null, 'RET', []));

  P.push(ins('_route_tool', 'SELECT', ['TOOL', 'QRY']));
  P.push(ins(null, 'JE', ['TOOL', 'NULL', '_tool_not_found']));
  P.push(ins(null, 'SELECT', ['MAP', 'DOM']));
  P.push(ins(null, 'RET', []));
  P.push(ins('_tool_not_found', 'SELECT', ['TOOL', 'DOM']));
  P.push(ins(null, 'TRACE', ['tool_not_in_query->domain_toolchain']));
  P.push(ins(null, 'SELECT', ['MAP', 'DOM']));
  P.push(ins(null, 'RET', []));

  P.push(ins('_route_lookup', 'SELECT', ['MAP', 'DOM']));
  P.push(ins(null, 'SELECT', ['PROTO', 'anti_failure']));
  P.push(ins(null, 'SELECT', ['PROTO', 'dev_reference']));
  P.push(ins(null, 'RET', []));

  // --- execution -----------------------------------------------------------
  P.push(ins('_execute', 'COMPOSE', ['SKL', 'MAP', 'PROTO', 'TOOL']));
  P.push(ins(null, 'EXEC', ['SKL']));
  P.push(ins(null, 'JE', ['FLG', '1', '_exec_ok']));
  P.push(ins(null, 'JMP', ['_exec_retry']));
  P.push(ins('_exec_ok', 'TRACE', ['exec_success']));
  P.push(ins(null, 'RET', []));
  P.push(ins('_exec_retry', 'INC', ['RETRY']));
  P.push(ins(null, 'JG', ['RETRY', '3', '_exec_failed']));
  P.push(ins(null, 'SELECT', ['SKL', 'debug']));
  P.push(ins(null, 'EXEC', ['SKL']));
  P.push(ins(null, 'JMP', ['_exec_ok']));
  P.push(ins('_exec_failed', 'TRACE', ['exec_failed_3_attempts']));
  P.push(ins(null, 'RET', []));

  // --- verification chain --------------------------------------------------
  P.push(ins('_verify', 'VERIFY', ['source']));
  P.push(ins(null, 'JE', ['FLG', '0', '_verify_failed']));
  P.push(ins(null, 'VERIFY', ['hallucination']));
  P.push(ins(null, 'JE', ['FLG', '0', '_verify_failed']));
  P.push(ins(null, 'VERIFY', ['confidence']));
  P.push(ins(null, 'JG', ['CONF', '70', '_verify_pass']));
  P.push(ins(null, 'TRACE', ['verify_low_conf']));
  P.push(ins(null, 'RET', []));
  P.push(ins('_verify_pass', 'TRACE', ['verify_pass']));
  P.push(ins(null, 'RET', []));
  P.push(ins('_verify_failed', 'TRACE', ['verify_failed']));
  P.push(ins(null, 'MOV', ['ERR', 'verification_failed']));
  P.push(ins(null, 'RET', []));

  return { program: P, domains };
}

function buildProgram(deps) {
  const { program, domains } = assembleProgram(deps);
  const pinfo = llm.providerInfo();
  return {
    registers: REGISTER_SPEC.map(([name, desc]) => ({ name, desc })),
    opcodes: OPCODE_SPEC.map(([name, desc]) => ({ name, desc })),
    program: program.map((p, i) => ({ i, label: p.label, op: p.op, args: p.args, note: p.note })),
    domains,
    hasLiveKey: pinfo.hasKey,
    keySource: pinfo.keySource,
    provider: pinfo.label,
    providerName: pinfo.provider,
    model: pinfo.model,
    providers: llm.listProviders(),
    models: llm.modelCatalog(),
  };
}

// ---------------------------------------------------------------------------
// The interpreter
// ---------------------------------------------------------------------------

const MAX_STEPS = 4000;

function freshRegisters(query) {
  return {
    QRY: query || '',
    INT: null,
    DOM: [],
    SKL: [],
    MAP: [],
    TOOL: [],
    PROTO: [],
    CTX: { priorDomain: null, priorError: null },
    RETRY: 0,
    ERR: null,
    CONF: 0,
    OUT: '',
    FLG: 0,
    TRACE: [],
  };
}

/** Compact, JSON-safe snapshot of registers for a trace frame. */
function snapshot(R) {
  return {
    QRY: R.QRY.length > 80 ? R.QRY.slice(0, 80) + '…' : R.QRY,
    INT: R.INT,
    DOM: R.DOM.slice(),
    SKL: R.SKL.slice(),
    MAP: R.MAP.slice(),
    TOOL: R.TOOL.slice(),
    PROTO: R.PROTO.slice(),
    RETRY: R.RETRY,
    ERR: R.ERR,
    CONF: R.CONF,
    OUT: R.OUT ? `‹${R.OUT.length} chars›` : '',
    FLG: R.FLG,
    TRACE: R.TRACE.length,
  };
}

function tokenize(q) {
  return (q || '').toLowerCase().replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function matchKeywords(query, kws) {
  const q = (query || '').toLowerCase();
  const tokens = new Set(tokenize(query));
  const hit = [];
  for (const w of kws) {
    if (w.includes(' ')) { if (q.includes(w)) hit.push(w); }
    else if (tokens.has(w)) hit.push(w);
  }
  return hit;
}

function dedupePush(arr, items) {
  for (const it of items) if (it && !arr.includes(it)) arr.push(it);
}

/**
 * Run the program for a query. Returns a full execution record.
 * @param {string} query
 * @param {{mode?:'live'|'offline', maxSourceChars?:number}} opts
 * @param {{getRegistry,getSkill,classifyIntent,matchDomains}} deps
 */
async function executeISA(query, opts, deps) {
  opts = opts || {};
  const mode = opts.mode === 'offline' ? 'offline' : 'live';
  const { program } = assembleProgram(deps);

  // Label -> index table.
  const labels = {};
  program.forEach((p, i) => { if (p.label) labels[p.label] = i; });

  const R = freshRegisters(query);
  const trace = [];
  const callStack = [];
  const matchedDomains = deps.matchDomains(query); // [{domain, score, matched}]
  const primaryDomain = matchedDomains.length ? matchedDomains[0].domain : null;

  // Engagement frame (if a guarded engagement is active, EXEC honors its scope).
  const engagement = (deps.getEngagement && deps.getEngagement()) || { active: false };

  // Runtime context carried across opcodes.
  const rt = {
    deps, opts, mode,
    matchedDomains, primaryDomain,
    engagement,
    composed: [],          // [{skill_id, relpath, body}]
    execMode: null,        // 'live' | 'offline' | 'offline (fallback)'
    model: null,
    usage: null,
    verify: { source: null, hallucination: null, confidence: 0, verdict: null },
  };

  // BOOT preamble frame (already executed at registry-scan time).
  const reg = deps.getRegistry();
  trace.push({
    step: 0, pc: -1, label: '_boot', op: 'BOOT',
    args: [], note: `registry resident: ${reg && reg.skills ? reg.skills.length : 0} skills`,
    regs: snapshot(R),
  });

  let pc = labels['_run'];
  let step = 1;

  while (pc != null && pc >= 0 && pc < program.length && step < MAX_STEPS) {
    const instr = program[pc];
    let jumpTo = null;       // index to jump to, else fall through
    let note = instr.note || '';

    switch (instr.op) {
      case 'CALL': {
        callStack.push(pc + 1);
        jumpTo = labels[instr.args[0]];
        note = `-> ${instr.args[0]}`;
        break;
      }
      case 'RET': {
        jumpTo = callStack.length ? callStack.pop() : -2; // -2 => end
        break;
      }
      case 'JMP': {
        jumpTo = labels[instr.args[0]];
        note = `-> ${instr.args[0]}`;
        break;
      }
      case 'JE': {
        const [regName, val, lbl] = instr.args;
        if (regEquals(R, regName, val)) { jumpTo = labels[lbl]; note = `${regName}==${val} -> ${lbl}`; }
        else note = `${regName}!=${val}`;
        break;
      }
      case 'JG': {
        const [regName, val, lbl] = instr.args;
        if (regGreater(R, regName, Number(val))) { jumpTo = labels[lbl]; note = `${regName}>${val} -> ${lbl}`; }
        else note = `${regName}<=${val}`;
        break;
      }
      case 'MATCH': {
        const grp = instr.args[0];
        const hits = matchGroup(grp, R.QRY, rt);
        R.FLG = hits.length ? 1 : 0;
        note = hits.length ? `matched: ${hits.join(', ')}` : 'no match';
        break;
      }
      case 'MOV': {
        const [regName, val] = instr.args;
        R[regName] = isNumeric(val) ? Number(val) : val;
        note = `${regName} = ${val}`;
        break;
      }
      case 'XOR': {
        R[instr.args[0]] = [];
        note = `${instr.args[0]} cleared`;
        break;
      }
      case 'OR': {
        const [regName, val] = instr.args;
        if (!R[regName].includes(val)) R[regName].push(val);
        note = `${regName} += ${val}`;
        break;
      }
      case 'INC': {
        R[instr.args[0]] = (Number(R[instr.args[0]]) || 0) + 1;
        note = `${instr.args[0]} = ${R[instr.args[0]]}`;
        break;
      }
      case 'SELECT': {
        note = doSelect(instr.args[0], instr.args[1], R, rt);
        break;
      }
      case 'COMPOSE': {
        note = doCompose(R, rt);
        break;
      }
      case 'EXEC': {
        note = await doExec(R, rt);
        break;
      }
      case 'VERIFY': {
        note = doVerify(instr.args[0], R, rt);
        break;
      }
      case 'TRACE': {
        R.TRACE.push(instr.args[0]);
        note = instr.args[0];
        break;
      }
      case 'EMIT': {
        note = `emit ${instr.args[0]} (${R.OUT.length} chars)`;
        break;
      }
      case 'ASK': {
        R.CTX.priorError = 'clarification_requested';
        note = `ASK: ${instr.args[0]} (non-blocking; continuing)`;
        break;
      }
      case 'ABORT': {
        R.ERR = instr.args[0];
        note = `ABORT: ${instr.args[0]}`;
        trace.push(frame(step, pc, instr, note, R));
        pc = -2; // end
        continue;
      }
      case 'HALT': {
        note = 'halt';
        trace.push(frame(step, pc, instr, note, R));
        pc = -2;
        continue;
      }
      default:
        note = `nop(${instr.op})`;
    }

    trace.push(frame(step, pc, instr, note, R));
    step++;

    if (jumpTo === -2) { pc = -2; break; }        // RET past top => end
    pc = jumpTo != null ? jumpTo : pc + 1;
  }

  return {
    query,
    intent: R.INT,
    domains: R.DOM.slice(),
    primaryDomain,
    execMode: rt.execMode || mode,
    provider: rt.provider || llm.providerInfo().label,
    model: rt.model || llm.providerInfo().model,
    usage: rt.usage,
    engagement: rt.engagement && rt.engagement.active
      ? { active: true, scope: rt.engagement.scope, subMode: rt.engagement.subMode }
      : { active: false },
    sources: rt.composed.map((s) => ({ skill_id: s.skill_id, relpath: s.relpath, chars: s.body.length })),
    out: R.OUT,
    confidence: R.CONF,
    verify: rt.verify,
    registers: snapshot(R),
    traceLog: R.TRACE.slice(),
    trace,
    steps: trace.length,
    hasLiveKey: llm.hasKey(),
  };
}

function frame(step, pc, instr, note, R) {
  return { step, pc, label: instr.label, op: instr.op, args: instr.args, note, regs: snapshot(R) };
}

// --- comparison helpers ----------------------------------------------------

function regEquals(R, name, val) {
  const cur = R[name];
  if (val === 'NULL') return Array.isArray(cur) ? cur.length === 0 : cur == null;
  if (val === '0') return Array.isArray(cur) ? cur.length === 0 : Number(cur) === 0;
  if (Array.isArray(cur)) return cur.includes(val);
  return String(cur) === String(val);
}
function regGreater(R, name, n) {
  return (Number(R[name]) || 0) > n;
}
function isNumeric(v) { return /^-?\d+$/.test(String(v)); }

// --- MATCH groups ----------------------------------------------------------

function matchGroup(grp, query, rt) {
  // Intent groups.
  if (grp === 'BUILD_KW') return matchKeywords(query, INTENT_KW.BUILD);
  if (grp === 'DEBUG_KW') return matchKeywords(query, INTENT_KW.DEBUG);
  if (grp === 'PROTO_KW') return matchKeywords(query, INTENT_KW.PROTOTYPE);
  if (grp === 'TOOL_KW') return matchKeywords(query, INTENT_KW.TOOL);
  // Domain groups: <DOMAIN>_KW -> use the live matchDomains result.
  const m = grp.match(/^(.+)_KW$/);
  if (m) {
    const domain = m[1].toLowerCase();
    const found = rt.matchedDomains.find((d) => d.domain === domain);
    return found ? found.matched : [];
  }
  return [];
}

// --- SELECT ----------------------------------------------------------------

function exists(deps, id) { return !!deps.getSkill(id); }

function doSelect(target, criteria, R, rt) {
  const deps = rt.deps;
  const reg = deps.getRegistry();
  const dom = rt.primaryDomain;

  if (target === 'SKL' && criteria === 'build') {
    const id = dom ? `${dom}_build` : null;
    R.SKL = id && exists(deps, id) ? [id] : [];
    return `SKL <- ${R.SKL.join(', ') || '(none)'}`;
  }
  if (target === 'SKL' && criteria === 'debug') {
    const id = dom ? `${dom}_debug` : null;
    R.SKL = id && exists(deps, id) ? [id] : R.SKL;
    return `SKL <- ${R.SKL.join(', ') || '(none)'}`;
  }
  if (target === 'MAP' && criteria === 'DOM') {
    const ids = R.DOM.map((d) => `map_${d}`).filter((id) => exists(deps, id));
    R.MAP = ids;
    return `MAP <- ${ids.join(', ') || '(none)'}`;
  }
  if (target === 'TOOL' && criteria === 'DOM') {
    R.TOOL = dom && TOOLCHAINS[dom] ? TOOLCHAINS[dom].slice() : [];
    return `TOOL <- ${R.TOOL.join(', ') || '(none)'}`;
  }
  if (target === 'TOOL' && criteria === 'QRY') {
    // Find a known toolchain name mentioned in the query.
    const toks = new Set(tokenize(R.QRY));
    const all = [].concat(...Object.values(TOOLCHAINS));
    const found = all.filter((t) => toks.has(t.toLowerCase()));
    R.TOOL = found;
    return found.length ? `TOOL <- ${found.join(', ')}` : 'TOOL <- NULL';
  }
  if (target === 'PROTO') {
    const add = [];
    if (criteria === 'anti_failure' || criteria === 'all') {
      if (exists(deps, 'hallucination_guards')) add.push('hallucination_guards');
      if (dom && exists(deps, `${dom}_anti_failure`)) add.push(`${dom}_anti_failure`);
    }
    if (criteria === 'dev_reference' || criteria === 'all') {
      // Genuine reference docs only (ref_*) — keep the giant tool_repo index and
      // any mis-tagged examples out of the composed LLM context.
      for (const s of reg.skills) if (s.category === 'dev_ref' && /^ref_/.test(s.skill_id)) add.push(s.skill_id);
    }
    if (criteria === 'func_encyclopedia' || criteria === 'all') {
      for (const s of reg.skills) if (s.category === 'func_pattern') add.push(s.skill_id);
    }
    if (criteria === 'all') {
      for (const s of reg.skills) if (s.category === 'build_order' && /^project_/.test(s.skill_id)) add.push(s.skill_id);
    }
    dedupePush(R.PROTO, add);
    return `PROTO += ${add.join(', ') || '(none)'}`;
  }
  return `${target} <- (noop ${criteria})`;
}

// --- COMPOSE ---------------------------------------------------------------

function doCompose(R, rt) {
  const deps = rt.deps;
  const cap = rt.opts.maxSourceChars || 2600;
  const ids = [];
  dedupePush(ids, R.SKL);
  dedupePush(ids, R.MAP);
  dedupePush(ids, R.PROTO);
  // Guarantee the rank-1 guardrail is always in context.
  if (!ids.includes('hallucination_guards') && exists(deps, 'hallucination_guards')) {
    ids.push('hallucination_guards');
  }
  const composed = [];
  for (const id of ids) {
    const s = deps.getSkill(id);
    if (!s || !s._body) continue;
    const body = s._body.length > cap ? s._body.slice(0, cap) + '\n…[truncated]…' : s._body;
    composed.push({ skill_id: s.skill_id, relpath: s.relpath, body });
  }
  rt.composed = composed;
  return `composed ${composed.length} source(s): ${composed.map((c) => c.skill_id).join(', ')}`;
}

// --- EXEC (live LLM or offline composer) -----------------------------------

function buildPrompt(R, rt) {
  const domLabel = R.DOM.length ? R.DOM.join(', ') : 'general';
  let system =
    `You are NAVIGATOR, a skill-routing AI agent now executing the ${R.INT || 'LOOKUP'} skill ` +
    `for the ${domLabel} domain. Answer the user's request using ONLY the Navigator sources ` +
    `provided below. Be concrete, correct, and concise. Cite sources inline by their skill_id in ` +
    `square brackets, e.g. [python_build]. If the sources do not cover something, say so plainly ` +
    `rather than inventing details. Honor the rank-1 anti-failure guardrails in [hallucination_guards].`;
  if (rt.engagement && rt.engagement.active) {
    const fmt = {
      'per-item': 'a per-item report: title, detail, and concrete next step for each point',
      assessment: 'a structured assessment: summary, then findings with severity/priority, then recommendations',
      objective: 'an objective-driven plan: the goal, the ordered steps to reach it, and a definition of done',
    }[rt.engagement.subMode] || 'a structured report';
    system +=
      `\n\nENGAGEMENT MODE is ACTIVE. Operating scope: "${rt.engagement.scope || '(no scope set yet)'}". ` +
      `Keep the answer strictly within that scope; if the request falls outside it, say so and stop. ` +
      `Format the output as ${fmt}.`;
  }
  const sourceText = rt.composed
    .map((s) => `### [${s.skill_id}]  (${s.relpath})\n${s.body}`)
    .join('\n\n');
  const user =
    `REQUEST: ${R.QRY}\n\n` +
    `SELECTED REGISTERS\n` +
    `  intent = ${R.INT}\n  domain = ${domLabel}\n  skill  = ${R.SKL.join(', ') || '(none)'}\n` +
    `  map    = ${R.MAP.join(', ') || '(none)'}\n  tools  = ${R.TOOL.join(', ') || '(none)'}\n\n` +
    `NAVIGATOR SOURCES\n${sourceText}`;
  return { system, user };
}

async function doExec(R, rt) {
  if (rt.composed.length === 0) doCompose(R, rt);

  if (rt.mode === 'live' && llm.hasKey()) {
    try {
      const { system, user } = buildPrompt(R, rt);
      const res = await llm.chat({
        system, user, max_tokens: 1200, temperature: 0.3,
        provider: rt.opts.provider || undefined,   // per-run LLM switch (from UI/CLI)
        model: rt.opts.model || undefined,
      });
      const text = (res.content || '').trim();
      if (text) {
        R.OUT = text;
        R.CONF = scoreConfidence(R, rt, text);
        R.FLG = 1;
        rt.execMode = 'live';
        rt.provider = res.provider;
        rt.model = res.model;
        rt.usage = res.usage;
        return `EXEC live (${res.provider} · ${res.model}) -> ${text.length} chars, conf=${R.CONF}`;
      }
      // empty content -> fall through to offline
      rt.execMode = 'offline (fallback)';
      R.OUT = offlineAnswer(R, rt);
      R.CONF = 72; R.FLG = 1;
      return `EXEC live returned empty; offline fallback -> ${R.OUT.length} chars`;
    } catch (err) {
      rt.execMode = 'offline (fallback)';
      R.ERR = String(err && err.message ? err.message : err);
      R.OUT = offlineAnswer(R, rt);
      R.CONF = 70; R.FLG = 1;
      return `EXEC live failed (${R.ERR}); offline fallback -> ${R.OUT.length} chars`;
    }
  }

  // Offline deterministic composer.
  rt.execMode = 'offline';
  R.OUT = offlineAnswer(R, rt);
  R.CONF = 75; R.FLG = 1;
  return `EXEC offline composer -> ${R.OUT.length} chars`;
}

function scoreConfidence(R, rt, text) {
  let c = 60;
  if (rt.composed.length >= 2) c += 15;
  if (R.SKL.length) c += 5;
  if (/\[[a-z0-9_]+\]/.test(text)) c += 10; // cited a source
  if (R.DOM.length) c += 5;
  return Math.min(c, 95);
}

/** Pull the PHASE headings out of a domain map body, if present. */
function mapPhases(deps, mapId) {
  const m = deps.getSkill(mapId);
  if (!m || !m._body) return [];
  const re = /^##\s+PHASE\s+\d+\s*[—–-]+\s*(.+?)\s*$/gim;
  const out = [];
  let mm;
  while ((mm = re.exec(m._body)) !== null) out.push(mm[1].replace(/\s+/g, ' ').trim());
  return out;
}

/** Deterministic, offline answer assembled purely from the loaded sources. */
function offlineAnswer(R, rt) {
  const deps = rt.deps;
  const domLabel = R.DOM.length ? R.DOM.join(', ') : 'general';
  const lines = [];
  lines.push(`## NAVIGATOR · ${R.INT || 'LOOKUP'} · ${domLabel}`);
  lines.push('');
  lines.push(`**Query** — ${R.QRY}`);
  lines.push(`**Intent** \`${R.INT}\` · **Domain(s)** \`${domLabel}\` · **Confidence** ${R.CONF || 75}`);
  lines.push('');

  // Plan from the map phases.
  for (const mapId of R.MAP) {
    const phases = mapPhases(deps, mapId);
    if (phases.length) {
      lines.push(`### Methodology — \`${mapId}\``);
      phases.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
      lines.push('');
      break;
    }
  }

  // Skill summary.
  for (const skId of R.SKL) {
    const s = deps.getSkill(skId);
    if (s) {
      lines.push(`### Skill — \`${skId}\``);
      if (s.description) lines.push(s.description);
      lines.push('');
      break;
    }
  }

  // Guardrails.
  const anti = R.PROTO.find((p) => /anti_failure|hallucination/.test(p));
  if (anti) {
    const s = deps.getSkill(anti);
    if (s && s.description) {
      lines.push(`### Rank-1 guardrail — \`${anti}\``);
      lines.push(s.description);
      lines.push('');
    }
  }

  // Tools.
  if (R.TOOL.length) {
    lines.push(`### Toolchain`);
    lines.push(R.TOOL.map((t) => `\`${t}\``).join(' · '));
    lines.push('');
  }

  // Source ledger.
  lines.push('### Sources loaded into context');
  for (const c of rt.composed) lines.push(`- \`${c.skill_id}\` — ${c.relpath}`);
  lines.push('');
  lines.push('> Offline composition (no live model). Set a provider key (`ZAI_API_KEY` or `DEEPSEEK_API_KEY`) in credentials.env for live EXEC generation.');
  return lines.join('\n');
}

// --- VERIFY ----------------------------------------------------------------

function doVerify(kind, R, rt) {
  if (kind === 'source') {
    const ok = rt.composed.length > 0;
    rt.verify.source = ok ? 'PASS' : 'FAIL';
    R.FLG = ok ? 1 : 0;
    return `source check: ${rt.verify.source} (${rt.composed.length} sources)`;
  }
  if (kind === 'hallucination') {
    // Heuristic: non-empty output is required; a cited source is a strong signal.
    const nonEmpty = R.OUT.trim().length > 0;
    const cited = /\[[a-z0-9_]+\]/.test(R.OUT) || rt.execMode.startsWith('offline');
    let v;
    if (!nonEmpty) v = 'FAIL';
    else if (!cited) v = 'WARN';
    else v = 'PASS';
    rt.verify.hallucination = v;
    R.FLG = v === 'FAIL' ? 0 : 1;
    return `hallucination guard: ${v}`;
  }
  if (kind === 'confidence') {
    rt.verify.confidence = R.CONF;
    rt.verify.verdict = R.CONF > 70 ? 'PASS' : 'LOW_CONF';
    R.FLG = R.CONF > 70 ? 1 : 0;
    return `confidence: ${R.CONF} -> ${rt.verify.verdict}`;
  }
  return `verify ${kind}`;
}

module.exports = { buildProgram, executeISA, assembleProgram };
