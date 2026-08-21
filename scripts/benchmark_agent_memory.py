#!/usr/bin/env python3
"""Measure steady-state process-tree memory for DSH and jcode sessions."""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import fcntl
import json
import os
import platform
import pty
import queue
import re
import select
import shutil
import signal
import socket
import statistics
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
from pathlib import Path
from typing import Any, Sequence

MIB = 1024 * 1024
DSH_MARKER = "DSH_MEMORY_READY "
ANSI_RE = re.compile(r"\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x1b\x07]*(?:\x07|\x1b\\))")
PTY_PROBE = "dshmem92"
TERMINAL_REPLIES = (
    (b"\x1b[6n", b"\x1b[1;1R"),
    (b"\x1b[c", b"\x1b[?62;c"),
    (b"\x1b]10;?\x1b\\", b"\x1b]10;rgb:ffff/ffff/ffff\x1b\\"),
    (b"\x1b]11;?\x1b\\", b"\x1b]11;rgb:0000/0000/0000\x1b\\"),
    (b"\x1b]10;?\x07", b"\x1b]10;rgb:ffff/ffff/ffff\x07"),
    (b"\x1b]11;?\x07", b"\x1b]11;rgb:0000/0000/0000\x07"),
    (b"\x1b]4;0;?\x07", b"\x1b]4;0;rgb:0000/0000/0000\x07"),
    (b"\x1b[14t", b"\x1b[4;600;800t"),
    (b"\x1b[16t", b"\x1b[6;16;8t"),
    (b"\x1b[18t", b"\x1b[8;24;80t"),
    (b"\x1b[?1016$p", b"\x1b[?1016;1$y"),
    (b"\x1b[?2027$p", b"\x1b[?2027;1$y"),
    (b"\x1b[?2031$p", b"\x1b[?2031;1$y"),
    (b"\x1b[?1004$p", b"\x1b[?1004;1$y"),
    (b"\x1b[?2004$p", b"\x1b[?2004;1$y"),
    (b"\x1b[?2026$p", b"\x1b[?2026;1$y"),
)


@dataclasses.dataclass(frozen=True)
class ProcessRecord:
    """One process-table row needed for tree and group ownership."""

    pid: int
    ppid: int
    pgid: int
    rss_bytes: int


@dataclasses.dataclass(frozen=True)
class MemorySample:
    """One same-boundary process-tree observation."""

    captured_at: str
    process_count: int
    rss_bytes: int
    pss_bytes: int | None
    physical_footprint_bytes: int | None


@dataclasses.dataclass
class PtyClient:
    """A retained jcode client and its PTY owner."""

    process: subprocess.Popen[bytes]
    pgid: int
    master_fd: int
    ready: bool
    input_ready: bool
    excerpt: str | None
    screen_tail: str


class LineCollector:
    """Collect child output without blocking the sampling controller."""

    def __init__(self, stream: Any) -> None:
        self.lines: queue.Queue[str] = queue.Queue()
        self.tail: list[str] = []
        self.thread = threading.Thread(target=self._read, args=(stream,), daemon=True)
        self.thread.start()

    def _read(self, stream: Any) -> None:
        for line in iter(stream.readline, ""):
            line = line.rstrip("\n")
            self.tail.append(line)
            if len(self.tail) > 200:
                del self.tail[:-200]
            self.lines.put(line)


def utc_now() -> str:
    """Return an RFC 3339 UTC timestamp."""

    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def parse_counts(raw: str) -> list[int]:
    """Parse an increasing phase list beginning with the empty-host baseline."""

    try:
        counts = [int(value.strip()) for value in raw.split(",")]
    except ValueError as error:
        raise argparse.ArgumentTypeError("counts must be comma-separated integers") from error
    if len(counts) < 3 or counts[0] != 0 or 1 not in counts:
        raise argparse.ArgumentTypeError("counts must begin with 0, include 1, and include a larger phase")
    if any(value < 0 for value in counts) or any(left >= right for left, right in zip(counts, counts[1:])):
        raise argparse.ArgumentTypeError("counts must be non-negative and strictly increasing")
    return counts


