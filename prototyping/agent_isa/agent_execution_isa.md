---
skill_id: agent_execution_isa
type: prototype
category: isa
triggers:
  keywords: [agent, isa, vm, opcode, gate, infer, snapshot, resume, approval, harness, deterministic, sandbox, injection, autonomous, playbook, register, interpreter]
  languages: [python, all]
  platforms: [cross]
depends_on: [agent_isa_storage, gated_agent_loop]
priority: 9
description: AGENT-ISA v0.1 — the execution/safety ISA that confines the model to a single INFER opcode while deterministic code owns control flow, tool dispatch, gating, and audit. The enforcement counterpart to navigator_ISA.md.
---

# AGENT-ISA — The Execution (Safety) ISA

Navigator already has an ISA: `navigator_ISA.md`, the **cognitive** ISA, where *the model is
the execution unit* and the opcodes are a discipline it follows to route a query. That ISA is
advisory — nothing stops the model from skipping a step.

This file is the **complementary half**: an **execution** ISA where *the model is NOT the
execution unit*. A small deterministic virtual machine (the reference interpreter ships in
`reference/isa_vm.py`, ported 1:1 to `reference/vm.zep`) owns sequencing, branching, gating,
tool dispatch, and the audit trail. The model is confined to **one opcode — `INFER` — and
nothing else**. It returns data; the program decides what happens to that data.

```
navigator_ISA.md   (cognitive)   →  decides WHICH playbook/skill to run   (model drives)
agent_execution_isa (this file)  →  RUNS that playbook safely             (code drives, model is a part)
```

This is the architecture AETERNAE (the operator harness — Joshua's harness; see this folder's
`README.md`) already embodies: workflow runs, checkpoints, replay, gated tools. AGENT-ISA is
that pattern written down as a portable spec.

> Origin: distilled from the `mythos`/`mythos2` reference set. The pristine, byte-for-byte
> originals (runnable) live in `reference/` — `SPEC.txt` is the original spec, `isa_vm.py` the
> executable spec, `vm.zep` the Zephir port. This doc is the Navigator-conformant index over them.

---

## MACHINE MODEL

- **Registers** `r0–r15` — each holds an arbitrary JSON value. `r0` conventionally holds "the
  data being worked on."
- **PC** — program counter (index of the current instruction).
- **Flags** — `Z` (last value empty/null/zero), `F` (last `INFER` raised a named flag).
- **Run state** — `RUNNING | AWAITING_APPROVAL | HALTED | ERROR`.
- **Snapshot** = `{program_id, pc, registers, flags, pending_instruction}` — serializable to
  one DB row. Resume = load snapshot, continue. (~479 bytes in practice; this is what a paused
  GATE becomes — an AETERNAE "checkpoint".)
- **Field access** — any register arg may use dot-paths: `r1.summary`, `r0.items.0.from`. Reads
  on a missing path yield `null` (and set `Z`), never crash.

---

## OPCODES

