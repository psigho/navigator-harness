---
skill_id: gated_agent_loop
type: prototype
category: func_pattern
triggers:
  keywords: [agent, loop, mcp, tool, gate, confirmation, approval, tool_use, json-rpc, ntfy, notify, harness, autonomous]
  languages: [python, all]
  platforms: [cross]
priority: 8
description: The agent loop reduced to its bones (model → MCP tool → repeat) and the one design decision that matters — where the human-confirmation gate lives. Bare C/Zephir loops + a complete MCP server, with gated vs auto-allow tools.
---

# THE GATED AGENT LOOP

Every agent framework is decoration around one loop:

```
messages = [user_task]
loop:
  reply = call_model(messages, tool_menu)
  if reply has no tool calls -> done, reply.text is the answer
  for each tool call in reply:
     result = call_mcp_tool(name, args)      ; HTTP POST (JSON-RPC) to an MCP server
     messages += tool_result(result)
  goto loop
```

The loop itself is trivial and network-bound. The **only interesting decision is where the
human-confirmation gate sits** for destructive tools. This doc captures that decision in three
runnable references (in `reference/`) and ties it to the stronger guarantee in
`agent_execution_isa`.

---

## THE THREE REFERENCES

| File | What it shows |
|------|---------------|
| `reference/agent_loop.c` | The whole loop in ~190 lines of C (libcurl + jansson). Capped at `MAX_TURNS 10`. A comment marks the exact spot the gate belongs — **but does not implement it** (the naive baseline). |
| `reference/agentloop.zep` | Zephir/Phalcon port that **does** gate: a `gatedTools` list (`send_email`, `delete_email`, `forward_email`). On a gated tool it returns `awaiting_approval` + a `messages_snapshot` instead of executing — the client-side equivalent of AGENT-ISA's `GATE`. |
| `reference/notify_mcp_server.py` | A complete minimal MCP server (FastMCP): `notify_phone` (pushes via ntfy.sh) + read-only `check_system_status`. Demonstrates the gated/ungated split from the server's side. |

---

## WHERE THE GATE LIVES — CLIENT, NOT SERVER

The MCP server **exposes capability**; the **loop decides what needs a human yes**. The server
does not know which calls are dangerous — that policy belongs to the orchestrator:

- `notify_phone`, `check_system_status` → harmless, auto-executable.
- `send_email`, `delete_email`, `forward_email` → the gate fires in the loop *before* dispatch.

This is deliberately the same split AGENT-ISA formalises as `auto_allow` (ungated) vs
`SEND`-after-`GATE` (gated). The loop version is the lightweight form; when you need the gate to
be **unskippable** (enforced even if the model or a prompt injection tries to route around it),
graduate to the AGENT-ISA VM, where an ungated `SEND` is a *load-time error*, not a missed `if`.

```
gated_agent_loop   →  gate is an `if` in the loop body      (easy, but skippable in code)
agent_execution_isa →  gate is a load-time invariant         (enforced by the interpreter)
```

---

## THE GATE PATTERN (pseudocode)

```
for block in reply.content:
    if block.type == "tool_use":
        if block.name in GATED_TOOLS:
            persist({messages_snapshot, tool, args, tool_use_id})   # freeze
            notify_human(approve/deny)                              # ntfy push
            return "awaiting_approval"                              # stop the loop
        result = call_mcp_tool(block.name, block.input)            # ungated path
        messages += tool_result(result)
```

On approve, the orchestrator reloads the snapshot and resumes the loop from the stored
`messages` array — the same snapshot→resume mechanic as AGENT-ISA, one altitude up.

---

## MCP CALL SHAPE (for reference)

MCP over HTTP is JSON-RPC. Tool execution is one method:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "notify_phone", "arguments": { "message": "…" } } }
```

The model call is the Anthropic Messages API (`reference/*` pin `claude-sonnet-4-6`; for current
model ids/pricing consult the `claude-api` reference rather than copying the pinned value).

## CROSS-REFERENCES
- [agent_execution_isa](agent_execution_isa.md) — the stronger form where the gate is a load-time invariant, not a skippable `if` (`agent_execution_isa`).
- [agent_isa_storage](agent_isa_storage.md) — where a frozen gate / pending approval is persisted (`agent_isa_storage`).
- [tool_execution](../anti_failure/tool_execution.md) — anti-failure guard for tool dispatch and confirmation (`tool_execution`).
- [multi_agent](../anti_failure/multi_agent.md) — orchestration failure modes around looped tool use (`multi_agent`).

## END OF SKILL
