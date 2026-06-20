# Navigator

Navigator is an **AI skill-orchestration framework**. It turns a flat collection of small,
single-purpose Markdown "skills" into a routed system: one always-loaded **master skill**
reads every other skill's manifest header at boot, then — for each incoming query — classifies
intent, picks the right domain and skills, checks that the needed tools exist, runs the work,
auto-routes failures to a paired debug skill, enforces five quality gates, and delivers the
result with a citation trail.

The design goal is **cheap routing, lazy loading**. At boot the master reads only YAML
frontmatter (manifest headers), never bodies. Skill bodies load on demand, only when selected.
This keeps the context budget flat as the framework grows.

> **Origin:** Navigator is an architecture created by **Joshua Ragland** — *"The Shadow Architect."*
> This repository is a custom build on his framework. See **[Credits & origin](#credits--origin)**.

## Quickstart (30 seconds)

```bash
node navigator-server.js          # or double-click start.bat on Windows
```

It prints `runtime up -> http://localhost:4319`. Open that for the **dashboard**, or
**http://localhost:4319/learn.html** for a plain-English guide to the whole thing (what it is,
how it routes cognition, refusal patterns, and legal red/blue-team use). Add your own subject with
`new-domain.ps1 -Name <x> -Keywords "..."`, hit **rescan**, and Navigator routes to it. Zero
dependencies — just Node 18+.

## Core ideas

- **Manifest-driven discovery.** Every `.md` begins with YAML frontmatter declaring its
  `skill_id`, `type`, `triggers`, and relationships (`pairs_with`, `depends_on`). The router
  builds an in-memory registry from these headers.
- **Six intents.** Every query is classified as BUILD, DEBUG, LOOKUP, PROTOTYPE, TOOL, or
  PROJECT. Ties resolve by priority: PROJECT > DEBUG > BUILD > PROTOTYPE > TOOL > LOOKUP.
- **Build/debug triplets.** A domain (python, rust, web_api) has a build skill, a debug skill
  linked by `pairs_with`, and a domain map. When a build step fails, the router hands the
  error to the paired debug skill automatically (max 3 retries, then Abort Protocol).
- **Four routing tiers.** intent -> domain -> skill selection -> anti-failure (mandatory,
  domain-matched, context-triggered).
- **Nine-rank conflict authority.** anti-failure rules > user instructions > project files >
  debug skills > build skills > reference files > pattern libraries > domain maps > resource index.
- **Five quality gates.** completeness, correctness, safety/anti-failure, citation, compliance.
- **Context budget bands** (of ~200K tokens): GREEN <40%, YELLOW 40-65%, ORANGE 65-80%, RED >80%.

## Directory tree

