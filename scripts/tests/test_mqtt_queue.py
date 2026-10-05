"""Execute production MQTT scheduling/dispatch methods with deterministic host fakes.

Only hardware, time and producer callbacks are replaced. Interleavings are injected
while the actual dispatcher releases its lock to build/publish a message.
"""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / 'src/Modules/Network/MQTTModule'


def method(source, name):
    start = source.index('MQTTModule::' + name + '(')
    start = source.rfind('\n', 0, start) + 1
    end = source.index('\n}', start) + 2
    return source[start:end]


class MqttQueueTests(unittest.TestCase):
    def test_scheduling_and_dispatch(self):
        header = (MODULE / 'MQTTModule.h').read_text()
        source = (MODULE / 'MQTTQueue.cpp').read_text()
        names = ['findJobSlot_', 'allocJobSlot_', 'queuePush_', 'queuePop_',
                 'queueSlot_', 'deferJob_', 'releaseJob_', 'retryPendingJobsNoLock_',
                 'snapshotQueueStatsNoLock_', 'logEnqueueIssue_', 'enqueueJob_',
                 'enqueue', 'dequeueNextJob_', 'processJobs_']
        bodies = [method(source, name) for name in names]
        declarations = '\n'.join(body[:body.index('\n{')].replace('MQTTModule::', '') + ';'
                                 for body in bodies)
        # Keep the production default argument used by enqueue diagnostics.
        declarations = declarations.replace('JobStateCounts* states)', 'JobStateCounts* states = nullptr)')
        types = header[header.index('    enum class JobState'):header.index('    struct ScratchBuffers')]
        fixture = (ROOT / 'test/host/mqtt_queue.cpp').read_text()
        code = fixture.replace('// PRODUCTION_TYPES', types).replace('// PRODUCTION_DECLARATIONS', declarations)
        code = code.replace('// PRODUCTION_METHODS', '\n\n'.join(bodies))
        with tempfile.TemporaryDirectory(prefix='flow-mqtt-queue-') as tmp:
            cpp = Path(tmp) / 'mqtt_queue.cpp'
            cpp.write_text(code)
            binary = Path(tmp) / 'test'
            base = ['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                    '-Isrc', str(cpp), '-o', str(binary)]
            sanitized = subprocess.run(
                base[:1] + ['-fsanitize=address,undefined', '-fno-omit-frame-pointer'] + base[1:],
                cwd=ROOT, capture_output=True, text=True)
            if sanitized.returncode == 0:
                compile_result = sanitized
                test_result = subprocess.run([str(binary)], cwd=ROOT, capture_output=True, text=True)
            elif 'cannot find -lasan' in sanitized.stderr or 'cannot find -lubsan' in sanitized.stderr:
                # Some Windows GCC distributions omit sanitizer runtimes; keep
                # the deterministic logic test available there without them.
                compile_result = subprocess.run(base, cwd=ROOT, capture_output=True, text=True)
                test_result = (subprocess.run([str(binary)], cwd=ROOT, capture_output=True, text=True)
                               if compile_result.returncode == 0 else compile_result)
            else:
                compile_result = sanitized
                test_result = sanitized
            self.assertEqual(compile_result.returncode, 0, compile_result.stdout + compile_result.stderr)
            self.assertEqual(test_result.returncode, 0, test_result.stdout + test_result.stderr)
            if test_result.stdout:
                print(test_result.stdout, end='')


if __name__ == '__main__':
    unittest.main()