### Data / flow
| Op | Args | Effect |
|----|------|--------|
| `MOV` | rd, src | rd = src (register, path, or literal) |
| `CMP` | a, b | set Z if equal(a, b) |
| `TEST` | src | set Z if src is null/empty/zero/false |
| `JMP` | label | pc = label |
| `JZ` / `JNZ` | label | jump if Z set / clear |
| `JF` / `JNF` | label | jump if F set / clear (INFER's flag) |
| `HALT` | — | end run, state = HALTED |
| `LOG` | src | append src to the run transcript (no other effect) |

### Tools (deterministic — the model never calls these)
| Op | Args | Effect |
|----|------|--------|
| `FETCH` | rd, tool, {args} | call a **read-only** tool; rd = result. On error: rd = {error:…}, Z set |
| `SEND` | tool, {args} | call a **side-effect** tool. MUST be preceded by `GATE` unless the tool is on the program's `auto_allow` list |
| `NOTIFY` | channel, src, {opts} | push to a human (ntfy etc.). Always allowed |

### Judgment — the model's one door
| Op | Args | Effect |
|----|------|--------|
| `INFER` | rd, instruction, src, {opts} | run the model with `instruction` over `src`; rd = parsed result. If result has `"flag": true`, set F. opts: model, max_tokens, schema |

`INFER` is **sandboxed**: the model receives ONLY the instruction text and the `src` value. It
cannot see the program, the other registers, or the tool menu. It cannot call tools. It returns
data; the program decides the consequence.

### Safety
| Op | Args | Effect |
|----|------|--------|
| `GATE` | reason_src | snapshot state, set AWAITING_APPROVAL, halt. On approve: resume at the next instruction. On deny: resume with Z set (programs branch on `JZ` after `GATE`) |

---

## THE SECURITY MODEL — FIVE INVARIANTS

These are the reason this ISA exists. They are enforced by the interpreter, not by prompt
discipline, so a misbehaving or prompt-injected model cannot break them.

1. **No ungated side effects.** `SEND` without a preceding `GATE` in the same run is a
   **load-time error**, unless the tool is explicitly on the program's `auto_allow` list. Side
   effects are gated by the architecture, not by the model remembering to ask.
2. **INFER output is data, never instructions.** The VM never interprets register contents as
   opcodes. *Prompt injection can poison a value, not the control flow.* This is the structural
   answer to injection — the worst a poisoned email can do is set a bad string in `r1`; it can
   never make the machine call `SEND`.
3. **Total audit.** Every executed instruction appends a transcript row (op, resolved args,
   result, timestamp) to an append-only store. Nothing runs unlogged. (See `agent_isa_storage`.)
4. **Fail-safe approvals.** Snapshots expire (TTL, default 12h). An expired approval resumes as
   a **denial**, never as a silent yes.
5. **No guessing.** An unknown opcode or a bad argument count is an `ERROR` state, never a
   best-effort guess. (AETERNAE's "Unknown tool 'ldapsearch' — available: …" is the same
   principle applied to the tool layer.)

> **Port caveat (Python ↔ Zephir).** `isa_vm.py`'s `empty()` uses loose `==` and includes
> `{}`; `vm.zep`'s `isEmptyVal()` uses strict `===` and omits `{}` (harmless under PHP, where
> `json_decode(...,true)` yields `[]` for `{}`). The one real divergence: a float `0.0` from
> `INFER` reads as empty in Python (`0.0 == 0`) but non-empty in Zephir (`0.0 === 0` is false).
> When `TEST`-ing a numeric INFER result that could be `0.0`, normalise it first. The Python
> file is authoritative.

---

## ASSEMBLY FORMAT

```
LABEL:  OP      arg1, arg2, ...     ; comment
```

Literals: numbers, "strings", {json}, true/false/null. Labels resolve at load time. Programs
are stored as ordered rows (see `agent_isa_storage`); the assembly text is the human view.

---

## WORKED EXAMPLE — gated auto-reply (the "G-block")

```
START:  FETCH   r0, mail_read, {"from":"dee@co.com","unanswered":true}
        TEST    r0.messages
        JZ      DONE
        INFER   r1, "Draft a brief acknowledgment reply. Return {to,subject,body}.", r0.messages.0
        GATE    r1                          ; human sees the draft on phone
        JZ      DENIED                      ; Z set means the human said no
        SEND    mail_send, {"to":"r1.to","subject":"r1.subject","body":"r1.body"}
        NOTIFY  phone, "Reply to Dee sent.", {"priority":1}
        HALT
DENIED: LOG     "human denied G-reply to Dee"
DONE:   HALT
```

The `INFER` drafts; the `GATE` freezes the whole machine to a snapshot and pings the human; only
an approval lets `pc` advance to the `SEND`. Deny → Z set → `JZ DENIED`. The model never touched
the send tool. Run `reference/isa_vm.py` to watch the snapshot→approve and snapshot→deny paths,
plus the invariant-1 violation (SEND with no GATE → ERROR).

---

## HOW THIS PLUGS INTO NAVIGATOR

- A Navigator **skill/playbook** selected by the cognitive ISA can compile down to an AGENT-ISA
  program (rows in the `instructions` table) and execute under these invariants.
- Navigator's **EXEC** opcode (live LLM call) is, in AGENT-ISA terms, a single `INFER` — the
  same "one door for the model" idea. AGENT-ISA generalises it with gating + audit around it.
- Navigator's **engagement mode** (scope-gated operation) maps to a program's `auto_allow` list
  + `GATE` placement: in-scope read tools auto-allow, out-of-scope side effects gate.

## CROSS-REFERENCES
- [navigator_ISA](../../navigator_ISA.md) — the cognitive (routing) ISA this enforces; the model drives that one, code drives this one.
- [agent_isa_storage](agent_isa_storage.md) — the programs/instructions/runs/transcript/approvals schema that backs invariants 3 & 4 (`agent_isa_storage`).
- [gated_agent_loop](gated_agent_loop.md) — the simpler agent-loop form and where the confirmation gate lives client-side (`gated_agent_loop`).
- [isa_system_architecture](../isa_diagrams/system_architecture.md) — Navigator's runtime architecture diagram (`isa_system_architecture`).
- [tool_execution](../anti_failure/tool_execution.md) — anti-failure guard for tool dispatch, the failure mode GATE/auto_allow address (`tool_execution`).

## END OF SKILL
