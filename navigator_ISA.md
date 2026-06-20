# NAVIGATOR INSTRUCTION SET ARCHITECTURE (ISA)
## Cognitive routing in pseudo-machine-code format

This is Navigator translated into instruction-set-style operations that
an AI agent executes as discrete steps rather than parses as language.

The model treats each instruction as a deterministic operation on
context-window state, the way a CPU treats each opcode as a deterministic
operation on register state.

---

## REGISTERS (state held during execution)

```
QRY    = current user query string
INT    = classified intent (BUILD|DEBUG|PROTOTYPE|TOOL|LOOKUP)
DOM    = classified domain(s) (list)
SKL    = selected skill(s) (list)
MAP    = selected map(s) (list)
TOOL   = selected tool(s) (list)
PROTO  = selected prototyping reference(s) (list)
CTX    = conversation context (history, prior domain, prior errors)
RETRY  = build retry counter (0..3)
ERR    = last error captured
CONF   = confidence score (0..100)
OUT    = output buffer
TRACE  = decision trace log
```

---

## OPCODES (operations the AI executes)

```
BOOT                        ; Boot sequence — scan skills/, maps/, rules/
LOAD     <file>             ; Load a navigator file into working context
SCAN     <dir>              ; Enumerate manifest headers in directory
CLASSIFY <register>         ; Run classification on register contents
MATCH    <pattern> <reg>    ; Pattern match register against pattern
SELECT   <type> <criteria>  ; Select skill/map/tool by criteria
COMPOSE  <reg_list>         ; Compose output from multiple sources
EXEC     <skill>            ; Execute a skill
VERIFY   <result>           ; Run verification chain on result
TRACE    <event>            ; Log to decision trace
EMIT     <reg>              ; Emit register contents to output
HALT                        ; Stop processing
JMP      <label>            ; Jump to instruction label
JE       <reg> <val> <lbl>  ; Jump if register equals value
JNE      <reg> <val> <lbl>  ; Jump if register not equals value
JG       <reg> <val> <lbl>  ; Jump if register greater than value
INC      <reg>              ; Increment register
DEC      <reg>              ; Decrement register
PUSH     <reg>              ; Push register to stack
POP      <reg>              ; Pop stack to register
CALL     <subroutine>       ; Call a subroutine
RET                         ; Return from subroutine
NOP                         ; No operation (skip)
ABORT    <reason>           ; Abort with reason
ASK      <question>         ; Request clarification from user
```

---

## BOOT SEQUENCE (executes once on session start)

```assembly
_boot:
    LOAD     master_skill.md
    SCAN     skills/build/
    PUSH     SKL                    ; build skills registered
    SCAN     skills/debug/
    PUSH     SKL                    ; debug skills registered
    SCAN     maps/
    PUSH     MAP                    ; maps registered
    SCAN     prototyping/
    PUSH     PROTO                  ; prototyping refs registered
    LOAD     skills/rules/routing.md
    LOAD     tool_repo.md
    TRACE    "boot_complete"
    RET                             ; ready for queries
```

---

## MAIN ROUTING LOOP

```assembly
_main:
    POP      QRY                    ; receive user query
    TRACE    "query_received"
    CALL     _classify_intent
    CALL     _classify_domain
    CALL     _route
    CALL     _execute
    CALL     _verify
    EMIT     OUT
    JMP      _main                  ; loop for next query
```

---

## INTENT CLASSIFICATION

```assembly
_classify_intent:
    ; Check in priority order — first match wins

    MATCH    BUILD_KEYWORDS QRY
    JE       MATCH 1 _set_build

    MATCH    DEBUG_KEYWORDS QRY
    JE       MATCH 1 _set_debug

    MATCH    PROTO_KEYWORDS QRY
    JE       MATCH 1 _set_proto

    MATCH    TOOL_KEYWORDS QRY
    JE       MATCH 1 _set_tool

    ; Default if nothing else matched
    JMP      _set_lookup

_set_build:
    MOV      INT BUILD
    TRACE    "intent=BUILD"
    RET

_set_debug:
    MOV      INT DEBUG
    TRACE    "intent=DEBUG"
    RET

_set_proto:
    MOV      INT PROTOTYPE
    TRACE    "intent=PROTOTYPE"
    RET

_set_tool:
    MOV      INT TOOL
    TRACE    "intent=TOOL"
    RET

_set_lookup:
    MOV      INT LOOKUP
    TRACE    "intent=LOOKUP"
    RET
```

---

## DOMAIN CLASSIFICATION

