"""Run the production patch transaction with operator and administrator roles."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
ARDUINO_JSON = Path(os.environ.get("FLOWIO_ARDUINO_JSON",
    ROOT / ".pio/libdeps/Flowio-waveshare-esp32-s3/ArduinoJson/src"))

PREAMBLE = r'''
#include <ArduinoJson.h>
#include "Core/PsramJsonAllocator.h"
#include "Core/ConfigTypes.h"
#include <cassert>
#include <cstring>
#include <cstdlib>
namespace Log {
template<class... T> void warn(T...) {}
template<class... T> void debug(T...) {}
}
constexpr int LOG_MODULE_ID = 0;
enum class TrackedBufferId { ConfigApplyJsonDoc };
namespace BufferUsageTracker { template<class... T> void note(T...) {} }
void reportApplyJsonDocPeak_(size_t, size_t) {}
class ConfigStore {
public:
    ConfigMeta* _meta;
    uint16_t _metaCount;
    bool _prefs = true;
    unsigned persisted = 0, notified = 0;
    bool applyJson(const char*, ConfigWriteAccess = ConfigWriteAccess::Administrator, bool* = nullptr);
    template<class... T> void putInt_(T...) { ++persisted; }
    template<class... T> void putUShort_(T...) { ++persisted; }
    template<class... T> void putUChar_(T...) { ++persisted; }
    template<class... T> void putBool_(T...) { ++persisted; }
    template<class... T> void putFloat_(T...) { ++persisted; }
    template<class... T> void putBytes_(T...) { ++persisted; }
    template<class... T> void putString_(T...) { ++persisted; }
    template<class... T> void notifyChanged(T...) { ++notified; }
};
'''

PROGRAM = r'''
int main() {
    float setpoint = 27;
    uint16_t binding = 1;
    ConfigMeta meta[2]{};
    meta[0].module = "poollogic/heater";
    meta[0].name = "heater_setpoint";
    meta[0].nvsKey = "heat_sp";
    meta[0].type = ConfigType::Float;
    meta[0].persistence = ConfigPersistence::Persistent;
    meta[0].writeAccess = ConfigWriteAccess::Operator;
    meta[0].valuePtr = &setpoint;
    meta[1].module = "poollogic/devices";
    meta[1].name = "heat_pd";
    meta[1].nvsKey = "heat_pd";
    meta[1].type = ConfigType::UInt16;
    meta[1].persistence = ConfigPersistence::Persistent;
    meta[1].valuePtr = &binding;
    ConfigStore store{meta,2};
    bool denied = true;
    assert(store.applyJson(R"({"poollogic/heater":{"heater_setpoint":28.5}})", ConfigWriteAccess::Operator, &denied));
    assert(!denied && setpoint == 28.5 && store.persisted == 1 && store.notified == 1);
    const char* forbidden[] = {
        R"({"poollogic/devices":{"heat_pd":6}})",
        R"({"poollogic/heater":{"heater_setpoint":30},"poollogic/devices":{"heat_pd":6}})",
        R"({"poollogic/heater":{"heater_setpoint":30,"unknown":1}})",
        R"({"poollogic/heater":{"heater_setpoint":30},"io/output/d00":{"port":4}})",
        R"({"poollogic/heater":30})"
    };
    for (const char* patch : forbidden) {
        denied = false;
        assert(!store.applyJson(patch, ConfigWriteAccess::Operator, &denied));
        assert(denied && setpoint == 28.5 && binding == 1);
        assert(store.persisted == 1 && store.notified == 1);
    }
    assert(store.applyJson(R"({"poollogic/devices":{"heat_pd":6}})", ConfigWriteAccess::Administrator, &denied));
    assert(!denied && binding == 6 && store.persisted == 2 && store.notified == 2);
    assert(store.applyJson(R"({"poollogic/heater":{"heater_setpoint":28.5}})", ConfigWriteAccess::Operator, &denied));
    assert(store.persisted == 2 && store.notified == 2); // unchanged value: no extra writes
    assert(!store.applyJson("invalid", ConfigWriteAccess::Operator, &denied));
    assert(!denied);
}
'''


class ConfigWriteAccessTest(unittest.TestCase):
    def test_transaction(self):
        source = (ROOT / "src/Core/ConfigStore.cpp").read_text(encoding="utf-8")
        start = source.index("bool ConfigStore::applyJson(")
        # applyJson is the last method in this translation unit.
        with tempfile.TemporaryDirectory(prefix="flow-config-access-") as directory:
            work = Path(directory)
            cpp, binary = work / "main.cpp", work / "test.exe"
            cpp.write_text(PREAMBLE + source[start:] + PROGRAM, encoding="utf-8")
            subprocess.run([
                os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra", "-Werror",
                "-I", str(ROOT / "src"), "-I", str(ARDUINO_JSON),
                "-I", str(ROOT / "include"), str(cpp),
                str(ROOT / "test/host/json_allocator.cpp"), "-o", str(binary),
            ], check=True)
            subprocess.run([str(binary)], check=True)


if __name__ == "__main__":
    unittest.main()
