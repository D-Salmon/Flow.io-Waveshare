#!/usr/bin/env python3
"""Exercise production persistence/reset code with simulated acquisition and flash tasks."""
import os
import pathlib
import subprocess
import tempfile
import unittest
ROOT = pathlib.Path(__file__).resolve().parents[2]

class PulsePersistenceTests(unittest.TestCase):
    def test_task_and_flash_scenarios(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp = pathlib.Path(directory)
            source = (ROOT / 'src/Modules/IOModule/IOPulsePersistence.cpp').read_text()
            (tmp / 'persistence.cpp').write_text(source.replace('#include "IOModule.h"', '#include "fixture.h"', 1))
            (tmp / 'Core').mkdir()
            (tmp / 'Core/ModuleLog.h').write_text('#pragma once\n#define LOGW(...) ((void)0)\n')
            binary = tmp / 'pulse-persistence'
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            *([] if os.name == 'nt' else ['-fsanitize=address,undefined']), '-g', f'-I{tmp}',
                            '-Itest/host/pulse_persistence', '-Isrc', '-Iinclude',
                            '-I.pio/libdeps/Flowio-waveshare-esp32-s3/ArduinoJson/src',
                            str(tmp / 'persistence.cpp'), 'test/host/pulse_persistence/scenarios.cpp',
                            '-o', str(binary)], cwd=ROOT, check=True)
            subprocess.run([str(binary)], cwd=ROOT, check=True)

if __name__ == '__main__':
    unittest.main()
