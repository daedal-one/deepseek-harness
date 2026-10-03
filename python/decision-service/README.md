# Local decision service

This reference describes an opt-in Python service for the [private local decision protocol](../../packages/experimental/operation-kev/protocol.md). It runs an actual official Kev-4B CPU scorer or an independent tokenizer-only deployment. It is not an LLM generation server, a CLM endpoint, or a model qualification. Nothing installs model artifacts, starts this service, or adds it to a shipped DSH profile automatically.

## Serving contract

The operator entrypoint is `python -B -m dsh_decision_service --config /absolute/server.json`. FastAPI/Uvicorn binds one numeric loopback address, with one resident subprocess and a bounded queue shared by preparation and ranking. The required bearer key comes from the environment variable named by `bearer_env`; the entrypoint removes that variable before spawning. Worker environment inheritance is allowlisted. HTTP access logs, body logs and worker stdout/stderr are disabled. Error bodies contain stable codes, never exception text, requests, token ids or credentials. Use a separate service account and private configuration files; loopback authentication does not protect against a privileged host process.

Every operation is bounded by HTTP byte/depth limits, worker IPC byte limits, queue capacity and explicit deadlines. Preparation and tokenizer work have the same supervised execution deadline as ranking. Body reading has its own `body_timeout`; the public `requestTimeoutMs` is `(queue_timeout + execution_timeout) * 1000`, excluding body transfer and startup. Queue cancellation and expiry remove work before dispatch. Active cancellation, timeout, unexpected exit, or malformed/oversized worker output terminates and joins the subprocess, closes admission and rejects the queue. Availability stays false until the operator creates a new service; no request is retried or requeued. Shutdown rejects pending work, terminates active work, and joins the process, dispatcher and exit watcher. An idle shutdown first attempts bounded backend disposal.

Kev mode exposes only `POST /v1/prepare` and `POST /v1/decision`. Preparation uses the official strict encoder and performs no model call. Decision requests are parsed, associated with their exact UTF-8 digest, and completely re-encoded before inference; supplied token ids never control the model. Both responses identify the loaded artifacts, dtype, recipe and effective service limits. Complete full-precision probabilities accompany the unchanged official rounded answer distribution. `result.usage.output_tokens` is the official token count of serialized answers, not generated output, and no CLM billing units are invented.

Tokenizer mode exposes only `POST /v1/tokenize`. It loads a local fast `AutoTokenizer` with `trust_remote_code=False`, disables ML framework loading, and independently encodes each string with explicit `add_special_tokens`, no padding and no truncation. Its identifier binds the artifact files, Python/dependency versions and recipe digest, including `:add-special-tokens=true` or `:add-special-tokens=false`. Kev tokenization is not interchangeable with a CLM counter: official state/question/option framing includes delimiter sanitization and special markers.

## Verified CPU implementation

