/* ============================================================
   NAVIGATOR · operator console — frontend controller
   Vanilla ES, zero dependencies. Talks to the navigator-server
   JSON API over relative URLs.
   ============================================================ */
'use strict';

/* ---------- tiny DOM helpers ---------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

/* ---------- shared app state ---------- */
const STATE = {
  registry: null,      // /api/registry payload
  skillsById: new Map(),
  loadedCtx: new Set(),
  ctxFilter: '',
  regSearch: '',
  regType: 'all',
  regSort: { key: 'skill_id', dir: 1 },
  validated: false,
};

const TYPE_ORDER = ['build', 'debug', 'map', 'rules', 'prototype', 'custom'];

/* ============================================================
   NAVIGATION
   ============================================================ */
function initNav() {
  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchSection(btn.dataset.section));
  });
}
function switchSection(name) {
  $$('.nav-item').forEach((b) => b.classList.toggle('is-active', b.dataset.section === name));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === name));
  $('#crumb-leaf').textContent = name;
  // lazy section initialisers
  if (name === 'orders' && !$('#orders-grid').dataset.loaded) loadOrders();
  if (name === 'context' && !$('#ctx-picklist').dataset.loaded) initContext();
  if (name === 'isa' && !$('#isa-program').dataset.loaded) loadISA();
  if (name === 'engagement') refreshEngagement();
}

/* ============================================================
   BOOT / HEALTH
   ============================================================ */
async function boot() {
  const sub = $('#boot-sub');
  try {
    sub.textContent = 'probing server health…';
    const health = await getJSON('/api/health');
    sub.textContent = `scanning ${health.fileCount} framework files…`;
    await loadRegistry();
    paintHealth(true, health);
  } catch (e) {
    sub.textContent = 'server unreachable — retrying…';
    paintHealth(false);
    // soft retry once
    await new Promise((r) => setTimeout(r, 900));
    try { await loadRegistry(); paintHealth(true, await getJSON('/api/health')); }
    catch (_) { sub.textContent = 'server offline. start navigator-server.js'; return; }
  }
  // reveal shell
  $('#shell').hidden = false;
  const overlay = $('#boot-overlay');
  overlay.classList.add('gone');
  setTimeout(() => overlay.remove(), 600);
}

function paintHealth(ok, health) {
  const pill = $('#health-pill');
  pill.classList.toggle('ok', ok);
  pill.classList.toggle('bad', !ok);
  $('#health-text').textContent = ok ? 'online' : 'offline';
  if (ok && health) {
    const t = new Date(health.scannedAt);
    $('#foot-meta').textContent = `${health.fileCount} files · scanned ${t.toLocaleTimeString()}`;
    $('#env-tag').textContent = `${health.fileCount} skills resident`;
  }
}

/* ============================================================
   REGISTRY (load once, reused everywhere)
   ============================================================ */
async function loadRegistry() {
  const reg = await getJSON('/api/registry');
  STATE.registry = reg;
  STATE.skillsById = new Map(reg.skills.map((s) => [s.skill_id, s]));
  renderOverview();
  renderRegistryFilters();
  renderRegistry();
}

/* ============================================================
   OVERVIEW
   ============================================================ */
function renderOverview() {
  const { stats } = STATE.registry;
  const cards = [
    { v: stats.totalFiles, l: 'framework files', s: 'manifest-bearing .md' },
    { v: stats.byType.build || 0, l: 'build skills', s: 'pairs_with debug' },
    { v: stats.byType.debug || 0, l: 'debug skills', s: 'error-pattern keyed' },
    { v: stats.antiFailureCount, l: 'anti-failure guards', s: 'rank-1 authority' },
    { v: stats.mapCount, l: 'domain maps', s: 'keyword router source' },
    { v: stats.rulesCount, l: 'rules-engine files', s: 'always resident' },
    { v: `${stats.tripletComplete}/${stats.tripletTotal}`, l: 'triplets complete', s: 'build·debug·anti-failure' },
  ];
  const grid = $('#overview-stats');
  grid.innerHTML = '';
  cards.forEach((c) => {
    grid.appendChild(el('div', 'stat-card',
      `<div class="stat-val">${esc(c.v)}</div><div class="stat-label">${esc(c.l)}</div><div class="stat-sub">${esc(c.s)}</div>`));
  });

  // triplet matrix
  const tm = $('#triplet-matrix');
  tm.innerHTML = '';
  tm.appendChild(el('div', 'tm-row head',
    `<div class="tm-cell">domain</div><div class="tm-cell">build</div><div class="tm-cell">debug</div><div class="tm-cell">anti-failure</div><div class="tm-cell">status</div>`));
  (STATE.registry.triplets || []).forEach((t) => {
    const mark = (ok) => `<span class="tm-mark ${ok ? 'yes' : 'no'}">${ok ? '✓' : '✕'}</span>`;
    const row = el('div', 'tm-row',
      `<div class="tm-cell tm-dom">${esc(t.domain)}</div>
       <div class="tm-cell">${mark(!!t.build)}<span class="cat-mini">${t.build ? esc(t.build) : 'missing'}</span></div>
       <div class="tm-cell">${mark(!!t.debug)}<span class="cat-mini">${t.debug ? esc(t.debug) : 'missing'}</span></div>
       <div class="tm-cell">${mark(!!t.antiFailure)}<span class="cat-mini">${t.antiFailure ? esc(t.antiFailure) : 'missing'}</span></div>
       <div class="tm-cell"><span class="tm-status ${t.complete ? 'ok' : 'bad'}">${t.complete ? 'complete' : 'partial'}</span></div>`);
    tm.appendChild(row);
  });

  // type bars
  const byType = STATE.registry.stats.byType || {};
  const max = Math.max(1, ...Object.values(byType));
  const bars = $('#type-bars');
  bars.innerHTML = '';
  const types = [...new Set([...TYPE_ORDER, ...Object.keys(byType)])].filter((t) => byType[t]);
  types.forEach((t) => {
    const n = byType[t] || 0;
    const row = el('div', 'type-bar',
      `<span class="tb-name">${esc(t)}</span>
       <div class="tb-track"><div class="tb-fill" style="width:${(n / max) * 100}%"></div></div>
       <span class="tb-num">${n}</span>`);
    bars.appendChild(row);
  });
}

/* ============================================================
   REGISTRY TABLE
   ============================================================ */
