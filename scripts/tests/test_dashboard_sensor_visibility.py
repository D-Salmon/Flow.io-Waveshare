"""Execute configured-sensor rules used by dashboard slots and alarm cards."""
from pathlib import Path
import os
import subprocess,shutil,tempfile,unittest
ROOT=Path(__file__).resolve().parents[2]
class DashboardSensorVisibilityTest(unittest.TestCase):
 def test_configured_not_available(self):
  source=(ROOT/'src/Modules/Network/WebInterfaceModule/WebInterfaceServer.cpp').read_text(encoding='utf-8')
  start=source.index('bool waveshareSensorConfigured_');end=source.index('void sendWaveshareDashboardSlotsResponse_',start)
  program=r"""
#include <cassert>
#include <cstring>
#include <cstdio>
#include <map>
#include <string>
#include <ArduinoJson.h>
#include "Core/AlarmIds.h"
#include "Core/Services/IPoolConfiguration.h"
constexpr uint16_t IO_PORT_INVALID=0;namespace PoolInputSlots{constexpr uint8_t WaterMeter=1;}
constexpr uint16_t IO_ID_INVALID=65535;using RuntimeUiId=uint16_t;
enum class ModuleId:uint8_t {Io=1,Other=2};
uint8_t runtimeUiModuleId(RuntimeUiId id){return id>>8;}uint8_t runtimeUiValueId(RuntimeUiId id){return id&255;}
ArduinoJson::Allocator* psramPreferredJsonAllocator(){return ArduinoJson::detail::DefaultAllocator::instance();}
struct ConfigStore {
 std::map<std::string,std::string> modules;
 bool toJsonModule(const char* name,char* out,size_t len,void*,bool){if(!modules.count(name))return false;snprintf(out,len,"%s",modules[name].c_str());return true;}
};
"""+source[start:end]+r"""
int main(){
ConfigStore cfg;cfg.modules["poollogic/sensors"]=R"({"wat_temp_io_id":65535,"air_temp_io_id":65535,"ph_io_id":1,"dis_io_id":2,"psi_io_id":65535,"ph_lvl_io_id":65535,"chl_lvl_io_id":65535,"pool_lvl_io_id":65535,"filtr_fb_io_id":65535,"swg_fb_io_id":65535,"flow_switch_io_id":3,"flow_switch_enabled":false})";
for(uint8_t value:{1,2,6})assert(!waveshareDashboardSensorConfigured_(&cfg,256+value));
for(uint8_t value:{3,4})assert(waveshareDashboardSensorConfigured_(&cfg,256+value));
for(uint16_t id:{1000,1001,1002,1003,1006,1007,1008,1009,1010})assert(!waveshareAlarmSensorConfigured_(&cfg,id));
for(uint16_t id:{1004,1005,1200})assert(waveshareAlarmSensorConfigured_(&cfg,id));
cfg.modules["poollogic/sensors"]=R"({"wat_temp_io_id":4,"flow_switch_io_id":3,"flow_switch_enabled":true})";
assert(waveshareDashboardSensorConfigured_(&cfg,257));assert(waveshareAlarmSensorConfigured_(&cfg,1009));assert(waveshareAlarmSensorConfigured_(&cfg,1010));
for(auto driver:{"bmp280","bme680","sht40"})cfg.modules[std::string("io/drivers/")+driver]=R"({"enabled":false})";
for(uint8_t value:{7,8,9,10,11,12,13,14})assert(!waveshareDashboardSensorConfigured_(&cfg,256+value));
cfg.modules["io/drivers/bme680"]=R"({"enabled":true})";assert(waveshareDashboardSensorConfigured_(&cfg,264));

for(int mode:{0,1,2,3}){
 cfg.modules["poollogic/modes"]="{\"disinfection_type\":"+std::to_string(mode)+"}";
 assert(waveshareAlarmSensorConfigured_(&cfg,1005)==(mode==0));
}
cfg.modules["poollogic/sensors"]=R"({"psi_io_id":194,"psi_monitoring":false})";
for(int id:{1000,1001})assert(!waveshareAlarmSensorConfigured_(&cfg,id));
cfg.modules["poollogic/sensors"]=R"({"psi_io_id":194,"psi_monitoring":true})";
for(int id:{1000,1001})assert(waveshareAlarmSensorConfigured_(&cfg,id));
cfg.modules["poollogic/sensors"]=R"({"psi_io_id":65535,"psi_monitoring":true})";
for(int id:{1000,1001})assert(!waveshareAlarmSensorConfigured_(&cfg,id));
cfg.modules["io/input/i01"]=R"({"binding_port":0,"counter_total":1234})";
assert(!waveshareDashboardSensorConfigured_(&cfg,261));
cfg.modules["io/input/i01"]=R"({"binding_port":201,"counter_total":1234})";
assert(waveshareDashboardSensorConfigured_(&cfg,261));
// No sensor readings are consulted: enabled but unavailable probes remain visible.
assert(waveshareDashboardSensorConfigured_(nullptr,257));
}
"""
  includes=list(Path(os.environ.get('FLOWIO_TEST_LIBDEPS', ROOT/'.pio/libdeps')).glob('*/ArduinoJson/src'))
  with tempfile.TemporaryDirectory(prefix='flow-sensor-visibility-') as d:
   cpp=Path(d)/'main.cpp';exe=Path(d)/'test.exe';cpp.write_text(program,encoding='utf-8')
   subprocess.run([shutil.which('g++') or 'C:/msys64/ucrt64/bin/g++.exe','-std=c++17','-I'+str(includes[0]),'-I'+str(ROOT/'include'),'-I'+str(ROOT/'src'),str(cpp),'-o',str(exe)],check=True);subprocess.run([str(exe)],check=True)
if __name__=='__main__':unittest.main()
