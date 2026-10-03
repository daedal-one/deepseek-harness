"""Pinned official Kev CPU scoring and tokenizer-only loading from verified local files.

ML imports occur only in the isolated worker factory. The bridge reproduces the
pinned Checkpoint._adapted_torch unmerged path with explicit local paths instead
of allowing head metadata or adapter revision=None to select a Hub snapshot.
"""

from __future__ import annotations

import importlib
import json
import os
from pathlib import Path
import sys
import time

from .config import Manifest, UPSTREAM_SHA, digest, integer, parse_json
from .protocol import (identity, preparation, request_record, validate_envelope,
                       validate_preparation, validate_probabilities)
from .worker import ServiceError

# Exact official source bytes, resolved from the immutable GitHub commit above.
OFFICIAL_FILES = {
    "__init__.py": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "api.py": "a6f53af5354f8ea17915abc78360fdf291a5108ce39a53a2d9135d48c603ae58",
    "model.py": "2ff3b2e67c048e3bc5a0d1a32aafe50804ed315a5564fce06bb4b95697c5271c",
    "checkpoint.py": "8c8642c56c35ff55ffbb6d5fae6032e8bcf69defcfbd49db13b21f83ea1bd4d5",
}


def offline():
    """Disable Hub resolution and deny network connections inside the worker process."""
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                      TOKENIZERS_PARALLELISM="false", CUDA_VISIBLE_DEVICES="")
    for name in list(os.environ):
        if name.startswith("KEV_"):
            del os.environ[name]
    def audit(event, _args):
        if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto"}:
            raise RuntimeError("network access is disabled in decision workers")
    sys.addaudithook(audit)


def _local_config(path: Path, name: str) -> dict:
    value = parse_json((path / name).read_bytes(), 64)
    if not isinstance(value, dict) or value.get("auto_map") or value.get("quantization_config"):
        raise ValueError("custom code and quantized model artifacts are unsupported")
    return value


