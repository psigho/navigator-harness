'use strict';
/**
 * navigator-llm.js — minimal, zero-dependency, MULTI-PROVIDER LLM client for the
 * EXEC opcode.
 *
 * Providers (both OpenAI-compatible /chat/completions):
 *   - deepseek : api.deepseek.com           key DEEPSEEK_API_KEY  model deepseek-v4-flash
 *   - zai      : api.z.ai (Zhipu / GLM)      key ZAI_API_KEY       model glm-4.6
 *
 * Active provider resolution (first match wins):
 *   1. NAV_LLM_PROVIDER env / credentials.env  (explicit: "deepseek" | "zai")
 *   2. whichever provider actually has a key, z.ai preferred if present
 *   3. deepseek (identity default, even with no key -> offline)
 *
 * Keys/models are read from process.env or a credentials file and are NEVER
 * returned over the wire or logged. Callers only learn hasKey() and the source
 * label ("credentials.env" / "process.env" / "none").
 *
 * Node 18+ global fetch + AbortController. No npm packages.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const PROVIDERS = {
  openrouter: {
    label: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    baseUrlEnv: 'OPENROUTER_BASE_URL',          // base + /chat/completions if set
    keyEnv: 'OPENROUTER_API_KEY',
    modelEnv: 'OPENROUTER_MODEL',
    defaultModel: 'z-ai/glm-5.2',
    extraHeaders: { 'HTTP-Referer': 'https://psio.io', 'X-Title': 'Navigator ISA' },
  },
  deepseek: {
    label: 'deepseek',
    url: 'https://api.deepseek.com/v1/chat/completions',
    keyEnv: 'DEEPSEEK_API_KEY',
    modelEnv: 'DEEPSEEK_MODEL',
    defaultModel: 'deepseek-v4-flash',
  },
  zai: {
    label: 'z.ai',
    url: 'https://api.z.ai/api/paas/v4/chat/completions',
    keyEnv: 'ZAI_API_KEY',
    modelEnv: 'ZAI_MODEL',
    defaultModel: 'glm-5.2',
  },
};

// Curated model menus for the in-UI switcher. OpenRouter ids are namespaced
// (provider/model); free routes carry a :free suffix. Users may also type any
// model id the gateway accepts.
const MODEL_CATALOG = {
  openrouter: [
    // GLM (z.ai)
    'z-ai/glm-5.2', 'z-ai/glm-5.1', 'z-ai/glm-5', 'z-ai/glm-5-turbo', 'z-ai/glm-4.7',
    // Qwen (latest)
    'qwen/qwen3.7-max', 'qwen/qwen3.7-plus', 'qwen/qwen3-coder-plus',
    // Nemotron (NVIDIA, latest)
    'nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3-super-120b-a12b',
    // Claude
    'anthropic/claude-opus-4.8', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-haiku-4.5',
    // DeepSeek
    'deepseek/deepseek-v4-flash', 'deepseek/deepseek-chat-v3.1', 'deepseek/deepseek-r1',
    // GPT / Gemini / Llama
    'openai/gpt-4o-mini', 'google/gemini-2.5-pro', 'meta-llama/llama-3.3-70b-instruct',
    // free
    'qwen/qwen3-next-80b-a3b-instruct:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'openai/gpt-oss-120b:free',
  ],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  zai: ['glm-5.2', 'glm-5', 'glm-4.7', 'glm-4.6', 'glm-4.5-air'],
};

// Preference order when auto-selecting among providers that have a key.
const AUTO_ORDER = ['openrouter', 'zai', 'deepseek'];

// Candidate dotenv-style files, searched in order; process.env always wins.
const ENV_FILES = [
  path.join(__dirname, '.env'),
  'K:/Antigravity Projects/auth/credentials.env',
];

let _envCache = null;

function loadEnvFiles() {
  if (_envCache) return _envCache;
  const env = {};
  for (const file of ENV_FILES) {
    try {
      if (!fs.existsSync(file)) continue;
      const txt = fs.readFileSync(file, 'utf8');
      for (const line of txt.split(/\r?\n/)) {
        if (/^\s*#/.test(line) || !line.includes('=')) continue;
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!(m[1] in env)) env[m[1]] = v;
      }
    } catch (_) { /* unreadable file -> skip */ }
  }
  _envCache = env;
  return env;
}