function renderRegistryFilters() {
  const wrap = $('#reg-type-filters');
  wrap.innerHTML = '';
  const types = ['all', ...TYPE_ORDER.filter((t) => (STATE.registry.stats.byType[t] || 0) > 0)];
  types.forEach((t) => {
    const chip = el('button', 'fchip' + (t === STATE.regType ? ' on' : ''), esc(t));
    chip.addEventListener('click', () => {
      STATE.regType = t;
      $$('.fchip', wrap).forEach((c) => c.classList.toggle('on', c.textContent === t));
      renderRegistry();
    });
    wrap.appendChild(chip);
  });

  const search = $('#reg-search');
  search.value = STATE.regSearch;
  search.addEventListener('input', () => { STATE.regSearch = search.value.toLowerCase(); renderRegistry(); });

  $$('.reg-table thead th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (STATE.regSort.key === k) STATE.regSort.dir *= -1;
      else STATE.regSort = { key: k, dir: 1 };
      renderRegistry();
    });
  });
}

function triggerSummary(tr) {
  if (!tr) return '';
  const kw = (tr.keywords || []).slice(0, 6).join(', ');
  const ext = (tr.extensions || []).join(' ');
  return [kw, ext].filter(Boolean).join(' · ');
}

function renderRegistry() {
  let rows = STATE.registry.skills.slice();
  if (STATE.regType !== 'all') rows = rows.filter((s) => s.type === STATE.regType);
  if (STATE.regSearch) {
    const q = STATE.regSearch;
    rows = rows.filter((s) => {
      const hay = [s.skill_id, s.description, s.category, s.relpath,
        ...(s.triggers?.keywords || []), ...(s.triggers?.error_patterns || [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  const { key, dir } = STATE.regSort;
  rows.sort((a, b) => {
    let av = a[key], bv = b[key];
    if (typeof av === 'number' || typeof bv === 'number') return ((av || 0) - (bv || 0)) * dir;
    return String(av || '').localeCompare(String(bv || '')) * dir;
  });

  const body = $('#reg-body');
  body.innerHTML = '';
  rows.forEach((s) => {
    const tr = el('tr');
    tr.innerHTML =
      `<td class="cid">${esc(s.skill_id)}</td>
       <td><span class="type-pill ${esc(s.type)}">${esc(s.type)}</span></td>
       <td class="cat-mini">${esc(s.category || '—')}</td>
       <td><span class="trig-mini">${esc(triggerSummary(s.triggers)) || '—'}</span></td>
       <td class="cat-mini">${s.priority == null ? '—' : s.priority}</td>
       <td class="cat-mini">${fmt(s.lines)}</td>
       <td class="marks"><span class="${s.hasCrossRefs ? 'ok' : 'bad'}">${s.hasCrossRefs ? '⊕' : '⊗'}</span><span class="${s.hasEndMarker ? 'ok' : 'bad'}">${s.hasEndMarker ? '⊕' : '⊗'}</span></td>`;
    tr.addEventListener('click', () => openDrawer(s.skill_id));
    body.appendChild(tr);
  });
  $('#reg-count').textContent = `${rows.length} of ${STATE.registry.skills.length} skills`;
}

/* ============================================================
   SKILL DRAWER
   ============================================================ */
async function openDrawer(id) {
  const s = STATE.skillsById.get(id);
  if (!s) return;
  $('#drawer-id').textContent = s.skill_id;
  $('#drawer-path').textContent = s.relpath;
  const tr = s.triggers || {};
  const arr = (a) => (a && a.length ? a.join(', ') : '—');
  $('#drawer-meta').innerHTML = [
    field('type', s.type), field('category', s.category || 'null'),
    field('priority', s.priority == null ? 'default' : s.priority),
    field('pairs_with', s.pairs_with || '—'),
    field('depends_on', arr(s.depends_on), true),
    field('keywords', arr(tr.keywords), true),
    field('extensions', arr(tr.extensions)),
    field('languages', arr(tr.languages)),
    field('error_patterns', arr(tr.error_patterns), true),
    field('platforms', arr(tr.platforms)),
    field('description', esc(s.description), true),
    field('markers', `cross-refs ${s.hasCrossRefs ? '✓' : '✕'} · end ${s.hasEndMarker ? '✓' : '✕'} · ${fmt(s.bytes)} bytes`, true),
  ].join('');

  $('#drawer').hidden = false;
  $('#drawer-scrim').hidden = false;
  const raw = $('#drawer-raw');
  raw.textContent = 'loading raw skill…';
  try {
    const r = await getJSON(`/api/raw?id=${encodeURIComponent(id)}`);
    raw.textContent = r.markdown || '(empty)';
  } catch (e) { raw.textContent = `failed to load: ${e.message}`; }
}
function field(k, v, full) {
  return `<div class="dm-field${full ? ' full' : ''}"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
}
function closeDrawer() { $('#drawer').hidden = true; $('#drawer-scrim').hidden = true; }

/* ============================================================
   ROUTER CONSOLE — the centerpiece
   ============================================================ */
const ROUTER_EXAMPLES = [
  'why does my rust tokio task crash on borrow?',
  'build a fastapi rest endpoint that returns json',
  'fix python asyncio traceback in my pytest run',
  'how does cargo handle crate lifetimes?',
  'design the architecture for a new cli tool',
  'continue the example_cli_tool build order',
];

function initRouter() {
  const chips = $('#router-examples');
  ROUTER_EXAMPLES.forEach((q) => {
    const c = el('button', 'ex-chip', esc(q));
    c.addEventListener('click', () => { $('#router-input').value = q; runRoute(q); });
    chips.appendChild(c);
  });
  $('#router-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#router-input').value.trim();
    if (q) runRoute(q);
  });
}

async function runRoute(q) {
  const result = $('#router-result');
  const empty = $('#router-empty');
  empty.hidden = true;
  result.hidden = false;
  const pipe = $('#pipeline');
  pipe.innerHTML = `<li class="stage" style="animation-delay:0s"><div class="stage-card mode-note">routing “${esc(q)}”…</div></li>`;
  let data;
  try { data = await getJSON(`/api/route?q=${encodeURIComponent(q)}`); }
  catch (e) { pipe.innerHTML = `<li class="stage"><div class="stage-card mode-note flag">route failed: ${esc(e.message)}</div></li>`; return; }
  renderPipeline(data);
}

function stage(n, title, bodyHTML, delay) {
  const li = el('li', 'stage');
  li.style.animationDelay = `${delay}s`;
  li.innerHTML =
    `<div class="stage-head"><span class="stage-n">STAGE ${n}</span><span class="stage-title">${esc(title)}</span></div>
     <div class="stage-card">${bodyHTML}</div>`;
  return li;
}

function renderPipeline(d) {
  const pipe = $('#pipeline');
  pipe.innerHTML = '';
  let n = 1, delay = 0;
  const step = 0.12;
  const add = (title, html) => { pipe.appendChild(stage(n++, title, html, delay)); delay += step; };

  /* 1 · Mode Check */
  const mode = d.mode || {};
  add('Mode Check', `<div class="mode-note">${mode.transition
    ? `<span class="flag">⚑ transition detected</span> — ${esc(mode.note || '')}`
    : `no mode transition · <span style="color:var(--ink-2)">${esc(mode.note || 'standard routing')}</span>`}</div>`);

  /* 2 · Classify Intent */
  const intent = d.intent || { selected: '—', candidates: [] };
  const maxScore = Math.max(1, ...(intent.candidates || []).map((c) => c.score || 0));
  const rows = (intent.candidates || []).map((c) => {
    const win = c.intent === intent.selected;
    const matched = (c.matched || []).join(', ');
    return `<div class="intent-row ${win ? 'win' : ''}">
        <span class="ir-name">${esc(c.intent)}${win ? '<span class="win-badge">SELECTED</span>' : ''}</span>
        <div class="ir-track"><div class="ir-fill" style="width:${((c.score || 0) / maxScore) * 100}%"></div></div>
        <span class="ir-num">${c.score || 0}</span>
        ${matched ? `<span class="ir-matched">matched: ${esc(matched)}</span>` : ''}
      </div>`;
  }).join('');
  add('Classify Intent', rows || '<div class="af-empty">no intent signal</div>');

  /* 3 · Check Projects */
  const proj = d.project || {};
  add('Check Projects', `<div class="proj-note">${proj.matched
    ? `active project matched → <b style="color:var(--accent)">${esc(proj.id || 'project')}</b>`
    : 'no active build-order / project match'}</div>
    ${renderDomains(d.domains)}`);

  /* 4 · Select Sources */
  add('Select Sources', renderSources(d.sources) + renderAFTiers(d.antiFailureTier));

  /* 5 · Resource Check */
  add('Resource Check', renderResources(d.resourceCheck));

  /* 6 · Quality Gates */
  add('Quality Gates', renderGates(d.qualityGates));

  /* 7 · Deliver */
  add('Deliver', `${renderChain(d.chain)}<div class="deliver-note">${esc(d.deliverNote || 'ready to deliver')}</div>`);
}

function renderDomains(domains) {
  if (!domains || !domains.length) return '<div style="margin-top:9px" class="af-empty">no domain keywords matched</div>';
  return '<div style="margin-top:11px">' + domains.map((dm) =>
    `<span class="dom-pill">${esc(dm.domain)} <span class="ds">${dm.score}</span>${
      dm.matched && dm.matched.length ? `<span class="dm">[${esc(dm.matched.join(' '))}]</span>` : ''}</span>`).join('') + '</div>';
}

function srcChip(id, kind) {
  if (!id) return `<span class="src-chip null"><span class="sc-kind">${esc(kind)}</span> none</span>`;
  return `<span class="src-chip" data-jump="${esc(id)}"><span class="sc-kind">${esc(kind)}</span>${esc(id)}</span>`;
}
function renderSources(src) {
  src = src || {};
  const grp = (label, html) => `<div class="src-group"><div class="sg-label">${esc(label)}</div><div>${html}</div></div>`;
  const list = (arr, kind) => (arr && arr.length ? arr.map((i) => srcChip(i, kind)).join('') : srcChip(null, kind));
  let html = '';
  html += grp('domain maps', list(src.maps, 'map'));
  html += grp('skills', srcChip(src.buildSkill, 'build') + srcChip(src.debugSkill, 'debug'));
  if (src.references && src.references.length) html += grp('references', list(src.references, 'ref'));
  if (src.patterns && src.patterns.length) html += grp('pattern libs', list(src.patterns, 'pat'));
  return html;
}

function renderAFTiers(t) {
  t = t || {};
  const tier = (cls, label, ids) => {
    const items = (ids && ids.length)
      ? ids.map((i) => `<div class="af-item" data-jump="${esc(i)}">${esc(i)}</div>`).join('')
      : '<div class="af-empty">none</div>';
    return `<div class="af-tier ${cls}"><h4>${esc(label)}</h4>${items}</div>`;
  };
  return `<div class="src-group"><div class="sg-label">anti-failure tiers</div>
    <div class="af-tiers">
      ${tier('mandatory', 'mandatory', t.mandatory)}
      ${tier('domain', 'domain-matched', t.domainMatched)}
      ${tier('context', 'context-triggered', t.contextTriggered)}
    </div></div>`;
}

function renderResources(rc) {
  rc = rc || { required: [], missing: [] };
  if (!rc.required || !rc.required.length) return '<div class="af-empty">no external resources required</div>';
  return rc.required.map((r) => {
    const missing = (rc.missing || []).includes(r);
    return `<div class="res-line"><span class="${missing ? 'miss' : 'ok'}">${missing ? '✕ missing' : '✓ present'}</span> · ${esc(r)}</div>`;
  }).join('');
}

function renderGates(gates) {
  if (!gates || !gates.length) return '<div class="af-empty">no gates</div>';
  return gates.map((g) =>
    `<div class="gate-row ${g.applies ? 'on' : 'off'}"><span class="g-mark">${g.applies ? '✓' : '·'}</span>${esc(g.gate)}</div>`).join('');
}

function renderChain(chain) {
  if (!chain || !chain.length) return '';
  return `<div class="sg-label" style="margin-bottom:6px">execution chain</div><ol class="chain-list">${
    chain.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>`;
}

/* delegate clicks: jump-to-registry from any chip with data-jump */
document.addEventListener('click', (e) => {
  const jump = e.target.closest('[data-jump]');
  if (jump) {
    const id = jump.getAttribute('data-jump');
    if (STATE.skillsById.has(id)) { switchSection('registry'); openDrawer(id); }
  }
});

/* ============================================================
   ISA CONSOLE — routing as deterministic microcode
   ============================================================ */
const ISA_EXAMPLES = [
  'fix a python ModuleNotFoundError',
  'build a python CLI that parses CSV',
  'how does cargo handle crate lifetimes?',
  'design the architecture for a new cli tool',
];
const ISA_REG_NAMES = ['QRY', 'INT', 'DOM', 'SKL', 'MAP', 'TOOL', 'PROTO', 'CTX', 'RETRY', 'ERR', 'CONF', 'OUT', 'FLG', 'TRACE'];

const ISA = {
  program: [],          // program[] from /api/isa/program
  pcIndex: new Map(),   // program[].i  ->  DOM node
  regDesc: new Map(),   // reg name -> description
  exec: null,           // last /api/isa/exec payload
  frames: [],           // exec.trace[]
  frame: -1,            // current frame index (-1 = reset / frame 0 base)
  timer: null,          // auto-play interval id
  mode: 'live',
  hasLiveKey: false,
  loadedExamples: false,
  provider: null,       // selected LLM provider (null = server default)
  model: null,          // selected model id (null = provider default)
  providers: [],        // [{provider,label,hasKey,model,models}]
  catalog: {},          // provider -> [model ids]
};

async function loadISA() {
  const prog = $('#isa-program');
  // example chips (build once)
  if (!ISA.loadedExamples) {
    const chips = $('#isa-examples');
    ISA_EXAMPLES.forEach((q) => {
      const c = el('button', 'ex-chip', esc(q));
      c.addEventListener('click', () => { $('#isa-input').value = q; runISA(q); });
      chips.appendChild(c);
    });
    initISAControls();
    ISA.loadedExamples = true;
  }
  let data;
  try { data = await getJSON('/api/isa/program'); }
  catch (e) { prog.innerHTML = `<div class="skeleton-row">failed to load program: ${esc(e.message)}</div>`; return; }

  ISA.program = data.program || [];
  ISA.regDesc = new Map((data.registers || []).map((r) => [r.name, r.desc]));
  $('#isa-prog-note').textContent = `${ISA.program.length} ops · ${(data.opcodes || []).length} opcodes`;
  paintISALLM(data);
  initISAPicker(data);
  renderISAProgram();
  renderISARegs(null, null);
  prog.dataset.loaded = '1';   // only mark loaded after a successful render
}

/* ---- LLM provider + model switcher -------------------------------------- */
function isaOpt(value, text, selected) {
  const o = document.createElement('option');
  o.value = value;
  if (text != null) o.textContent = text;
  if (selected) o.selected = true;
  return o;
}

function fillISAModelList(provider) {
  const dl = $('#isa-model-list');
  dl.innerHTML = '';
  (ISA.catalog[provider] || []).forEach((m) => dl.appendChild(isaOpt(m)));
}

function syncISAPicker() {
  const provSel = $('#isa-provider');
  const off = ISA.mode === 'offline' || !ISA.hasLiveKey || provSel.options.length === 0;
  provSel.disabled = off;
  $('#isa-model').disabled = off;
  const wrap = $('#isa-llmpick');
  if (wrap) wrap.classList.toggle('is-off', off);
}

function initISAPicker(data) {
  ISA.providers = data.providers || [];
  ISA.catalog = data.models || {};
  const provSel = $('#isa-provider');
  const modelInput = $('#isa-model');
  const withKey = ISA.providers.filter((p) => p.hasKey);

  provSel.innerHTML = '';
  if (!withKey.length) {
    provSel.appendChild(isaOpt('', 'offline'));
  } else {
    withKey.forEach((p) => provSel.appendChild(isaOpt(p.provider, p.label, p.provider === data.providerName)));
  }

  ISA.provider = data.providerName || (withKey[0] && withKey[0].provider) || null;
  ISA.model = data.model || null;
  fillISAModelList(ISA.provider);
  modelInput.value = ISA.model || '';

  if (!ISA.pickerWired) {
    provSel.addEventListener('change', () => {
      ISA.provider = provSel.value || null;
      const list = ISA.catalog[ISA.provider] || [];
      ISA.model = list[0] || '';
      fillISAModelList(ISA.provider);
      $('#isa-model').value = ISA.model || '';
    });
    const onModel = () => { ISA.model = $('#isa-model').value.trim() || null; };
    modelInput.addEventListener('change', onModel);
    modelInput.addEventListener('input', onModel);
    ISA.pickerWired = true;
  }
  syncISAPicker();
}

function initISAControls() {
  $('#isa-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#isa-input').value.trim();
    if (q) runISA(q);
  });
  $$('.isa-mode', $('#isa-toggle')).forEach((b) => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      ISA.mode = b.dataset.mode;
      $$('.isa-mode', $('#isa-toggle')).forEach((x) => x.classList.toggle('on', x === b));
      syncISAPicker();
    });
  });
  $('#isa-step').addEventListener('click', () => stepISA());
  $('#isa-reset').addEventListener('click', () => resetISA());
}

function paintISALLM(data) {
  data = data || {};
  ISA.hasLiveKey = !!data.hasLiveKey;
  const provider = data.provider || 'llm';
  const model = data.model || '';
  const src = data.keySource || 'credentials.env';
  const pill = $('#isa-llm');
  const liveBtn = $('.isa-mode[data-mode="live"]', $('#isa-toggle'));
  const offBtn = $('.isa-mode[data-mode="offline"]', $('#isa-toggle'));
  pill.classList.toggle('ok', ISA.hasLiveKey);
  pill.classList.toggle('off', !ISA.hasLiveKey);
  if (ISA.hasLiveKey) {
    ISA.mode = 'live';
    liveBtn.disabled = false;
    liveBtn.classList.add('on');
    offBtn.classList.remove('on');
    $('#isa-llm-text').textContent = `LLM: ${provider}${model ? ' · ' + model : ''} (${src})`;
  } else {
    ISA.mode = 'offline';
    liveBtn.disabled = true;
    liveBtn.classList.remove('on');
    offBtn.classList.add('on');
    $('#isa-llm-text').textContent = `LLM: offline (no ${provider} key)`;
  }
}

function renderISAProgram() {
  const wrap = $('#isa-program');
  wrap.innerHTML = '';
  ISA.pcIndex = new Map();
  ISA.program.forEach((p) => {
    const args = (p.args || []).map((a) => `<span class="ip-arg">${esc(a)}</span>`).join('<span class="ip-comma">, </span>');
    const line = el('div', 'ip-line');
    line.dataset.pc = p.i;
    line.innerHTML =
      `<span class="ip-idx">${String(p.i).padStart(2, '0')}</span>` +
      (p.label ? `<span class="ip-label">${esc(p.label)}:</span>` : '<span class="ip-label empty"></span>') +
      `<span class="ip-op">${esc(p.op)}</span>` +
      `<span class="ip-args">${args}</span>` +
      (p.note ? `<span class="ip-note">; ${esc(p.note)}</span>` : '');
    wrap.appendChild(line);
    ISA.pcIndex.set(p.i, line);
  });
}

function regToText(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length ? v.join(', ') : null;
  const s = String(v);
  return s.length ? s : null;
}

function renderISARegs(regs, prevRegs) {
  const wrap = $('#isa-regs');
  wrap.innerHTML = '';
  ISA_REG_NAMES.forEach((name) => {
    const raw = regs ? regs[name] : undefined;
    const txt = regToText(raw);
    const prevTxt = prevRegs ? regToText(prevRegs[name]) : undefined;
    const changed = regs && prevRegs && txt !== prevTxt;
    const isList = Array.isArray(raw);
    const row = el('div', 'reg-row' + (changed ? ' flash' : ''));
    const valHtml = txt == null
      ? '<span class="reg-empty">∅</span>'
      : (isList
        ? raw.map((c) => `<span class="reg-chip">${esc(c)}</span>`).join('')
        : `<span class="reg-val">${esc(txt)}</span>`);
    row.innerHTML =
      `<span class="reg-name" title="${esc(ISA.regDesc.get(name) || '')}">${esc(name)}</span>` +
      `<div class="reg-cell">${valHtml}</div>`;
    wrap.appendChild(row);
  });
}

async function runISA(q) {
  $('#isa-input').value = q;
  resetISA();
  const runBtn = $('#isa-run');
  runBtn.disabled = true;
  const trace = $('#isa-trace');
  const label = ISA.mode === 'live'
    ? (`${ISA.provider || ''}${ISA.model ? ' · ' + ISA.model : ''}`.trim() || 'live')
    : 'offline';
  trace.innerHTML = `<div class="isa-exec"><span class="isa-spin"></span>executing “${esc(q)}” · ${esc(label)}…</div>`;

  const payload = { query: q, mode: ISA.mode };
  if (ISA.mode === 'live') {
    if (ISA.provider) payload.provider = ISA.provider;
    if (ISA.model) payload.model = ISA.model;
  }
  let data;
  try { data = await postJSON('/api/isa/exec', payload); }
  catch (e) {
    trace.innerHTML = `<div class="isa-trace-empty flag">exec failed: ${esc(e.message)}</div>`;
    runBtn.disabled = false;
    return;
  }
  runBtn.disabled = false;
  ISA.exec = data;
  ISA.frames = data.trace || [];
  trace.innerHTML = '';
  ISA.frame = -1;
  if (!ISA.frames.length) { trace.innerHTML = '<div class="isa-trace-empty">no trace frames returned.</div>'; return; }
  playISA();
}

function playISA() {
  clearInterval(ISA.timer);
  ISA.timer = setInterval(() => {
    if (!stepISA()) clearInterval(ISA.timer);
  }, 120);
}

/* advance exactly one frame; returns false when at the end */
function stepISA() {
  if (!ISA.frames.length || ISA.frame >= ISA.frames.length - 1) {
    if (ISA.frames.length) revealISAOutput();
    return false;
  }
  ISA.frame += 1;
  const f = ISA.frames[ISA.frame];
  const prev = ISA.frame > 0 ? ISA.frames[ISA.frame - 1] : null;

  // highlight program line at f.pc
  $$('.ip-line.cur', $('#isa-program')).forEach((n) => n.classList.remove('cur'));
  const line = ISA.pcIndex.get(f.pc);
  if (line) {
    line.classList.add('cur');
    line.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // registers from this frame (flash deltas vs previous frame)
  renderISARegs(f.regs, prev ? prev.regs : null);

  // append trace line
  appendISATrace(f);

  // reveal output once we reach the last frame
  if (ISA.frame === ISA.frames.length - 1) revealISAOutput();
  return true;
}

function appendISATrace(f) {
  const trace = $('#isa-trace');
  const empty = $('#isa-trace-empty');
  if (empty) empty.remove();
  const args = (f.args || []).join(' ');
  const row = el('div', 'isa-tr');
  row.innerHTML =
    `<span class="tr-step">${String(f.step).padStart(2, '0')}</span>` +
    (f.label ? `<span class="tr-label">${esc(f.label)}</span>` : '') +
    `<span class="tr-op">${esc(f.op)}</span>` +
    (args ? `<span class="tr-args">${esc(args)}</span>` : '') +
    (f.note ? `<span class="tr-note">— ${esc(f.note)}</span>` : '');
  trace.appendChild(row);
  trace.scrollTop = trace.scrollHeight;
}

function resetISA() {
  clearInterval(ISA.timer);
  ISA.frame = -1;
  $$('.ip-line.cur', $('#isa-program')).forEach((n) => n.classList.remove('cur'));
  const trace = $('#isa-trace');
  trace.innerHTML = '<div class="isa-trace-empty" id="isa-trace-empty">Run a query to stream the execution trace.</div>';
  $('#isa-output').hidden = true;
  // restore baseline register view (frame 0 if we have one, else blank)
  if (ISA.frames && ISA.frames.length) renderISARegs(null, null);
  else renderISARegs(null, null);
}

function revealISAOutput() {
  const d = ISA.exec;
  if (!d) return;
  const out = $('#isa-output');
  out.hidden = false;

  // mode + model badge
  const badges = $('#isa-out-badges');
  const modeLive = (d.execMode || '').toLowerCase() === 'live';
  badges.innerHTML =
    `<span class="isa-badge mode ${modeLive ? 'live' : 'offline'}">${esc((d.execMode || 'offline').toUpperCase())}</span>` +
    (d.model ? `<span class="isa-badge model">${esc(d.model)}</span>` : '') +
    `<span class="isa-badge steps">${d.steps || ISA.frames.length} ops</span>`;

  // verify badges
  const v = d.verify || {};
  const vc = (status) => {
    const s = String(status || '').toUpperCase();
    return s === 'PASS' ? 'pass' : (s === 'WARN' || s === 'LOW_CONF' ? 'warn' : 'fail');
  };
  $('#isa-verify').innerHTML =
    vbadge('source', v.source, vc(v.source)) +
    vbadge('hallucination', v.hallucination, vc(v.hallucination)) +
    vbadge('confidence', (d.confidence != null ? d.confidence : v.confidence) + '%', cConf(d.confidence != null ? d.confidence : v.confidence)) +
    vbadge('verdict', v.verdict, vc(v.verdict));

  // sources
  const sw = $('#isa-out-sources');
  const sources = d.sources || [];
  sw.innerHTML = sources.length
    ? sources.map((s) =>
        `<span class="isa-src" title="${esc(s.relpath || '')}">${esc(s.skill_id)}<span class="src-chars">${fmt(s.chars)}c</span></span>`).join('')
    : '<span class="af-empty">no sources cited</span>';

  // answer body (minimal markdown)
  $('#isa-out-body').innerHTML = renderISAMarkdown(d.out || '');
}

function vbadge(label, value, cls) {
  return `<div class="vb ${cls}"><span class="vb-k">${esc(label)}</span><span class="vb-v">${esc(value == null ? '—' : value)}</span></div>`;
}
function cConf(n) {
  n = Number(n) || 0;
  return n >= 70 ? 'pass' : (n >= 40 ? 'warn' : 'fail');
}

/* minimal markdown: fenced code → <pre>, plus headings/bold/inline-code in prose */
function renderISAMarkdown(md) {
  md = String(md || '');
  const parts = md.split(/```/);
  let html = '';
  parts.forEach((chunk, i) => {
    if (i % 2 === 1) {
      // fenced code block: drop an optional language line
      const body = chunk.replace(/^[^\n]*\n/, (m) => (/^[a-zA-Z0-9_+-]*\s*$/.test(m.trim()) ? '' : m));
      html += `<pre class="isa-code">${esc(body.replace(/\n$/, ''))}</pre>`;
    } else {
      html += isaProse(chunk);
    }
  });
  return html || '<span class="af-empty">empty answer</span>';
}
function isaProse(text) {
  return esc(text)
    .replace(/^######\s?(.+)$/gm, '<h6>$1</h6>')
    .replace(/^#####\s?(.+)$/gm, '<h5>$1</h5>')
    .replace(/^####\s?(.+)$/gm, '<h4>$1</h4>')
    .replace(/^###\s?(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s?(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s?(.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n{2,}/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

/* ============================================================
   CONTEXT BUDGET
   ============================================================ */
function initContext() {
  $('#ctx-picklist').dataset.loaded = '1';
  const search = $('#ctx-search');
  search.addEventListener('input', () => { STATE.ctxFilter = search.value.toLowerCase(); renderPicklist(); });
  renderPicklist();
  refreshContext();
}
function renderPicklist() {
  const list = $('#ctx-picklist');
  list.innerHTML = '';
  let skills = STATE.registry.skills.slice().sort((a, b) => a.skill_id.localeCompare(b.skill_id));
  if (STATE.ctxFilter) skills = skills.filter((s) => (s.skill_id + ' ' + s.type).toLowerCase().includes(STATE.ctxFilter));
  skills.forEach((s) => {
    const tok = Math.ceil((s.bytes || 0) / 4);
    const row = el('label', 'pick-row');
    const checked = STATE.loadedCtx.has(s.skill_id) ? 'checked' : '';
    row.innerHTML =
      `<input type="checkbox" ${checked} data-id="${esc(s.skill_id)}" />
       <span class="pr-id">${esc(s.skill_id)}</span>
       <span class="pr-type">${esc(s.type)}</span>
       <span class="pr-tok">${fmt(tok)}t</span>`;
    row.querySelector('input').addEventListener('change', (ev) => {
      if (ev.target.checked) STATE.loadedCtx.add(s.skill_id);
      else STATE.loadedCtx.delete(s.skill_id);
      refreshContext();
    });
    list.appendChild(row);
  });
  $('#ctx-pick-count').textContent = `${skills.length} sources`;
}

async function refreshContext() {
  const ids = [...STATE.loadedCtx];
  let data;
  try { data = await getJSON(`/api/context?load=${encodeURIComponent(ids.join(','))}`); }
  catch (e) { $('#ctx-readout').textContent = `context query failed: ${e.message}`; return; }

  const fill = $('#ctx-fill');
  const lvl = (data.level || 'GREEN').toUpperCase();
  fill.style.width = `${Math.min(100, data.percent || 0)}%`;
  fill.className = 'meter-fill ' + lvl.toLowerCase();

  $('#ctx-readout').innerHTML =
    `reserved <b>${fmt(data.reservedTokens)}</b> + loaded <b>${fmt(data.loadedTokens)}</b>
     = <b>${fmt((data.reservedTokens || 0) + (data.loadedTokens || 0))}</b> / ${fmt(data.totalBudget)} tokens
     · <b>${(data.percent || 0).toFixed(1)}%</b><span class="lvl ${lvl}">${lvl}</span>`;

  $('#ctx-reserved-tok').textContent = fmt(data.reservedTokens);
  $('#ctx-loaded-tok').textContent = fmt(data.loadedTokens);
  fillList($('#ctx-reserved-list'), data.reserved);
  fillList($('#ctx-loaded-list'), data.loaded);
}
function fillList(ul, items) {
  ul.innerHTML = '';
  if (!items || !items.length) { ul.appendChild(el('li', '', '<span style="color:var(--ink-3)">none</span>')); return; }
  items.forEach((i) => ul.appendChild(el('li', '', `${esc(i.id)}<span>${fmt(i.tokens)}t</span>`)));
}

/* ============================================================
   VALIDATION
   ============================================================ */
function initValidation() {
  $('#val-run').addEventListener('click', runValidation);
}
async function runValidation() {
  const btn = $('#val-run');
  btn.disabled = true; btn.textContent = 'running…';
  const list = $('#val-list');
  list.innerHTML = '<div class="skeleton-row">executing 27 checks…</div>';
  let data;
  try { data = await getJSON('/api/validate'); }
  catch (e) { list.innerHTML = `<div class="val-item fail"><span class="vi-n">!</span><div><div class="vi-name">validation request failed</div><div class="vi-detail">${esc(e.message)}</div></div><span class="val-badge fail">error</span></div>`; btn.disabled = false; btn.textContent = 'Run validation'; return; }

  // ring
  const wrap = $('#val-ring-wrap'); wrap.hidden = false;
  const circ = 2 * Math.PI * 52;
  const fg = $('#ring-fg');
  fg.style.strokeDasharray = circ;
  const ratio = data.total ? data.passed / data.total : 0;
  fg.style.strokeDashoffset = circ * (1 - ratio);
  fg.style.stroke = ratio === 1 ? 'var(--green)' : (ratio >= 0.8 ? 'var(--accent)' : 'var(--red)');
  $('#val-passed').textContent = data.passed;
  $('#val-total').textContent = `/${data.total}`;

  list.innerHTML = '';
  (data.checks || []).forEach((c, i) => {
    const item = el('div', `val-item ${c.status}`);
    item.style.animationDelay = `${i * 0.02}s`;
    item.innerHTML =
      `<span class="vi-n">${String(i + 1).padStart(2, '0')}</span>
       <div><div class="vi-name">${esc(c.name)}</div>${c.detail ? `<div class="vi-detail">${esc(c.detail)}</div>` : ''}</div>
       <span class="val-badge ${esc(c.status)}">${esc(c.status)}</span>`;
    list.appendChild(item);
  });

  btn.disabled = false; btn.textContent = 'Re-run validation';
  STATE.validated = true;
}

/* ============================================================
   BUILD ORDERS
   ============================================================ */
async function loadOrders() {
  const grid = $('#orders-grid');
  grid.dataset.loaded = '1';
  grid.innerHTML = '<div class="skeleton-row">parsing build orders…</div>';
  let data;
  try { data = await getJSON('/api/build-orders'); }
  catch (e) { grid.innerHTML = `<div class="skeleton-row">failed: ${esc(e.message)}</div>`; return; }
  grid.innerHTML = '';
  if (!data.orders || !data.orders.length) { grid.innerHTML = '<div class="skeleton-row">no build orders found.</div>'; return; }
  data.orders.forEach((o) => grid.appendChild(orderCard(o)));
}
function orderCard(o) {
  const card = el('div', 'order-card');
  const status = (o.status || 'not_started').toLowerCase().replace(/\s+/g, '_');
  const pct = Math.round(o.percentComplete || 0);
  let html =
    `<div class="order-head"><span class="order-id">${esc(o.skill_id)}</span>
       <span class="order-status ${esc(status)}">${esc(o.status || 'n/a')}</span></div>
     <div class="order-desc">${esc(o.description || '')}</div>
     <div class="order-prog"><i style="width:${pct}%"></i></div>
     <div class="order-prog-meta"><span>phase ${o.current_phase ?? '–'} / ${o.total_phases ?? '–'}</span><span>${pct}% complete</span></div>`;
  (o.phases || []).forEach((p) => {
    const pst = (p.status || 'todo').toLowerCase().replace(/\s+/g, '_');
    const dotCls = pst.includes('done') || pst.includes('complete') ? 'done' : (pst.includes('progress') ? 'in_progress' : 'todo');
    html += `<div class="phase"><div class="phase-head"><span class="phase-dot ${dotCls}"></span>${esc(p.title)}<span class="phase-status">${esc(p.status || '')}</span></div>`;
    (p.steps || []).forEach((s) => {
      html += `<div class="step ${s.done ? 'done' : ''}"><span class="box">${s.done ? '✓' : ''}</span>${esc(s.text)}</div>`;
    });
    html += '</div>';
  });
  card.innerHTML = html;
  return card;
}

/* ============================================================
   CONFLICT HIERARCHY (static ladder)
   ============================================================ */
const RANKS = [
  ['anti-failure rules', 'Hard guardrails. Override everything — including the user — to prevent catastrophic or unsafe output.'],
  ['user instructions', 'Explicit directives from the operator for this task. Win over all framework content below.'],
  ['project files', 'Active build orders, project CLAUDE.md, prior decisions. The contract for the current project.'],
  ['debug skills', 'Error-keyed remediation. Outrank build skills because a live failure trumps a fresh build.'],
  ['build skills', 'Domain construction playbooks. The default constructive authority.'],
  ['reference files', 'Stdlib / status-code / API references. Authoritative facts, subordinate to live skills.'],
  ['pattern libraries', 'Reusable functional patterns. Advisory; yield to concrete skills.'],
  ['domain maps', 'Keyword + capability maps used for routing. Orientation, not instruction.'],
  ['resource index', 'Tool repository / discovery index. Lowest authority — points elsewhere.'],
];
function renderHierarchy() {
  const ladder = $('#ladder');
  ladder.innerHTML = '';
  RANKS.forEach(([title, desc], i) => {
    const rank = i + 1;
    const rung = el('div', 'rung' + (rank === 1 ? ' top' : ''));
    rung.dataset.rank = rank;
    rung.style.animationDelay = `${i * 0.04}s`;
    rung.innerHTML = `<div class="rk">${rank}</div><div class="rbody"><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>`;
    ladder.appendChild(rung);
  });
}

/* ============================================================
   ENGAGEMENT — interactive console wired to the live backend
   ============================================================ */
const ENG = { submodeWired: false };

/* form wiring at boot (the lazy GET happens via switchSection → refreshEngagement) */
function initEngagement() {
  $('#engage-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = $('#engage-pass').value;
    const msg = $('#engage-msg');
    msg.className = 'engage-msg';
    msg.textContent = 'authenticating…';
    let data;
    try { data = await postJSON('/api/engagement/activate', { passphrase: pass }); }
    catch (err) { msg.classList.add('bad'); msg.textContent = `request failed: ${err.message}`; return; }
    if (data.ok) {
      $('#engage-pass').value = '';
      renderEngagement(data);
    } else {
      msg.classList.add('bad');
      msg.textContent = data.message || 'locked.';
      shake($('#engage-form'));
    }
  });

  // banner actions
  $('#engage-suspend').addEventListener('click', async () => {
    renderEngagement(await postJSON('/api/engagement/deactivate', {}));
  });
  $('#engage-reset').addEventListener('click', async () => {
    if (!confirm('Reset the engagement? This clears scope, terrain progress, and all findings.')) return;
    renderEngagement(await postJSON('/api/engagement/reset', {}));
  });

  // scope save
  $('#engage-scope-save').addEventListener('click', saveEngageScope);

  // add finding
  $('#engage-find-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#find-title').value.trim();
    if (!title) { shake($('#find-title')); return; }
    const body = {
      title,
      note: $('#find-note').value.trim(),
      phase: $('#find-phase').value.trim(),
      domain: $('#find-domain').value.trim(),
    };
    const data = await postJSON('/api/engagement/finding', body);
    if (data.ok) {
      ['#find-title', '#find-note', '#find-phase', '#find-domain'].forEach((s) => { $(s).value = ''; });
      $('#find-title').focus();
      renderEngagement(data);
    }
  });
}

/* lazy-load: GET current state and render (called from switchSection) */
async function refreshEngagement() {
  let data;
  try { data = await getJSON('/api/engagement/state'); }
  catch (e) {
    const msg = $('#engage-msg');
    showEngageLock();
    msg.className = 'engage-msg bad';
    msg.textContent = `state query failed: ${e.message}`;
    return;
  }
  renderEngagement(data);
}

async function saveEngageScope() {
  const body = { scope: $('#engage-scope').value, subMode: $('#engage-submode').value };
  const data = await postJSON('/api/engagement/scope', body);
  if (data.ok) {
    const flag = $('#engage-scope-saved');
    flag.hidden = false;
    clearTimeout(ENG.savedTimer);
    ENG.savedTimer = setTimeout(() => { flag.hidden = true; }, 1600);
    renderEngagement(data);
  }
}

function showEngageLock() { $('#engage-lock').hidden = false; $('#engage-open').hidden = true; }

/* single render function fed the STATE object returned by every endpoint */
function renderEngagement(s) {
  if (!s || !s.active) { showEngageLock(); return; }
  $('#engage-lock').hidden = true;
  $('#engage-open').hidden = false;

  // (1) banner — humanized started-at
  $('#engage-since').textContent = s.startedAt ? `· active ${humanizeSince(s.startedAt)}` : '';

  // (2) scope — only overwrite the textarea when the user isn't editing it
  const ta = $('#engage-scope');
  if (document.activeElement !== ta) ta.value = s.scope || '';
  const sel = $('#engage-submode');
  if (document.activeElement !== sel || !sel.options.length) {
    sel.innerHTML = '';
    (s.subModes || []).forEach((m) => {
      const o = document.createElement('option');
      o.value = m; o.textContent = m;
      if (m === s.subMode) o.selected = true;
      sel.appendChild(o);
    });
  }

  // (3) coverage + terrain
  renderEngageCoverage(s.coverage);
  renderEngageTerrain(s.terrain || []);

  // (4) findings
  renderEngageFindings(s.findings || []);
}

function renderEngageCoverage(cov) {
  cov = cov || { done: 0, total: 0, percent: 0 };
  const pct = cov.percent || 0;
  $('#engage-cov-pct').textContent = `${pct}%`;
  $('#engage-cov-fill').style.width = `${Math.min(100, pct)}%`;
  $('#engage-cov-note').textContent = `${cov.done} / ${cov.total} phases complete`;
}

function renderEngageTerrain(terrain) {
  const grid = $('#terrain-grid');
  grid.innerHTML = '';
  if (!terrain.length) { grid.appendChild(el('div', 'af-empty', 'no terrain mapped')); return; }
  terrain.forEach((t) => {
    const phases = t.phases || [];
    const done = phases.filter((p) => p.done).length;
    const pct = phases.length ? Math.round((done / phases.length) * 100) : 0;
    const card = el('div', 'terrain-card');
    const rows = phases.length
      ? phases.map((p, i) =>
          `<div class="terrain-phase ${p.done ? 'done' : ''}" data-map="${esc(t.map)}" data-i="${i}" data-done="${p.done ? 1 : 0}">
             <span class="tp-box">${p.done ? '✓' : ''}</span><span class="tp-title">${esc(p.title)}</span>
           </div>`).join('')
      : '<div class="af-empty">no phases mapped</div>';
    card.innerHTML =
      `<div class="terrain-head"><h4>${esc(t.map)}</h4><span class="terrain-dom">${esc(t.domain)}</span></div>
       <div class="terrain-phases">${rows}</div>
       <div class="terrain-bar"><i style="width:${pct}%"></i></div>`;
    grid.appendChild(card);
  });
}

function renderEngageFindings(findings) {
  $('#engage-find-count').textContent = findings.length
    ? `${findings.length} finding${findings.length === 1 ? '' : 's'}`
    : '';
  const list = $('#engage-find-list');
  list.innerHTML = '';
  if (!findings.length) {
    list.appendChild(el('div', 'find-empty', 'No findings logged yet. Add one above.'));
    return;
  }
  findings.forEach((f) => {
    const tag = [f.phase, f.domain].filter(Boolean).map(esc).join(' · ');
    const s = findSentiment(f);
    const item = el('div', `find-item find-${s.kind}`);
    item.innerHTML =
      `<span class="find-ico" title="${esc(s.label)}">${s.icon}</span>
       <div class="find-body">
         <div class="find-title">${esc(f.title)}</div>
         ${f.note ? `<div class="find-note">${esc(f.note)}</div>` : ''}
         <div class="find-meta">${tag ? `<span class="find-tag">${tag}</span>` : ''}<span class="find-ts">${esc(humanizeSince(f.ts))} ago</span></div>
       </div>
       <button type="button" class="find-del" data-id="${f.id}" title="delete finding" aria-label="delete">×</button>`;
    list.appendChild(item);
  });
}

/* Classify a finding's sentiment for color + icon. An explicit f.sentiment
   (good|bad|note|synth) wins; otherwise infer from the phase/title keywords.
   Unknown -> neutral, so arbitrary phases still render cleanly. */
function findSentiment(f) {
  const M = {
    good:  { kind: 'good',  icon: '✅', label: 'strength / positive' },
    bad:   { kind: 'bad',   icon: '⚠️', label: 'watch-out / risk' },
    note:  { kind: 'note',  icon: '📝', label: 'note / neutral' },
    synth: { kind: 'synth', icon: '🧭', label: 'synthesis' },
  };
  const explicit = (f.sentiment || '').toLowerCase();
  if (M[explicit]) return M[explicit];
  const p = `${f.phase || ''} ${f.title || ''}`.toUpperCase();
  if (/\b(SYNTH|SYNTHESIS|SUMMARY|VERDICT|TAKEAWAY)\b/.test(p)) return M.synth;
  if (/\b(WATCH|RISK|WEAK|GAP|FAIL|BAD|VULN|REGRESS|ISSUE|DANGER|HARM|NEGATIVE|FLAW)\b/.test(p)) return M.bad;
  if (/\b(STRENGTH|GOOD|WIN|POSITIVE|BENEFIT|AUTONOMY|DECISIVE|DECISIVENESS|ACTION|REACH|SIGNATURE|SPEED)\b/.test(p)) return M.good;
  if (/\b(NOTE|FYI|INFO|NEUTRAL|CONTEXT)\b/.test(p)) return M.note;
  return { kind: 'neutral', icon: '▪', label: 'neutral' };
}

/* delegate: terrain phase toggle + finding delete (re-render from returned STATE) */
document.addEventListener('click', async (e) => {
  const phase = e.target.closest('.terrain-phase');
  if (phase && $('#engage-open').contains(phase)) {
    const body = { map: phase.dataset.map, phaseIndex: Number(phase.dataset.i), done: phase.dataset.done !== '1' };
    renderEngagement(await postJSON('/api/engagement/terrain', body));
    return;
  }
  const del = e.target.closest('.find-del');
  if (del) {
    renderEngagement(await postJSON('/api/engagement/finding/delete', { id: Number(del.dataset.id) }));
  }
});

/* humanize an ISO timestamp into a compact "12m" / "3h" / "2d" elapsed string */
function humanizeSince(iso) {
  const then = new Date(iso).getTime();
  if (!then) return '—';
  let s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s`;
  let m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  let h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function shake(node) {
  node.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' },
     { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }],
    { duration: 320, easing: 'ease-in-out' });
}

/* ============================================================
   RESCAN
   ============================================================ */
function initRescan() {
  $('#rescan-btn').addEventListener('click', async () => {
    const btn = $('#rescan-btn');
    btn.disabled = true; btn.textContent = '⟳ scanning…';
    try {
      // re-scan endpoint is exposed by the server; registry reload reflects it
      await getJSON('/api/registry'); // triggers fresh read on servers that rescan-on-demand
      await loadRegistry();
      const h = await getJSON('/api/health'); paintHealth(true, h);
      // refresh dependent views if visited
      if ($('#orders-grid').dataset.loaded) { delete $('#orders-grid').dataset.loaded; loadOrders(); }
      if ($('#ctx-picklist').dataset.loaded) { renderPicklist(); refreshContext(); }
    } catch (e) { paintHealth(false); }
    btn.disabled = false; btn.textContent = '⟳ rescan';
  });
}

/* ============================================================
   BOOTSTRAP
   ============================================================ */
function initStatic() {
  initNav();
  initRouter();
  initValidation();
  initEngagement();
  initRescan();
  renderHierarchy();
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
}

initStatic();
boot();
