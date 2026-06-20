/*
 * agent_loop.c — the agent loop, stripped to its bones.
 *
 * THE ENTIRE IDEA:
 *
 *   messages = [user_task]
 *   loop:
 *     reply = call_model(messages, tool_menu)
 *     if reply has no tool calls -> done, reply.text is the answer
 *     for each tool call in reply:
 *        result = call_mcp_tool(name, args)      // HTTP POST to MCP server
 *        messages += tool_result(result)
 *     goto loop
 *
 * Everything else in every agent framework is decoration around this.
 *
 * Build: gcc agent_loop.c -lcurl -ljansson -o agent
 * (jansson = small C JSON lib; libcurl = HTTP)
 */

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <curl/curl.h>
#include <jansson.h>

#define MODEL_URL "https://api.anthropic.com/v1/messages"
#define MCP_URL   "http://localhost:9000/mcp"   /* your MCP server */
#define MAX_TURNS 10                            /* safety: never loop forever */

/* ---- tiny growable buffer for curl responses ---- */
struct buf { char *data; size_t len; };

static size_t on_data(void *chunk, size_t sz, size_t n, void *userp) {
    struct buf *b = (struct buf *)userp;
    size_t add = sz * n;
    b->data = realloc(b->data, b->len + add + 1);
    memcpy(b->data + b->len, chunk, add);
    b->len += add;
    b->data[b->len] = '\0';
    return add;
}

/* ---- generic JSON-in, JSON-out HTTP POST ---- */
static json_t *http_post_json(const char *url, json_t *body,
                              struct curl_slist *headers) {
    CURL *c = curl_easy_init();
    struct buf b = {0};
    char *payload = json_dumps(body, 0);

    curl_easy_setopt(c, CURLOPT_URL, url);
    curl_easy_setopt(c, CURLOPT_POSTFIELDS, payload);
    curl_easy_setopt(c, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, on_data);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, &b);
    CURLcode rc = curl_easy_perform(c);
    curl_easy_cleanup(c);
    free(payload);

    if (rc != CURLE_OK) { free(b.data); return NULL; }
    json_t *out = json_loads(b.data, 0, NULL);
    free(b.data);
    return out;        /* caller must json_decref() */
}

/* ---- step 1 of the loop: ask the model what to do ---- */
static json_t *call_model(json_t *messages, json_t *tool_menu) {
    json_t *body = json_pack("{s:s, s:i, s:O, s:O}",
        "model", "claude-sonnet-4-6",
        "max_tokens", 1024,
        "messages", messages,
        "tools", tool_menu);

    struct curl_slist *h = NULL;
    h = curl_slist_append(h, "content-type: application/json");
    h = curl_slist_append(h, "x-api-key: YOUR_KEY_FROM_ENV");
    h = curl_slist_append(h, "anthropic-version: 2023-06-01");

    json_t *resp = http_post_json(MODEL_URL, body, h);
    curl_slist_free_all(h);
    json_decref(body);
    return resp;
}

/* ---- step 2 of the loop: execute a tool via the MCP server ----
 * MCP over HTTP is JSON-RPC: method "tools/call", params {name, arguments}.
 */
static json_t *call_mcp_tool(const char *name, json_t *args) {
    json_t *rpc = json_pack("{s:s, s:s, s:i, s:{s:s, s:O}}",
        "jsonrpc", "2.0",
        "method", "tools/call",
        "id", 1,
        "params", "name", name, "arguments", args);

    struct curl_slist *h = NULL;
    h = curl_slist_append(h, "content-type: application/json");

    json_t *resp = http_post_json(MCP_URL, rpc, h);
    curl_slist_free_all(h);
    json_decref(rpc);
    return resp;
}

int main(void) {
    curl_global_init(CURL_GLOBAL_DEFAULT);

    /* the tool menu — in real MCP you'd fetch this from the server
       via method "tools/list" at startup instead of hardcoding it */
    json_t *tool_menu = json_loads(
        "[{\"name\":\"notify_phone\","
        "  \"description\":\"Send a push notification to the user's phone\","
        "  \"input_schema\":{\"type\":\"object\","
        "    \"properties\":{\"message\":{\"type\":\"string\"}},"
        "    \"required\":[\"message\"]}}]", 0, NULL);

    /* conversation starts with the user's task */
    json_t *messages = json_loads(
        "[{\"role\":\"user\","
        "  \"content\":\"Check status and notify my phone if anything is up.\"}]",
        0, NULL);

    for (int turn = 0; turn < MAX_TURNS; turn++) {

        json_t *reply = call_model(messages, tool_menu);
        if (!reply) { fprintf(stderr, "model call failed\n"); break; }

        /* append assistant reply to history (role+content) */
        json_t *content = json_object_get(reply, "content");
        json_array_append_new(messages, json_pack("{s:s, s:O}",
            "role", "assistant", "content", content));

        /* scan content blocks for tool_use; collect results */
        json_t *results = json_array();
        size_t i; json_t *block;
        int used_tool = 0;

        json_array_foreach(content, i, block) {
            const char *type = json_string_value(json_object_get(block, "type"));

            if (type && strcmp(type, "text") == 0)
                printf("MODEL: %s\n",
                    json_string_value(json_object_get(block, "text")));

            if (type && strcmp(type, "tool_use") == 0) {
                used_tool = 1;
                const char *name = json_string_value(json_object_get(block, "name"));
                const char *id   = json_string_value(json_object_get(block, "id"));
                json_t *args     = json_object_get(block, "input");

                printf("TOOL CALL: %s\n", name);

                /* >>> the confirmation gate goes RIGHT HERE for
                   destructive tools: pause, ask the human, then proceed <<< */

                json_t *tr = call_mcp_tool(name, args);

                /* wrap result in the format the model expects back */
                char *tr_text = json_dumps(
                    json_object_get(json_object_get(tr, "result"), "content"), 0);
                json_array_append_new(results, json_pack(
                    "{s:s, s:s, s:s}",
                    "type", "tool_result",
                    "tool_use_id", id,
                    "content", tr_text ? tr_text : "(empty)"));
                free(tr_text);
                json_decref(tr);
            }
        }

        json_decref(reply);

        if (!used_tool) {            /* no tool calls -> model is done */
            json_decref(results);
            break;
        }

        /* feed tool results back as the next user turn; loop again */
        json_array_append_new(messages, json_pack("{s:s, s:O}",
            "role", "user", "content", results));
        json_decref(results);
    }

    json_decref(messages);
    json_decref(tool_menu);
    curl_global_cleanup();
    return 0;
}