```assembly
_classify_domain:
    XOR      DOM DOM                ; clear domain register

    MATCH    AD_KEYWORDS QRY
    JE       MATCH 1 _add_ad

_check_linux:
    MATCH    LINUX_KEYWORDS QRY
    JE       MATCH 1 _add_linux

_check_container:
    MATCH    CONTAINER_KEYWORDS QRY
    JE       MATCH 1 _add_container

_check_cloud:
    MATCH    CLOUD_KEYWORDS QRY
    JE       MATCH 1 _add_cloud

_check_web:
    MATCH    WEB_KEYWORDS QRY
    JE       MATCH 1 _add_web

    JMP      _domain_done

_add_ad:
    OR       DOM AD
    TRACE    "domain+=AD"
    JMP      _check_linux

_add_linux:
    OR       DOM LINUX
    TRACE    "domain+=LINUX"
    JMP      _check_container

_add_container:
    OR       DOM CONTAINER
    TRACE    "domain+=CONTAINER"
    JMP      _check_cloud

_add_cloud:
    OR       DOM CLOUD
    TRACE    "domain+=CLOUD"
    JMP      _check_web

_add_web:
    OR       DOM WEB
    TRACE    "domain+=WEB"
    JMP      _domain_done

_domain_done:
    JE       DOM 0 _ask_domain      ; if no domain matched, clarify
    RET

_ask_domain:
    ASK      "Which domain does this apply to?"
    RET
```

---

## ROUTING BRANCH

```assembly
_route:
    JE       INT BUILD     _route_build
    JE       INT DEBUG     _route_debug
    JE       INT PROTOTYPE _route_proto
    JE       INT TOOL      _route_tool
    JE       INT LOOKUP    _route_lookup
    ABORT    "unknown_intent"

_route_build:
    SELECT   SKL build LANGUAGE=QRY.lang
    SELECT   PROTO build_order LANGUAGE=QRY.lang
    SELECT   PROTO func_encyclopedia DOMAIN=DOM
    SELECT   PROTO dev_reference DOMAIN=DOM
    SELECT   MAP DOM
    SELECT   TOOL DOM
    MOV      RETRY 0
    RET

_route_debug:
    SELECT   SKL debug ERROR=ERR
    SELECT   PROTO dev_reference DOMAIN=DOM
    RET

_route_proto:
    SELECT   PROTO ALL DOMAIN=DOM
    SELECT   MAP DOM
    RET

_route_tool:
    SELECT   TOOL QRY.tool_name
    JE       TOOL NULL _tool_not_found
    SELECT   MAP TOOL.referenced_by
    RET

_tool_not_found:
    ABORT    "tool_not_in_repo"

_route_lookup:
    SELECT   MAP DOM
    RET
```

---

## EXECUTION

```assembly
_execute:
    JE       INT BUILD _exec_build
    JMP      _exec_default

_exec_build:
    EXEC     SKL                    ; run build skill
    VERIFY   OUT
    JE       VERIFY OK _build_success
    JMP      _build_retry

_build_success:
    TRACE    "build_success"
    RET

_build_retry:
    INC      RETRY
    JG       RETRY 3 _build_failed_final
    CALL     _route_debug           ; load paired debug skill
    EXEC     SKL                    ; run debug skill
    JMP      _exec_build            ; retry build

_build_failed_final:
    TRACE    "build_failed_3_attempts"
    EMIT     "Tried: ..."
    EMIT     "Failed because: ..."
    EMIT     "Manual steps: ..."
    HALT

_exec_default:
    COMPOSE  SKL MAP PROTO TOOL
    EMIT     OUT
    RET
```

---

## VERIFICATION CHAIN

```assembly
_verify:
    PUSH     OUT
    CALL     _verify_source         ; cited sources exist?
    JE       VERIFY FAIL _verify_failed

    CALL     _verify_hallucination  ; any unknown tool/syscall mentioned?
    JE       VERIFY FAIL _verify_failed

    CALL     _verify_confidence     ; confidence above threshold?
    JG       CONF 70 _verify_pass
    JMP      _verify_low_conf

_verify_pass:
    TRACE    "verify_pass"
    POP      OUT
    RET

_verify_low_conf:
    TRACE    "verify_low_conf"
    EMIT     "Low confidence — review carefully"
    POP      OUT
    RET

_verify_failed:
    TRACE    "verify_failed"
    ABORT    "verification_failed"
```

---

## ERROR RECOVERY

