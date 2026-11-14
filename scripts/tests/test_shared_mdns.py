"""Exercise the production responder ownership across network transitions."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SharedMdnsTests(unittest.TestCase):
    def test_interface_transitions(self):
        program = r'''
#include "Core/SharedMdns.h"
#include <cassert>
#include <string>
struct FakeResponder {
    int starts = 0, stops = 0;
    bool running = false, fail = false;
    std::string host;
    bool begin(const char* name) {
        ++starts;
        if (fail) return false;
        running = true; host = name; return true;
    }
    void end() { ++stops; running = false; }
};
int main() {
    for (bool ethernetFirst : {false, true}) {
        FakeResponder backend;
        SharedMdns<FakeResponder> mdns(backend);
        auto first = ethernetFirst ? MdnsInterface::Ethernet : MdnsInterface::Wifi;
        auto second = ethernetFirst ? MdnsInterface::Wifi : MdnsInterface::Ethernet;
        assert(mdns.acquire(first, "flowio"));
        assert(mdns.acquire(second, "flowio"));
        assert(backend.starts == 1);
        mdns.release(first);
        assert(backend.running && backend.stops == 0);
        assert(mdns.acquire(second, "flowio"));
        assert(backend.starts == 1);
        assert(mdns.acquire(first, "flowio"));
        mdns.release(second);
        assert(backend.running && backend.stops == 0);
        assert(mdns.acquire(first, "new-name"));
        assert(backend.host == "new-name" && backend.starts == 2 && backend.stops == 1);
        mdns.release(first);
        assert(!backend.running && backend.stops == 2);
        backend.fail = true;
        assert(!mdns.acquire(first, "flowio"));
        backend.fail = false;
        assert(mdns.acquire(second, "flowio"));
        mdns.release(second);
        assert(!backend.running); // Failed acquisition must not keep a phantom owner.
        assert(mdns.acquire(first, "flowio"));
        backend.fail = true;
        assert(!mdns.acquire(first, "renamed"));
        backend.fail = false;
        assert(mdns.acquire(first, "renamed"));
        assert(backend.running && backend.host == "renamed");
        mdns.release(first);
        mdns.release(first);
        assert(!backend.running);
    }
}
'''
        with tempfile.TemporaryDirectory(prefix='flow-mdns-') as folder:
            source, exe = Path(folder) / 'mdns.cpp', Path(folder) / 'mdns.exe'
            source.write_text(program, encoding='utf-8')
            compiler = shutil.which('g++') or 'C:/msys64/ucrt64/bin/g++.exe'
            subprocess.run([compiler, '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            '-I' + str(ROOT / 'src'), str(source), '-o', str(exe)], check=True)
            subprocess.run([str(exe)], check=True)


if __name__ == '__main__':
    unittest.main()
