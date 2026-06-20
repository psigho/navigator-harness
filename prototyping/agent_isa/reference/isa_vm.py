"""
isa_vm.py — reference interpreter for AGENT-ISA v0.1

Runnable and testable: tools and INFER are injected as callables, so the
demo at the bottom runs the F-block and G-block programs with mocks and
exercises snapshot/resume through a GATE.

This file is the executable spec. The Zephir port mirrors it 1:1.
"""

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable


# ---------------------------------------------------------------- parsing

@dataclass
class Instr:
    label: str | None
    op: str
    args: list[Any]
    line: str


def _parse_arg(tok: str) -> Any:
    tok = tok.strip()
    if not tok:
        return None
    if tok[0] in "{[\"":
        return json.loads(tok)
    if tok in ("true", "false", "null"):
        return json.loads(tok)
    try:
        return int(tok)
    except ValueError:
        pass
    try:
        return float(tok)
    except ValueError:
        pass
    return tok  # register, path, label, or bare word


def _split_args(s: str) -> list[str]:
    """split on commas not inside {} [] or quotes"""
    out, depth, q, cur = [], 0, None, []
    for ch in s:
        if q:
            cur.append(ch)
            if ch == q:
                q = None
            continue
        if ch in "\"'":
            q = ch
            cur.append(ch)
        elif ch in "{[":
            depth += 1
            cur.append(ch)
        elif ch in "}]":
            depth -= 1
            cur.append(ch)
        elif ch == "," and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    if cur:
        out.append("".join(cur))
    return out


def assemble(text: str) -> tuple[list[Instr], dict[str, int]]:
    prog: list[Instr] = []
    labels: dict[str, int] = {}
    for raw in text.splitlines():
        line = raw.split(";")[0].rstrip()
        if not line.strip():
            continue
        label = None
        m = re.match(r"\s*([A-Za-z_]\w*):\s*(.*)", line)
        if m:
            label, line = m.group(1), m.group(2)
        if label:
            labels[label] = len(prog)
        if not line.strip():
            continue
        parts = line.strip().split(None, 1)
        op = parts[0].upper()
        args = [_parse_arg(a) for a in _split_args(parts[1])] if len(parts) > 1 else []
        prog.append(Instr(label, op, args, raw))
    return prog, labels


# ---------------------------------------------------------------- the VM

RUNNING, AWAITING_APPROVAL, HALTED, ERROR = (
    "RUNNING", "AWAITING_APPROVAL", "HALTED", "ERROR")

SIDE_EFFECT_OPS = {"SEND"}


