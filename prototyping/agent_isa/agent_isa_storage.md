---
skill_id: agent_isa_storage
type: prototype
category: dev_ref
triggers:
  keywords: [schema, storage, database, postgres, sql, transcript, audit, append-only, runs, approvals, programs, instructions, snapshot, checkpoint, replay, migration]
  languages: [sql, all]
  platforms: [cross]
priority: 8
description: The five-table storage + audit model that backs AGENT-ISA (programs, instructions, runs, transcript, approvals) — append-only audit, the rules→programs migration trick, and the 1:1 mapping onto the AETERNAE harness UI.
---

# AGENT-ISA STORAGE & AUDIT MODEL

The deterministic VM in `agent_execution_isa` is stateless code; its durability lives in five
tables. The pristine DDL is `reference/schema.sql` (Postgres; trivially portable to
MySQL/SQLite). This doc indexes it and maps it onto the AETERNAE operator console.

---

## THE FIVE TABLES

| Table | Role |
|-------|------|
| `programs` | A named playbook (`morning_mail`, `g2_dee_ack`). Holds `schedule_cron`, `enabled`, and `auto_allow` (the tools `SEND` may use ungated). |
| `instructions` | The ISA itself — **one row per opcode** (`seq` = program counter, `label`, `op`, `args`). |
| `runs` | One execution of a program (append-only). `state ∈ RUNNING\|AWAITING_APPROVAL\|HALTED\|ERROR\|EXPIRED`, `trigger ∈ cron\|manual\|resume`. |
| `transcript` | Every executed instruction, forever (append-only). `pc`, `op`, `detail` (resolved args, results, flags). The audit spine — invariant 3. |
| `approvals` | Frozen gates awaiting a human: the `snapshot` JSON (full VM state), `reason`, `expires_at` (default now()+12h), `decision ∈ approved\|denied\|expired`. Invariant 4. |

---

## TWO DESIGN MOVES WORTH KEEPING

**1. Append-only enforcement (invariant 3 in DDL).** `REVOKE UPDATE, DELETE ON transcript FROM
PUBLIC;` — the audit trail cannot be rewritten, even by the owner. Corrections are new rows. The
only mutable audit fields (`approvals.decided_at`/`decision`) are gated behind a
`SECURITY DEFINER` function or a dedicated role.

**2. The rules→programs migration trick (no data migration).** A "simple rule" is just a program
with 2–4 rows (`FETCH`, `INFER`, `NOTIFY`, `HALT`). Start by only ever writing those shapes and
you're effectively using a rules table. Later, write longer programs with jumps and gates into
the **same** `instructions` table — the interpreter doesn't care. You graduate from a rules
engine to a full agent VM with zero schema migration.

---

## MAPPING ONTO AETERNAE (the harness this models)

AETERNAE — the operator console in the screenshots (`K:\Antigravity Projects\Ares\Aet1–4.png`) —
is this storage model with a UI on top. The correspondence is near 1:1:

| AETERNAE UI | AGENT-ISA storage / concept |
|-------------|------------------------------|
| **SWARM → "Workflow Runs"** (`htb-farm-autonomous`, status RUNNING/FAILED/ABORTED) | rows in `runs`, with the `state` machine |
| **MACHINES → "Checkpoint"** (active engagement, paused state) | an `approvals.snapshot` — a `GATE` frozen mid-run |
| **REPLAY** tab | reading back the `transcript` rows of a run |
| **"Attack Chain"** (`run_command`, `read_files`, …) | `FETCH`/`SEND` transcript entries |
| **FINDINGS** tab | engagement findings logged against a run (cf. Navigator engagement mode) |
| **"Unknown tool 'ldapsearch' — available: …"** | invariant 5 (no guessing) at the tool layer |
| Settings → **ISA / FRAMEWORK / SKILLS / MCP** tabs | Navigator loaded as AETERNAE's skill framework + ISA |
| Left rail → **FRAMEWORK LOAD: Navigator V6 · SKILLS 34 · NAVIGATOR MCP** | Navigator is the framework AETERNAE consumes |
| Operator Console → "all four tables confirmed in `training.db`" | the persisted ISA tables (programs/instructions/runs/transcript/approvals) — AETERNAE keeps its run state in a local SQLite `training.db` |
| Footer killchain **RCN·ENM·FTH·USR·PRV·ROT·LOT·RPT·CLN** | per-run phase tracking layered over the `runs` state machine |

In other words: AETERNAE = AGENT-ISA runs + Navigator skills, presented as a red-team operator
console. Integrating AGENT-ISA into Navigator closes the loop — the harness's runtime model now
has a written spec inside the framework it already loads.

---

## EXAMPLE — the G-block as rows

`reference/schema.sql` ends with the full `INSERT` for `g2_dee_ack`: 11 `instructions` rows
(`FETCH → TEST → JZ → INFER → GATE → JZ → SEND → NOTIFY → HALT`, plus `DENIED`/`DONE` labels)
under one `programs` row scheduled `0 19 * * *`. That is exactly what a dashboard program editor
writes, and exactly what the VM in `reference/isa_vm.py` loads and runs.

## CROSS-REFERENCES
- [agent_execution_isa](agent_execution_isa.md) — the VM these tables persist; invariants 3 & 4 live here (`agent_execution_isa`).
- [gated_agent_loop](gated_agent_loop.md) — the loop form whose pending approvals persist to the `approvals` table (`gated_agent_loop`).
- [build_integrity](../anti_failure/build_integrity.md) — append-only audit as a build-integrity guarantee (`build_integrity`).
- [isa_system_architecture](../isa_diagrams/system_architecture.md) — where storage sits in the Navigator runtime (`isa_system_architecture`).

## END OF SKILL
