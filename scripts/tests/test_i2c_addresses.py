#!/usr/bin/env python3
"""Exercise I2C address arbitration and verify UI/persistence coverage."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
DRIVERS = ['ads1115_int', 'ads1115_ext', 'sht40', 'bmp280', 'bme680', 'ina226'] + [f'expander{i:02d}' for i in range(4)]

class I2cAddressTests(unittest.TestCase):
    def test_module_bus_plan(self):
        source = (ROOT / 'src/Modules/IOModule/IOI2cAddresses.cpp').read_text(encoding='utf-8')
        production = source[source.index('void IOModule::resolveI2cAddresses_'):]
        harness = (ROOT / 'test/host/i2c_module_plan.cpp').read_text(encoding='utf-8')
        with tempfile.TemporaryDirectory() as directory:
            cpp = Path(directory) / 'plan.cpp'
            binary = Path(directory) / 'plan'
            cpp.write_text(harness + '\n' + production, encoding='utf-8')
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            '-Wno-unused-but-set-variable',
                            *(['-fsanitize=address,undefined'] if os.name != 'nt' else []),
                            '-Isrc', '-Iinclude', str(cpp), '-o', str(binary)], cwd=ROOT, check=True)
            subprocess.run([str(binary)], check=True)

    def test_configuration_capacity(self):
        import re
        import importlib.util
        limits = (ROOT / 'include/Core/SystemLimits.h').read_text(encoding='utf-8')
        capacity = int(re.search(r'MaxConfigVars = (\d+)', limits).group(1))
        # The SPIFFS packer removes the generated JSON after splitting it into
        # chunks. Load canonical definitions rather than a transient build file.
        spec = importlib.util.spec_from_file_location('config_docs', ROOT / 'scripts/generate_config_docs.py')
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        docs, _, _ = generator._load_text_docs(ROOT / 'src', stem='cfgdocs', locale='fr')
        generator._expand_value_slot_docs(docs, generator.VALUE_DERIVED_LAST_SLOT)
        generator._expand_digital_input_slot_docs(docs, generator.WAVESHARE_DIGITAL_INPUT_LAST_SLOT)
        generator._prune_io_slot_docs(docs, analog_last=generator.WAVESHARE_ANALOG_LAST_SLOT,
                                     digital_last=generator.WAVESHARE_DIGITAL_INPUT_LAST_SLOT,
                                     output_last=generator.WAVESHARE_DIGITAL_OUTPUT_LAST_SLOT)
        generator._prune_pool_device_docs(docs, last_slot=7)
        self.assertLessEqual(len(docs) + 16, capacity)

    def test_arbitration(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'i2c-addresses'
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            *(['-fsanitize=address,undefined'] if os.name != 'nt' else []), '-g', '-Isrc',
                            'test/host/i2c_address_selection.cpp', '-o', str(binary)],
                           cwd=ROOT, check=True)
            subprocess.run([str(binary)], check=True)

    def test_ui_address_fields(self):
        base = ROOT / 'src/Modules/IOModule/text'
        docs = json.loads((base / 'cfgdocs.fr.json').read_text())['docs']
        forms = json.loads((base / 'cfgmods.fr.json').read_text())['docs']
        for locale in ['fr', 'en']:
            strings = json.loads((base / f'i18n.{locale}.json').read_text())['translations']
            for driver in DRIVERS:
                for field in ['address', 'secondary_address']:
                    path = f'io/drivers/{driver}/{field}'
                    self.assertEqual(docs[path]['type'], 'UInt8')
                    self.assertEqual(forms[path]['display_format'], 'hex')
                    for key in ['label_t', 'help_t']:
                        self.assertTrue(strings[docs[path][key]])

if __name__ == '__main__':
    unittest.main()
