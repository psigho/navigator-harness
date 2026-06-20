# agent_isa/ — the execution (safety) ISA

Navigator's `navigator_ISA.md` is the **cognitive** ISA: the model *is* the execution unit and
the opcodes are a routing discipline it follows. This folder is the **execution** ISA: a small
deterministic VM is the execution unit, and the model is confined to one opcode (`INFER`).
Together they are the two halves of a complete agent — *decide which playbook to run* (cognitive)
and *run it safely* (execution).

This subsystem was distilled from the `mythos` / `mythos2` reference set and is the written-down
form of the runtime that **AETERNAE** (the operator harness at `K:\Antigravity Projects\Ares`,
"Joshua's harness") already runs. AETERNAE loads Navigator as its skill framework (see its
left-rail "FRAMEWORK LOAD: Navigator · NAVIGATOR MCP" and Settings → ISA/FRAMEWORK/SKILLS tabs);
this folder gives that runtime a spec inside the framework it loads.

## Files

| File | Scanned? | What |
|------|----------|------|
| `agent_execution_isa.md` | ✅ skill (`isa`) | The opcode spec, machine model, and the 5 security invariants. The core doc. |
| `gated_agent_loop.md` | ✅ skill (`func_pattern`) | The bare agent loop and where the human-confirmation gate lives. |
| `agent_isa_storage.md` | ✅ skill (`dev_ref`) | The 5-table storage/audit model + the 1:1 AETERNAE UI mapping. |
| `reference/isa_vm.py` | — | Runnable reference interpreter (the executable spec). `python isa_vm.py` runs the demos. |
| `reference/vm.zep` | — | Zephir/Phalcon 1:1 port of the interpreter. |
| `reference/schema.sql` | — | The Postgres DDL (programs/instructions/runs/transcript/approvals). |
| `reference/agent_loop.c` | — | The agent loop to its bones, in C. |
| `reference/agentloop.zep` | — | Zephir agent loop with a client-side `gatedTools` gate. |
| `reference/notify_mcp_server.py` | — | A complete minimal MCP server (ntfy notify + read-only status). |
| `reference/SPEC.txt` | — | The original AGENT-ISA v0.1 spec, byte-for-byte (`.txt` so the `.md` scanner ignores it). |

Only the three `.md` files carry Navigator manifests and are indexed by the registry; everything
in `reference/` is pristine, runnable source the docs point at.

## The one-line thesis

> Deterministic control flow owns sequencing, branching, gating, tool dispatch, and audit. The
> model is confined to a single `INFER` opcode. Programs are data, state is serializable, every
> step is logged. **Prompt injection can poison a value, not the control flow.**
