#!/usr/bin/env node
'use strict';
/**
 * navigator-agent.js — run Navigator headless, as a full agent.
 *
 *   node navigator-agent.js "build a python cli that parses csv"
 *   node navigator-agent.js --offline "how does cargo handle lifetimes?"
 *   node navigator-agent.js --trace "fix a python ModuleNotFoundError"
 *
 * Boots the registry from disk, runs the ISA virtual machine on the query
 * (live DeepSeek EXEC with offline fallback), and prints the answer. With
 * --trace it also prints the full opcode execution trace.
 */

const server = require('./navigator-server'); // require.main-guarded: does NOT listen
const isa = require('./navigator-isa');

function parseArgs(argv) {
  const opts = { mode: 'live', trace: false, provider: undefined, model: undefined };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') opts.mode = 'offline';
    else if (a === '--live') opts.mode = 'live';
    else if (a === '--trace') opts.trace = true;
    else if (a === '--provider') opts.provider = argv[++i];
    else if (a.startsWith('--provider=')) opts.provider = a.slice('--provider='.length);
    else if (a === '--model') opts.model = argv[++i];
    else if (a.startsWith('--model=')) opts.model = a.slice('--model='.length);
    else rest.push(a);
  }
  opts.query = rest.join(' ').trim();
  return opts;
}

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.query) {
    console.error('usage: node navigator-agent.js [--offline] [--trace] "<query>"');
    process.exit(2);
  }

  server.scan(); // populate the registry from the on-disk framework tree

  const result = await isa.executeISA(
    opts.query,
    { mode: opts.mode, provider: opts.provider, model: opts.model },
    server.isaDeps(),
  );

  console.log('');
  console.log(C.bold(C.cyan('NAVIGATOR')) + C.dim('  ·  ISA agent'));
  console.log(C.dim('─'.repeat(64)));
  console.log(`${C.dim('query   ')} ${result.query}`);
  console.log(`${C.dim('intent  ')} ${C.yellow(result.intent)}`);
  console.log(`${C.dim('domains ')} ${result.domains.join(', ') || '(none)'}`);
  console.log(`${C.dim('sources ')} ${result.sources.map((s) => s.skill_id).join(', ') || '(none)'}`);
  console.log(`${C.dim('exec    ')} ${result.execMode}${result.model ? ' · ' + result.model : ''}`);
  console.log(`${C.dim('verify  ')} source=${result.verify.source} hallucination=${result.verify.hallucination} conf=${result.confidence} (${result.verify.verdict})`);
  console.log(C.dim('─'.repeat(64)));
  console.log('');
  console.log(result.out);
  console.log('');

  if (opts.trace) {
    console.log(C.dim('─'.repeat(64)));
    console.log(C.bold('EXECUTION TRACE') + C.dim(`  (${result.steps} steps)`));
    for (const f of result.trace) {
      const lbl = f.label ? C.green(f.label.padEnd(20)) : ''.padEnd(20);
      const op = C.cyan(f.op.padEnd(8));
      const args = (f.args || []).join(' ').padEnd(22);
      console.log(`  ${String(f.step).padStart(3)} ${lbl} ${op} ${args} ${C.dim(f.note || '')}`);
    }
  }
}

main().catch((err) => {
  console.error('navigator-agent error:', err && err.stack ? err.stack : err);
  process.exit(1);
});
