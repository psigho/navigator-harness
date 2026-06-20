// agentloop/agentloop.zep
//
// Zephir version of the same loop, shaped for YOUR stack:
// Phalcon orchestrates -> this class runs the loop -> tools execute
// either on an MCP server (HTTP JSON-RPC) or via your Python worker.
//
// Build: zephir build   (inside an ext skeleton: zephir init agentloop)
// Use from PHP/Phalcon:
//   $loop = new AgentLoop\AgentLoop($apiKey, "http://localhost:9000/mcp");
//   $out  = $loop->run("Summarize unread email and notify my phone", $toolMenu);
//
// Zephir compiles this to a C extension, but note what we noted before:
// the work here is network-bound, so the speed win is ~zero. The value
// is keeping your business logic in your compiled PHP layer.

namespace AgentLoop;

class AgentLoop
{
    protected apiKey;
    protected mcpUrl;
    protected modelUrl = "https://api.anthropic.com/v1/messages";
    protected maxTurns = 10;

    // tools that must pause for human approval before executing
    protected gatedTools;

    public function __construct(string apiKey, string mcpUrl)
    {
        let this->apiKey = apiKey;
        let this->mcpUrl = mcpUrl;
        let this->gatedTools = ["send_email", "delete_email", "forward_email"];
    }

    // ---------- THE LOOP ----------
    public function run(string task, array toolMenu) -> array
    {
        var messages, reply, content, block, results, toolResult;
        var transcript;            // every step, for your append-only store
        int turn;
        bool usedTool;

        let messages = [
            ["role": "user", "content": task]
        ];
        let transcript = [];

        for turn in range(1, this->maxTurns) {

            let reply = this->callModel(messages, toolMenu);
            if !isset reply["content"] {
                let transcript[] = ["error": "model call failed", "turn": turn];
                break;
            }

            let content = reply["content"];
            let messages[] = ["role": "assistant", "content": content];

            let results = [];
            let usedTool = false;

            for block in content {

                if block["type"] === "text" {
                    let transcript[] = ["turn": turn, "type": "text",
                                        "text": block["text"]];
                }

                if block["type"] === "tool_use" {
                    let usedTool = true;

                    // ---- confirmation gate ----
                    if in_array(block["name"], this->gatedTools) {
                        // Don't execute. Persist a pending approval and stop.
                        // Your Phalcon app pings your phone (ntfy) with
                        // approve/deny; on approve, the loop resumes from
                        // the stored messages array.
                        let transcript[] = ["turn": turn, "type": "gated",
                                            "tool": block["name"],
                                            "args": block["input"],
                                            "tool_use_id": block["id"],
                                            "messages_snapshot": messages];
                        return ["status": "awaiting_approval",
                                "transcript": transcript];
                    }

                    let toolResult = this->callMcpTool(
                        block["name"], block["input"]);

                    let transcript[] = ["turn": turn, "type": "tool_call",
                                        "tool": block["name"],
                                        "args": block["input"],
                                        "result": toolResult];

                    let results[] = [
                        "type": "tool_result",
                        "tool_use_id": block["id"],
                        "content": json_encode(toolResult)
                    ];
                }
            }

            if !usedTool {
                // no tool calls => the model has finished
                return ["status": "done", "transcript": transcript];
            }

            // feed tool results back; loop continues
            let messages[] = ["role": "user", "content": results];
        }

        return ["status": "max_turns", "transcript": transcript];
    }

    // ---------- step 1: ask the model ----------
    protected function callModel(array messages, array toolMenu) -> array
    {
        var body;
        let body = [
            "model": "claude-sonnet-4-6",
            "max_tokens": 1024,
            "messages": messages,
            "tools": toolMenu
        ];
        return this->postJson(this->modelUrl, body, [
            "content-type: application/json",
            "x-api-key: " . this->apiKey,
            "anthropic-version: 2023-06-01"
        ]);
    }

    // ---------- step 2: execute a tool on the MCP server ----------
    protected function callMcpTool(string name, var args) -> array
    {
        var rpc, resp;
        let rpc = [
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": ["name": name, "arguments": args]
        ];
        let resp = this->postJson(this->mcpUrl, rpc,
            ["content-type: application/json"]);

        if isset resp["result"] {
            return resp["result"];
        }
        return ["error": "mcp call failed", "raw": resp];
    }

    // ---------- plumbing: Zephir can call PHP's curl directly ----------
    protected function postJson(string url, array body, array headers) -> array
    {
        var ch, raw, decoded;

        let ch = curl_init(url);
        curl_setopt(ch, CURLOPT_POST, true);
        curl_setopt(ch, CURLOPT_POSTFIELDS, json_encode(body));
        curl_setopt(ch, CURLOPT_HTTPHEADER, headers);
        curl_setopt(ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt(ch, CURLOPT_TIMEOUT, 120);

        let raw = curl_exec(ch);
        curl_close(ch);

        if raw === false {
            return [];
        }
        let decoded = json_decode(raw, true);
        if decoded === null {
            return [];
        }
        return decoded;
    }
}
