"""Access setup remains outside the Python SDK owned run interval."""
from __future__ import annotations

import sys
from pathlib import Path

from deepseek_harness import DeepSeekHarness


def test_recorded_access_setup_stays_outside_the_python_run_interval(tmp_path: Path) -> None:
    fixture = Path(__file__).resolve().parents[3] / "snapshots/sdk/bash-tool/notifications.expected.jsonl"
    script = tmp_path / "recorded_access_runtime.py"
    script.write_text(
        """
import json
import sys
from pathlib import Path

frames = [json.loads(line.replace("{{sessionId}}", "main")) for line in Path(sys.argv[1]).read_text().splitlines()]
context = next(json.loads(line) for line in Path(sys.argv[1]).with_name("session.v3.jsonl").read_text().splitlines() if json.loads(line)["type"] == "permission/context")
for line in sys.stdin:
    request = json.loads(line)
    method = request["method"]
    result = {}
    if method == "initialize":
        result = {"serverInfo": {"name": "recorded-access"}}
    elif method == "session/prompt":
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": "main", "event": context}}), flush=True)
        for frame in frames:
            print(json.dumps({"jsonrpc": "2.0", **frame}), flush=True)
        result = {"messageId": "main"}
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
    if method == "shutdown":
        break
""".strip()
    )
    with DeepSeekHarness(_launch_args=(sys.executable, str(script), str(fixture)), cwd=str(tmp_path)) as harness:
        result = harness.run("replay", session_id="main")
    assert result.finish_reason == "completed"
    assert result.final_response == "dsh-sdk-proof-7391"
    assert all(event["type"] != "permission/context" for event in result.events)
    assert result.events[0]["type"] == "agent/inbox/spliced"
