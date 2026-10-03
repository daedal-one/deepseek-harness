"""Explicit service limits and immutable deployment manifests; no model imports."""

from __future__ import annotations

from dataclasses import dataclass, fields
import hashlib
import importlib.metadata
import ipaddress
import json
import math
from pathlib import Path
import re
import stat
import sys

UPSTREAM_SHA = "90512f1c517d977741f2104470a40635408236c9"
KEV_RECIPE = "kev-official-single-choice-v1"
TOKENIZER_RECIPE = "independent-auto-tokenizer-v1"
KEV_SERIALIZATION = "kev-90512f1c-systemone-choice-v1"
SHA = re.compile(r"[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
SAFE_INTEGER = 2**53 - 1


def digest(data: bytes) -> str:
    """Hash exact bytes using the private protocol's identifier convention."""
    return "sha256:" + hashlib.sha256(data).hexdigest()


def tokenizer_identity(data: dict) -> str:
    """Bind tokenizer-only identity to files, dependency versions and special-token recipe."""
    artifact = data["artifacts"]["tokenizer"]
    payload = {"tokenizer": {key: artifact[key] for key in ("repository", "revision", "files")},
               "python": data["python"], "dependencies": data["dependencies"], "recipe": data["recipe"]}
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    return artifact["repository"] + "@" + artifact["revision"] + ":add-special-tokens=" + str(data["recipe"]["add_special_tokens"]).lower() + ":" + digest(encoded)


def exact_keys(value: object, names: set[str]) -> dict:
    """Reject unknown or missing fields at a JSON/configuration boundary."""
    if not isinstance(value, dict) or set(value) != names:
        raise ValueError("unexpected fields")
    return value


def integer(value: object, minimum: int = 1, maximum: int = SAFE_INTEGER) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("integer outside allowed range")
    return value


def positive(value: object) -> float:
    if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
        raise ValueError("expected positive finite number")
    return float(value)


def text(value: object) -> str:
    if not isinstance(value, str) or not value or not value.isprintable():
        raise ValueError("expected nonempty printable identifier")
    return value


def parse_json(raw: bytes | str, max_depth: int) -> object:
    """Reject deep JSON before decoding, duplicates, non-finite values and invalid UTF-8."""
    source = raw.decode("utf-8", errors="strict") if isinstance(raw, bytes) else raw
    source.encode("utf-8", errors="strict")
    depth = 0
    quoted = escaped = False
    for char in source:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
            if depth > max_depth:
                raise ValueError("JSON depth limit exceeded")
        elif char in "]}":
            depth -= 1
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result
    def bad_constant(_):
        raise ValueError("non-finite JSON value")
    value = json.loads(source, object_pairs_hook=pairs, parse_constant=bad_constant)
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, str):
            item.encode("utf-8", errors="strict")
        elif isinstance(item, float) and not math.isfinite(item):
            raise ValueError("non-finite JSON value")
        elif isinstance(item, dict):
            pending.extend(item.keys())
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    return value


@dataclass(frozen=True)
class Limits:
    """All deployment-dependent admission, tokenizer and process limits are required."""

    max_request_bytes: int
    max_response_bytes: int
    max_json_depth: int
    max_texts: int
    max_candidates: int
    max_input_tokens: int
    max_state_tokens: int
    max_text_tokens: int
    queue_size: int
    queue_timeout: float
    execution_timeout: float
    startup_timeout: float
    shutdown_timeout: float
    body_timeout: float
    http_concurrency: int
    http_backlog: int
    http_keep_alive: float
    http_header_bytes: int
    cpu_threads: int
    cpu_interop_threads: int

    @classmethod
    def from_dict(cls, value: dict) -> Limits:
        exact_keys(value, {field.name for field in fields(cls)})
        floats = {"queue_timeout", "execution_timeout", "startup_timeout", "shutdown_timeout", "body_timeout", "http_keep_alive"}
        for name, item in value.items():
            positive(item) if name in floats else integer(item)
        if value["max_candidates"] > 255 or value["max_state_tokens"] > value["max_input_tokens"]:
            raise ValueError("invalid encoder limits")
        if value["max_response_bytes"] < 128 or value["max_request_bytes"] < 128:
            raise ValueError("JSON byte caps must fit protocol errors")
        if value["max_json_depth"] > 128:
            raise ValueError("JSON depth exceeds supported recursion bound")
        if value["http_concurrency"] < 2:
            raise ValueError("HTTP concurrency must admit at least one connection and task")
        for name in ("queue_timeout", "execution_timeout"):
            milliseconds = value[name] * 1000
            if not float(milliseconds).is_integer():
                raise ValueError("public time limits must be whole milliseconds")
            integer(int(milliseconds))
        integer(int(1000 * (value["queue_timeout"] + value["execution_timeout"])))
        return cls(**value)


