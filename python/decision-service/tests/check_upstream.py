"""Explicit source-only compatibility check; never imports Kev or downloads weights.

Run separately from the offline unit suite. Checks immutable source hashes and
AST signatures against every official API the production backend invokes.
"""

import ast
import hashlib
import urllib.request

from dsh_decision_service.backend import OFFICIAL_FILES
from dsh_decision_service.config import UPSTREAM_SHA


def parameters(node):
    return {arg.arg for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs}


def check():
    modules = {}
    for name, digest in OFFICIAL_FILES.items():
        url = f"https://raw.githubusercontent.com/jaredpalmer/kev/{UPSTREAM_SHA}/kev/{name}"
        with urllib.request.urlopen(url, timeout=30) as response:
            raw = response.read(100000)
        assert hashlib.sha256(raw).hexdigest() == digest, name
        modules[name] = ast.parse(raw)
    def function(file, name):
        return next(node for node in ast.walk(modules[file]) if isinstance(node, ast.FunctionDef) and node.name == name)
    assert parameters(function("model.py", "encode")) >= {"tok", "rec", "max_state", "max_branch", "strict", "option_isolation"}
    model = next(node for node in modules["model.py"].body if isinstance(node, ast.ClassDef) and node.name == "DecisionModel")
    constructor = next(node for node in model.body if isinstance(node, ast.FunctionDef) and node.name == "__init__")
    assert parameters(constructor) >= {"name", "tok", "device", "lora", "revision", "head_dim", "option_isolation", "dtype", "attn"}
    assert parameters(function("model.py", "probs")) == {"self", "enc"}
    assert parameters(function("api.py", "to_record")) == {"req"}
    assert parameters(function("api.py", "to_answers")) == {"probs", "meta"}
    assert parameters(function("api.py", "output_tokens")) == {"tok", "answers"}
    assert parameters(function("checkpoint.py", "from_dict")) == {"cls", "d"}
    adapted = function("checkpoint.py", "_adapted_torch")
    calls = [ast.unparse(node.func) for node in ast.walk(adapted) if isinstance(node, ast.Call)]
    assert "DecisionModel" in calls and "PeftModel.from_pretrained" in calls
    # Execute only the pure official encoder functions with a synthetic tokenizer.
    # No Torch/model imports, tensor creation, weight loading or inference occur.
    names = {"SPECIAL", "MAX_STATE", "MAX_BRANCH", "MAX_PACKED", "_SPECIAL_RE", "OPT_NONE", "OPT_DECIDE",
             "ContextOverflow", "user_tokens", "encode"}
    selected = []
    for node in modules["model.py"].body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names:
            selected.append(node)
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in names for target in ast.walk(node.targets[0])):
            selected.append(node)
    import re
    from types import SimpleNamespace
    namespace = {"re": re}
    exec(compile(ast.Module(body=selected, type_ignores=[]), "official-pure-encoder", "exec"), namespace)
    class Tokenizer:
        def __call__(self, text, *, add_special_tokens):
            assert add_special_tokens is False
            return SimpleNamespace(input_ids=list(text.encode("utf-8")))
        def convert_tokens_to_ids(self, token):
            return 500 + namespace["SPECIAL"].index(token)
    record = {"state": "<|fim_middle|>", "questions": [{"instr": "choose", "options": ["a: A", "b: B"], "label": 0}]}
    encoded = namespace["encode"](Tokenizer(), record, max_state=100, max_branch=200, strict=True, option_isolation=False)
    assert encoded["ids"][0] == 500 and encoded["ids"][-1] == 504
    assert encoded["ids"].count(501) == 1  # caller delimiters were sanitized
    assert len(encoded["ids"]) == len(encoded["seg"]) == len(encoded["pos"]) == len(encoded["opt"])
    assert encoded["pos"] == list(range(len(encoded["ids"])))
    assert len(encoded["opt_idx"][0]) == 2 and not encoded["state_truncated"]
    try:
        namespace["encode"](Tokenizer(), record, max_state=2, max_branch=200, strict=True)
    except namespace["ContextOverflow"]:
        pass
    else:
        raise AssertionError("official encoder silently truncated")
    print(f"Verified immutable Kev hashes, called API signatures and pure encoder at {UPSTREAM_SHA}; no ML imports, weights, or inference.")


if __name__ == "__main__":
    check()
