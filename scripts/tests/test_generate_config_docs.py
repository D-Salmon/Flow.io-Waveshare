import json
import runpy
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "generate_config_docs.py"
MODULE = runpy.run_path(str(SCRIPT), init_globals={"Import": lambda name: None, "env": None})


class ConfigDocsWaveshareSlotTests(unittest.TestCase):
    def test_pool_devices_cover_all_sixteen_outputs(self):
        root = SCRIPT.parents[1]
        manifest = json.loads((root / "src/Modules/PoolLogicModule/text/cfgmods.fr.json").read_text())
        result = MODULE["_apply_profile_specific_io_enum_sets"](manifest["meta"], "waveshare")
        entries = result["enum_sets"]["poollogic_device_slot"]
        self.assertEqual(list(range(16)), [item["value"] for item in entries])
        self.assertEqual("pd15 -> d15 [15]", entries[-1]["label"])
        docs = {f"pdm/pd{slot}/enabled": {} for slot in range(17)}
        MODULE["_prune_pool_device_docs"](docs, MODULE["WAVESHARE_DIGITAL_OUTPUT_LAST_SLOT"])
        self.assertEqual(16, len(docs))
        self.assertIn("pdm/pd15/enabled", docs)

    def test_waveshare_analog_configuration_keeps_a20_and_prunes_a21(self):
        docs = {
            "io/input/a15/a15_name": {},
            "io/input/a16/a16_name": {},
            "io/input/a20/a20_name": {},
            "io/input/a21/a21_name": {},
        }

        MODULE["_prune_io_slot_docs"](
            docs,
            analog_last=MODULE["WAVESHARE_ANALOG_LAST_SLOT"],
            digital_last=MODULE["WAVESHARE_DIGITAL_INPUT_LAST_SLOT"],
            output_last=MODULE["WAVESHARE_DIGITAL_OUTPUT_LAST_SLOT"],
        )

        self.assertIn("io/input/a16/a16_name", docs)
        self.assertIn("io/input/a20/a20_name", docs)
        self.assertNotIn("io/input/a21/a21_name", docs)

    def test_waveshare_analog_configuration_tree_ends_at_a20(self):
        meta = {
            "cfg_tree_aliases": [
                {"display": "io/input/analog/a20", "store": "io/input/a20"},
                {"display": "io/input/analog/a21", "store": "io/input/a21"},
            ],
            "cfg_tree_virtual_branches": [{
                "display": "io/input/analog",
                "children": ["a19", "a20", "a21"],
            }],
        }

        result = MODULE["_prune_io_slot_meta"](
            meta,
            analog_last=MODULE["WAVESHARE_ANALOG_LAST_SLOT"],
            digital_last=MODULE["WAVESHARE_DIGITAL_INPUT_LAST_SLOT"],
            output_last=MODULE["WAVESHARE_DIGITAL_OUTPUT_LAST_SLOT"],
        )

        self.assertEqual(
            ["io/input/analog/a20"],
            [item["display"] for item in result["cfg_tree_aliases"]],
        )
        self.assertEqual(["a19", "a20"], result["cfg_tree_virtual_branches"][0]["children"])


if __name__ == "__main__":
    unittest.main()