@dataclass(frozen=True)
class ServerConfig:
    host: str
    port: int
    bearer_env: str
    manifest: str
    manifest_sha256: str

    @classmethod
    def load(cls, path: str) -> ServerConfig:
        value = parse_json(Path(path).read_bytes(), 8)
        exact_keys(value, {field.name for field in fields(cls)})
        config = cls(**value)
        if not ipaddress.ip_address(config.host).is_loopback:
            raise ValueError("service must bind a numeric loopback address")
        integer(config.port, 1, 65535)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", config.bearer_env):
            raise ValueError("invalid credential environment name")
        if not Path(config.manifest).is_absolute() or not SHA.fullmatch(config.manifest_sha256):
            raise ValueError("absolute manifest path and sha256 are required")
        return config


class Manifest:
    """Verify all provisioned files and exact installed dependency versions before loading.

    Directories must be dereferenced, immutable snapshots with exhaustive inventories.
    Inventories include bytecode caches if present; source-only provisioning is preferred.
    The operator must prevent concurrent artifact mutation; stat checks detect drift
    after startup without rehashing multi-gigabyte weights for every decision.
    """

    def __init__(self, path: str, expected_sha256: str):
        raw = Path(path).read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected_sha256:
            raise ValueError("manifest digest mismatch")
        self.identity = digest(raw)
        self.data = exact_keys(parse_json(raw, 32), {"version", "mode", "model", "tokenizer", "serialization", "python", "dependencies", "artifacts", "recipe", "limits"})
        data = self.data
        if type(data["version"]) is not int or data["version"] != 1 or data["mode"] not in ("kev", "tokenizer"):
            raise ValueError("unsupported manifest")
        self.limits = Limits.from_dict(data["limits"])
        text(data["tokenizer"])
        text(data["serialization"])
        if data["python"] != ".".join(map(str, sys.version_info[:3])):
            raise ValueError("Python version mismatch")
        expected = data["dependencies"]
        installed = {re.sub(r"[-_.]+", "-", d.metadata["Name"]).lower(): d.version for d in importlib.metadata.distributions()}
        if not isinstance(expected, dict) or not expected or installed != expected:
            raise ValueError("installed dependency inventory differs from manifest")
        required = {"fastapi", "uvicorn", "transformers", "tokenizers"}
        if data["mode"] == "kev":
            required |= {"torch", "peft", "safetensors"}
        if not required <= expected.keys():
            raise ValueError("missing serving dependencies")
        recipe = data["recipe"]
        if data["mode"] == "kev":
            exact_keys(recipe, {"name", "dtype", "attention", "merge", "date_facts", "option_isolation", "temperature"})
            if any(recipe[k] != v for k, v in {"name": KEV_RECIPE, "dtype": "float32", "attention": "eager", "merge": False, "date_facts": False, "option_isolation": False}.items()):
                raise ValueError("unsupported Kev encoding or CPU recipe")
            for key in ("merge", "date_facts", "option_isolation"):
                if type(recipe[key]) is not bool:
                    raise ValueError("recipe flags must be booleans")
            positive(recipe["temperature"])
            exact_keys(data["model"], {"id", "wireModel", "encoder"})
            for identifier in data["model"].values():
                text(identifier)
            names = {"base", "adapter", "tokenizer", "kev", "bridge"}
        else:
            exact_keys(recipe, {"name", "add_special_tokens"})
            if recipe["name"] != TOKENIZER_RECIPE or type(recipe["add_special_tokens"]) is not bool or data["model"] is not None:
                raise ValueError("unsupported tokenizer-only recipe")
            names = {"tokenizer", "bridge"}
        exact_keys(data["artifacts"], names)
        self.paths = {}
        self._stamps = {}
        for name, artifact in data["artifacts"].items():
            exact_keys(artifact, {"path", "repository", "revision", "files"})
            text(artifact["repository"])
            if not isinstance(artifact["revision"], str) or not REVISION.fullmatch(artifact["revision"]):
                raise ValueError("artifact revision must be an immutable commit")
            root = Path(artifact["path"])
            if not root.is_absolute() or root.resolve(strict=True) != root or not root.is_dir():
                raise ValueError("artifact root must be an absolute non-symlink directory")
            inventory = artifact["files"]
            if not isinstance(inventory, dict) or not inventory:
                raise ValueError("empty artifact inventory")
            actual = set()
            for entry in root.rglob("*"):
                if entry.is_symlink():
                    raise ValueError("artifact symlinks are not allowed")
                if entry.is_dir():
                    continue
                if not entry.is_file():
                    raise ValueError("artifact must contain only regular files")
                actual.add(entry.relative_to(root).as_posix())
            if actual != set(inventory):
                raise ValueError("artifact file inventory mismatch")
            for relative, sha in inventory.items():
                if not isinstance(sha, str) or not SHA.fullmatch(sha):
                    raise ValueError("invalid artifact sha256")
                file = root / relative
                before = file.stat()
                with file.open("rb") as stream:
                    measured = hashlib.file_digest(stream, "sha256").hexdigest()
                if measured != sha or before != file.stat():
                    raise ValueError("artifact hash mismatch or concurrent mutation")
                self._stamps[file] = self._stamp(file)
            self.paths[name] = root
        if data["mode"] == "kev":
            kev = data["artifacts"]["kev"]
            if kev["repository"] != "jaredpalmer/kev" or kev["revision"] != UPSTREAM_SHA:
                raise ValueError("unsupported official Kev source revision")
            self._source_only(kev["files"])
            base, adapter = data["artifacts"]["base"], data["artifacts"]["adapter"]
            tokenizer = data["artifacts"]["tokenizer"]
            if base["repository"] != "Qwen/Qwen3.5-4B-Base" or adapter["repository"] != "jaredpalmer/kev-4b":
                raise ValueError("this bridge supports the Kev-4B LoRA deployment only")
            base_id = base["repository"] + "@" + base["revision"]
            adapter_id = adapter["repository"] + "@" + adapter["revision"]
            if data["model"]["id"] != adapter_id or data["model"]["encoder"] != base_id + "+" + adapter_id:
                raise ValueError("model labels must identify the verified artifacts")
            if data["serialization"] != KEV_SERIALIZATION:
                raise ValueError("unsupported serialization identity")
            if any(tokenizer[key] != adapter[key] for key in ("repository", "revision")) or any(adapter["files"].get(key) != sha for key, sha in tokenizer["files"].items()):
                raise ValueError("Kev tokenizer must match the pinned adapter's tokenizer copy")
            if not {"head.pt", "adapter_config.json", "adapter_model.safetensors", "training_config.json"} <= adapter["files"].keys():
                raise ValueError("incomplete Kev checkpoint")
            if "adapter_config.json" in base["files"] or not any(name.endswith(".safetensors") for name in base["files"]):
                raise ValueError("base must contain local full safetensors weights")
            if any(name.endswith((".bin", ".pt", ".py")) for name in base["files"]):
                raise ValueError("base code and pickle weights are unsupported")
            self._verify_shards(self.paths["base"], base["files"])
        token = data["artifacts"]["tokenizer"]
        token_id = token["repository"] + "@" + token["revision"]
        if data["mode"] == "tokenizer":
            token_id = tokenizer_identity(data)
            if data["serialization"] != TOKENIZER_RECIPE:
                raise ValueError("unsupported tokenizer serialization identity")
        if data["tokenizer"] != token_id:
            raise ValueError("tokenizer label must identify verified artifacts")
        if not {"tokenizer.json", "tokenizer_config.json"} <= token["files"].keys():
            raise ValueError("fast tokenizer artifacts are required")
        tokenizer_config = parse_json((self.paths["tokenizer"] / "tokenizer_config.json").read_bytes(), 64)
        if not isinstance(tokenizer_config, dict):
            raise ValueError("invalid tokenizer configuration")
        for key in ("tokenizer_file", "vocab_file", "merges_file", "added_tokens_file", "special_tokens_map_file", "chat_template_file"):
            if tokenizer_config.get(key) is not None:
                self._contained_reference(tokenizer_config[key], token["files"])
        for reference in tokenizer_config.get("fast_tokenizer_files", []):
            self._contained_reference(reference, token["files"])
        bridge = Path(__file__).resolve().parent
        if self.paths["bridge"] != bridge:
            raise ValueError("bridge inventory must describe the running package")

    @staticmethod
    def _source_only(inventory: dict):
        if any(name.endswith((".pyc", ".pyo", ".so", ".pyd")) for name in inventory):
            raise ValueError("official Kev must be provisioned as source, not importable caches or binaries")

    @staticmethod
    def _verify_shards(root: Path, inventory: dict):
        for name in inventory:
            if name.endswith(".safetensors.index.json"):
                index = parse_json((root / name).read_bytes(), 32)
                weight_map = index.get("weight_map") if isinstance(index, dict) else None
                if not isinstance(weight_map, dict) or not weight_map:
                    raise ValueError("invalid checkpoint shard index")
                for reference in weight_map.values():
                    Manifest._contained_reference(reference, inventory, suffix=".safetensors")

    @staticmethod
    def _contained_reference(reference: object, inventory: dict, *, suffix: str = ""):
        if not isinstance(reference, str) or not reference or "\\" in reference or ":" in reference:
            raise ValueError("invalid artifact file reference")
        path = Path(reference)
        if path.is_absolute() or ".." in path.parts or path.as_posix() != reference or reference not in inventory or not reference.endswith(suffix):
            raise ValueError("artifact file reference escapes verified inventory")

    @staticmethod
    def _stamp(path: Path):
        s = path.lstat()
        return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, stat.S_IFMT(s.st_mode)

    def check_unchanged(self):
        """Fail closed if a verified local file has changed after loading."""
        if any(self._stamp(path) != stamp for path, stamp in self._stamps.items()):
            raise ValueError("artifact changed since verification")