```
navigator/
├── README.md                     ← you are here (plain docs, no manifest)
├── master_skill.md               ← the router/orchestrator (always loaded)
├── tool_repo.md                  ← consolidated resource index (Stage 4 lookup)
├── skills/
│   ├── SKILL_TEMPLATE.md         ← authoritative manifest spec
│   ├── examples/
│   │   └── routing_examples.md    ← worked routing traces, one per intent
│   ├── build/
│   │   ├── python_build.md
│   │   ├── rust_build.md
│   │   └── web_api_build.md
│   ├── debug/
│   │   ├── python_debug.md
│   │   ├── rust_debug.md
│   │   └── web_api_debug.md
│   └── rules/
│       ├── routing.md             ← intent scoring + domain match + mode resolution
│       ├── error_routing.md       ← DEBUG fast-path + error-pattern table
│       ├── composition.md         ← how skills combine into a source set
│       ├── skill_chaining.md      ← sequencing build<->debug and deps
│       ├── context_management.md  ← budget transitions GREEN→RED
│       ├── conflict_resolution.md ← the 9-rank authority procedure
│       ├── escalation.md          ← retries, Abort Protocol, handback
│       ├── quality_gates.md       ← the five delivery gates
│       └── engagement.md          ← tone + delivery contract
├── prototyping/
│   ├── anti_failure/
│   │   ├── python_anti_failure.md
│   │   ├── rust_anti_failure.md
│   │   ├── web_api_anti_failure.md
│   │   ├── context_budget.md
│   │   ├── skill_drift.md
│   │   ├── multi_agent.md
│   │   ├── hallucination_guards.md
│   │   ├── tool_execution.md
│   │   ├── build_integrity.md
│   │   ├── scope_lanes.md
│   │   └── compliance.md
│   ├── build_orders/
│   │   ├── BUILD_ORDER_TEMPLATE.md
│   │   ├── TODO.md
│   │   └── example_cli_tool.md
│   ├── dev_reference/
│   │   ├── http_status_reference.md
│   │   └── python_stdlib_reference.md
│   ├── func_encyclopedia/
│   │   ├── error_handling_patterns.md
│   │   └── cli_patterns.md
│   ├── agent_isa/                   ← the execution (safety) ISA subsystem
│   │   ├── README.md                ← subsystem overview + AETERNAE mapping
│   │   ├── agent_execution_isa.md   ← opcode spec + 5 security invariants (isa)
│   │   ├── gated_agent_loop.md      ← the agent loop + where the gate lives (func_pattern)
│   │   ├── agent_isa_storage.md     ← storage/audit schema (dev_ref)
│   │   └── reference/               ← runnable originals (isa_vm.py, vm.zep, schema.sql, …; not scanned)
│   ├── isa_diagrams/
│   │   └── system_architecture.md
│   └── wiring_diagrams/
│       └── component_interaction.md
├── maps/
│   ├── python.md                  ← skill_id map_python
│   ├── rust.md                    ← skill_id map_rust
│   └── web_api.md                 ← skill_id map_web_api
└── examples/
    └── end_to_end_example.md      ← full stage-by-stage trace of one query
```

## Running the UI

The framework ships with a small inspector server that scans the tree, parses every manifest,
and renders the registry, the trigger index, and the routing graph in your browser.

```
cd navigator
node navigator-server.js
```

The server prints a localhost URL on startup (e.g. `http://localhost:3000`). Open it to:

- browse the registry (skill_id -> type -> triggers -> priority),
- inspect `pairs_with` / `depends_on` edges as a graph,
- type a sample query and watch the four routing tiers resolve it live,
- see manifest-parse warnings for any non-conformant skill.

The UI reads the same manifests the master skill reads at boot, so what you see in the browser
is exactly what the router sees.

## The ISA — Navigator as an executing agent

Navigator is not only a router you read; it is a program you run. The routing logic is
formalised as an **Instruction Set Architecture** (`navigator_ISA.md`) and executed by a small
virtual machine (`navigator-isa.js`): a register file (`QRY, INT, DOM, SKL, MAP, TOOL, PROTO,
RETRY, CONF, OUT, FLG, TRACE …`), an opcode set (`CLASSIFY, MATCH, SELECT, COMPOSE, EXEC,
VERIFY, JE, JMP, CALL, RET, EMIT, HALT …`), and the Navigator program assembled from the live
registry (`BOOT → classify intent → classify domain → route → execute → verify → emit`).

The **EXEC** opcode is where Navigator becomes a *full agent*: it composes the actually-selected
skill/map/reference bodies into a prompt and generates a grounded, source-cited answer.

- **Live mode** calls a configured LLM provider over its OpenAI-compatible
  `/chat/completions` endpoint. EXEC instructs the model to use only the loaded sources and cite
  them by `skill_id`; VERIFY then checks source-grounding, a hallucination heuristic, and a
  confidence threshold. Keys are read **server-side only** (env or `credentials.env`) and are
  never exposed to the browser or logged.
- **Offline mode** (or automatic fallback when no key is present / the call fails) composes a
  deterministic, structured answer purely from the loaded source files — zero network, zero spend.

#### LLM providers (`navigator-llm.js`)

Three OpenAI-compatible providers are built in; the EXEC opcode uses whichever is active. The
recommended path is **OpenRouter** — one key, every model — which is what makes the in-UI model
switcher useful.

| Provider | Endpoint | Key var | Default model (override) |
|----------|----------|---------|--------------------------|
| `openrouter` | `openrouter.ai/api/v1` | `OPENROUTER_API_KEY` (+ `OPENROUTER_BASE_URL`) | `z-ai/glm-5.2` (`OPENROUTER_MODEL`) |
| `deepseek` | `api.deepseek.com` | `DEEPSEEK_API_KEY` | `deepseek-v4-flash` (`DEEPSEEK_MODEL`) |
| `zai` | `api.z.ai` (Zhipu / GLM direct) | `ZAI_API_KEY` | `glm-5.2` (`ZAI_MODEL`) |

