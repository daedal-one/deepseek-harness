from __future__ import annotations

import hashlib
import json
import inspect
import sys
import threading
import time
from pathlib import Path

import pytest

from deepseek_harness import DeepSeekHarness, HarnessClient, HarnessConfig, Notification, RunResult, SdkProtocolError
from deepseek_harness.errors import JsonRpcError


def test_high_level_sdk_runs_turn_and_collects_final_response(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    env_dump = tmp_path / "env.json"
    init_dump = tmp_path / "init.json"
    script.write_text(
        """
import json
import os
import sys

env_dump = os.environ["ENV_DUMP"]
json.dump({
    "OPENROUTER_API_KEY": os.environ.get("OPENROUTER_API_KEY"),
    "OPENROUTER_BASE_URL": os.environ.get("OPENROUTER_BASE_URL"),
    "DSH_CWD": os.environ.get("DSH_CWD"),
    "DSH_SESSION_ROOT": os.environ.get("DSH_SESSION_ROOT"),
    "DSH_CORDIS_CONFIG": os.environ.get("DSH_CORDIS_CONFIG"),
}, open(env_dump, "w"))

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        json.dump(msg.get("params"), open(os.environ["INIT_DUMP"], "w"))
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif method == "session/prompt":
        params = msg.get("params") or {}
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": params["sessionId"], "event": {"type": "agent/inbox/spliced", "data": {"target": "next-turn", "start": 0, "inserted": [{"id": "message-1"}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": params["sessionId"], "status": "running"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": "message-1"}}), flush=True)
        print(json.dumps({
            "jsonrpc": "2.0",
            "method": "session.event",
            "params": {
                "sessionId": params["sessionId"],
                "event": {
                    "type": "assistant/message",
                    "data": {
                        "message": {
                            "role": "assistant",
                            "content": [{"type": "text", "text": "hello from runtime"}],
                        },
                    },
                },
            },
        }), flush=True)
        print(json.dumps({
            "jsonrpc": "2.0",
            "method": "session.event",
            "params": {
                "sessionId": params["sessionId"],
                "event": {
                    "type": "turn/end",
                    "data": {"turn": 1, "reason": {"kind": "completed"}},
                },
            },
        }), flush=True)
        print(json.dumps({
            "jsonrpc": "2.0",
            "method": "session.event",
            "params": {
                "sessionId": params["sessionId"],
                "event": {
                    "type": "turn/end",
                    "data": {"turn": 2, "reason": {"kind": "max-tokens"}},
                },
            },
        }), flush=True)
        print(json.dumps({
            "jsonrpc": "2.0",
            "method": "session.status",
            "params": {"sessionId": params["sessionId"], "status": "idle"},
        }), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with DeepSeekHarness(
        model="deepseek-v4-flash",
        reasoning_effort="max",
        max_tokens=4096,
        cwd=str(tmp_path),
        _launch_args=(sys.executable, str(script)),
        env={
            "ENV_DUMP": str(env_dump),
            "INIT_DUMP": str(init_dump),
            "OPENROUTER_API_KEY": "env-key",
            "OPENROUTER_BASE_URL": "http://127.0.0.1:4321",
        },
    ) as harness:
        result = harness.run("say hello", session_id="main")

    assert result.final_response == "hello from runtime"
    assert result.finish_reason == "max-tokens"
    assert result.events[-1]["type"] == "turn/end"
    dumped_env = json.loads(env_dump.read_text())
    assert dumped_env["OPENROUTER_API_KEY"] == "env-key"
    assert dumped_env["OPENROUTER_BASE_URL"] == "http://127.0.0.1:4321"
    assert dumped_env["DSH_CWD"] is None
    assert dumped_env["DSH_SESSION_ROOT"] is None
    assert dumped_env["DSH_CORDIS_CONFIG"] is None
    assert json.loads(init_dump.read_text()) == {
        "cwd": str(tmp_path),
        "provider": "openrouter",
        "model": "deepseek-v4-flash",
        "reasoningEffort": "max",
        "maxTokens": 4096,
    }


def test_session_run_invokes_notification_callback_before_returning(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif method == "session/prompt":
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": "main", "event": {"type": "agent/inbox/spliced", "data": {"target": "next-turn", "start": 0, "inserted": [{"id": "message-1"}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": "main", "status": "running"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": "message-1"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "subagent.started", "params": {"parentSessionId": "main", "childSessionId": "child"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": "main", "status": "idle"}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    seen: list[str] = []
    with DeepSeekHarness(
        _launch_args=(sys.executable, str(script)),
        cwd=str(tmp_path),
    ) as harness:
        session = harness.start_session("main")
        result = session.run(
            "spawn a helper",
            on_notification=lambda notification: seen.append(notification.method),
        )

    assert seen == ["session.event", "session.status", "subagent.started", "session.status"]
    assert result.finish_reason is None


def test_high_level_sdk_rejects_turn_end_without_reason_kind(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif method == "session/prompt":
        params = msg.get("params") or {}
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": params["sessionId"], "event": {"type": "agent/inbox/spliced", "data": {"target": "next-turn", "start": 0, "inserted": [{"id": "message-1"}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": "message-1"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": params["sessionId"], "event": {"type": "turn/end", "data": {"turn": 1, "reason": {}}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": params["sessionId"], "status": "idle"}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with DeepSeekHarness(
        _launch_args=(sys.executable, str(script)),
        cwd=str(tmp_path),
    ) as harness:
        with pytest.raises(
            SdkProtocolError,
            match=r"turn/end event requires a string data\.reason\.kind",
        ):
            harness.run("reject malformed turn ending", session_id="main")


def test_relative_cwd_is_absolute_in_process_environment_and_wire(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    script = tmp_path / "capture_cwd.py"
    capture = tmp_path / "cwd.json"
    script.write_text(
        """
import json
import os
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        json.dump({"process": os.getcwd(), "environment": os.environ.get("DSH_CWD"), "wire": msg["params"]["cwd"]}, open(os.environ["CAPTURE"], "w"))
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )
    monkeypatch.chdir(tmp_path)

    with DeepSeekHarness(
        cwd=".",
        runtime_cwd=".",
        _launch_args=(sys.executable, str(script)),
        env={"CAPTURE": str(capture)},
    ):
        pass

    expected = str(tmp_path.resolve())
    assert json.loads(capture.read_text()) == {
        "process": expected,
        "environment": None,
        "wire": expected,
    }


def test_session_run_includes_subagent_finished_for_parent_session(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif method == "session/prompt":
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": "main", "event": {"type": "agent/inbox/spliced", "data": {"target": "next-turn", "start": 0, "inserted": [{"id": "message-1"}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": "main", "status": "running"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": "message-1"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "subagent.started", "params": {"parentSessionId": "main", "childSessionId": "child"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "subagent.finished", "params": {"parentSessionId": "main", "childSessionId": "child", "status": "ok", "stopReason": "completed"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": "main", "status": "idle"}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with DeepSeekHarness(
        _launch_args=(sys.executable, str(script)),
        cwd=str(tmp_path),
    ) as harness:
        result = harness.run("spawn a helper", session_id="main")

    assert [notification.method for notification in result.notifications] == [
        "session.event",
        "session.status",
        "subagent.started",
        "subagent.finished",
        "session.status",
    ]


def test_session_run_collects_nested_subagent_tree_without_polluting_root_events(
    tmp_path: Path,
) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif method == "session/prompt":
        root = (msg.get("params") or {})["sessionId"]
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": root, "event": {"type": "agent/inbox/spliced", "data": {"target": "next-turn", "start": 0, "inserted": [{"id": "message-1"}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": root, "status": "running"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": "message-1"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "subagent.started", "params": {"parentSessionId": root, "childSessionId": "child"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": "child", "event": {"type": "assistant/message", "data": {"content": [{"type": "text", "text": "child response"}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "subagent.started", "params": {"parentSessionId": "child", "childSessionId": "grandchild"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": "grandchild", "event": {"type": "assistant/message", "data": {"content": [{"type": "text", "text": "grandchild response"}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "subagent.finished", "params": {"parentSessionId": "child", "childSessionId": "grandchild", "status": "ok"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "subagent.finished", "params": {"parentSessionId": root, "childSessionId": "child", "status": "ok"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": root, "event": {"type": "assistant/message", "data": {"content": [{"type": "text", "text": "root response"}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": root, "status": "idle"}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    seen: list[str] = []
    with DeepSeekHarness(
        _launch_args=(sys.executable, str(script)),
        cwd=str(tmp_path),
    ) as harness:
        result = harness.run(
            "delegate recursively",
            session_id="main",
            on_notification=lambda notification: seen.append(notification.method),
        )
        assert harness.client._notifications.qsize() == 0

    assert result.final_response == "root response"
    assert [event["data"]["content"][0]["text"] for event in result.events if event["type"] == "assistant/message"] == ["root response"]
    assert [notification.method for notification in result.notifications] == [
        "session.event",
        "session.status",
        "subagent.started",
        "session.event",
        "subagent.started",
        "session.event",
        "subagent.finished",
        "subagent.finished",
        "session.event",
        "session.status",
    ]
    assert seen == [notification.method for notification in result.notifications]


def test_session_run_ignores_notifications_for_other_sessions(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif method == "session/prompt":
        params = msg.get("params") or {}
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": "other", "event": {"type": "assistant/message", "data": {"content": [{"type": "text", "text": "wrong session"}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": "other", "status": "idle"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": params["sessionId"], "event": {"type": "agent/inbox/spliced", "data": {"target": "next-turn", "start": 0, "inserted": [{"id": "message-1"}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": params["sessionId"], "status": "running"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": "message-1"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": params["sessionId"], "event": {"type": "assistant/message", "data": {"content": [{"type": "text", "text": "right session"}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": params["sessionId"], "status": "idle"}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with DeepSeekHarness(
        _launch_args=(sys.executable, str(script)),
        cwd=str(tmp_path),
    ) as harness:
        result = harness.run("stay in your lane", session_id="main")

    assert result.final_response == "right session"
    assert [notification.payload.get("sessionId") for notification in result.notifications] == ["main"] * 4


def test_high_level_session_run_does_not_accumulate_global_notifications(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif method == "session/prompt":
        params = msg.get("params") or {}
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": params["sessionId"], "event": {"type": "agent/inbox/spliced", "data": {"target": "next-turn", "start": 0, "inserted": [{"id": "message-1"}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": params["sessionId"], "status": "running"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": "message-1"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": params["sessionId"], "event": {"type": "assistant/message", "data": {"content": [{"type": "text", "text": "ok"}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": params["sessionId"], "status": "idle"}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with DeepSeekHarness(_launch_args=(sys.executable, str(script)), cwd=str(tmp_path)) as harness:
        result = harness.run("one turn", session_id="main")
        assert harness.client._notifications.qsize() == 0


def test_session_run_waits_for_late_idle_without_replaying_stale_notifications(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys
import time

turn = 0
for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif method == "session/prompt":
        turn += 1
        params = msg.get("params") or {}
        session_id = params["sessionId"]
        message_id = f"message-{turn}"
        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": session_id, "event": {"type": "agent/inbox/spliced", "data": {"target": "next-turn", "start": 0, "inserted": [{"id": message_id}]}}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": session_id, "status": "running"}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": message_id}}), flush=True)
        if turn == 1:
            print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": session_id, "event": {"type": "assistant/message", "data": {"content": [{"type": "text", "text": "first"}]}}}}), flush=True)
            print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": session_id, "status": "idle"}}), flush=True)
        else:
            time.sleep(0.05)
            print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": session_id, "event": {"type": "assistant/message", "data": {"content": [{"type": "text", "text": "second"}]}}}}), flush=True)
            print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": session_id, "status": "idle"}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with DeepSeekHarness(_launch_args=(sys.executable, str(script)), cwd=str(tmp_path)) as harness:
        first = harness.run("first turn", session_id="main")
        second = harness.run("second turn", session_id="main")

    assert first.final_response == "first"
    assert second.final_response == "second"
    assert [notification.payload.get("sessionId") for notification in second.notifications] == ["main"] * 4


def test_client_starts_subprocess_sends_requests_and_routes_notifications(tmp_path: Path) -> None:
    script = tmp_path / "fake_bridge.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-dsh"}}}), flush=True)
    elif method == "session/prompt":
        params = msg.get("params") or {}
        print(json.dumps({"jsonrpc": "2.0", "method": "llm/request", "params": {"requestId": "req-1", "sessionId": params["sessionId"], "model": "dsagent", "messages": []}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": "message-1"}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with HarnessClient(_launch_args=(sys.executable, str(script))) as client:
        init = client.initialize(provider="deepseek-official", cwd="/workspace", model="dsagent")
        assert init.serverInfo.name == "fake-dsh"

        client.session_prompt("main", [{"type": "text", "text": "fix it"}])
        notification = client.next_notification()
        assert notification.method == "llm/request"
        assert notification.payload["requestId"] == "req-1"
    assert notification.payload["sessionId"] == "main"


def test_client_keeps_unmatched_notifications_available_globally_while_subscribed() -> None:
    client = HarnessClient()
    with client.subscribe_session_notifications("main"):
        client._handle_message({
            "jsonrpc": "2.0",
            "method": "session.event",
            "params": {"sessionId": "other", "event": {"type": "assistant/message"}},
        })

        assert client._notifications.qsize() == 1
        notification = client._notifications.get_nowait()
        assert not isinstance(notification, BaseException)
        assert notification.method == "session.event"
        assert notification.payload["sessionId"] == "other"


def test_session_subscription_keeps_descendant_relationships_across_subscriptions() -> None:
    client = HarnessClient()
    with client.subscribe_session_notifications("main") as first:
        client._handle_message({
            "jsonrpc": "2.0",
            "method": "subagent.started",
            "params": {"parentSessionId": "main", "childSessionId": "child"},
        })
        assert first.next().payload["childSessionId"] == "child"

    with client.subscribe_session_notifications("main") as second:
        client._handle_message({
            "jsonrpc": "2.0",
            "method": "subagent.started",
            "params": {"parentSessionId": "child", "childSessionId": "grandchild"},
        })
        client._handle_message({
            "jsonrpc": "2.0",
            "method": "session.event",
            "params": {"sessionId": "grandchild", "event": {"type": "assistant/message"}},
        })
        assert second.next().payload["childSessionId"] == "grandchild"
        assert second.next().payload["sessionId"] == "grandchild"

    assert client._notifications.qsize() == 0


def test_session_subscription_preserves_reused_child_ancestry_after_late_finish() -> None:
    client = HarnessClient()
    old_seen: list[Notification] = []
    new_seen: list[Notification] = []
    with (
        client.subscribe_session_notifications("old-parent") as old_subscription,
        client.subscribe_session_notifications("new-parent") as new_subscription,
    ):
        client._handle_message({
            "jsonrpc": "2.0",
            "method": "subagent.started",
            "params": {"parentSessionId": "old-parent", "childSessionId": "reused-child"},
        })
        old_subscription.drain(old_seen.append)
        new_subscription.drain(new_seen.append)
        assert [notification.method for notification in old_seen] == ["subagent.started"]
        assert new_seen == []

        client._handle_message({
            "jsonrpc": "2.0",
            "method": "subagent.started",
            "params": {"parentSessionId": "new-parent", "childSessionId": "reused-child"},
        })
        old_subscription.drain(old_seen.append)
        new_subscription.drain(new_seen.append)
        assert [notification.method for notification in new_seen] == ["subagent.started"]

        client._handle_message({
            "jsonrpc": "2.0",
            "method": "subagent.finished",
            "params": {"parentSessionId": "old-parent", "childSessionId": "reused-child"},
        })
        old_subscription.drain(old_seen.append)
        new_subscription.drain(new_seen.append)
        assert [notification.method for notification in old_seen] == [
            "subagent.started",
            "subagent.finished",
        ]
        assert [notification.method for notification in new_seen] == ["subagent.started"]

        client._handle_message({
            "jsonrpc": "2.0",
            "method": "session.event",
            "params": {"sessionId": "reused-child", "event": {"type": "assistant/message"}},
        })
        old_subscription.drain(old_seen.append)
        new_subscription.drain(new_seen.append)

    assert [notification.method for notification in old_seen] == [
        "subagent.started",
        "subagent.finished",
    ]
    assert [notification.method for notification in new_seen] == [
        "subagent.started",
        "session.event",
    ]
    assert client._notifications.qsize() == 0


def test_client_contains_notification_filter_failure_to_its_subscription(tmp_path: Path) -> None:
    script = tmp_path / "fake_bridge.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-dsh"}}}), flush=True)
    elif method in {"emit-first", "emit-second"}:
        print(json.dumps({"jsonrpc": "2.0", "method": "tick", "params": {"source": method}}), flush=True)
    elif method == "session/prompt":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": "message-1"}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    def broken_filter(_notification: object) -> bool:
        raise RuntimeError("bad notification filter")

    with HarnessClient(_launch_args=(sys.executable, str(script))) as client:
        client.initialize(provider="deepseek-official", cwd="/workspace", model="dsagent")
        with (
            client.subscribe_notifications(broken_filter) as broken,
            client.subscribe_notifications(lambda notification: notification.method == "tick") as healthy,
        ):
            client.notify("emit-first")
            with pytest.raises(RuntimeError, match="bad notification filter"):
                broken.next()
            assert healthy.next().payload == {"source": "emit-first"}
            assert client._notifications.qsize() == 0

            client.session_prompt("main", [{"type": "text", "text": "reader still works"}])
            client.notify("emit-second")
            assert healthy.next().payload == {"source": "emit-second"}


def test_client_rejects_unaccepted_session_prompt_response(tmp_path: Path) -> None:
    script = tmp_path / "fake_bridge.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-dsh"}}}), flush=True)
    elif method == "session/prompt":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"accepted": False}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with HarnessClient(_launch_args=(sys.executable, str(script))) as client:
        client.initialize(provider="deepseek-official", cwd="/workspace", model="dsagent")
        with pytest.raises(ValueError):
            client.session_prompt("main", [{"type": "text", "text": "fix it"}])


def test_client_routes_bridge_requests_and_sends_responses(tmp_path: Path) -> None:
    script = tmp_path / "fake_bridge.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-dsh"}}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "id": "bridge-req-1", "method": "llm.request", "params": {"requestId": "req-1", "sessionId": "main", "model": "dsagent", "messages": []}}), flush=True)
    elif "id" in msg and "method" not in msg:
        print(json.dumps({"jsonrpc": "2.0", "method": "response/seen", "params": {"result": msg.get("result")}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with HarnessClient(_launch_args=(sys.executable, str(script))) as client:
        client.initialize(provider="deepseek-official", cwd="/workspace", model="dsagent")

        request = client.next_request()
        assert request.id == "bridge-req-1"
        assert request.method == "llm.request"
        assert request.payload["requestId"] == "req-1"

        client.respond(request.id, {"content_blocks": [{"type": "text", "text": "done"}]})
        notification = client.next_notification()
        assert notification.method == "response/seen"
        assert notification.payload["result"]["content_blocks"][0]["text"] == "done"


def test_client_ignores_non_json_stdout_lines(tmp_path: Path) -> None:
    script = tmp_path / "fake_bridge.py"
    script.write_text(
        """
import json
import sys

print("node warning: experimental loader", flush=True)
for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-dsh"}}}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with HarnessClient(_launch_args=(sys.executable, str(script))) as client:
        init = client.initialize(provider="deepseek-official", cwd="/workspace", model="dsagent")
        assert init.serverInfo.name == "fake-dsh"


def test_client_request_times_out_when_bridge_does_not_respond(tmp_path: Path) -> None:
    script = tmp_path / "fake_bridge.py"
    script.write_text(
        """
import sys
import time

print("bridge is still starting", file=sys.stderr, flush=True)
time.sleep(60)
""".strip()
    )

    with HarnessClient(
        HarnessConfig(
            profile="web",
            initialize_timeout_seconds=0.1,
        ),
        _launch_args=(sys.executable, str(script)),
    ) as client:
        start = time.monotonic()
        try:
            client.initialize(provider="deepseek-official", cwd="/workspace", model="dsagent")
        except TimeoutError as exc:
            assert time.monotonic() - start < 2
            assert "bridge is still starting" in str(exc)
            assert "profile 'web'" in str(exc)
        else:
            raise AssertionError("initialize should time out")


def test_client_close_times_out_when_shutdown_does_not_respond(tmp_path: Path) -> None:
    script = tmp_path / "fake_bridge.py"
    script.write_text(
        """
import json
import signal
import sys
import time

signal.signal(signal.SIGTERM, signal.SIG_IGN)

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-dsh"}}}), flush=True)
    elif msg.get("method") == "shutdown":
        time.sleep(60)
""".strip()
    )

    client = HarnessClient(
        HarnessConfig(
            shutdown_timeout_seconds=0.1,
        ),
        _launch_args=(sys.executable, str(script)),
    )
    client.start()
    proc = client._proc
    assert proc is not None
    client.initialize(provider="deepseek-official", cwd="/workspace", model="dsagent")
    start = time.monotonic()
    client.close()
    assert time.monotonic() - start < 2
    assert proc.poll() is not None
    assert client._proc is None


def test_client_close_allows_eof_quiescence_after_shutdown_response(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    marker = tmp_path / "quiesced.txt"
    script.write_text(
        """
import json
import os
from pathlib import Path
import sys
import time

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-dsh"}}}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)

time.sleep(0.05)
Path(os.environ["QUIESCED_MARKER"]).write_text("quiesced")
""".strip()
    )

    client = HarnessClient(
        HarnessConfig(
            env={"QUIESCED_MARKER": str(marker)},
            shutdown_timeout_seconds=1,
        ),
        _launch_args=(sys.executable, str(script)),
    )
    client.start()
    client.initialize(provider="deepseek-official", cwd="/workspace", model="dsagent")
    client.close()

    assert marker.read_text() == "quiesced"


def test_initialize_failure_reaps_started_runtime(tmp_path: Path) -> None:
    script = tmp_path / "rejecting_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print("initialize diagnostic", file=sys.stderr, flush=True)
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32000, "message": "bad initialize"}}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    client = HarnessClient(_launch_args=(sys.executable, str(script)))
    client.start()
    proc = client._proc
    assert proc is not None

    with pytest.raises(JsonRpcError, match="bad initialize") as excinfo:
        client.initialize(provider="deepseek-official", cwd=".", model="dsagent")

    assert excinfo.value.code == -32000
    assert "initialize diagnostic" in str(excinfo.value)
    assert proc.wait(timeout=1) is not None
    assert client._proc is None


def test_public_signatures_omit_unsupported_wire_parameters() -> None:
    from deepseek_harness import DeepSeekHarnessConfig, Session

    assert "session_root" not in inspect.signature(HarnessClient.initialize).parameters
    assert "system_prompt" not in inspect.signature(HarnessClient.initialize).parameters
    assert "profile" not in inspect.signature(HarnessClient.session_prompt).parameters
    assert "profile" not in inspect.signature(DeepSeekHarness.run).parameters
    assert "profile" not in inspect.signature(Session.run).parameters
    assert "system_prompt" not in DeepSeekHarnessConfig.__dataclass_fields__
    assert "max_tokens" in DeepSeekHarnessConfig.__dataclass_fields__
    assert "reasoning_effort" in DeepSeekHarnessConfig.__dataclass_fields__
    assert "max_tokens" in inspect.signature(HarnessClient.initialize).parameters
    assert "reasoning_effort" in inspect.signature(HarnessClient.initialize).parameters
    assert "client_name" not in HarnessConfig.__dataclass_fields__
    assert "client_version" not in HarnessConfig.__dataclass_fields__
    assert {"dsh_bin", "profile", "patches", "dsh_home"} <= set(
        DeepSeekHarnessConfig.__dataclass_fields__
    )
    assert {"dsh_bin", "profile", "patches", "dsh_home"} <= set(
        HarnessConfig.__dataclass_fields__
    )
    assert "initialize_timeout_seconds" in DeepSeekHarnessConfig.__dataclass_fields__
    assert "initialize_timeout_seconds" in HarnessConfig.__dataclass_fields__
    assert DeepSeekHarnessConfig().initialize_timeout_seconds == 30.0
    assert HarnessConfig().initialize_timeout_seconds == 30.0
    for removed in ("cordis", "session_root", "runtime_bin", "bridge_bin", "launch_args_override"):
        assert removed not in DeepSeekHarnessConfig.__dataclass_fields__
        assert removed not in HarnessConfig.__dataclass_fields__
    assert "_launch_args" not in HarnessConfig.__dataclass_fields__
    assert "session_root" not in RunResult.__dataclass_fields__


def test_client_close_is_idempotent_before_and_after_start(tmp_path: Path) -> None:
    HarnessClient().close()

    script = tmp_path / "fake_bridge.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-dsh"}}}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    client = HarnessClient(_launch_args=(sys.executable, str(script)))
    client.start()
    client.initialize(provider="deepseek-official", cwd="/workspace", model="dsagent")
    client.close()
    client.close()


def test_runtime_closed_error_includes_stderr_tail(tmp_path: Path) -> None:
    script = tmp_path / "crashing_runtime.py"
    script.write_text(
        """
import sys

print("fatal bridge exploded", file=sys.stderr, flush=True)
sys.exit(42)
""".strip()
    )

    with HarnessClient(
        HarnessConfig(
            request_timeout_seconds=2,
        ),
        _launch_args=(sys.executable, str(script)),
    ) as client:
        with pytest.raises(Exception, match="fatal bridge exploded"):
            client.initialize(provider="deepseek-official", cwd="/workspace", model="dsagent")


def test_client_serializes_concurrent_writes(tmp_path: Path) -> None:
    script = tmp_path / "fake_bridge.py"
    output = tmp_path / "seen.jsonl"
    script.write_text(
        """
import json
import os
import sys

with open(os.environ["SEEN"], "w") as seen:
    for line in sys.stdin:
        seen.write(line)
        seen.flush()
        msg = json.loads(line)
        if "id" in msg and msg.get("method") == "initialize":
            print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-dsh"}}}), flush=True)
        elif "id" in msg and msg.get("method") == "shutdown":
            print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
            break
""".strip()
    )

    with HarnessClient(
        HarnessConfig(
            env={"SEEN": str(output)},
        ),
        _launch_args=(sys.executable, str(script)),
    ) as client:
        client.initialize(provider="deepseek-official", cwd="/workspace", model="dsagent")
        threads = [
            threading.Thread(target=client.notify, args=(f"notice-{index}", {"index": index}))
            for index in range(50)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

    for line in output.read_text().splitlines():
        json.loads(line)


def _install_fake_bundled_dsh(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Install a fake runtime package that records dsh argv and serves lifecycle calls."""
    runtime = tmp_path / "dsh.py"
    runtime.write_text(
        """
import json
import os
import sys

json.dump({
    "argv": sys.argv[1:],
    "DSH_HOME": os.environ.get("DSH_HOME"),
    "DSH_CORDIS_CONFIG": os.environ.get("DSH_CORDIS_CONFIG"),
}, open(os.environ["ENV_DUMP"], "w"))
for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "bundled-runtime"}}}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    module_dir = tmp_path / "deepseek_harness_runtime"
    module_dir.mkdir()
    (module_dir / "__init__.py").write_text(
        f"""
def resolve_bundled_launch_args(mode=None):
    return ({sys.executable!r}, {str(runtime)!r})
""".strip()
    )

    monkeypatch.syspath_prepend(str(tmp_path))
    monkeypatch.delitem(sys.modules, "deepseek_harness_runtime", raising=False)


def test_client_default_launch_uses_bundled_dsh_sdk_profile_and_explicit_home(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env_dump = tmp_path / "env.json"
    home = tmp_path / "home"
    patch = tmp_path / "sdk.patch.yml"
    patch.write_text("[]\n")
    _install_fake_bundled_dsh(tmp_path, monkeypatch)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DSH_HOME", str(tmp_path / "ambient-home"))
    monkeypatch.delenv("DSH_CORDIS_CONFIG", raising=False)

    with HarnessClient(HarnessConfig(
        profile="sdk",
        patches=("sdk.patch.yml",),
        dsh_home=str(home),
        env={"ENV_DUMP": str(env_dump), "DSH_HOME": str(tmp_path / "env-home")},
    )) as client:
        init = client.initialize(provider="deepseek-official", cwd="/workspace", model="deepseek-v4-pro")

    assert init.serverInfo.name == "bundled-runtime"
    assert json.loads(env_dump.read_text()) == {
        "argv": ["--profile", "sdk", "--patch", str(patch)],
        "DSH_HOME": str(home),
        "DSH_CORDIS_CONFIG": None,
    }


def test_client_accepts_explicit_environment_dsh_home(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env_dump = tmp_path / "env.json"
    home = tmp_path / "environment-home"
    _install_fake_bundled_dsh(tmp_path, monkeypatch)

    with HarnessClient(
        HarnessConfig(profile="custom", env={"ENV_DUMP": str(env_dump), "DSH_HOME": str(home)})
    ) as client:
        client.initialize(provider="deepseek-official", cwd="/workspace", model="deepseek-v4-pro")

    assert json.loads(env_dump.read_text()) == {
        "argv": ["--profile", "custom"],
        "DSH_HOME": str(home),
        "DSH_CORDIS_CONFIG": None,
    }


def test_client_rejects_an_implicit_default_dsh_home(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_fake_bundled_dsh(tmp_path, monkeypatch)
    monkeypatch.delenv("DSH_HOME", raising=False)

    with pytest.raises(ValueError, match="explicit dsh_home or non-empty DSH_HOME"):
        HarnessClient(HarnessConfig(env={})).start()


def test_client_reports_missing_bundled_runtime_dependency(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delitem(sys.modules, "deepseek_harness_runtime", raising=False)
    monkeypatch.setattr(sys, "path", [])

    with pytest.raises(FileNotFoundError, match="Install deepseek-harness-runtime-bin"):
        HarnessClient(HarnessConfig(dsh_home="/explicit/home")).start()


@pytest.mark.parametrize("phase", ["returned", "pending", "checkpointed"])
def test_workspace_receipt_is_separate_from_model_completion(tmp_path: Path, phase: str) -> None:
    script = tmp_path / "workspace_runtime.py"
    script.write_text(
        """
import json
import sys

def send(method, params):
    print(json.dumps({"jsonrpc": "2.0", "method": method, "params": params}), flush=True)

for line in sys.stdin:
    msg = json.loads(line)
    if msg["method"] == "initialize":
        result = {"serverInfo": {"name": "workspace-fixture"}}
    elif msg["method"] == "session/prompt":
        sid = msg["params"]["sessionId"]
        events = [
            {"type": "agent/inbox/spliced", "data": {"target": "next-turn", "start": 0, "inserted": [{"id": "accepted"}]}},
            {"type": "turn/end", "data": {"turn": 1, "reason": {"kind": "completed"}}},
            {"type": "workspace/state", "data": {"workspaceId": "a" * 32, "turn": 1, "phase": sys.argv[1], "baseline": "b" * 40, "checkpoint": 2, "branches": {"refs/heads/dsh/result": "c" * 40}}},
        ]
        send("session.status", {"sessionId": sid, "status": "running"})
        for event in events:
            send("session.event", {"sessionId": sid, "event": event})
        send("session.status", {"sessionId": sid, "status": "idle"})
        result = {"messageId": "accepted"}
    else:
        result = {}
    print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}), flush=True)
    if msg["method"] == "shutdown":
        break
""".strip()
    )
    with DeepSeekHarness(_launch_args=(sys.executable, str(script), phase), cwd=str(tmp_path)) as harness:
        result = harness.run("finish", session_id="main")
    assert result.finish_reason == "completed"
    assert [event["type"] for event in result.events] == ["agent/inbox/spliced", "turn/end", "workspace/state"]
    assert result.events[-1]["data"]["phase"] == phase
    assert result.events[-1]["data"]["checkpoint"] == 2


def test_recorded_workspace_outcomes_match_the_typescript_sdk(tmp_path: Path) -> None:
    fixture = Path(__file__).resolve().parents[3] / "snapshots/sdk/workspace-outcomes/notifications.expected.jsonl"
    script = tmp_path / "recorded_workspace_runtime.py"
    script.write_text(
        """
import json
import sys
from pathlib import Path

frames = [json.loads(line.replace("{{sessionId}}", "main")) for line in Path(sys.argv[1]).read_text().splitlines()]
for line in sys.stdin:
    msg = json.loads(line)
    if msg["method"] == "initialize":
        result = {"serverInfo": {"name": "recorded-workspace-fixture"}}
    elif msg["method"] == "session/prompt":
        for frame in frames:
            print(json.dumps({"jsonrpc": "2.0", **frame}), flush=True)
        result = {"messageId": "main"}
    else:
        result = {}
    print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}), flush=True)
    if msg["method"] == "shutdown":
        break
