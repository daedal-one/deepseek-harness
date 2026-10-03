"""Synthetic subprocess backend using production protocol and decision dispatch."""

from contextlib import nullcontext
import json
from pathlib import Path
import time
from types import SimpleNamespace

from dsh_decision_service.backend import LocalBackend
from dsh_decision_service.config import Limits
from dsh_decision_service.protocol import identity


def limits(**overrides):
    values = dict(max_request_bytes=16000, max_response_bytes=20000, max_json_depth=16,
                  max_texts=8, max_candidates=8, max_input_tokens=4000, max_state_tokens=2000,
                  max_text_tokens=4000, queue_size=2, queue_timeout=0.25,
                  execution_timeout=1.0, startup_timeout=5.0, shutdown_timeout=0.2,
                  body_timeout=1.0, http_concurrency=20, http_backlog=20,
                  http_keep_alive=1.0, http_header_bytes=8192, cpu_threads=1, cpu_interop_threads=1)
    values.update(overrides)
    return Limits.from_dict(values)


def request(state="hello", criteria=None):
    return json.dumps({"model": "kev-test", "state": state, "questions": {"transition": {
        "type": "choice", "instructions": "Choose", "criteria": criteria or {"a": "read A", "b": "read B"}}}}, separators=(",", ":"))


class Tokenizer:
    def __call__(self, texts, **kwargs):
        def encode(text):
            return ([511] if kwargs.get("add_special_tokens") else []) + list(text.encode())
        return SimpleNamespace(input_ids=[encode(text) for text in texts] if isinstance(texts, list) else encode(texts))


class FakeBackend(LocalBackend):
    def __init__(self, config):
        self.limits = limits(**config.get("limits", {}))
        self.mode = config.get("mode", "kev")
        self.data = {"mode": self.mode, "model": {"id": "fake-model", "wireModel": "kev-test", "encoder": "fake-encoder"},
                     "tokenizer": "fake-tokenizer", "serialization": "fake-serialization", "recipe": {"dtype": "float32", "add_special_tokens": True}}
        self.vocabulary = set(range(512))
        self.vocab_size = 512
        self.identity = identity(self.data, self.limits, 512)
        self.tok = Tokenizer()
        self.torch = SimpleNamespace(inference_mode=nullcontext)
        self.marker = config.get("marker")
        self.drift = config.get("drift", False)
        self.manifest = SimpleNamespace(identity="fake-deployment", check_unchanged=lambda: None)
        self.api = SimpleNamespace(SystemOneRequest=SimpleNamespace(model_validate=lambda value: value),
                                   to_record=self.record, to_answers=self.answers,
                                   output_tokens=lambda tok, answers: len(json.dumps(answers)))
        self.encoder_module = SimpleNamespace(encode=self.encode, ContextOverflow=OverflowError)
        self.model = SimpleNamespace(probs=self.probs)

    def record(self, value):
        keys = list(value["questions"]["transition"]["criteria"])
        return value, [{"keys": keys, "id": "transition", "type": "choice"}]

    def encode(self, tok, record, **kwargs):
        self.record_value = record
        ids = [500] + list(json.dumps(record, ensure_ascii=False).encode()) + [501]
        if self.drift:
            self.drift = False
            ids += [502]
        return {"ids": ids, "state_truncated": False, "decide_idx": [len(ids) - 1],
                "opt_idx": [[0] * len(record["questions"]["transition"]["criteria"])]}

    def probs(self, _encoded):
        if self.marker:
            with Path(self.marker).open("a") as stream:
                stream.write(str(self.record_value["state"]) + "\n")
        state = self.record_value["state"]
        if state == "hang":
            while True:
                time.sleep(60)
        if state == "slow":
            time.sleep(0.6)
        if state == "fail":
            raise RuntimeError("secret raw content must not escape")
        keys = list(self.record_value["questions"]["transition"]["criteria"])
        values = [1 / len(keys)] * len(keys)
        return [SimpleNamespace(tolist=lambda: values)]

    def answers(self, values, metadata):
        keys = metadata[0]["keys"]
        return {"transition": {"type": "choice", "choice": keys[0], "confidence": 0.0,
                                "probabilities": dict(zip(keys, [round(v, 4) for v in values[0]]))}}


def create(config):
    return FakeBackend(config)