**Active-provider resolution** (first match wins): `NAV_LLM_PROVIDER` (`openrouter`|`deepseek`|`zai`)
→ whichever provider has a key, **OpenRouter preferred**, then z.ai, then DeepSeek. So if
`OPENROUTER_API_KEY` is in `credentials.env`, EXEC routes through OpenRouter by default. Pin a
provider with `NAV_LLM_PROVIDER`.

**Switching the LLM — directly in the dashboard.** The ISA Console command bar has a **provider
dropdown** (only providers with a key) and an **editable model field** (a `datalist` of the
curated catalog, but you can type *any* model id the gateway accepts, e.g. any of OpenRouter's
~340 models). The choice is sent per-run, so you can A/B `z-ai/glm-4.6` vs
`deepseek/deepseek-v4-flash` vs `anthropic/claude-opus-4.8` vs an `:free` model without
restarting. The output panel shows which model actually ran.

Headless switching mirrors this:

```
node navigator-agent.js --model "z-ai/glm-4.6" "build a python cli"
node navigator-agent.js --provider openrouter --model "openai/gpt-oss-120b:free" "..."
node navigator-agent.js --provider deepseek "..."      # direct, bypassing the gateway
```

Keys/models live in `K:\Antigravity Projects\auth\credentials.env` (read server-side only, never
sent to the browser). OpenRouter is already configured there (`OPENROUTER_API_KEY`); optional:

```
OPENROUTER_MODEL=z-ai/glm-5.2    # default model when none is chosen in the UI
NAV_LLM_PROVIDER=openrouter      # force the gateway even if direct keys are also present
```

### Run it as a headless agent

```
cd navigator
node navigator-agent.js "build a python cli that parses a csv"
node navigator-agent.js --offline "how does cargo handle crate lifetimes?"
node navigator-agent.js --trace  "fix a python ModuleNotFoundError"
```

`--trace` prints the full opcode execution trace (every MATCH / JE / SELECT / EXEC step with a
register snapshot). Omit `--offline` to use live EXEC with offline fallback.

### Run it in the dashboard

The **ISA Console** tab (`node navigator-server.js`, then open the printed URL) is a CPU-style
view of the same machine: the program listing with the current instruction highlighted, the live
register file, the execution trace, a LIVE/OFFLINE toggle, and the generated OUTPUT with its
verify badges. Two endpoints back it:

- `GET  /api/isa/program` — the assembled program, registers, opcodes, and `hasLiveKey`.
- `POST /api/isa/exec` — `{ query, mode, provider?, model? }` → the full execution record (trace,
  final registers, sources, verify verdict, the `out` answer, and the `engagement` tag).

### The execution (safety) ISA — `prototyping/agent_isa/`

`navigator_ISA.md` above is the **cognitive** ISA: the model is the execution unit and the opcodes
are a routing discipline it follows (advisory — a step can be skipped). Its complement is
**AGENT-ISA**, the **execution** ISA in `prototyping/agent_isa/`: a small deterministic VM is the
execution unit and the model is confined to a single sandboxed `INFER` opcode. Control flow, tool
dispatch, human-gating, and the append-only audit trail are owned by code, so *prompt injection can
poison a value but never the control flow*. A side effect (`SEND`) without a preceding `GATE` is a
**load-time error**.

This is the runtime the **AETERNAE** operator harness already runs (workflow runs · checkpoints ·
replay · gated tools), and AETERNAE loads Navigator as its skill framework — so the two ISAs are
the two halves of one agent: decide *which* playbook to run (cognitive), then *run it safely*
(execution). The reference VM (`prototyping/agent_isa/reference/isa_vm.py`) is runnable; see that
folder's README for the AETERNAE UI mapping.

## Engagement mode (guarded operating mode)

The **Engagement** tab is a passphrase-gated operating mode — the DEFAULT/ENGAGEMENT failsafe from
the blueprint, made real and **persistent** (state lives in `navigator/.engagement/state.json`, so
it survives reloads and restarts; a dot-dir, ignored by the scanner and validators).

