"""Compile the production HA number entries and round-trip their Jinja commands.

Requires a C++17 host compiler (CXX or c++) and Jinja2.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

from jinja2 import Environment, StrictUndefined

ROOT = Path(__file__).resolve().parents[2]


class RegulationWindowsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = (ROOT / 'src/Modules/PoolLogicModule/PoolLogicLifecycle.cpp').read_text(encoding='utf-8')
        entries = re.findall(r'const HANumberEntry (\w+)\{(.*?)\n        \};', source, re.S)
        selected = [(name, body) for name, body in entries
                    if '"pl_ph_window"' in body or '"pl_dis_window"' in body]
        if len(selected) != 2:
            raise AssertionError('Both production window entries must be registered')
        definitions = '\n'.join(f'const HANumberEntry {name}{{{body}\n}};' for name, body in selected)
        names = ', '.join(name for name, _ in selected)
        harness = r'''
#include "Core/Services/IHA.h"
#include <cstdio>
namespace MqttTopics { constexpr const char* SuffixCfgSet = "cfg/set"; }
'''+definitions+r'''
int main() {
    const HANumberEntry entries[] = {'''+names+r'''};
    for (const auto& e : entries) {
        // Match the existing Discovery serializer: templates are JSON fragments.
        std::printf("{\"id\":\"%s\",\"topic\":\"%s\",\"value\":\"%s\","
                    "\"command\":\"%s\",\"unit\":\"%s\","
                    "\"min\":%g,\"max\":%g,\"step\":%g}\n",
                    e.objectSuffix, e.stateTopicSuffix, e.valueTemplate,
                    e.commandTemplate, e.unit, e.minValue, e.maxValue, e.step);
    }
}
'''
        with tempfile.TemporaryDirectory() as directory:
            main = Path(directory) / 'windows.cpp'
            binary = Path(directory) / ('windows.exe' if os.name == 'nt' else 'windows')
            main.write_text(harness, encoding='utf-8')
            subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++17', '-Isrc',
                            str(main), '-o', str(binary)], cwd=ROOT, check=True,
                           capture_output=True, text=True)
            output = subprocess.check_output([str(binary)], text=True)
        cls.entries = [json.loads(line) for line in output.splitlines()]
        cls.env = Environment(undefined=StrictUndefined)

    def test_seconds_round_trip_and_identity(self):
        for entry, branch, key in zip(self.entries, ('ph', 'chlorine'), ('ph_window_ms', 'dis_window_ms')):
            self.assertEqual(entry['id'], 'pl_ph_window' if branch == 'ph' else 'pl_dis_window')
            self.assertEqual(entry['topic'], 'cfg/poollogic/' + branch)
            self.assertEqual(entry['unit'], 's')
            self.assertEqual((entry['min'], entry['max'], entry['step']), (1, 10800, 1))
            for seconds in (1, 30, 90, 1800, 10800):
                with self.subTest(channel=branch, seconds=seconds):
                    command = json.loads(self.env.from_string(entry['command']).render(value=str(seconds)))
                    self.assertEqual(command, {'poollogic/' + branch: {key: seconds * 1000}})
                    state = self.env.from_string(entry['value']).render(value_json=command['poollogic/' + branch])
                    self.assertEqual(int(state), seconds)


if __name__ == '__main__':
    unittest.main(verbosity=2)