```assembly
_on_error:
    PUSH     ERR
    TRACE    "error_captured"

    MATCH    ERR_PATTERNS ERR
    JE       MATCH 1 _route_to_debug
    JMP      _no_debug_skill

_route_to_debug:
    SELECT   SKL debug ERROR_PATTERN=ERR.pattern
    EXEC     SKL
    RET

_no_debug_skill:
    ABORT    "no_debug_skill_for_error"
```

---

## EXAMPLE TRACE: BUILD QUERY

User: "build me a Modbus TCP scanner in C for Linux"

```assembly
; Trace of execution

BOOT                                ; (already done at session start)

POP      QRY = "build me a Modbus TCP scanner in C for Linux"

CALL     _classify_intent
    MATCH BUILD_KEYWORDS QRY → 1
    MOV INT = BUILD
    TRACE "intent=BUILD"
RET

CALL     _classify_domain
    MATCH AD_KEYWORDS QRY → 0
    MATCH LINUX_KEYWORDS QRY → 1
    OR DOM = LINUX
    MATCH CONTAINER_KEYWORDS QRY → 0
    MATCH CLOUD_KEYWORDS QRY → 0
    MATCH WEB_KEYWORDS QRY → 0
    ; Also matches OT/ICS for Modbus
    OR DOM = OT_ICS
RET

CALL     _route_build
    SELECT SKL = c_build (lang=C)
    SELECT PROTO build_orders/c_socket_linux
    SELECT PROTO func_encyclopedia/socket_create
    SELECT PROTO func_encyclopedia/tcp_connect
    SELECT PROTO dev_reference/modbus_tcp_frame
    SELECT MAP = ot_ics_scada
    SELECT TOOL = mbtget, pymodbus (reference)
    MOV RETRY = 0
RET

CALL     _execute
    CALL _exec_build
    EXEC SKL c_build
        ; Composes from:
        ;   - maps/ot_ics_scada.md (Modbus protocol)
        ;   - prototyping/build_orders (gcc linux socket build)
        ;   - prototyping/func_encyclopedia (socket patterns)
        ;   - prototyping/dev_reference (Modbus frame structure)
    VERIFY OUT
        VERIFY source → PASS
        VERIFY hallucination → PASS
        VERIFY confidence → CONF=85 → PASS
RET

EMIT OUT
TRACE "query_complete"
JMP _main
```

---

## WHY THIS WORKS AS A COGNITIVE COMPILATION

When an AI model reads Navigator-as-markdown, it has to:
1. Parse the natural language
2. Infer what to do from the description
3. Hold the framework in attention
4. Apply it through interpretation

When an AI model reads Navigator-as-ISA, it executes deterministic
operations:
1. POP query
2. CLASSIFY intent (pattern match → set register)
3. CLASSIFY domain (pattern match → set register)
4. JMP to route handler (deterministic branch)
5. SELECT sources (lookup table)
6. EXEC skill (call sequence)
7. VERIFY (deterministic check)
8. EMIT output

The interpretation layer collapses. The model treats each opcode as
a discrete action with defined inputs and outputs. There's no
ambiguity about what comes next.

This is closer to how compiled code runs on a CPU. The model
becomes the execution unit. Navigator becomes the program.

The markdown version describes the system.
The ISA version IS the system.

---

## COMPANION: THE EXECUTION (SAFETY) ISA

The ISA above is the **cognitive** ISA — *the model is the execution unit*, and these opcodes are
a discipline it follows to route a query. It is advisory: nothing stops the model from skipping a
step.

There is a complementary half: **AGENT-ISA**, the **execution** ISA, where *the model is NOT the
execution unit*. A small deterministic VM owns sequencing, branching, gating, tool dispatch, and
the audit trail; the model is confined to a single opcode (`INFER`) that returns data the program
decides what to do with.

```
navigator_ISA.md   (this file, cognitive)   →  decide WHICH playbook/skill to run   (model drives)
agent_execution_isa (execution)             →  RUN that playbook safely              (code drives)
```

Navigator's own **EXEC** opcode (the live LLM call) is, in AGENT-ISA terms, exactly one sandboxed
`INFER`. AGENT-ISA generalises it with load-time-enforced gating (`SEND` requires `GATE`), an
append-only transcript, and fail-safe approval expiry — the runtime model the AETERNAE harness
already runs. See:

- `prototyping/agent_isa/agent_execution_isa.md` — the opcode spec + five security invariants.
- `prototyping/agent_isa/gated_agent_loop.md` — the loop form and where the gate lives.
- `prototyping/agent_isa/agent_isa_storage.md` — the storage/audit schema + AETERNAE mapping.
