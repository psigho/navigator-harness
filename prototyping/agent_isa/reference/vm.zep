// agentisa/vm.zep — Zephir port of isa_vm.py (the executable spec).
// Mirrors the Python reference 1:1; where behavior is unclear, the
// Python file is authoritative. This is the CPU-bound dispatch loop
// where Zephir's compilation actually pays off.
//
// Usage from Phalcon:
//   $vm = new AgentIsa\Vm($toolRunner, $inferRunner, $notifier, ["log_tool"]);
//   $vm->reset($programRows);                 // rows from `instructions` table
//   $state = $vm->run();
//   if ($state === "AWAITING_APPROVAL") { store $vm->snapshot(); ping phone; }
//   ...later: $vm->restore($snapshotJson, $approved); $vm->run();

namespace AgentIsa;

class Vm
{
    const RUNNING = "RUNNING";
    const AWAITING = "AWAITING_APPROVAL";
    const HALTED = "HALTED";
    const ERR = "ERROR";

    protected prog;        // array of ["op": "...", "args": [...], "label": ?]
    protected labels;      // label -> index
    protected reg;         // r0..r15 -> mixed
    protected pc = 0;
    protected zf = false;  // zero flag
    protected ff = false;  // infer flag
    protected state;
    protected gatePassed = false;
    protected transcript;

    // injected runtimes — keep the VM pure, like the Python version
    protected toolRunner;   // callable(string toolName, array args) -> array
    protected inferRunner;  // callable(string instruction, var src, array opts) -> array
    protected notifier;     // callable(string channel, var msg, array opts) -> void
    protected autoAllow;    // array of tool names SEND may use ungated

    public function __construct(var toolRunner, var inferRunner,
                                var notifier, array autoAllow = [])
    {
        let this->toolRunner = toolRunner;
        let this->inferRunner = inferRunner;
        let this->notifier = notifier;
        let this->autoAllow = autoAllow;
    }

    public function reset(array programRows) -> void
    {
        var row; int i = 0;
        let this->prog = [], this->labels = [];
        for row in programRows {
            if isset row["label"] && row["label"] {
                let this->labels[row["label"]] = i;
            }
            let this->prog[] = row;
            let i++;
        }
        var j;
        let this->reg = [];
        for j in range(0, 15) { let this->reg["r" . j] = null; }
        let this->pc = 0, this->zf = false, this->ff = false;
        let this->state = self::RUNNING, this->gatePassed = false;
        let this->transcript = [];
    }

    // ---- value resolution: register, dot-path, or literal ----
    protected function val(var a) -> var
    {
        var m, v, part, parts;
        if typeof a != "string" { return a; }
        if !preg_match("/^(r\\d+)((?:\\.\\w+)*)$/", a, m) { return a; }
        let v = isset this->reg[m[1]] ? this->reg[m[1]] : null;
        if m[2] === "" { return v; }
        let parts = explode(".", substr(m[2], 1));
        for part in parts {
            if typeof v == "array" && isset v[part] {
                let v = v[part];
            } else {
                return null;   // missing path -> null, never crash
            }
        }
        return v;
    }

    protected function resolveObj(var o) -> var
    {
        var k, x, out;
        if typeof o == "array" {
            let out = [];
            for k, x in o { let out[k] = this->resolveObj(x); }
            return out;
        }
        if typeof o == "string" && preg_match("/^r\\d+(\\.\\w+)*$/", o) {
            return this->val(o);
        }
        return o;
    }

    protected function isEmptyVal(var v) -> bool
    {
        return v === null || v === false || v === 0 || v === ""
            || v === [] ;
    }

    protected function logStep(string op, var detail) -> void
    {
        let this->transcript[] = ["ts": microtime(true),
            "pc": this->pc, "op": op, "detail": detail];
        // production: also INSERT into append-only transcript table here
    }

    // ---- snapshot / resume (the async gate mechanism) ----
    public function snapshot() -> string
    {
        return json_encode(["pc": this->pc, "reg": this->reg,
            "z": this->zf, "f": this->ff, "state": this->state]);
    }