/** Read a var from process.env first, then the credentials files. */
function env(name) {
  if (process.env[name]) return process.env[name];
  const v = loadEnvFiles()[name];
  return v || null;
}

/** Where a given var resolved from (no value leaked). */
function sourceOf(name) {
  if (process.env[name]) return 'process.env';
  if (loadEnvFiles()[name]) return 'credentials.env';
  return 'none';
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

function activeProviderName() {
  const want = (env('NAV_LLM_PROVIDER') || '').toLowerCase().trim();
  if (PROVIDERS[want]) return want;
  for (const name of AUTO_ORDER) {
    if (env(PROVIDERS[name].keyEnv)) return name;
  }
  return 'deepseek';
}

function activeProvider() { return PROVIDERS[activeProviderName()]; }

function getKey() { return env(activeProvider().keyEnv); }
function getModel() {
  const p = activeProvider();
  return env(p.modelEnv) || p.defaultModel;
}
function hasKey() { return !!getKey(); }

/** Plain key-source label for the active provider's key. */
function keySource() { return sourceOf(activeProvider().keyEnv); }

/** Rich provider summary for the UI / diagnostics. Never includes the key. */
function providerInfo() {
  const name = activeProviderName();
  const p = PROVIDERS[name];
  return {
    provider: name,
    label: p.label,
    model: getModel(),
    hasKey: !!env(p.keyEnv),
    keySource: sourceOf(p.keyEnv),
    forced: !!PROVIDERS[(env('NAV_LLM_PROVIDER') || '').toLowerCase().trim()],
  };
}

/** All configured providers and whether each currently has a key. */
function listProviders() {
  return Object.keys(PROVIDERS).map((name) => ({
    provider: name,
    label: PROVIDERS[name].label,
    model: env(PROVIDERS[name].modelEnv) || PROVIDERS[name].defaultModel,
    hasKey: !!env(PROVIDERS[name].keyEnv),
    models: MODEL_CATALOG[name] || [],
  }));
}

/** Curated model menus per provider, for the in-UI switcher. */
function modelCatalog() { return MODEL_CATALOG; }

/** Resolve the chat-completions URL, honoring a provider's base-URL env override. */
function urlFor(p) {
  if (p.baseUrlEnv) {
    const base = env(p.baseUrlEnv);
    if (base) return base.replace(/\/+$/, '') + '/chat/completions';
  }
  return p.url;
}

// ---------------------------------------------------------------------------
// Chat completion
// ---------------------------------------------------------------------------

/**
 * One chat completion against the active (or explicitly named) provider.
 * @param {{system?:string,user:string,model?:string,provider?:string,
 *          max_tokens?:number,temperature?:number,timeoutMs?:number}} opts
 * @returns {Promise<{content,model,provider,usage}>}
 */
async function chat(opts) {
  const name = PROVIDERS[(opts.provider || '').toLowerCase()] ? opts.provider.toLowerCase() : activeProviderName();
  const p = PROVIDERS[name];
  const key = env(p.keyEnv);
  if (!key) throw new Error(`no API key for provider "${p.label}" (set ${p.keyEnv})`);

  const model = opts.model || env(p.modelEnv) || p.defaultModel;
  const body = {
    model,
    messages: [
      { role: 'system', content: opts.system || '' },
      { role: 'user', content: opts.user || '' },
    ],
    max_tokens: opts.max_tokens || 1200,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.3,
  };

  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (p.extraHeaders) Object.assign(headers, p.extraHeaders);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 45000);
  let res;
  try {
    res = await fetch(urlFor(p), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new Error(`${p.label} request failed: ${err && err.message ? err.message : err}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 240); } catch (_) { /* ignore */ }
    throw new Error(`${p.label} ${res.status}: ${detail}`);
  }

  const json = await res.json();
  const content =
    json && json.choices && json.choices[0] && json.choices[0].message
      ? json.choices[0].message.content
      : '';
  return { content: content || '', model, provider: p.label, usage: json.usage || null };
}

module.exports = {
  chat, hasKey, keySource, getKey, getModel,
  providerInfo, listProviders, modelCatalog, activeProviderName, PROVIDERS,
};