The bridge pins [official Kev source](https://github.com/jaredpalmer/kev/tree/90512f1c517d977741f2104470a40635408236c9) and additionally checks the exact SHA-256 of its imported `api.py`, `model.py`, `checkpoint.py` and `__init__.py`. The loaded model is `kev.model.DecisionModel` on CPU, eager attention, fp32 parameters, an unmerged `PeftModel` LoRA, and the strictly loaded pointer head. The bridge uses `Meta.from_dict(torch.load(..., weights_only=True))`, verifies adapter tensor coverage, preserves the checkpoint's recorded temperature, and calls `model.probs`. It does not use `generate`, date preprocessing, temperature overrides, model routing, automatic backend selection or remote code.

The bridge does not call `Checkpoint.load`: that API takes base/tokenizer paths from head metadata and can resolve an unpinned base when its revision is absent. It instead passes the independently verified local base and tokenizer to the same official unmerged loader sequence. Offline environment settings and a worker network-denial audit hook prevent Hub resolution. Custom-code and quantized configs are rejected. Dependency versions and Python patch version are exact manifest entries; production dependencies are provisioned separately, not pulled in by installing this HTTP package.

The example identifies `jaredpalmer/kev-4b@139fdd94f1b6a6ad80cc15e08fcb99cac885a101`. Its [training configuration](https://huggingface.co/jaredpalmer/kev-4b/raw/139fdd94f1b6a6ad80cc15e08fcb99cac885a101/training_config.json) records `Qwen/Qwen3.5-4B-Base@1001bb4d826a52d1f399e183466143f4da7b741b`, fp32 saved weights, a 256-dimensional head and rank-16 LoRA. An adapter's `revision: null` never authorizes loading base `main`. The runtime checks training provenance and available head/adapter revision declarations against the explicit manifest base revision.

## Configuration

[The manifest template](examples/manifest.template.json) is deliberately incomplete and fails validation until provisioned. Its example limits are not defaults, performance recommendations or calibration results. All fields are required; unsupported fields, precision modes and recipes fail closed. The exact manifest bytes determine deployment identity as `sha256:<hex>`; [server configuration](examples/server.template.json) separately pins that digest.

| Field group | Meaning |
| --- | --- |
| `model` | Artifact-derived model id, fixed wire route, and base-plus-adapter encoder identity |
| `tokenizer`, `serialization` | Immutable tokenizer revision and exact encoding recipe identity |
| `artifacts` | Absolute non-symlink roots, repository/commit provenance and exhaustive relative-file SHA-256 inventories |
| `python`, `dependencies` | Exact Python patch version and complete installed distribution-name/version map |
| `recipe` | CPU fp32/eager/unmerged behavior and checkpoint temperature, or independent tokenizer special-token behavior |
| `limits.max_*` | Request/response bytes, JSON depth, texts/candidates and full input/state/per-text token ceilings |
| `limits.queue_*` | Pending capacity and queue wait deadline in seconds |
| `limits.*_timeout` | Execution, startup, shutdown and body-read deadlines in seconds |
| `limits.http_*` | ASGI concurrency, listen backlog, keep-alive and incomplete-header bounds |
| `limits.cpu_*` | Torch intra/inter-op thread counts; intra-op count also pins OpenMP/MKL/OpenBLAS environment settings |

The public identity derives `vocabSize` from one plus the maximum actual tokenizer id, including added tokens. All public counts and millisecond budgets are safe integers. Other lifecycle limits remain manifest-owned. Artifact files are hashed before load; changed inode, size, timestamps or file type invalidate subsequent operations. Operators must keep artifact trees and the environment immutable for the process lifetime; stat checks are not a defense against a privileged concurrent filesystem attacker. All files, including bridge bytecode caches if present, must be inventoried. Official Kev rejects bytecode and native-module files entirely so imports cannot replace verified source. Shard-index and tokenizer-file references must name files inside their hashed inventories. Prefer source-only trees and `-B`; keep virtual environments, `.git` metadata and unrelated files outside artifact roots.

## Provisioning tutorial

1. Obtain separate authorization for provisioning and later inference. Outside the service, resolve and verify the exact official source, base, adapter/head and tokenizer snapshots using approved artifact tooling. Copy/dereference snapshot files into immutable local directories. The adapter directory must include `head.pt`, `adapter_model.safetensors`, `adapter_config.json`, `training_config.json`, and its tokenizer copy. The dedicated tokenizer directory contains an exact subset of those tokenizer files. Base weights must be local safetensors, not another adapter or pickle checkpoint. No provisioning or download command runs at startup.
2. Build an isolated Python 3.12/3.13 environment from reviewed offline wheels and the pinned official source. Follow the upstream [dependency requirements](https://github.com/jaredpalmer/kev/blob/90512f1c517d977741f2104470a40635408236c9/pyproject.toml): Torch `>=2.6,<2.9`, Transformers `>=5.17,<6`, PEFT `>=0.21`, plus their exact resolved dependencies. Use a CPU Torch wheel. Install this package without ML extras, and retain the exact lock/wheel provenance in operator records. Tokenizer-only deployments require Transformers/tokenizers but not Torch or Kev. This implementation has not installed or exercised those ML dependencies.
3. Fill every placeholder in the manifest template. Use the installed bridge package directory for `artifacts.bridge.path` and the `kev` package directory for `artifacts.kev.path`. Read the already-provisioned head using a trusted Torch `weights_only=True` loader to record its temperature; do not choose an override. Capture complete local file hashes and the environment inventory using the same interpreter that will serve, for example:

```python
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import sys
from dsh_decision_service.config import tokenizer_identity

path = Path("/private/manifest.json")
manifest = json.loads(path.read_text())
manifest["python"] = ".".join(map(str, sys.version_info[:3]))
manifest["dependencies"] = {
    re.sub(r"[-_.]+", "-", dist.metadata["Name"]).lower(): dist.version
    for dist in importlib.metadata.distributions()
}
for artifact in manifest["artifacts"].values():
    root = Path(artifact["path"])
    artifact["files"] = {}
    for file in sorted(root.rglob("*")):
        if file.is_symlink():
            raise ValueError("dereference artifacts before inventorying")
        if file.is_file():
            with file.open("rb") as stream:
                artifact["files"][file.relative_to(root).as_posix()] = hashlib.file_digest(stream, "sha256").hexdigest()
if manifest["mode"] == "tokenizer":
    manifest["tokenizer"] = tokenizer_identity(manifest)
path.write_text(json.dumps(manifest, indent=2) + "\n")
print(hashlib.sha256(path.read_bytes()).hexdigest())
```

4. Put that digest in private server configuration. Supply a strong bearer value using a protected environment file or the supervisor's credential mechanism, never command-line arguments or request bodies. Set the DSH provider's expected deployment, identity and service caps from these same verified records, not a route alias. For tokenizer-only mode, remove base/adapter/Kev artifacts, set `model` to `null`, use `recipe: {"name": "independent-auto-tokenizer-v1", "add_special_tokens": false}` (or explicit `true`), set serialization to that recipe name and derive `tokenizer` with `tokenizer_identity(manifest)` after inventorying.
5. After operator review, launch under independent supervision. [The example systemd unit](examples/dsh-decision.service) is a reference only: adjust paths, account and stop deadline; it is not installed or activated here. Its `Restart=no` and control-group teardown prevent replay of interrupted requests. Only a `dsh` profile composes the Node provider. Serving readiness does not satisfy the operation runner's separate deployment-verification and calibration requirements.

## Verification and limitations

Run the deterministic suite with lightweight HTTP test dependencies in an isolated environment:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src:tests python3 -m unittest discover -s tests -v
```

Tests exercise real subprocesses and loopback Uvicorn HTTP routes using synthetic backends, including pure preparation, drift, bounds, authentication, identity, queue cancellation/expiry, hung workers and disposal. Public imports require no Torch. The separately invoked `PYTHONPATH=src:tests python3 tests/check_upstream.py` fetches only pinned source, verifies hashes/signatures, and executes the pure official encoder with a synthetic tokenizer; it does not import ML libraries or load weights.

The real base/adapter/head load and CPU inference path remain unexecuted. No model weights were downloaded, no memory/latency/quality claims were measured, and no qualification is asserted. CPU memory demand and long-input cost must be assessed in separately authorized deployment work. Only Kev-4B LoRA, one transition choice, and CPU fp32/eager/unmerged serving are supported. TLS, non-loopback binding, batching inference across requests, persistent prefix caching, and automatic worker restart are intentionally absent.