    public function restore(string snap, bool approved) -> void
    {
        var d;
        let d = json_decode(snap, true);
        let this->reg = d["reg"], this->ff = d["f"];
        let this->pc = d["pc"] + 1;     // continue AFTER the GATE
        let this->zf = !approved;       // deny => Z set; programs JZ on it
        let this->state = self::RUNNING;
        if approved { let this->gatePassed = true; }
        this->logStep("RESUME", ["approved": approved]);
    }

    public function getTranscript() -> array { return this->transcript; }
    public function getState() -> string { return this->state; }

    // ---- main loop ----
    public function run() -> string
    {
        var ins, e;
        while this->state === self::RUNNING && this->pc < count(this->prog) {
            let ins = this->prog[this->pc];
            try {
                this->step(ins);
            } catch \Exception, e {
                let this->state = self::ERR;
                this->logStep("ERROR", ["err": e->getMessage()]);
                break;
            }
            if this->state === self::RUNNING { let this->pc++; }
        }
        if this->state === self::RUNNING { let this->state = self::HALTED; }
        return this->state;
    }

    protected function step(array ins) -> void
    {
        var op, a, rd, tool, args, res, reason, src, opts, instruction;
        let op = ins["op"], a = ins["args"];

        switch op {

            case "MOV":
                let this->reg[a[0]] = this->val(a[1]);
                break;

            case "CMP":
                let this->zf = (this->val(a[0]) == this->val(a[1]));
                break;

            case "TEST":
                let this->zf = this->isEmptyVal(this->val(a[0]));
                break;

            case "JMP":
                let this->pc = this->labels[a[0]] - 1; break;
            case "JZ":
                if this->zf  { let this->pc = this->labels[a[0]] - 1; } break;
            case "JNZ":
                if !this->zf { let this->pc = this->labels[a[0]] - 1; } break;
            case "JF":
                if this->ff  { let this->pc = this->labels[a[0]] - 1; } break;
            case "JNF":
                if !this->ff { let this->pc = this->labels[a[0]] - 1; } break;

            case "HALT":
                let this->state = self::HALTED; break;

            case "LOG":
                this->logStep("LOG", this->val(a[0])); break;

            case "FETCH":
                let rd = a[0], tool = a[1];
                let args = this->resolveObj(isset a[2] ? a[2] : []);
                let res = call_user_func(this->toolRunner, tool, args);
                let this->reg[rd] = res;
                let this->zf = (typeof res == "array" && isset res["error"]);
                this->logStep("FETCH", ["tool": tool, "ok": !this->zf]);
                break;

            case "SEND":
                let tool = a[0];
                if !in_array(tool, this->autoAllow) && !this->gatePassed {
                    throw new \Exception("SEND " . tool .
                        " without passed GATE (invariant 1)");
                }
                let args = this->resolveObj(isset a[1] ? a[1] : []);
                let res = call_user_func(this->toolRunner, tool, args);
                this->logStep("SEND", ["tool": tool, "result": res]);
                break;

            case "NOTIFY":
                let src = this->val(a[1]);
                let opts = this->resolveObj(isset a[2] ? a[2] : []);
                call_user_func(this->notifier, a[0], src, opts);
                this->logStep("NOTIFY", ["channel": a[0], "msg": src]);
                break;

            case "INFER":
                let rd = a[0], instruction = a[1];
                let src = isset a[2] ? this->val(a[2]) : null;
                let opts = this->resolveObj(isset a[3] ? a[3] : []);
                let res = call_user_func(this->inferRunner,
                                         instruction, src, opts);
                let this->reg[rd] = res;
                let this->ff = (typeof res == "array"
                    && isset res["flag"] && res["flag"]);
                this->logStep("INFER", ["flag": this->ff]);
                break;

            case "GATE":
                let reason = count(a) ? this->val(a[0]) : null;
                let this->state = self::AWAITING;
                this->logStep("GATE", ["reason": reason]);
                // caller persists snapshot() and pings the human
                break;

            default:
                throw new \Exception("unknown opcode " . op .
                    " (invariant 5)");
        }
    }
}