class VM:
    def __init__(self,
                 tools: dict[str, Callable[[dict], Any]],
                 infer: Callable[[str, Any, dict], Any],
                 notify: Callable[[str, Any, dict], None],
                 auto_allow: set[str] | None = None):
        self.tools = tools
        self.infer_fn = infer
        self.notify_fn = notify
        self.auto_allow = auto_allow or set()
        self.transcript: list[dict] = []

    # ---- state ----
    def reset(self, program: list[Instr], labels: dict[str, int]):
        self.prog, self.labels = program, labels
        self.pc = 0
        self.reg: dict[str, Any] = {f"r{i}": None for i in range(16)}
        self.z = False
        self.f = False
        self.state = RUNNING
        self.gate_passed_for_run = False

    # ---- value resolution: register, dot-path, or literal ----
    def val(self, a: Any) -> Any:
        if not isinstance(a, str):
            return a
        m = re.match(r"^(r\d+)((?:\.\w+)*)$", a)
        if not m:
            return a  # bare string literal / label
        v = self.reg.get(m.group(1))
        for part in m.group(2).split(".")[1:]:
            if isinstance(v, dict):
                v = v.get(part)
            elif isinstance(v, list) and part.isdigit():
                i = int(part)
                v = v[i] if i < len(v) else None
            else:
                v = None
        return v

    def resolve_obj(self, o: Any) -> Any:
        """resolve register paths used as values inside arg objects"""
        if isinstance(o, dict):
            return {k: self.resolve_obj(v) for k, v in o.items()}
        if isinstance(o, list):
            return [self.resolve_obj(x) for x in o]
        if isinstance(o, str) and re.match(r"^r\d+(\.\w+)*$", o):
            return self.val(o)
        return o

    @staticmethod
    def empty(v: Any) -> bool:
        return v is None or v is False or v == 0 or v == "" or v == [] or v == {}

    def log(self, op: str, detail: Any):
        self.transcript.append({
            "ts": time.time(), "pc": self.pc, "op": op, "detail": detail})

    # ---- snapshot / resume ----
    def snapshot(self) -> str:
        return json.dumps({
            "pc": self.pc, "reg": self.reg,
            "z": self.z, "f": self.f, "state": self.state})

    def restore(self, snap: str, approved: bool):
        d = json.loads(snap)
        self.reg, self.f = d["reg"], d["f"]
        self.pc = d["pc"] + 1          # continue AFTER the GATE
        self.z = not approved          # deny => Z set, programs JZ to handle
        self.state = RUNNING
        if approved:
            self.gate_passed_for_run = True
        self.log("RESUME", {"approved": approved})

    # ---- main loop ----
    def run(self) -> str:
        while self.state == RUNNING and self.pc < len(self.prog):
            ins = self.prog[self.pc]
            try:
                self.step(ins)
            except Exception as e:           # never guess: fail loudly
                self.state = ERROR
                self.log("ERROR", {"line": ins.line, "err": str(e)})
                break
            if self.state == RUNNING:
                self.pc += 1
        if self.state == RUNNING:
            self.state = HALTED
        return self.state

    def step(self, ins: Instr):
        op, a = ins.op, ins.args

        if op == "MOV":
            self.reg[a[0]] = self.val(a[1])
        elif op == "CMP":
            self.z = self.val(a[0]) == self.val(a[1])
        elif op == "TEST":
            self.z = self.empty(self.val(a[0]))
        elif op == "JMP":
            self.pc = self.labels[a[0]] - 1
        elif op == "JZ":
            if self.z: self.pc = self.labels[a[0]] - 1
        elif op == "JNZ":
            if not self.z: self.pc = self.labels[a[0]] - 1
        elif op == "JF":
            if self.f: self.pc = self.labels[a[0]] - 1
        elif op == "JNF":
            if not self.f: self.pc = self.labels[a[0]] - 1
        elif op == "HALT":
            self.state = HALTED
        elif op == "LOG":
            self.log("LOG", self.val(a[0]))

        elif op == "FETCH":
            rd, tool = a[0], a[1]
            args = self.resolve_obj(a[2] if len(a) > 2 else {})
            try:
                res = self.tools[tool](args)
            except Exception as e:
                res = {"error": str(e)}
            self.reg[rd] = res
            self.z = isinstance(res, dict) and "error" in res
            self.log("FETCH", {"tool": tool, "args": args,
                               "ok": not self.z})

        elif op == "SEND":
            tool = a[0]
            if tool not in self.auto_allow and not self.gate_passed_for_run:
                raise RuntimeError(
                    f"SEND {tool} without passed GATE (invariant 1)")
            args = self.resolve_obj(a[1] if len(a) > 1 else {})
            res = self.tools[tool](args)
            self.log("SEND", {"tool": tool, "args": args, "result": res})

        elif op == "NOTIFY":
            channel, src = a[0], self.val(a[1])
            opts = self.resolve_obj(a[2] if len(a) > 2 else {})
            self.notify_fn(channel, src, opts)
            self.log("NOTIFY", {"channel": channel, "msg": src})

        elif op == "INFER":
            rd, instruction = a[0], a[1]
            src = self.val(a[2]) if len(a) > 2 else None
            opts = self.resolve_obj(a[3] if len(a) > 3 else {})
            res = self.infer_fn(instruction, src, opts)
            self.reg[rd] = res
            self.f = bool(isinstance(res, dict) and res.get("flag"))
            self.log("INFER", {"instruction": instruction, "flag": self.f})

        elif op == "GATE":
            reason = self.val(a[0]) if a else None
            self.state = AWAITING_APPROVAL
            self.log("GATE", {"reason": reason})
            # caller persists self.snapshot() and notifies the human

        else:
            raise RuntimeError(f"unknown opcode {op} (invariant 5)")