def parse_ps_table(text: str) -> dict[int, ProcessRecord]:
    """Parse `ps` rows emitted as pid, ppid, pgid, and KiB RSS."""

    records: dict[int, ProcessRecord] = {}
    for line in text.splitlines():
        fields = line.split()
        if len(fields) != 4:
            continue
        try:
            pid, ppid, pgid, rss_kib = (int(field) for field in fields)
        except ValueError:
            continue
        records[pid] = ProcessRecord(pid, ppid, pgid, rss_kib * 1024)
    return records


def read_linux_process_table() -> dict[int, ProcessRecord]:
    """Read Linux parent/group identity and current RSS without external tools."""

    records: dict[int, ProcessRecord] = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / "stat").read_text(encoding="utf-8")
            rest = stat[stat.rfind(")") + 2 :].split()
            status = (entry / "status").read_text(encoding="utf-8")
            rss_match = re.search(r"^VmRSS:\s+(\d+)\s+kB$", status, re.MULTILINE)
            records[int(entry.name)] = ProcessRecord(
                pid=int(entry.name),
                ppid=int(rest[1]),
                pgid=int(rest[2]),
                rss_bytes=0 if rss_match is None else int(rss_match.group(1)) * 1024,
            )
        except (OSError, ValueError, IndexError):
            continue
    return records


def read_process_table() -> dict[int, ProcessRecord]:
    """Read the platform process table used to close the ownership set."""

    if sys.platform.startswith("linux"):
        return read_linux_process_table()
    completed = subprocess.run(
        ["ps", "-axo", "pid=,ppid=,pgid=,rss="],
        check=True,
        capture_output=True,
        text=True,
    )
    return parse_ps_table(completed.stdout)


def owned_pids(records: dict[int, ProcessRecord], root_pids: Sequence[int], pgids: Sequence[int]) -> set[int]:
    """Close roots over descendants and retained process groups."""

    children: dict[int, list[int]] = {}
    for record in records.values():
        children.setdefault(record.ppid, []).append(record.pid)
    selected: set[int] = {record.pid for record in records.values() if record.pgid in pgids}
    stack = list(root_pids)
    while stack:
        pid = stack.pop()
        if pid in selected:
            stack.extend(child for child in children.get(pid, []) if child not in selected)
            continue
        if pid not in records:
            continue
        selected.add(pid)
        stack.extend(children.get(pid, []))
    return selected


def parse_smaps_rollup(text: str) -> tuple[int, int]:
    """Return RSS and PSS bytes from one Linux smaps rollup."""

    values: dict[str, int] = {}
    for line in text.splitlines():
        match = re.match(r"^(Rss|Pss):\s+(\d+)\s+kB$", line)
        if match is not None:
            values[match.group(1)] = int(match.group(2)) * 1024
    if "Pss" not in values:
        raise ValueError("smaps_rollup contains no Pss row")
    return values.get("Rss", 0), values["Pss"]


def parse_footprint_bytes(text: str) -> int:
    """Return shared-page-adjusted bytes from macOS `footprint` output."""

    summary = re.search(r"^Summary Footprint:\s+(\d+)\s+B$", text, re.MULTILINE)
    if summary is not None:
        return int(summary.group(1))
    physical = re.search(r"^\s*phys_footprint:\s+(\d+)\s+B$", text, re.MULTILINE)
    if physical is not None:
        return int(physical.group(1))
    raise ValueError("footprint output contains no byte-formatted physical footprint")


