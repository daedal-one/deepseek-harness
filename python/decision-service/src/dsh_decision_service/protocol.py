"""Wire validation and exact preparation shared by real and synthetic backends."""

from __future__ import annotations

import math

from .config import Limits, digest, exact_keys, integer, parse_json
from .worker import ServiceError


def validate_envelope(operation: str, payload: object, *, mode: str, deployment: str, tokenizer: str):
    """Reject route, version and deployment drift before any backend operation."""
    names = {"version", "tokenizer", "texts"} if operation == "tokenize" else {"version", "deployment", "request"}
    if operation == "decision":
        names.add("preparation")
    try:
        exact_keys(payload, names)
        if type(payload["version"]) is not int or payload["version"] != 1:
            raise ValueError("version")
        if operation == "tokenize":
            if mode != "tokenizer" or payload["tokenizer"] != tokenizer:
                raise ValueError("tokenizer")
        elif mode != "kev" or operation not in ("prepare", "decision") or payload["deployment"] != deployment:
            raise ValueError("deployment")
    except (ValueError, TypeError, KeyError):
        raise ServiceError(422, "invalid_identity_or_envelope") from None


def request_record(request: object, model: str, limits: Limits) -> dict:
    """Accept exactly one transition choice; preserve candidate insertion order."""
    try:
        if not isinstance(request, str) or len(request.encode("utf-8")) > limits.max_request_bytes:
            raise ValueError("request")
        value = exact_keys(parse_json(request, limits.max_json_depth), {"model", "state", "questions"})
        if value["model"] != model:
            raise ValueError("model")
        questions = exact_keys(value["questions"], {"transition"})
        question = exact_keys(questions["transition"], {"type", "instructions", "criteria"})
        if question["type"] != "choice":
            raise ValueError("question")
        criteria = question["criteria"]
        if not isinstance(criteria, dict) or not 1 <= len(criteria) <= limits.max_candidates:
            raise ValueError("candidates")
        if any(not key for key in criteria):
            raise ValueError("candidate id")
        return value
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
        raise ServiceError(422, "invalid_system_one_request") from None


def preparation(request: str, ids: list[int], *, tokenizer: str, serialization: str, limits: Limits, vocabulary: set[int]) -> dict:
    """Build evidence from the complete locally encoded sequence, never from client ids."""
    if not ids or len(ids) > limits.max_input_tokens:
        raise ServiceError(422, "input_token_limit")
    if any(type(token) is not int or token not in vocabulary for token in ids):
        raise ServiceError(503, "invalid_encoder_output")
    return {"requestDigest": digest(request.encode("utf-8")), "tokenizer": tokenizer, "serialization": serialization,
            "inputTokens": len(ids), "maxInputTokens": limits.max_input_tokens, "tokenIds": ids}


def validate_preparation(supplied: object, expected: dict):
    """Check exact field types as well as equality (JSON booleans are not token integers)."""
    try:
        exact_keys(supplied, set(expected))
        integer(supplied["inputTokens"])
        integer(supplied["maxInputTokens"])
        if not isinstance(supplied["tokenIds"], list):
            raise ValueError("ids")
        for token in supplied["tokenIds"]:
            integer(token, 0)
        if supplied != expected:
            raise ValueError("drift")
    except (ValueError, TypeError, KeyError):
        raise ServiceError(422, "preparation_mismatch") from None


def validate_probabilities(values: list, keys: list[str]) -> dict:
    """Reject incomplete or non-finite official model probabilities without normalization."""
    if len(values) != len(keys) or any(type(p) not in (int, float) or not math.isfinite(p) or not 0 <= p <= 1 for p in values):
        raise ServiceError(503, "invalid_model_probabilities")
    if abs(sum(values) - 1) > 1e-6:
        raise ServiceError(503, "invalid_model_probabilities")
    return dict(zip(keys, values, strict=True))


def identity(data: dict, limits: Limits, vocab_size: int) -> dict:
    """Project the actual manifest and loaded vocabulary into the public identity subset."""
    return {"model": data["model"]["id"], "wireModel": data["model"]["wireModel"], "encoder": data["model"]["encoder"],
            "tokenizer": data["tokenizer"], "serialization": data["serialization"], "dtype": data["recipe"]["dtype"],
            "serviceCaps": {"maxInputTokens": limits.max_input_tokens, "vocabSize": vocab_size,
                            "maxCandidates": limits.max_candidates, "maxRequestBytes": limits.max_request_bytes,
                            "maxResponseBytes": limits.max_response_bytes, "maxQueueSize": limits.queue_size,
                            "requestTimeoutMs": round(1000 * (limits.queue_timeout + limits.execution_timeout)),
                            "executionTimeoutMs": round(1000 * limits.execution_timeout)}}