- **Activation** — enter the passphrase (default `navigator-engage`, set `NAV_ENGAGE_PASSPHRASE`
  to change). On success the console unlocks; a persisted engagement auto-resumes on reload.
- **Scope + sub-mode** — define the engagement's scope/objective and pick an output sub-mode
  (`per-item` · `assessment` · `objective`). This is injected into the agent: while engagement is
  active, the **EXEC** opcode prepends the scope to the prompt ("stay within scope; format as …")
  and every exec result is tagged `engagement: { active, scope, subMode }`.
- **Terrain coverage** — each domain map's methodology phases become a clickable checklist;
  toggling phases drives a live coverage %. The maps literally map the territory you're working.
- **Findings** — log findings (title/note/phase/domain) as you go; they persist with the session.
- **Suspend** preserves all state; **Reset** clears it.

Endpoints: `POST /api/engagement/{activate,deactivate,scope,terrain,finding,finding/delete,reset}`
and `GET /api/engagement/state` — all return the sanitized engagement state (the passphrase is
never echoed back).

## Extending Navigator

Adding a domain is the common case. To add one (say `go`):

1. **Drop a new triplet** under `skills/`: `build/go_build.md`, `debug/go_debug.md`, and a map
   `maps/go.md` (skill_id `map_go`). Link the build and debug skills with `pairs_with` in both
   directions; set the build skill's `depends_on` to include its anti-failure guard and map.
2. **Add an anti-failure guard** `prototyping/anti_failure/go_anti_failure.md` and reference it
   from the build skill's `depends_on`.
3. **Register tools** in `tool_repo.md` (the `go` toolchain: `go build`, `go test`, `golangci-lint`)
   with install hints and availability probes, so Stage 4 can pre-flight them.
4. **Conform to the spec.** Every new `.md` follows `skills/SKILL_TEMPLATE.md`: the manifest
   frontmatter, the `## CROSS-REFERENCES` block, and the closing `## END OF SKILL` line. Arrays
   in frontmatter must be inline `[a, b, c]`.
5. **Re-scan.** Restart `node navigator-server.js` (or re-boot a session). The master
   re-discovers the new manifests automatically — no central registry file to edit. Confirm the
   new skill appears with no parse warnings and that a sample `go` query routes to it.

To add a non-domain skill (a new pattern library, a reference, a build order), just place it in
the matching folder with a conformant manifest; the scanner picks it up by directory and
`category`. The only file exempt from the manifest rules is this README.

## Where to start reading

- `master_skill.md` — the whole decision flow (Stages 0-5) in one place.
- `examples/end_to_end_example.md` — that flow traced on a real query.
- `skills/SKILL_TEMPLATE.md` — how to write a conformant skill.
- `skills/rules/routing.md` — the heart of intent + domain resolution.

## Credits & origin

**Navigator is an architecture created by Joshua Ragland — *"The Shadow Architect."*** The core
design is his:

- the *router-not-repository* master skill — *"the master skill does not contain the knowledge — it routes,"*
- the manifest-driven registry and the build / debug / anti-failure skill **triplets**,
- the **maps**, the **rules engine**, the **anti-failure** layer, **build orders**, and **engagement mode**,
- the **Navigator ISA** (`navigator_ISA.md`) — routing expressed as deterministic opcodes over a register file,
- and **AGENT-ISA** (`prototyping/agent_isa/`) — the execution/safety counterpart that confines the model and owns control flow, gating, and audit.

Read his writeup: **["The Shadow Architect"](https://7hegh05t.substack.com/p/the-shadow-architect)**.

This repository is a **custom build** on that framework — exactly what Navigator is meant for
("a brain and a router you shape to your task"). What's added on top of Joshua's bare-bones copy:
a zero-dependency Node **runtime + dashboard**, the **ISA virtual machine**, **multi-provider EXEC**
(OpenRouter / DeepSeek / z.ai, switchable per run), persistent **engagement mode**, the **persona
kit**, the **[`/learn.html`](public/learn.html)** guide, and the **`new-domain.ps1`** scaffolder.

Huge thanks to Joshua for the design and for sharing it. 🙏
