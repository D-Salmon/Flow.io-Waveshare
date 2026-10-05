"""Exercise production dashboard serialization with configured flow monitoring."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

class FlowAlarmDashboardTest(unittest.TestCase):
    def test_flow_card_and_saved_labels(self):
        source = (ROOT / 'src/Modules/Network/WebInterfaceModule/WebInterfaceServer.cpp').read_text(encoding='utf-8')
        def part(start, end):
            a = source.index(start)
            return source[a:source.index(end, a)]
        program = r'''
#include <cassert>
#include <cstdio>
#include <string>
#include <sstream>
#include <ArduinoJson.h>
#include "Core/AlarmIds.h"
constexpr uint8_t kWaveshareDashboardSlotCount = 8;
struct ConfigStore {bool flow=false; bool existing=false;};
struct AlarmService {};
struct WaveshareAlarmDashboardSlotConfig {bool enabled=true;uint16_t alarmId=0;char label[64]{};uint8_t colorId=0;};
struct WaveshareAlarmDashboardSlotState {bool available=false,latched=false,resettable=false,conditionKnown=false,conditionTrue=false,lastChangeValid=false;uint32_t lastChangeMs=0;};
struct AsyncResponseStream {std::ostringstream out;template<class T>void print(T value){out<<value;}};
void printJsonEscaped_(AsyncResponseStream& out,const char* text){out.print('"');out.print(text);out.print('"');}
const char* waveshareDashboardColorHex_(uint8_t,uint8_t){return "#FFE9E4";}
uint32_t millis(){return 100;}
bool waveshareReadAlarmDashboardSlotState_(const AlarmService*,uint16_t,WaveshareAlarmDashboardSlotState& state){state.conditionKnown=true;return true;}
bool waveshareAlarmSensorConfigured_(ConfigStore* cfg,uint16_t id){return id!=(uint16_t)AlarmId::PoolNoFlow||cfg->flow;}
void waveshareLoadAlarmDashboardSlotConfig_(ConfigStore* cfg,uint8_t i,WaveshareAlarmDashboardSlotConfig& slot){
 slot.alarmId=1000+i;
 if(i==0)snprintf(slot.label,sizeof(slot.label),"Custom pressure");
 if(i==4)snprintf(slot.label,sizeof(slot.label),"pH uptime");
 if(i==5)snprintf(slot.label,sizeof(slot.label),"ORP uptime");
 if(i==7&&cfg->existing)slot.alarmId=(uint16_t)AlarmId::PoolNoFlow;
}
''' + part('const char* waveshareAlarmDashboardLabel_', 'void waveshareDashboardFallbackLabel_') + part('void sendWaveshareAlarmDashboardSlotsResponse_', 'bool parseRuntimeUiIdsCsv_') + r'''
int main(){
 ConfigStore cfg;AlarmService alarms;
 for(bool flow:{false,true})for(bool existing:{false,true}){
  cfg.flow=flow;cfg.existing=existing;
  AsyncResponseStream response;response.print('[');bool first=true;
  sendWaveshareAlarmDashboardSlotsResponse_(response,first,&cfg,&alarms);response.print(']');
  JsonDocument doc;assert(!deserializeJson(doc,response.out.str()));
  assert(doc.size()==(flow&&!existing?9:8));
  unsigned flowCards=0;for(JsonObject slot:doc.as<JsonArray>())if(slot["alarm_id"]==1010&&slot["enabled"].as<bool>())flowCards++;
  assert(flowCards==(flow?1:0));
  assert(doc[0]["label"]=="Custom pressure");
  assert(doc[4]["label"]=="Durée maximale pompe pH");
  assert(doc[5]["label"]=="Durée maximale pompe chlore");
  if(flow&&!existing)assert(doc[8]["label"]=="Débit de filtration absent");
 }
}
'''
        includes = list(Path(os.environ.get('FLOWIO_TEST_LIBDEPS', ROOT/'.pio/libdeps')).glob('*/ArduinoJson/src'))
        with tempfile.TemporaryDirectory(prefix='flow-alarm-dashboard-') as folder:
            cpp = Path(folder) / 'main.cpp'
            exe = Path(folder) / 'test.exe'
            cpp.write_text(program, encoding='utf-8')
            subprocess.run(['C:/msys64/ucrt64/bin/g++.exe', '-std=c++17', '-I'+str(includes[0]), '-I'+str(ROOT/'include'), '-I'+str(ROOT/'src'), str(cpp), '-o', str(exe)], check=True)
            subprocess.run([str(exe)], check=True)

if __name__ == '__main__':
    unittest.main()
