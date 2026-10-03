"""Production loader argument/identity tests using lightweight module substitutes."""

from contextlib import ExitStack
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from dsh_decision_service.backend import LocalBackend, OFFICIAL_FILES
from support import limits


class BackendLoaderTests(unittest.TestCase):
    def test_cpu_loader_uses_explicit_local_base_adapter_head_and_recorded_temperature(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base, adapter, kev = [root / name for name in ("base", "adapter", "kev")]
            for path in (base, adapter, kev):
                path.mkdir()
            revision = "a" * 40
            base_id = "Qwen/Qwen3.5-4B-Base"
            (base / "config.json").write_text('{}')
            (adapter / "adapter_config.json").write_text(json.dumps({"base_model_name_or_path": base_id, "revision": None,
                "peft_type": "LORA", "task_type": "FEATURE_EXTRACTION", "r": 16}))
            (adapter / "training_config.json").write_text(json.dumps({"base_revision": revision}))
            meta = SimpleNamespace(base=base_id, base_revision=revision, weights="lora", weights_dtype="fp32",
                                   option_isolation=False, special_embeddings=False, head_dim=256, lora=16,
                                   temperature=1.25, head={"q": "synthetic"})
            weight = SimpleNamespace(shape=(2, 2))
            lm = SimpleNamespace()
            lm.to = Mock(return_value=lm)
            model = SimpleNamespace(lm=lm, head=SimpleNamespace(load_state_dict=Mock()), dtype="float32",
                                    eval=Mock(), parameters=lambda: [SimpleNamespace(device=SimpleNamespace(type="cpu"), dtype="float32")])
            factory = Mock(return_value=model)
            special = ["s", "q", "o", "c", "d"]
            modules = {
                "kev.api": SimpleNamespace(__file__=str(kev / "api.py")),
                "kev.model": SimpleNamespace(__file__=str(kev / "model.py"), DecisionModel=factory, SPECIAL=special),
                "kev.checkpoint": SimpleNamespace(__file__=str(kev / "checkpoint.py"), Meta=SimpleNamespace(from_dict=lambda value: value)),
                "torch": SimpleNamespace(float32="float32", load=Mock(return_value=meta), set_num_threads=Mock(),
                                         set_num_interop_threads=Mock(), set_default_dtype=Mock(), use_deterministic_algorithms=Mock()),
                "peft": SimpleNamespace(PeftConfig=SimpleNamespace(from_pretrained=Mock(return_value=SimpleNamespace())),
                                        PeftModel=SimpleNamespace(from_pretrained=Mock(return_value=lm)),
                                        get_peft_model_state_dict=lambda _: {"adapter": weight}),
                "safetensors.torch": SimpleNamespace(load_file=Mock(return_value={"adapter": weight})),
            }
            instance = LocalBackend.__new__(LocalBackend)
            instance.manifest = SimpleNamespace(paths={"base": base, "adapter": adapter, "kev": kev})
            instance.data = {"artifacts": {"base": {"revision": revision, "repository": base_id}, "kev": {"files": OFFICIAL_FILES}},
                             "recipe": {"temperature": 1.25}}
            instance.limits = limits()
            instance.tok = SimpleNamespace(convert_tokens_to_ids=special.index, unk_token_id=None)
            instance.vocabulary = set(range(100))
            with ExitStack() as stack:
                stack.enter_context(patch.dict(sys.modules, modules))
                stack.enter_context(patch.object(sys, "path", list(sys.path)))
                instance._load_kev()
                self.assertIs(instance.model, model)
                factory.assert_called_once_with(str(base), instance.tok, "cpu", lora=None, revision=revision,
                                                head_dim=256, option_isolation=False, dtype="float32", attn="eager")
                modules["torch"].load.assert_called_once_with(adapter / "head.pt", map_location="cpu", weights_only=True)
                self.assertEqual(model.head.temperature, 1.25)
                model.head.load_state_dict.assert_called_once_with(meta.head, strict=True)
                arguments = modules["peft"].PeftModel.from_pretrained.call_args
                self.assertEqual(arguments.args[1], str(adapter))
                self.assertEqual(arguments.kwargs["config"].base_model_name_or_path, str(base))
                self.assertEqual(arguments.kwargs["config"].revision, revision)
                self.assertTrue(arguments.kwargs["local_files_only"])
                meta.base_revision = "b" * 40
                with self.assertRaises(ValueError):
                    instance._load_kev()
                self.assertEqual(factory.call_count, 1)
                meta.base_revision = revision
                meta.temperature = 9.0
                with self.assertRaises(ValueError):
                    instance._load_kev()
                self.assertEqual(factory.call_count, 1)

    def test_tokenizer_only_loader_has_no_model_imports_and_explicit_offline_recipe(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "tokenizer_config.json").write_text('{}')
            tok = SimpleNamespace(get_vocab=lambda: {"a": 1, "special": 9})
            tokenizer = SimpleNamespace(from_pretrained=Mock(return_value=tok))
            manifest = SimpleNamespace(data={"mode": "tokenizer"}, limits=limits(), paths={"tokenizer": root}, check_unchanged=Mock())
            with patch("dsh_decision_service.backend.offline"), patch("dsh_decision_service.backend.Manifest", return_value=manifest), \
                    patch.dict(sys.modules, {"transformers": SimpleNamespace(AutoTokenizer=tokenizer)}), \
                    patch.dict("os.environ", {}, clear=True):
                result = LocalBackend({"manifest": "unused", "manifest_sha256": "unused"})
                tokenizer.from_pretrained.assert_called_once_with(str(root), local_files_only=True, trust_remote_code=False, use_fast=True)
                self.assertIsNone(result.model)
                self.assertEqual(result.vocab_size, 10)
                self.assertNotIn("torch", sys.modules)


if __name__ == "__main__":
    unittest.main()
