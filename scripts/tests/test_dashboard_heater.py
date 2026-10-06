"""Exercise the production heater runtime value and regulation activation event."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class DashboardHeaterTests(unittest.TestCase):
    def test_actual_state_and_regulation_stop(self):
        header = (ROOT / 'src/Modules/PoolDeviceModule/PoolDeviceModule.h').read_text(encoding='utf-8')
        start = header.index('    enum RuntimeUiValueId')
        ids = header[start:header.index('\n    };', start) + 7]
        source = (ROOT / 'src/Modules/PoolDeviceModule/PoolDeviceRuntime.cpp').read_text(encoding='utf-8')
        start = source.index('bool PoolDeviceModule::writeRuntimeUiValue(')
        writer = source[start:source.index('\n}', start) + 2]
        lifecycle = (ROOT / 'src/Modules/PoolLogicModule/PoolLogicLifecycle.cpp').read_text(encoding='utf-8')
        start = lifecycle.index('        if (p->moduleId == (uint8_t)ConfigModuleId::PoolLogic &&\n            p->localBranchId == kCfgBranchHeater')
        change = lifecycle[start:lifecycle.index('        if (p->moduleId', start + 10)]
        code = r'''
#include <cassert>
#include <cstdint>
#include <cstring>
namespace PoolIds { enum {DeviceFiltrationPump=0,DevicePhPump=1,DeviceChlorinePump=2,DeviceRobot=3,DeviceWaterHeater=7}; }
using RuntimeUiId=uint16_t;
RuntimeUiId makeRuntimeUiId(uint8_t module,uint8_t value){return module*256+value;}
struct Store {bool actualOn=false,desiredOn=true,available=true;uint8_t lastSlot=255;};
struct PoolDeviceRuntimeStateEntry {bool actualOn=false;};
bool poolDeviceRuntimeState(Store& store,uint8_t slot,PoolDeviceRuntimeStateEntry& state){
 store.lastSlot=slot;state.actualOn=store.actualOn;return store.available;
}
uint32_t poolDeviceRuntimeCount(Store&){return 8;}
struct IRuntimeUiWriter {RuntimeUiId id=0;bool unavailable=false,value=false;
 bool writeUnavailable(RuntimeUiId input){id=input;unavailable=true;return true;}
 bool writeU32(RuntimeUiId input,uint32_t){id=input;return true;}
 bool writeBool(RuntimeUiId input,bool state){id=input;value=state;return true;}
};
struct PoolDeviceModule {
''' + ids + r'''
 Store* dataStore_=nullptr;uint8_t moduleId()const{return 6;}
 bool writeRuntimeUiValue(uint8_t,IRuntimeUiWriter&)const;
};
''' + writer + r'''
enum class ConfigModuleId:uint8_t {PoolLogic=8};
constexpr uint8_t kCfgBranchHeater=11;
namespace NvsKeys {namespace PoolLogic {constexpr const char* HeaterAutoMode="pl_hta";}}
#define LOGW(...) ((void)0)
struct Change {uint8_t moduleId=8,localBranchId=11;const char* nvsKey="pl_hta";};
struct Regulation {bool heaterAutoMode_=false;uint8_t heaterDeviceSlot_=7;unsigned writes=0;bool desired=true;
 bool writeDeviceDesired_(uint8_t slot,bool value){assert(slot==7);desired=value;++writes;return true;}
 void changed(Change* p){
''' + change + r'''
 }
};
int main(){
 PoolDeviceModule module;Store store;IRuntimeUiWriter out;
 module.dataStore_=&store;
 assert(module.writeRuntimeUiValue(module.RuntimeUiHeaterOn,out));
 assert(store.lastSlot==7&&out.id==6*256+6&&!out.value&&!out.unavailable);
 store.actualOn=true;store.desiredOn=false;
 assert(module.writeRuntimeUiValue(module.RuntimeUiHeaterOn,out)&&out.value);
 store.available=false;out={};
 assert(module.writeRuntimeUiValue(module.RuntimeUiHeaterOn,out)&&out.unavailable);
 module.dataStore_=nullptr;out={};
 assert(module.writeRuntimeUiValue(module.RuntimeUiHeaterOn,out)&&out.unavailable);
 Regulation heater;Change event;
 for(bool automatic:{false,true}){
   heater.heaterAutoMode_=automatic;heater.desired=true;heater.writes=0;heater.changed(&event);
   assert(!heater.desired&&heater.writes==1);
 }
 event.nvsKey="pl_hts";heater.writes=0;heater.desired=true;heater.changed(&event);
 assert(heater.writes==0&&heater.desired); // A setpoint edit does not reset the relay.
}
'''
        with tempfile.TemporaryDirectory(prefix='flow-heater-dashboard-') as directory:
            cpp = Path(directory) / 'heater.cpp'
            exe = Path(directory) / 'heater.exe'
            cpp.write_text(code, encoding='utf-8')
            subprocess.run(['C:/msys64/ucrt64/bin/g++.exe', '-std=c++17', '-include', 'initializer_list',
                            str(cpp), '-o', str(exe)], check=True)
            subprocess.run([str(exe)], check=True)


if __name__ == '__main__':
    unittest.main()
