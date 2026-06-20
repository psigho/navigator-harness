# notify_mcp_server.py
#
# A complete custom MCP server — the "notify my phone" tool from our
# conversation, plus a read-only status tool to show the gated/ungated split.
#
# This is the WHOLE thing. An MCP server is just:
#   1. declare tools (name, description, input schema)
#   2. implement them as functions
#   3. speak the protocol (the SDK handles that part)
#
# Install:  pip install "mcp[cli]" httpx
# Run (HTTP, for your C/Zephir loop to call):
#   python notify_mcp_server.py
#   -> serves JSON-RPC at http://localhost:9000/mcp
#
# Phone setup: install the ntfy app, subscribe to your secret topic name.
# That's it — no account, no API key. POST to the topic = push notification.

import httpx
from mcp.server.fastmcp import FastMCP

# pick a long random topic name — it IS the password
NTFY_TOPIC = "joshua-harness-x9k2m4p7"

mcp = FastMCP("personal-tools", host="0.0.0.0", port=9000)


@mcp.tool()
def notify_phone(message: str, title: str = "Agent", priority: int = 3) -> str:
    """Send a push notification to the user's phone.

    Use this to alert the user about anything important: task results,
    items needing attention, or completed work. Priority: 1=silent,
    3=normal, 5=urgent (bypasses quiet hours).
    """
    resp = httpx.post(
        f"https://ntfy.sh/{NTFY_TOPIC}",
        content=message.encode("utf-8"),
        headers={"Title": title, "Priority": str(priority)},
        timeout=10,
    )
    resp.raise_for_status()
    return f"Notification sent (status {resp.status_code})"


@mcp.tool()
def check_system_status() -> dict:
    """Read-only: report current harness/system status.

    Returns run counts and worker health. Safe to call freely.
    """
    # in real life: query your Phalcon API or DB here
    return {
        "harness_runs_today": 4,
        "last_run": "2026-06-10T07:30:00Z",
        "worker": "healthy",
        "pending_approvals": 0,
    }


# NOTE the design principle, matching the Zephir loop's gatedTools list:
# - notify_phone / check_system_status: harmless, auto-executable.
# - send_email / delete_email: if you add them here, the GATE lives in
#   the agent loop (client side), not in this server. The server just
#   exposes capability; the loop decides what needs a human yes.

if __name__ == "__main__":
    # streamable-http = the modern MCP HTTP transport; this is what your
    # C and Zephir loops POST JSON-RPC to. For Claude Desktop instead,
    # run with: mcp.run(transport="stdio")
    mcp.run(transport="streamable-http")
