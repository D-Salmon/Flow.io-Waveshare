"""Execute production mode coupling for every disinfection choice."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

def function(source, signature):
    start = source.index(signature)
    return source[start:source.index('\n}', start) + 2]

class AutomationModesTest(unittest.TestCase):
    def compile_and_run(self, program, extra_includes=()):
        with tempfile.TemporaryDirectory(prefix='flow-automation-') as directory:
            cpp = Path(directory) / 'modes.cpp'
            exe = Path(directory) / 'modes.exe'
            cpp.write_text(program, encoding='utf-8')
            compiler = shutil.which('g++') or 'C:/msys64/ucrt64/bin/g++.exe'
            includes = ['-I' + str(ROOT / 'src'), *['-I' + str(path) for path in extra_includes]]
            subprocess.run([compiler, '-std=c++17', '-Wall', '-Wextra', '-Werror', *includes, str(cpp), '-o', str(exe)], check=True)
            subprocess.run([str(exe)], check=True)

    def test_waveshare_runtime_uses_selected_treatment(self):
        server = (ROOT / 'src/Modules/Network/WebInterfaceModule/WebInterfaceServer.cpp').read_text(encoding='utf-8')
        loader = function(server, 'bool waveshareLoadPoolModeFlags_')
        program = r'''
#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>
#include <ArduinoJson.h>
#include "Core/Services/IPoolConfiguration.h"
ArduinoJson::Allocator* psramPreferredJsonAllocator() { return ArduinoJson::detail::DefaultAllocator::instance(); }
struct ConfigStore {
    std::string modes, ph = "{\"ph_auto_mode\":true}", chlorine;
    bool toJsonModule(const char* path, char* output, size_t size, bool* truncated, bool) const {
        const auto& content = std::strcmp(path,"poollogic/modes")==0 ? modes : std::strcmp(path,"poollogic/ph")==0 ? ph : chlorine;
        const int length = std::snprintf(output,size,"%s",content.c_str());
        *truncated = length < 0 || static_cast<size_t>(length) >= size;
        return !*truncated;
    }
};
''' + loader + r'''
int main() {
    ConfigStore store;
    for (int method=0; method<=3; ++method) for (bool orp : {false,true}) for (bool treatment : {false,true}) {
        char modes[160],chlorine[80];
        std::snprintf(modes,sizeof(modes),"{\"auto_mode\":true,\"disinfection_type\":%d,\"treatment_auto_mode\":%s}",method,treatment?"true":"false");
        std::snprintf(chlorine,sizeof(chlorine),"{\"dis_auto_mode\":%s}",orp?"true":"false");
        store.modes=modes;store.chlorine=chlorine;
        bool available=false,autoMode=false,winter=false,ph=false,disinfection=false;
        assert(waveshareLoadPoolModeFlags_(&store,available,autoMode,winter,ph,disinfection));
        assert(available && autoMode && ph && !winter);
        assert(disinfection == (method==0 ? orp : method==1 || method==2 ? treatment : false));
    }
}
'''
        self.compile_and_run(program, [ROOT / '.pio/libdeps/Flowio-waveshare-esp32-s3/ArduinoJson/src'])

    def test_global_mode_enables_selected_disinfection(self):
        source = (ROOT / 'src/Modules/PoolLogicModule/PoolLogicLifecycle.cpp').read_text(encoding='utf-8')
        functions = '\n'.join(function(source, signature) for signature in [
            'void PoolLogicModule::applyAutoMode_',
            'bool PoolLogicModule::disinfectionAutoMode_',
            'void PoolLogicModule::alignSubordinateAutomationModes_'])
        commands = (ROOT / 'src/Modules/PoolLogicModule/PoolLogicCommands.cpp').read_text(encoding='utf-8')
        start = commands.index('    if (strcmp(cmdName, "poollogic.orp_auto_mode.set")')
        end = commands.index('    if (strcmp(cmdName, "poollogic.heater_auto_mode.set")', start)
        command = r'''
bool PoolLogicModule::command(const char* cmdName, bool requested) {
    char reply[128]; const size_t replyLen = sizeof(reply);
    auto setModeValue = [&](const char*, ConfigVariable<bool, 0>& variable, bool& mirror) {
        *variable.value = requested; mirror = requested; return true;
    };
    auto toggleModeValue = [&](const char*, ConfigVariable<bool, 0>& variable, bool& mirror) {
        mirror = !mirror; *variable.value = mirror; return true;
    };
''' + commands[start:end] + '    return false;\n}\n'
        program = r'''
#include <cassert>
#include <cstddef>
#include <cstdio>
#include <cstring>
#include "Core/Services/IPoolConfiguration.h"
template<class T, size_t N> struct ConfigVariable { T* value; operator T() const {return *value;} };
struct Store { template<class T, size_t N> bool set(ConfigVariable<T,N>& variable, T value) { *variable.value = value; return true; } };
struct PoolLogicModule {
    enum { DisinfectionChlorineBromine, DisinfectionSwg, DisinfectionActiveOxygen, DisinfectionDisabled };
    Store *cfgStore_;
    int disinfectionType_ = 0;
    bool enabled_ = false, autoMode_ = false, phAutoMode_ = false, orpAutoMode_ = false, treatmentAutoMode_ = false;
    ConfigVariable<bool,0> enabledVar_{&enabled_}, autoModeVar_{&autoMode_}, phAutoModeVar_{&phAutoMode_}, orpAutoModeVar_{&orpAutoMode_}, treatmentAutoModeVar_{&treatmentAutoMode_};
    void applyAutoMode_(bool);
    bool disinfectionAutoMode_() const;
    bool command(const char*, bool);
    void alignSubordinateAutomationModes_();
};
'''
        main = r'''
int main() {
    Store store;
    PoolLogicModule module; module.cfgStore_ = &store;
    for (int type = 0; type <= PoolLogicModule::DisinfectionDisabled; ++type) {
        module.disinfectionType_ = type;
        module.applyAutoMode_(true);
        assert(module.enabled_ && module.enabledVar_ && module.autoMode_ && module.autoModeVar_);
        assert(module.phAutoMode_ && module.phAutoModeVar_);
        assert(module.treatmentAutoMode_ == (type == PoolLogicModule::DisinfectionSwg || type == PoolLogicModule::DisinfectionActiveOxygen));
        assert(module.treatmentAutoModeVar_ == module.treatmentAutoMode_);
        assert(module.orpAutoMode_ == (type == PoolLogicModule::DisinfectionChlorineBromine));
        assert(module.disinfectionAutoMode_() == (type != PoolLogicModule::DisinfectionDisabled));
        assert(module.command("poollogic.dis_auto_mode.set", false) == (type != PoolLogicModule::DisinfectionDisabled));
        assert(!module.disinfectionAutoMode_());
        assert(module.command("poollogic.dis_auto_mode.toggle", false) == (type != PoolLogicModule::DisinfectionDisabled));
        assert(module.disinfectionAutoMode_() == (type != PoolLogicModule::DisinfectionDisabled));
        assert(module.orpAutoMode_ == (type == PoolLogicModule::DisinfectionChlorineBromine));
        module.applyAutoMode_(false);
        assert(!module.phAutoMode_ && !module.orpAutoMode_ && !module.treatmentAutoMode_);
        assert(!module.autoModeVar_ && !module.phAutoModeVar_ && !module.orpAutoModeVar_ && !module.treatmentAutoModeVar_);
    }
    module.cfgStore_ = nullptr;
    module.applyAutoMode_(true);
    assert(!module.autoMode_);
}
'''
        self.compile_and_run(program + functions + command + main)

if __name__ == '__main__':
    unittest.main()