def sample_process_tree(root_pids: Sequence[int], pgids: Sequence[int]) -> MemorySample:
    """Sample the complete owned process set with the platform's physical metric."""

    records = read_process_table()
    pids = sorted(owned_pids(records, root_pids, pgids))
    if not pids:
        raise RuntimeError("the benchmark process tree disappeared before sampling")
    rss_bytes = sum(records[pid].rss_bytes for pid in pids if pid in records)
    pss_bytes: int | None = None
    physical_footprint_bytes: int | None = None
    if sys.platform.startswith("linux"):
        pss_bytes = 0
        rss_bytes = 0
        counted: list[int] = []
        for pid in pids:
            try:
                rss, pss = parse_smaps_rollup(
                    Path(f"/proc/{pid}/smaps_rollup").read_text(encoding="utf-8")
                )
            except (OSError, ValueError):
                continue
            counted.append(pid)
            rss_bytes += rss
            pss_bytes += pss
        pids = counted
    elif sys.platform == "darwin":
        command = ["/usr/bin/footprint", "--noCategories", "--format", "bytes"]
        for pid in pids:
            command.extend(("-p", str(pid)))
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        physical_footprint_bytes = parse_footprint_bytes(completed.stdout)
    else:
        raise RuntimeError("agent memory benchmarking supports Linux and macOS")
    if not pids:
        raise RuntimeError("no owned process exposed a readable physical-memory metric")
    return MemorySample(utc_now(), len(pids), rss_bytes, pss_bytes, physical_footprint_bytes)


def median_int(values: Sequence[int]) -> int:
    """Return the nearest integer median."""

    return round(statistics.median(values))


def summarize_samples(agent_count: int, tool_count: int | None, samples: Sequence[MemorySample]) -> dict[str, Any]:
    """Preserve raw observations and derive one median phase row."""

    if not samples:
        raise ValueError("a phase requires at least one memory sample")
    pss = [sample.pss_bytes for sample in samples if sample.pss_bytes is not None]
    footprint = [
        sample.physical_footprint_bytes
        for sample in samples
        if sample.physical_footprint_bytes is not None
    ]
    return {
        "agents": agent_count,
        "tools": tool_count,
        "processCount": median_int([sample.process_count for sample in samples]),
        "rssBytes": median_int([sample.rss_bytes for sample in samples]),
        "pssBytes": None if not pss else median_int(pss),
        "physicalFootprintBytes": None if not footprint else median_int(footprint),
        "samples": [dataclasses.asdict(sample) for sample in samples],
    }


def primary_bytes(phase: dict[str, Any]) -> int:
    """Read the platform primary metric from one summarized phase."""

    key = "pssBytes" if sys.platform.startswith("linux") else "physicalFootprintBytes"
    value = phase.get(key)
    if not isinstance(value, int):
        raise ValueError(f"phase contains no {key}")
    return value