# ---------------------------------------------------------------- demo

F_BLOCK = """
START:  FETCH   r0, mail_read, {"from":"@allowlist","since":"8h"}
        TEST    r0.messages
        JZ      DONE
        INFER   r1, "Summarize these emails in 3 lines. Set flag=true if anything is urgent.", r0.messages
        LOG     r1
        JNF     QUIET
        NOTIFY  phone, r1.summary, {"priority":4,"title":"Urgent mail"}
        HALT
QUIET:  NOTIFY  phone, r1.summary, {"priority":2,"title":"Morning mail"}
DONE:   HALT
"""

G_BLOCK = """
START:  FETCH   r0, mail_read, {"from":"dee@co.com","unanswered":true}
        TEST    r0.messages
        JZ      DONE
        INFER   r1, "Draft a brief acknowledgment reply. Return {to,subject,body}.", r0.messages.0
        GATE    r1
        JZ      DENIED
        SEND    mail_send, {"to":"r1.to","subject":"r1.subject","body":"r1.body"}
        NOTIFY  phone, "Reply to Dee sent.", {"priority":1}
        HALT
DENIED: LOG     "human denied G-reply to Dee"
DONE:   HALT
"""

if __name__ == "__main__":
    sent = []
    tools = {
        "mail_read": lambda a: {"messages": [
            {"from": "dee@co.com", "subject": "Q3 numbers",
             "body": "Can you confirm the harness timeline?"}]},
        "mail_send": lambda a: sent.append(a) or {"ok": True},
    }
    notifications = []

    def mock_infer(instruction, src, opts):
        if "Summarize" in instruction:
            return {"summary": "1 mail from Dee re: timeline.", "flag": True}
        return {"to": "dee@co.com", "subject": "Re: Q3 numbers",
                "body": "Got it — will confirm tomorrow. —J"}

    def mock_notify(channel, msg, opts):
        notifications.append((channel, msg, opts))
        print(f"  [notify -> {channel}] {msg}")

    # ---- run F-block straight through ----
    print("== F-block (morning summary) ==")
    vm = VM(tools, mock_infer, mock_notify)
    vm.reset(*assemble(F_BLOCK))
    print("final state:", vm.run())

    # ---- run G-block: hits GATE, snapshot, resume approved ----
    print("\n== G-block (gated reply) ==")
    vm2 = VM(tools, mock_infer, mock_notify)
    vm2.reset(*assemble(G_BLOCK))
    state = vm2.run()
    print("state at gate:", state)
    snap = vm2.snapshot()
    print("snapshot bytes:", len(snap), "(this is the DB row)")

    # ...hours pass; human taps APPROVE on phone...
    vm3 = VM(tools, mock_infer, mock_notify)
    vm3.reset(*assemble(G_BLOCK))
    vm3.restore(snap, approved=True)
    print("resumed ->", vm3.run())
    print("emails actually sent:", sent)

    # ---- same gate, but DENIED ----
    print("\n== G-block, denial path ==")
    sent.clear()
    vm4 = VM(tools, mock_infer, mock_notify)
    vm4.reset(*assemble(G_BLOCK))
    vm4.run()
    snap2 = vm4.snapshot()
    vm5 = VM(tools, mock_infer, mock_notify)
    vm5.reset(*assemble(G_BLOCK))
    vm5.restore(snap2, approved=False)
    print("resumed ->", vm5.run())
    print("emails actually sent:", sent, "(should be empty)")

    # ---- invariant check: SEND without GATE must fail ----
    print("\n== invariant 1: SEND without GATE ==")
    BAD = 'START:  SEND  mail_send, {"to":"x"}\n        HALT'
    vm6 = VM(tools, mock_infer, mock_notify)
    vm6.reset(*assemble(BAD))
    print("state:", vm6.run(), "->", vm6.transcript[-1]["detail"]["err"])