""".strip()
    )
    with DeepSeekHarness(_launch_args=(sys.executable, str(script), str(fixture)), cwd=str(tmp_path)) as harness:
        result = harness.run("finish", session_id="main")
    assert result.finish_reason == "completed"
    assert result.final_response == "SDK snapshot OK"
    actual = [event["data"] for event in result.events if event["type"] == "workspace/state"]
    expected = [
        frame["params"]["event"]["data"]
        for frame in (json.loads(line) for line in fixture.read_text().splitlines())
        if frame["method"] == "session.event" and frame["params"]["event"]["type"] == "workspace/state"
    ]
    assert actual == expected
    assert [event["phase"] for event in actual] == ["saving", "pending", "returned"]


def test_recorded_operation_records_match_the_typescript_sdk(tmp_path: Path) -> None:
    fixture = Path(__file__).resolve().parents[3] / "snapshots/sdk/clm-operations/notifications.expected.jsonl"
    expected_path = Path(__file__).parent / "expected/clm-operations.json"
    script = tmp_path / "recorded_operation_runtime.py"
    script.write_text(
        """
import json
import sys
from pathlib import Path

frames = [json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines()]
for frame in frames:
    frame["params"]["sessionId"] = "main"
accepted = next(
    frame["params"]["event"]["data"]["inserted"][0]["id"]
    for frame in frames
    if frame["method"] == "session.event"
    and frame["params"]["event"]["type"] == "agent/inbox/spliced"
    and frame["params"]["event"]["data"].get("inserted")
)
for line in sys.stdin:
    msg = json.loads(line)
    if msg["method"] == "initialize":
        result = {"serverInfo": {"name": "recorded-operation-fixture"}}
    elif msg["method"] == "session/prompt":
        for frame in frames:
            print(json.dumps({"jsonrpc": "2.0", **frame}), flush=True)
        result = {"messageId": accepted}
    else:
        result = {}
    print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}), flush=True)
    if msg["method"] == "shutdown":
        break