def analyze_phases(phases: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Separate empty-host, first-agent, and added-agent costs."""

    by_count = {int(phase["agents"]): phase for phase in phases}
    zero = by_count[0]
    one = by_count[1]
    maximum = by_count[max(by_count)]
    added = int(maximum["agents"]) - 1
    slope = round((primary_bytes(maximum) - primary_bytes(one)) / added)
    return {
        "primaryMetric": "pss" if sys.platform.startswith("linux") else "physical_footprint",
        "emptyHostBytes": primary_bytes(zero),
        "oneAgentBytes": primary_bytes(one),
        "firstAgentAndToolMountBytes": primary_bytes(one) - primary_bytes(zero),
        "addedAgentSlopeBytes": slope if slope >= 0 else None,
        "addedAgentSlopeObservationBytes": slope,
        "slopeEndpoints": [1, int(maximum["agents"])],
    }


def retained_heap_slope(markers: Sequence[dict[str, Any]]) -> int:
    """Return DSH's post-collection retained JS-heap growth per added agent."""

    by_count = {int(marker["agents"]): marker for marker in markers}
    one = by_count[1]
    maximum = by_count[max(by_count)]
    added = int(maximum["agents"]) - 1
    return round((int(maximum["node"]["heapUsed"]) - int(one["node"]["heapUsed"])) / added)


def wait_for_socket(path: Path, timeout_seconds: float) -> None:
    """Wait until a Unix socket accepts a connection."""

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if path.exists():
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                    client.connect(str(path))
                return
            except OSError:
                pass
        time.sleep(0.05)
    raise TimeoutError(f"server socket did not become ready: {path}")


def terminate_group(pgid: int, timeout_seconds: float = 8.0) -> None:
    """Terminate one benchmark-owned process group with a bounded escalation."""

    try:
        os.killpg(pgid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            if not any(record.pgid == pgid for record in read_process_table().values()):
                return
        except (OSError, subprocess.SubprocessError):
            return
        time.sleep(0.05)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def collect_phase(
    roots: Sequence[int],
    pgids: Sequence[int],
    agent_count: int,
    tool_count: int | None,
    args: argparse.Namespace,
) -> dict[str, Any]:
    """Wait for allocator settling, then collect the configured sample window."""

    time.sleep(args.settle_seconds)
    samples: list[MemorySample] = []
    attempts = 0
    while len(samples) < args.samples and attempts < args.samples + 3:
        attempts += 1
        try:
            samples.append(sample_process_tree(roots, pgids))
        except (OSError, subprocess.SubprocessError, RuntimeError, ValueError):
            if attempts >= args.samples + 3:
                raise
        if len(samples) < args.samples:
            time.sleep(args.sample_interval_seconds)
    return summarize_samples(agent_count, tool_count, samples)


def wait_for_dsh_marker(
    process: subprocess.Popen[str],
    collector: LineCollector,
    expected: int,
    timeout_seconds: float,
) -> dict[str, Any]:
    """Wait for the probe's exact ready milestone."""

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                f"DSH exited before agent phase {expected}; stdout tail:\n" + "\n".join(collector.tail)
            )
        try:
            line = collector.lines.get(timeout=min(0.2, deadline - time.monotonic()))
        except queue.Empty:
            continue
        if not line.startswith(DSH_MARKER):
            continue
        marker = json.loads(line[len(DSH_MARKER) :])
        if marker.get("agents") != expected:
            raise RuntimeError(f"DSH probe reported phase {marker.get('agents')} while waiting for {expected}")
        return marker
    raise TimeoutError(f"DSH did not reach agent phase {expected}; stdout tail:\n" + "\n".join(collector.tail))


def command_version(command: Sequence[str], env: dict[str, str], version_args: Sequence[str]) -> str:
    """Return the first non-empty version line without failing the benchmark."""

    completed = subprocess.run(
        [*command, *version_args], env=env, capture_output=True, text=True, check=False
    )
    for line in (completed.stdout + completed.stderr).splitlines():
        if line.strip():
            return line.strip()
    return f"exit {completed.returncode}"


def dsh_command(args: argparse.Namespace, repo_root: Path) -> list[str]:
    """Resolve the built checkout CLI or an explicitly supplied executable."""

    if args.dsh_bin is not None:
        path = Path(args.dsh_bin).expanduser().resolve()
    else:
        path = repo_root / "apps/cli/lib/bin.js"
    if not path.exists():
        raise FileNotFoundError(f"missing DSH CLI {path}; run pnpm run build:lib")
    if path.suffix == ".js":
        node = shutil.which("node")
        if node is None:
            raise FileNotFoundError("node is required to run the built DSH CLI")
        return [node, *(["--expose-gc"] if args.dsh_force_gc else []), str(path)]
    return [str(path)]


def benchmark_dsh(args: argparse.Namespace, repo_root: Path) -> dict[str, Any]:
    """Run one shared Web host through the configured live-agent phases."""

    command = dsh_command(args, repo_root)
    with tempfile.TemporaryDirectory(prefix="dsh-agent-memory-") as temp:
        temp_root = Path(temp)
        overlay = temp_root / "memory-probe.cordis.yml"
        probe = repo_root / "scripts/fixtures/agent-memory-probe.mjs"
        overlay.write_text(
            f"- insert:\n    - id: agent-memory-probe\n      name: {json.dumps(str(probe))}\n",
            encoding="utf-8",
        )
        env = os.environ.copy()
        env.update(
            {
                "DSH_HOME": str(temp_root / "home"),
                "DSH_MEMORY_AGENT_COUNTS": ",".join(str(value) for value in args.counts),
                "DSH_MEMORY_AGENT_PRESET": args.dsh_preset,
                "DSH_MEMORY_FORCE_GC": "1" if args.dsh_force_gc else "0",
                "DSH_TELEMETRY_DISABLED": "1",
            }
        )
        env.pop("NODE_OPTIONS", None)
        version = command_version(command, env, ("--version",))
        process = subprocess.Popen(
            [
                *command,
                "--profile",
                "web",
                "--patch",
                str(overlay),
                "--host",
                "127.0.0.1",
                "--port",
                "0",
            ],
            cwd=args.cwd,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
            bufsize=1,
        )
        if process.stdout is None or process.stderr is None or process.stdin is None:
            raise RuntimeError("DSH benchmark failed to open child pipes")
        stdout = LineCollector(process.stdout)
        stderr = LineCollector(process.stderr)
        pgid = os.getpgid(process.pid)
        phases: list[dict[str, Any]] = []
        markers: list[dict[str, Any]] = []
        try:
            for index, count in enumerate(args.counts):
                if index > 0:
                    process.stdin.write("next\n")
                    process.stdin.flush()
                marker = wait_for_dsh_marker(process, stdout, count, args.timeout_seconds)
                markers.append(marker)
                phases.append(collect_phase([process.pid], [pgid], count, marker.get("tools"), args))
        except Exception as error:
            detail = "\n".join(stderr.tail)
            raise RuntimeError(f"DSH memory benchmark failed; stderr tail:\n{detail}") from error
        finally:
            terminate_group(pgid)
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
        analysis = analyze_phases(phases)
        if args.dsh_force_gc:
            analysis["retainedHeapSlopeBytes"] = retained_heap_slope(markers)
        return {
            "tool": "dsh",
            "version": version,
            "mode": f"shared web host, {args.dsh_preset} preset, no model turn, "
            + ("reclaimable V8 garbage collected" if args.dsh_force_gc else "natural V8 collection"),
            "phases": phases,
            "runtimeMarkers": markers,
            "analysis": analysis,
        }


def strip_ansi(value: bytes) -> str:
    """Normalize PTY output for readiness detection."""

    return ANSI_RE.sub("", value.decode("utf-8", "replace")).replace("\r", "\n")


def jcode_tui_ready(text: str) -> bool:
    """Return whether a sanitized jcode screen reached a connected session UI."""

    return (
        ("jcode · client" in text and "Context" in text)
        or "Welcome to jcode onboarding" in text
        or ("skills:" in text and "Context" in text)
    )


def reply_to_terminal_queries(master_fd: int, buffer: bytes) -> bytes:
    """Answer terminal capability probes needed by an unattached TUI."""

    for query, response in TERMINAL_REPLIES:
        while query in buffer:
            os.write(master_fd, response)
            buffer = buffer.replace(query, b"")
    return buffer


def launch_jcode_client(
    command: Sequence[str], socket_path: Path, cwd: str, env: dict[str, str], timeout_seconds: float
) -> PtyClient:
    """Launch one real interactive client and retain its PTY."""

    master_fd, slave_fd = pty.openpty()
    fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    process = subprocess.Popen(
        [*command, "--no-update", "--no-selfdev", "--socket", str(socket_path)],
        cwd=cwd,
        env=env,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    os.close(slave_fd)
    os.set_blocking(master_fd, False)
    deadline = time.monotonic() + timeout_seconds
    buffer = b""
    probe_sent = False
    ready = False
    input_ready = False
    excerpt: str | None = None
    while time.monotonic() < deadline and process.poll() is None:
        readable, _, _ = select.select([master_fd], [], [], 0.05)
        if readable:
            try:
                buffer += os.read(master_fd, 65536)
            except BlockingIOError:
                continue
            buffer = reply_to_terminal_queries(master_fd, buffer)
            plain = strip_ansi(buffer)
            meaningful = next(
                (" ".join(line.split()) for line in plain.splitlines() if sum(char.isalnum() for char in line) >= 3),
                None,
            )
            if meaningful is not None:
                excerpt = meaningful[:160]
                if not probe_sent:
                    os.write(master_fd, PTY_PROBE.encode())
                    probe_sent = True
            if probe_sent and PTY_PROBE in plain:
                input_ready = True
            if jcode_tui_ready(plain):
                ready = True
            if ready:
                break
    return PtyClient(
        process,
        os.getpgid(process.pid),
        master_fd,
        ready,
        input_ready,
        excerpt,
        strip_ansi(buffer)[-1000:],
    )


def benchmark_jcode(args: argparse.Namespace) -> dict[str, Any]:
    """Run jcode's shared server plus one retained PTY client per session."""

    binary = Path(args.jcode_bin).expanduser().resolve() if args.jcode_bin else None
    if binary is None:
        found = shutil.which("jcode")
        if found is None:
            raise FileNotFoundError("jcode is not installed; pass --jcode-bin")
        binary = Path(found)
    command = [str(binary)]
    with tempfile.TemporaryDirectory(prefix="jcode-agent-memory-") as temp:
        temp_root = Path(temp)
        socket_path = temp_root / "run/bench.sock"
        jcode_home = temp_root / "home"
        jcode_home.mkdir(parents=True)
        (jcode_home / "setup_hints.json").write_text(
            json.dumps(
                {
                    "hotkey_configured": False,
                    "hotkey_dismissed": True,
                    "desktop_shortcut_created": True,
                    "mac_ghostty_dismissed": True,
                }
            )
            + "\n",
            encoding="utf-8",
        )
        socket_path.parent.mkdir(parents=True)
        env = os.environ.copy()
        env.update(
            {
                "JCODE_HOME": str(jcode_home),
                "JCODE_RUNTIME_DIR": str(socket_path.parent),
                "JCODE_TEMP_SERVER": "1",
                "JCODE_SERVER_OWNER_PID": str(os.getpid()),
                "JCODE_NO_TELEMETRY": "1",
                "JCODE_MEMORY_ENABLED": "1" if args.jcode_memory else "0",
                "TERM": "xterm-256color",
            }
        )
        env.pop("NO_COLOR", None)
        version = command_version(command, env, ("version",))
        server = subprocess.Popen(
            [*command, "--no-update", "--no-selfdev", "serve", "--socket", str(socket_path)],
            cwd=args.cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        if server.stdout is None or server.stderr is None:
            raise RuntimeError("jcode benchmark failed to open server output pipes")
        server_stdout = LineCollector(server.stdout)
        server_stderr = LineCollector(server.stderr)
        server_pgid = os.getpgid(server.pid)
        clients: list[PtyClient] = []
        phases: list[dict[str, Any]] = []
        notes: list[str] = []
        try:
            wait_for_socket(socket_path, args.timeout_seconds)
            for count in args.counts:
                while len(clients) < count:
                    client = launch_jcode_client(command, socket_path, args.cwd, env, args.timeout_seconds)
                    clients.append(client)
                    notes.append(
                        f"session {len(clients)}: ready={str(client.ready).lower()} "
                        f"inputReady={str(client.input_ready).lower()} excerpt={client.excerpt!r}"
                    )
                    if not client.ready:
                        raise RuntimeError(
                            f"jcode session {len(clients)} never rendered a connected TUI; "
                            f"inputReady={client.input_ready} excerpt={client.excerpt!r} "
                            f"screenTail={client.screen_tail!r}"
                        )
                roots = [server.pid, *(client.process.pid for client in clients)]
                pgids = [server_pgid, *(client.pgid for client in clients)]
                phases.append(collect_phase(roots, pgids, count, None, args))
        except Exception as error:
            detail = "\n".join([*server_stdout.tail, *server_stderr.tail])
            raise RuntimeError(f"jcode memory benchmark failed; server output tail:\n{detail}") from error
        finally:
            for client in clients:
                try:
                    os.close(client.master_fd)
                except OSError:
                    pass
            for client in reversed(clients):
                terminate_group(client.pgid)
            terminate_group(server_pgid)
        return {
            "tool": "jcode",
            "version": version,
            "mode": "shared server plus one PTY client per session; local memory "
            + ("enabled" if args.jcode_memory else "disabled"),
            "phases": phases,
            "notes": notes,
            "analysis": analyze_phases(phases),
        }


def mib(value: int | None) -> str:
    """Format bytes as MiB for the terminal report."""

    return "n/a" if value is None else f"{value / MIB:.1f}"


def print_report(payload: dict[str, Any]) -> None:
    """Print decision-first phase and slope tables."""

    metric = payload["primaryMetric"]
    print(f"Primary metric: {metric} (MiB); RSS is diagnostic only")
    print("tool\tagents\tprocesses\tprimary\tRSS\ttools")
    for result in payload["results"]:
        for phase in result["phases"]:
            print(
                f"{result['tool']}\t{phase['agents']}\t{phase['processCount']}\t"
                f"{mib(primary_bytes(phase))}\t{mib(phase['rssBytes'])}\t"
                f"{phase['tools'] if phase['tools'] is not None else '-'}"
            )
        analysis = result["analysis"]
        slope = analysis["addedAgentSlopeBytes"]
        if slope is None:
            slope_text = (
                "process-tree slope unresolved after page reclamation "
                f"(endpoint observation {mib(analysis['addedAgentSlopeObservationBytes'])} MiB)"
            )
        else:
            slope_text = f"added-agent process-tree slope {mib(slope)} MiB"
        retained = analysis.get("retainedHeapSlopeBytes")
        retained_text = "" if retained is None else f"; retained JS heap slope {mib(retained)} MiB"
        print(
            f"{result['tool']}: first agent + tool mount {mib(analysis['firstAgentAndToolMountBytes'])} MiB; "
            f"{slope_text}{retained_text} "
            f"({analysis['slopeEndpoints'][0]}->{analysis['slopeEndpoints'][1]})"
        )


def build_parser() -> argparse.ArgumentParser:
    """Build the benchmark command line."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tool", choices=("dsh", "jcode", "both"), default="dsh")
    parser.add_argument("--counts", type=parse_counts, default=parse_counts("0,1,2,4,8,10"))
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--settle-seconds", type=float, default=10.0)
    parser.add_argument("--sample-interval-seconds", type=float, default=1.0)
    parser.add_argument("--timeout-seconds", type=float, default=30.0)
    parser.add_argument("--cwd", default=os.getcwd())
    parser.add_argument("--json-out")
    parser.add_argument("--dsh-bin")
    parser.add_argument("--dsh-preset", default="standard")
    parser.add_argument(
        "--dsh-force-gc",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="collect reclaimable V8 garbage before each retained-state phase (default: enabled)",
    )
    parser.add_argument("--jcode-bin")
    parser.add_argument("--jcode-memory", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the selected benchmarks and preserve their raw samples."""

    args = build_parser().parse_args(argv)
    if args.samples <= 0:
        raise SystemExit("--samples must be positive")
    if args.settle_seconds < 0 or args.sample_interval_seconds < 0 or args.timeout_seconds <= 0:
        raise SystemExit("sample timing values must be non-negative and timeout must be positive")
    args.cwd = str(Path(args.cwd).resolve())
    repo_root = Path(__file__).resolve().parent.parent
    results: list[dict[str, Any]] = []
    if args.tool in ("dsh", "both"):
        results.append(benchmark_dsh(args, repo_root))
    if args.tool in ("jcode", "both"):
        results.append(benchmark_jcode(args))
    payload = {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "platform": {"system": platform.system(), "release": platform.release(), "machine": platform.machine()},
        "primaryMetric": "pss" if sys.platform.startswith("linux") else "physical_footprint",
        "configuration": {
            "counts": args.counts,
            "samples": args.samples,
            "settleSeconds": args.settle_seconds,
            "sampleIntervalSeconds": args.sample_interval_seconds,
            "cwd": args.cwd,
            "dshForceGc": args.dsh_force_gc,
        },
        "results": results,
    }
    print_report(payload)
    encoded = json.dumps(payload, indent=2) + "\n"
    if args.json_out:
        Path(args.json_out).write_text(encoded, encoding="utf-8")
        print(f"Raw evidence: {Path(args.json_out).resolve()}")
    else:
        print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
