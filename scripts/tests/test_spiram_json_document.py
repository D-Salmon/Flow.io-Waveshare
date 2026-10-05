"""ArduinoJson 7: owning views, PSRAM failure, fallback and malformed input."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
ARDUINO_JSON = ROOT / '.pio/libdeps/Flowio-waveshare-esp32-s3/ArduinoJson/src'
HEAP_HEADER = r'''
#pragma once
#include <cassert>
#include <cstdlib>
#include <cstddef>
constexpr unsigned MALLOC_CAP_SPIRAM = 1, MALLOC_CAP_8BIT = 2, MALLOC_CAP_INTERNAL = 4;
inline bool failAllocation = false;
inline unsigned liveAllocations = 0;
inline void* heap_caps_malloc(size_t bytes, unsigned) {
    if (failAllocation) return nullptr;
    auto* p = std::malloc(bytes); if (p) ++liveAllocations; return p;
}
inline void heap_caps_free(void* p) { if (p) { assert(liveAllocations); --liveAllocations; } std::free(p); }
inline void* heap_caps_realloc(void* p, size_t bytes, unsigned caps) {
    if (!p) return heap_caps_malloc(bytes, caps);
    if (!bytes) { heap_caps_free(p); return nullptr; }
    if (failAllocation) return nullptr;
    return std::realloc(p, bytes);
}
inline void* heap_caps_malloc_prefer(size_t bytes, unsigned, unsigned first, unsigned second) {
    auto* p = heap_caps_malloc(bytes, first);
    if (p) return p;
    bool previous = failAllocation; failAllocation = false;
    p = heap_caps_malloc(bytes, second); failAllocation = previous; return p;
}
inline void* heap_caps_realloc_prefer(void* p, size_t bytes, unsigned, unsigned first, unsigned second) {
    auto* resized = heap_caps_realloc(p, bytes, first);
    if (resized) return resized;
    bool previous = failAllocation; failAllocation = false;
    resized = heap_caps_realloc(p, bytes, second); failAllocation = previous; return resized;
}
'''
PROGRAM = r'''
#include "Core/PsramJsonAllocator.h"
#include <esp_heap_caps.h>
#include <cassert>
#include <cstring>
int main() {
    {
        JsonDocument first(psramOnlyJsonAllocator());
        assert(!deserializeJson(first, R"({"args":{"id":42,"value":"first"}})"));
        JsonObjectConst view = first["args"];
        const auto initialAllocations = liveAllocations;
        {
            JsonDocument second(psramOnlyJsonAllocator());
            assert(!deserializeJson(second, R"({"id":7,"value":"second"})"));
            assert(liveAllocations > initialAllocations);
            assert(view["id"].as<int>() == 42);
        }
        assert(liveAllocations == initialAllocations);
        assert(std::strcmp(view["value"], "first") == 0);
    }
    assert(liveAllocations == 0);
    failAllocation = true;
    {
        JsonDocument only(psramOnlyJsonAllocator());
        assert(deserializeJson(only, R"({"id":42})") == DeserializationError::NoMemory);
        assert(liveAllocations == 0);
        JsonDocument fallback(psramPreferredJsonAllocator());
        assert(!deserializeJson(fallback, R"({"id":42})"));
        assert(fallback["id"].as<int>() == 42);
    }
    failAllocation = false;
    assert(liveAllocations == 0);
    {
        JsonDocument doc(psramOnlyJsonAllocator());
        assert(deserializeJson(doc, "{invalid") != DeserializationError::Ok);
        assert(!deserializeJson(doc, R"({"id":42})"));
        doc.shrinkToFit();
        char out[32]{}; serializeJson(doc, out, sizeof(out));
        assert(std::strcmp(out, R"({"id":42})") == 0);
    }
    assert(liveAllocations == 0);
}
'''

class PsramJsonAllocatorTest(unittest.TestCase):
    def test_lifetime_failure_fallback_and_parsing(self):
        with tempfile.TemporaryDirectory(prefix='flow-json7-') as directory:
            work = Path(directory)
            (work / 'esp_heap_caps.h').write_text(HEAP_HEADER, encoding='utf-8')
            (work / 'main.cpp').write_text(PROGRAM, encoding='utf-8')
            executable = work / 'test.exe'
            subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                '-I', str(work), '-I', str(ROOT/'src'), '-I', str(ARDUINO_JSON),
                str(work/'main.cpp'), str(ROOT/'src/Core/PsramJsonAllocator.cpp'),
                '-o', str(executable)], check=True)
            subprocess.run([str(executable)], check=True)

if __name__ == '__main__': unittest.main()