""".strip()
    )
    seen: list[Notification] = []
    with DeepSeekHarness(_launch_args=(sys.executable, str(script), str(fixture)), cwd=str(tmp_path)) as harness:
        result = harness.run("verify the complete beta record", session_id="main", on_notification=seen.append)

    frames = [json.loads(line) for line in fixture.read_text().splitlines()]
    operation_frames = [
        frame for frame in frames
        if frame["method"] == "session.event" and frame["params"]["event"]["type"].startswith("operation/")
    ]
    raw_operations = [frame["params"]["event"] for frame in operation_frames]
    actual = [event for event in result.events if event["type"].startswith("operation/")]
    assert actual == raw_operations
    assert [
        notification.payload["event"]
        for notification in seen
        if notification.method == "session.event" and notification.payload["event"]["type"].startswith("operation/")
    ] == raw_operations
    assert all("ignorable" not in event for event in actual)

    def fixture_digest(value: object) -> str:
        # This fixture uses ASCII and numbers with identical Python/JS JSON spellings.
        encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        assert encoded.isascii()
        return hashlib.sha256(encoded.encode("ascii")).hexdigest()

    admission = actual[0]["data"]
    run_id = admission["runId"]
    assert all(event["data"]["runId"] == run_id for event in actual)
    outer_call = next(
        event["data"] for event in result.events
        if event["type"] == "tool/call" and event["data"]["name"] == "run_operation"
    )
    # Only the replay transport session was remapped to main; recorded caller facts stay intact.
    assert admission["caller"] == {
        "sessionId": operation_frames[0]["params"]["sessionId"],
        "callId": outer_call["callId"],
    }
    assert admission["rootCallId"] == outer_call["callId"]
    assert admission["plan"] == json.loads(outer_call["arguments"])["plan"]
    assert admission["planDigest"] == fixture_digest(admission["plan"])
    assert admission["configurationDigest"] == fixture_digest({
        "limits": admission["limits"],
        "forbiddenTools": admission["configuration"]["forbiddenTools"],
        "judgmentIdentity": admission["judgmentIdentity"],
    })

    starts = [event["data"] for event in actual if event["type"] == "operation/step-start"]
    outcomes = [event["data"] for event in actual if event["type"] == "operation/step-result"]
    identities = {identity["name"]: identity for identity in admission["toolIdentities"]}
    assert len(identities) == len(starts) == len(outcomes) == 2
    assert len({start["callId"] for start in starts}) == 2
    assert outer_call["callId"] not in {start["callId"] for start in starts}
    starts_by_step = {start["stepId"]: start for start in starts}
    outcomes_by_step = {outcome["stepId"]: outcome for outcome in outcomes}
    for identity in identities.values():
        assert identity["schemaDigest"] == fixture_digest(identity["schemas"])
    for start, outcome in zip(starts, outcomes):
        assert outcome["stepId"] == start["stepId"]
        assert outcome["callId"] == start["callId"]
        assert outcome["schemaDigest"] == start["schemaDigest"] == identities[start["tool"]]["schemaDigest"]
        assert start["argumentsDigest"] == fixture_digest(start["arguments"])
        assert outcome["valueDigest"] == fixture_digest(outcome["value"])
        assert outcome["execution"] == {"body": "started", "callerCancelled": False, "timedOut": False, "bodySignalAborted": False}
        assert outcome["isError"] is False

    request_records = [event["data"] for event in actual if event["type"] == "operation/judgment-request"]
    requests = [record["request"] for record in request_records]
    responses = [event["data"] for event in actual if event["type"] == "operation/judgment-result"]
    transitions = [event["data"] for event in actual if event["type"] == "operation/transition"]
    assert len(requests) == len(responses) == len(transitions) == 2
    assert len({request["draft"]["id"] for request in requests}) == 2
    assert [request["draft"]["id"] for request in requests] == [response["requestId"] for response in responses]
    assert [request["draft"]["id"] for request in requests] == [transition["requestId"] for transition in transitions]
    for record, response, transition in zip(request_records, responses, transitions):
        request = record["request"]
        draft = request["draft"]
        assert draft["runId"] == run_id
        assert response["response"]["requestId"] == draft["id"]
        assert response["response"]["identity"] == request["identity"] == admission["judgmentIdentity"]
        fingerprints = record["fingerprints"]
        assert fingerprints["stateDigest"] == fixture_digest(draft["state"])
        assert fingerprints["candidatesDigest"] == fixture_digest(draft["candidates"])
        assert fingerprints["completionEvidenceDigest"] == fixture_digest(draft["state"]["completionEvidence"])
        observed = draft["state"]["observations"]
        candidates_with_sources = [candidate for candidate in draft["candidates"] if "source" in candidate]
        assert len(fingerprints["observations"]) == len(observed)
        assert len(fingerprints["candidateSources"]) == len(candidates_with_sources)
        sources = observed + [candidate["source"] for candidate in candidates_with_sources]
        evidence_fingerprints = fingerprints["observations"] + fingerprints["candidateSources"]
        for source, fingerprint in zip(sources, evidence_fingerprints):
            assert fingerprint["step"] == source["step"]
            assert fingerprint["pointer"] == source["pointer"]
            producer = outcomes_by_step[source["step"]]
            selected_value = producer["value"]
            for component in source["pointer"].split("/")[1:]:
                # The authored paths are only /records, /records/0, /records/1, or the root.
                assert "~" not in component
                selected_value = selected_value[int(component)] if isinstance(selected_value, list) else selected_value[component]
            assert source["value"] == selected_value
            assert fingerprint["valueDigest"] == fixture_digest(selected_value)
            assert fingerprint["resultDigest"] == fixture_digest(producer["value"]) == producer["valueDigest"]
            assert fingerprint["schemaDigest"] == producer["schemaDigest"]
        assert [fingerprint["candidateId"] for fingerprint in fingerprints["candidateSources"]] == [
            candidate["id"] for candidate in candidates_with_sources
        ]
        selected = next(candidate for candidate in draft["candidates"] if candidate["id"] == transition["candidateId"])
        assert transition["accepted"] is True
        assert response["response"]["probabilities"][selected["id"]] == 1
        if selected["kind"] == "continue":
            next_start = starts_by_step[transition["nextStep"]]
            assert selected["nextStep"] == next_start["stepId"]
            assert selected["source"]["value"] == selected["arguments"] == transition["arguments"] == next_start["arguments"]
            assert next_start["argumentsDigest"] == fixture_digest(selected["source"]["value"])
        else:
            assert selected["kind"] == "complete"
            assert draft["state"]["completionEvidence"] == [outcomes[-1]["value"]]

    projection = {
        "final_response": result.final_response,
        "finish_reason": result.finish_reason,
        "event_types": [event["type"] for event in actual],
        "admission": {
            key: admission[key] for key in ("caller", "rootCallId", "planDigest", "configuration", "configurationDigest")
        },
        "tool_identities": [
            {"name": identity["name"], "schemaDigest": identity["schemaDigest"]}
            for identity in admission["toolIdentities"]
        ],
        "steps": [
            {"step": start["stepId"], **{key: start[key] for key in ("tool", "arguments", "callId", "schemaDigest", "argumentsDigest")}}
            for start in starts
        ],
        "canonical_results": [outcome["value"] for outcome in outcomes],
        "executions": [
            {key: outcome[key] for key in ("stepId", "callId", "schemaDigest", "valueDigest", "execution")}
            for outcome in outcomes
        ],
        "judgment_kinds": [request["draft"]["kind"] for request in requests],
        "judgment_fingerprints": [
            {"requestId": record["request"]["draft"]["id"], "fingerprints": record["fingerprints"]}
            for record in request_records
        ],
        "distributions": [response["response"]["probabilities"] for response in responses],
        "terminal": {key: value for key, value in actual[-1]["data"].items() if key != "runId"},
    }
    assert projection == json.loads(expected_path.read_text())
