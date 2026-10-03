"""Artifact/configuration refusal tests without importing any ML libraries."""

import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import dsh_decision_service.config as config
from support import limits


def inventory(root):
    return {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in root.rglob("*") if path.is_file()}


class ConfigTests(unittest.TestCase):
    def test_strict_json_rejects_duplicates_deep_nonfinite_and_surrogates(self):
        for raw in ('{"a":1,"a":2}', '[NaN]', '[1e999]', '"\\ud800"', '[' * 9 + '0' + ']' * 9):
            with self.subTest(raw=raw), self.assertRaises((ValueError, UnicodeError)):
                config.parse_json(raw, 8)
        self.assertEqual(config.parse_json('{"a":["[\\\"]"]}', 8), {"a": ['[\"]']})

    def test_limits_require_explicit_valid_tunables(self):
        for key, value in (("queue_size", True), ("execution_timeout", float("inf")), ("cpu_threads", 0),
                           ("max_candidates", 256), ("http_concurrency", 1), ("queue_timeout", 0.0001)):
            with self.subTest(key=key), self.assertRaises(ValueError):
                limits(**{key: value})

    def test_official_source_cannot_be_shadowed_by_inventoried_bytecode(self):
        for name in ("__pycache__/model.cpython-312.pyc", "api.pyc", "checkpoint.pyo", "model.so", "api.pyd"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                config.Manifest._source_only({"model.py": "verified-source", name: "different-code"})
        config.Manifest._source_only({"model.py": "verified-source", "api.py": "verified-source"})

    def test_checkpoint_shards_cannot_escape_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            index = root / "model.safetensors.index.json"
            inventory = {index.name: "unused", "model-00001.safetensors": "unused"}
            for reference in ("../outside.safetensors", "/outside.safetensors", "missing.safetensors", "C:\\outside.safetensors", "./model-00001.safetensors"):
                index.write_text(json.dumps({"weight_map": {"weight": reference}}))
                with self.subTest(reference=reference), self.assertRaises(ValueError):
                    config.Manifest._verify_shards(root, inventory)
            index.write_text(json.dumps({"weight_map": {"weight": "model-00001.safetensors"}}))
            config.Manifest._verify_shards(root, inventory)

    def test_server_rejects_nonloopback_and_floating_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "server.json"
            value = {"host": "0.0.0.0", "port": 8765, "bearer_env": "DSH_DECISION_KEY", "manifest": "/model/manifest.json", "manifest_sha256": "a" * 64}
            file.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                config.ServerConfig.load(str(file))
            value["host"] = "::1"
            file.write_text(json.dumps(value))
            self.assertEqual(config.ServerConfig.load(str(file)).host, "::1")
            value["manifest_sha256"] = "main"
            file.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                config.ServerConfig.load(str(file))

    def test_manifest_inventory_hash_dependency_identity_and_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tok = root / "tokenizer"
            tok.mkdir()
            (tok / "tokenizer_config.json").write_text('{}')
            (tok / "tokenizer.json").write_text('{}')
            bridge = Path(config.__file__).resolve().parent
            deps = {name: "1.0.0" for name in ("fastapi", "uvicorn", "transformers", "tokenizers")}
            distributions = [SimpleNamespace(metadata={"Name": name}, version=version) for name, version in deps.items()]
            value = {"version": 1, "mode": "tokenizer", "model": None, "python": ".".join(map(str, sys.version_info[:3])),
                     "tokenizer": "owner/tokenizer@" + "a" * 40 + ":add-special-tokens=false", "serialization": config.TOKENIZER_RECIPE,
                     "recipe": {"name": config.TOKENIZER_RECIPE, "add_special_tokens": False},
                     "dependencies": deps, "limits": vars(limits()), "artifacts": {
                         "tokenizer": {"path": str(tok), "repository": "owner/tokenizer", "revision": "a" * 40, "files": inventory(tok)},
                         "bridge": {"path": str(bridge), "repository": "local/bridge", "revision": "b" * 40, "files": inventory(bridge)}}}
            value["tokenizer"] = config.tokenizer_identity(value)
            path = root / "manifest.json"
            def load():
                raw = json.dumps(value).encode()
                path.write_bytes(raw)
                return config.Manifest(str(path), hashlib.sha256(raw).hexdigest())
            with patch.object(config.importlib.metadata, "distributions", return_value=distributions):
                manifest = load()
                self.assertEqual(manifest.identity, config.digest(path.read_bytes()))
                manifest.check_unchanged()
                (tok / "tokenizer.json").write_text('{"changed":true}')
                with self.assertRaises(ValueError):
                    manifest.check_unchanged()
                with self.assertRaises(ValueError):
                    load()
                value["artifacts"]["tokenizer"]["files"] = inventory(tok)
                with self.assertRaises(ValueError):
                    load()
                value["tokenizer"] = config.tokenizer_identity(value)
                load()
                (tok / "extra.json").write_text('{}')
                with self.assertRaises(ValueError):
                    load()
                (tok / "extra.json").unlink()
                (tok / "link").symlink_to(tok / "tokenizer.json")
                with self.assertRaises(ValueError):
                    load()
                (tok / "link").unlink()
                value["tokenizer"] += "wrong"
                with self.assertRaises(ValueError):
                    load()
                value["tokenizer"] = value["tokenizer"].removesuffix("wrong")
                value["dependencies"] = {**deps, "uninstalled": "1.0.0"}
                with self.assertRaises(ValueError):
                    load()


if __name__ == "__main__":
    unittest.main()