class LocalBackend:
    """One resident tokenizer and, in Kev mode, one actual official CPU decision model."""

    def __init__(self, config: dict):
        offline()
        self.manifest = Manifest(config["manifest"], config["manifest_sha256"])
        self.data = self.manifest.data
        self.limits = self.manifest.limits
        self.mode = self.data["mode"]
        for name in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
            os.environ[name] = str(self.limits.cpu_threads)
        self.model = None
        tok_path = self.manifest.paths["tokenizer"]
        _local_config(tok_path, "tokenizer_config.json")
        os.environ.update(USE_TORCH="1" if self.mode == "kev" else "0", USE_TF="0", USE_FLAX="0")
        from transformers import AutoTokenizer
        self.tok = AutoTokenizer.from_pretrained(str(tok_path), local_files_only=True,
                                                trust_remote_code=False, use_fast=True)
        self.vocabulary = set(self.tok.get_vocab().values())
        if not self.vocabulary:
            raise ValueError("tokenizer vocabulary is empty")
        for token in self.vocabulary:
            integer(token, 0)
        self.vocab_size = integer(max(self.vocabulary) + 1)
        if self.mode == "kev":
            self._load_kev()
            self.identity = identity(self.data, self.limits, self.vocab_size)
        self.manifest.check_unchanged()

    def _load_kev(self):
        root = self.manifest.paths["kev"]
        files = self.data["artifacts"]["kev"]["files"]
        if any(files.get(name) != sha for name, sha in OFFICIAL_FILES.items()):
            raise ValueError(f"official Kev source differs from {UPSTREAM_SHA}")
        # The inventory root is the kev package directory, not an arbitrary checkout.
        if root.name != "kev":
            raise ValueError("Kev source path must name its package directory")
        sys.path.insert(0, str(root.parent))
        api = importlib.import_module("kev.api")
        module = importlib.import_module("kev.model")
        checkpoint = importlib.import_module("kev.checkpoint")
        for imported in (api, module, checkpoint):
            if Path(imported.__file__).resolve().parent != root:
                raise ValueError("wrong Kev module origin")
        self.api, self.encoder_module = api, module
        import torch
        from peft import PeftConfig, PeftModel, get_peft_model_state_dict
        from safetensors.torch import load_file
        torch.set_num_threads(self.limits.cpu_threads)
        torch.set_num_interop_threads(self.limits.cpu_interop_threads)
        torch.set_default_dtype(torch.float32)
        torch.use_deterministic_algorithms(True)
        self.torch = torch
        base = self.manifest.paths["base"]
        adapter = self.manifest.paths["adapter"]
        base_revision = self.data["artifacts"]["base"]["revision"]
        base_repository = self.data["artifacts"]["base"]["repository"]
        _local_config(base, "config.json")
        adapter_config = _local_config(adapter, "adapter_config.json")
        training = _local_config(adapter, "training_config.json")
        if training.get("base_revision") != base_revision:
            raise ValueError("training provenance base revision mismatch")
        if adapter_config.get("base_model_name_or_path") != base_repository or adapter_config.get("revision") not in (None, base_revision):
            raise ValueError("adapter base identity mismatch")
        if adapter_config.get("peft_type") != "LORA" or adapter_config.get("task_type") != "FEATURE_EXTRACTION" or adapter_config.get("trainable_token_indices"):
            raise ValueError("unsupported adapter recipe")
        meta = checkpoint.Meta.from_dict(torch.load(adapter / "head.pt", map_location="cpu", weights_only=True))
        if meta.base != base_repository or meta.base_revision not in (None, base_revision):
            raise ValueError("head base identity mismatch")
        if meta.weights != "lora" or meta.weights_dtype != "fp32" or meta.option_isolation or meta.special_embeddings:
            raise ValueError("unsupported checkpoint recipe")
        integer(meta.head_dim)
        if meta.lora != adapter_config.get("r") or meta.temperature != self.data["recipe"]["temperature"]:
            raise ValueError("checkpoint adapter or temperature mismatch")
        special = [self.tok.convert_tokens_to_ids(token) for token in module.SPECIAL]
        if len(set(special)) != len(special) or any(token not in self.vocabulary or token == self.tok.unk_token_id for token in special):
            raise ValueError("tokenizer lacks the official Kev delimiter tokens")
        # Do not call Checkpoint.load: its base/tokenizer locations come from head metadata.
        # DecisionModel's native Transformers class uses no remote code; custom auto_map
        # configs are rejected above and the process has no network access.
        model = module.DecisionModel(str(base), self.tok, "cpu", lora=None,
                                     revision=base_revision, head_dim=meta.head_dim,
                                     option_isolation=False, dtype=torch.float32, attn="eager")
        peft_config = PeftConfig.from_pretrained(str(adapter), local_files_only=True)
        peft_config.base_model_name_or_path = str(base)
        peft_config.revision = base_revision
        model.lm = PeftModel.from_pretrained(model.lm, str(adapter), config=peft_config,
                                             torch_device="cpu", local_files_only=True,
                                             is_trainable=False).to("cpu")
        saved = load_file(str(adapter / "adapter_model.safetensors"), device="cpu")
        loaded = get_peft_model_state_dict(model.lm)
        if set(saved) != set(loaded) or any(saved[key].shape != loaded[key].shape for key in saved):
            raise ValueError("adapter tensor coverage mismatch")
        del saved, loaded
        model.head.load_state_dict(meta.head, strict=True)
        model.head.temperature = meta.temperature
        model.eval()
        if model.dtype != "float32" or any(parameter.device.type != "cpu" or parameter.dtype != torch.float32 for parameter in model.parameters()):
            raise ValueError("loaded model is not CPU fp32")
        self.model = model

    def _encode(self, request: str):
        value = request_record(request, self.data["model"]["wireModel"], self.limits)
        record, metadata = self.api.to_record(self.api.SystemOneRequest.model_validate(value))
        try:
            encoded = self.encoder_module.encode(self.tok, record, max_state=self.limits.max_state_tokens,
                                                  max_branch=self.limits.max_input_tokens,
                                                  strict=True, option_isolation=False)
        except self.encoder_module.ContextOverflow:
            raise ServiceError(422, "input_token_limit") from None
        if encoded["state_truncated"] or len(encoded["decide_idx"]) != 1 or len(encoded["opt_idx"][0]) != len(metadata[0]["keys"]):
            raise ServiceError(503, "invalid_encoder_output")
        prepared = preparation(request, encoded["ids"], tokenizer=self.data["tokenizer"],
                               serialization=self.data["serialization"], limits=self.limits,
                               vocabulary=self.vocabulary)
        return encoded, metadata, prepared

    def handle(self, operation: str, payload: dict) -> dict:
        """Re-encode each decision before scoring; preparation never calls the model."""
        self.manifest.check_unchanged()
        validate_envelope(operation, payload, mode=self.mode, deployment=self.manifest.identity, tokenizer=self.data["tokenizer"])
        if operation == "tokenize":
            return self._tokenize(payload)
        encoded, metadata, prepared = self._encode(payload["request"])
        envelope = {"version": 1, "deployment": self.manifest.identity, "identity": self.identity}
        if operation == "prepare":
            return {**envelope, "preparation": prepared}
        validate_preparation(payload["preparation"], prepared)
        started = time.perf_counter()
        with self.torch.inference_mode():
            raw = self.model.probs(encoded)
        if len(raw) != 1:
            raise ServiceError(503, "invalid_model_probabilities")
        values = raw[0].tolist()
        probabilities = validate_probabilities(values, metadata[0]["keys"])
        answers = self.api.to_answers([values], metadata)
        result = {"model": self.data["model"]["wireModel"], "answers": answers,
                  "usage": {"input_tokens": len(encoded["ids"]), "output_tokens": self.api.output_tokens(self.tok, answers)},
                  "latency_ms": round((time.perf_counter() - started) * 1000, 1)}
        return {**envelope, "requestDigest": prepared["requestDigest"], "probabilities": probabilities, "result": result}

    def _tokenize(self, payload: dict):
        texts = payload["texts"]
        if not isinstance(texts, list) or not 1 <= len(texts) <= self.limits.max_texts or any(not isinstance(item, str) for item in texts):
            raise ServiceError(422, "invalid_texts")
        encoded = self.tok(texts, add_special_tokens=self.data["recipe"]["add_special_tokens"],
                           padding=False, truncation=False, return_attention_mask=False,
                           return_token_type_ids=False).input_ids
        if len(encoded) != len(texts):
            raise ServiceError(503, "invalid_encoder_output")
        counts = []
        for index, (text, ids) in enumerate(zip(texts, encoded, strict=True)):
            if len(ids) > self.limits.max_text_tokens:
                raise ServiceError(422, "text_token_limit")
            if any(type(token) is not int or token not in self.vocabulary for token in ids):
                raise ServiceError(503, "invalid_encoder_output")
            counts.append({"index": index, "textDigest": digest(text.encode("utf-8")), "tokens": len(ids)})
        return {"version": 1, "tokenizer": self.data["tokenizer"], "counts": counts}

    def close(self):
        self.model = None


def create_backend(config: dict) -> LocalBackend:
    """Worker-only factory; there is no production fake backend or model-selection flag."""
    return LocalBackend(config)
