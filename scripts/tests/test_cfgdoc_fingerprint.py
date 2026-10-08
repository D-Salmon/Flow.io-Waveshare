"""Documentation-only and translation-only updates must invalidate browser caches."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("cfgdoc_chunks", ROOT / "scripts/generate_cfgdoc_chunks.py")
chunks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chunks)


class FingerprintTest(unittest.TestCase):
    def test_bundle_matches_individual_modules(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            web, output, modules = root / "web", root / "wc", root / "modules"
            web.mkdir()
            fields = {
                "system": {"label": "System"},
                "*/name": {"label": "Name"},
                "poollogic/heater/enabled": {"type": "bool", "label_t": "heater.enabled"},
                "poollogic/swg/min_temp": {"type": "float", "min": 0, "max": 40, "step": 0.5},
                "io/output/d00/name": {"type": "string"},
            }
            (web / "cfgdocs.json").write_text(json.dumps({"docs": fields}))
            with patch.multiple(chunks, WEB_DIR=web, CFGDOC_DIR=output, SRC_MODULES_DIR=modules):
                with contextlib.redirect_stdout(io.StringIO()):
                    chunks.main()
                index = json.loads((output / "i.j").read_text())
                group = index["bundles"]["poollogic"]
                payload = json.loads((output / index["modules"][group["module"]]).read_text())
                self.assertEqual(set(payload["modules"]), {"__root", "__wildcard", "poollogic/heater", "poollogic/swg"})
                for key, source in payload["modules"].items():
                    self.assertEqual(source, json.loads((output / index["modules"][key]).read_text()))
                first = (output / "v.j").read_bytes()
                fields["poollogic/robot/enabled"] = {"type": "bool"}
                (web / "cfgdocs.json").write_text(json.dumps({"docs": fields}))
                with contextlib.redirect_stdout(io.StringIO()):
                    chunks.main()
                updated = json.loads((output / "i.j").read_text())
                self.assertIn("poollogic/robot", updated["bundles"]["poollogic"]["members"])
                self.assertNotEqual(first, (output / "v.j").read_bytes())

    def test_content_changes_and_reproducibility(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            web, output, modules = root / "web", root / "wc", root / "modules"
            web.mkdir()
            text = modules / "Example/text"
            text.mkdir(parents=True)
            docs = web / "cfgdocs.json"
            translation = text / "i18n.fr.json"
            docs.write_text(json.dumps({"docs": {"example/field": {"help": "First help"}}}))
            translation.write_text(json.dumps({"label": "First label"}))

            def generate():
                with contextlib.redirect_stdout(io.StringIO()):
                    chunks.main()
                return (output / "v.j").read_bytes(), (output / "i.j").read_bytes()

            with patch.multiple(chunks, WEB_DIR=web, CFGDOC_DIR=output, SRC_MODULES_DIR=modules):
                first, index = generate()
                self.assertEqual((first, index), generate(), "An identical rebuild must retain its cache key")
                docs.write_text(json.dumps({"docs": {"example/field": {"help": "Updated help"}}}))
                help_changed, same_index = generate()
                self.assertEqual(index, same_index, "The index alone does not identify help changes")
                self.assertNotEqual(first, help_changed)
                translation.write_text(json.dumps({"label": "Updated label"}))
                translation_changed, _ = generate()
                self.assertNotEqual(help_changed, translation_changed)
                self.assertEqual(translation_changed, generate()[0])


if __name__ == "__main__":
    unittest.main()
