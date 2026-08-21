from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("benchmark_agent_memory.py")
SPEC = importlib.util.spec_from_file_location("benchmark_agent_memory", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot import {MODULE_PATH}")
BENCH = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BENCH
SPEC.loader.exec_module(BENCH)


class AgentMemoryBenchmarkTests(unittest.TestCase):
    def test_counts_require_baseline_one_and_growth(self) -> None:
        self.assertEqual(BENCH.parse_counts("0,1,2,10"), [0, 1, 2, 10])
        with self.assertRaises(Exception):
            BENCH.parse_counts("0,2,10")
        with self.assertRaises(Exception):
            BENCH.parse_counts("0,1,1,10")

    def test_ps_rows_convert_kib_to_bytes(self) -> None:
        rows = BENCH.parse_ps_table(" 11 1 11 2048\n12 11 11 512\n")
        self.assertEqual(rows[11].rss_bytes, 2 * 1024 * 1024)
        self.assertEqual(rows[12].ppid, 11)

    def test_owned_pids_close_descendants_and_process_groups(self) -> None:
        records = {
            10: BENCH.ProcessRecord(10, 1, 10, 1),
            11: BENCH.ProcessRecord(11, 10, 10, 1),
            20: BENCH.ProcessRecord(20, 1, 20, 1),
            21: BENCH.ProcessRecord(21, 1, 10, 1),
        }
        self.assertEqual(BENCH.owned_pids(records, [10], [10]), {10, 11, 21})

    def test_linux_rollup_reads_rss_and_pss(self) -> None:
        rss, pss = BENCH.parse_smaps_rollup("Rss: 2048 kB\nPss: 1536 kB\n")
        self.assertEqual(rss, 2 * 1024 * 1024)
        self.assertEqual(pss, 1536 * 1024)

    def test_footprint_prefers_shared_adjusted_summary(self) -> None:
        output = "phys_footprint: 100 B\nSummary Footprint: 180 B\n"
        self.assertEqual(BENCH.parse_footprint_bytes(output), 180)
        self.assertEqual(BENCH.parse_footprint_bytes("  phys_footprint: 100 B\n"), 100)

    def test_jcode_readiness_requires_a_connected_screen(self) -> None:
        self.assertFalse(BENCH.jcode_tui_ready("Connecting to server...\ndshmem92"))
        self.assertTrue(BENCH.jcode_tui_ready("jcode · client\nskills: 10 loaded\nContext 3k/200k"))
        self.assertTrue(BENCH.jcode_tui_ready("Welcome to jcode onboarding"))

    def test_analysis_separates_first_mount_from_added_agent_slope(self) -> None:
        key = "pssBytes" if sys.platform.startswith("linux") else "physicalFootprintBytes"

        def phase(agents: int, primary: int) -> dict[str, object]:
            return {
                "agents": agents,
                "rssBytes": primary,
                "pssBytes": primary if key == "pssBytes" else None,
                "physicalFootprintBytes": primary if key == "physicalFootprintBytes" else None,
            }

        analysis = BENCH.analyze_phases([phase(0, 100), phase(1, 160), phase(10, 250)])
        self.assertEqual(analysis["firstAgentAndToolMountBytes"], 60)
        self.assertEqual(analysis["addedAgentSlopeBytes"], 10)
        self.assertEqual(analysis["addedAgentSlopeObservationBytes"], 10)

    def test_negative_process_slope_is_reported_as_unresolved(self) -> None:
        key = "pssBytes" if sys.platform.startswith("linux") else "physicalFootprintBytes"

        def phase(agents: int, primary: int) -> dict[str, object]:
            return {
                "agents": agents,
                "rssBytes": primary,
                "pssBytes": primary if key == "pssBytes" else None,
                "physicalFootprintBytes": primary if key == "physicalFootprintBytes" else None,
            }

        analysis = BENCH.analyze_phases([phase(0, 100), phase(1, 160), phase(10, 140)])
        self.assertIsNone(analysis["addedAgentSlopeBytes"])
        self.assertEqual(analysis["addedAgentSlopeObservationBytes"], -2)

    def test_retained_heap_slope_uses_post_collection_markers(self) -> None:
        markers = [
            {"agents": 0, "node": {"heapUsed": 80}},
            {"agents": 1, "node": {"heapUsed": 100}},
            {"agents": 10, "node": {"heapUsed": 190}},
        ]
        self.assertEqual(BENCH.retained_heap_slope(markers), 10)


if __name__ == "__main__":
    unittest.main()
