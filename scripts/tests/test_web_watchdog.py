"""Exercise the production watchdog snapshot/age calculation with controlled time."""
from pathlib import Path
import subprocess
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[2]

class WebWatchdogTests(unittest.TestCase):
    def test_snapshot_and_rollover(self):
        source = (ROOT / 'src/Modules/System/SystemMonitorModule/SystemMonitorModule.cpp').read_text()
        start = source.index('    WebInterfaceHealth health{};', source.index('void SystemMonitorModule::pollWebWatchdog_'))
        end = source.index('    // A connected but idle', start)
        code = (ROOT / 'test/host/web_watchdog.cpp').read_text().replace('// PRODUCTION_CALCULATION', source[start:end])
        with tempfile.TemporaryDirectory() as tmp:
            cpp = Path(tmp) / 'watchdog.cpp'
            cpp.write_text(code)
            binary = Path(tmp) / 'test'
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            '-fsanitize=address,undefined', str(cpp), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)

if __name__ == '__main__':
    unittest.main()
