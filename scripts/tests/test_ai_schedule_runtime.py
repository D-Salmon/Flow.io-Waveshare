"""Exercise production scheduling gates, durable reservation and independent weather."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


def function(source, signature):
    start = source.index(signature)
    return source[start:source.index('\n}', start) + 2]


class AiScheduleRuntimeTests(unittest.TestCase):
    def test_production_gates_and_reservation(self):
        source = (ROOT / 'src/Modules/AiInsightModule/AiInsightModule.cpp').read_text(encoding='utf-8')
        service = (ROOT / 'src/Core/Services/IAiInsight.h').read_text(encoding='utf-8')
        schedule = service[service.index('enum class AiScheduleState'):service.index('struct AiPoolInsightStatus')]
        implementations = '\n'.join(function(source, signature) for signature in [
            'bool AiInsightModule::requestWeatherRefresh_', 'bool AiInsightModule::networkReady_',
            'void AiInsightModule::buildScheduleStatus_', 'bool AiInsightModule::persistScheduleCheckpoint_',
            'void AiInsightModule::processDailySchedule_'])
        program = r'''
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <ctime>
tm* localtime_r(const time_t* value,tm* out){return localtime_s(out,value)==0?out:nullptr;}
#include "Modules/AiInsightModule/AiDailySchedule.h"
#include "Core/Services/ITime.h"
#define portENTER_CRITICAL(...) ((void)0)
#define portEXIT_CRITICAL(...) ((void)0)
#define LOGW(...) ((void)0)
#define LOGI(...) ((void)0)
#define LOGE(...) ((void)0)
#define NVS_KEY(key) key
namespace NvsKeys {namespace AiInsight {constexpr const char* ScheduleCheckpoint="ai_day_state";}}
uint32_t millis(){return 1000;}
''' + schedule + r'''
enum class AiWeatherState {Idle,Queued,Loading,Ready,Failed};
enum class AiPoolInsightState {Idle,Queued,Loading};
struct ConfigStore {
 bool fail=false;unsigned writes=0;AiDailySchedule::Checkpoint saved{};
 bool writeRuntimeBlob(const char*,const void* value,size_t length){
  assert(length==sizeof(saved));writes++;if(fail)return false;memcpy(&saved,value,length);return true;
 }
};
struct NetworkAccessService {bool(*isWebReachable)(void*);void* ctx;};
struct Clock {uint64_t now=1791356400;bool valid=true;};
bool clockState(void* ctx,TimeState* out){auto& clock=*static_cast<Clock*>(ctx);out->valid=clock.valid;out->currentTimeUtc=clock.now;return true;}
bool online(void* ctx){return *static_cast<bool*>(ctx);}
struct AiInsightModule {
 struct Config {bool enabled=true,automaticEnabled=true;char apiKey[10]="test",model[10]="test",dailyTime[6]="08:00";double latitude=46.04,longitude=4.0;} cfgData_{};
 struct Weather {AiWeatherState state=AiWeatherState::Idle;uint32_t updatedAtMs=0;char message[96]{};};
 struct Storage {bool refreshPending=false,forceRefresh=false,insightPending=false;Weather weatherStatus{};struct {AiPoolInsightState state=AiPoolInsightState::Idle;}insightStatus{};} owned;
 Storage* storage_=&owned;mutable int lock_=0;
 Clock clock;TimeService time{};const TimeService* timeService_=&time;
 bool connected=true;NetworkAccessService network{online,&connected};const NetworkAccessService* networkAccessService_=&network;
 ConfigStore store;ConfigStore* cfgStore_=&store;
 AiDailySchedule::Checkpoint scheduleCheckpoint_{};bool schedulePersistenceReady_=true;unsigned requests=0;bool reject=false;
 AiInsightModule(){time.ctx=&clock;time.currentState=clockState;}
 static bool locationIsValid_(double lat,double lon){return std::isfinite(lat)&&std::isfinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180;}
 static bool writeError_(char* out,size_t length,const char* message){snprintf(out,length,"%s",message);return true;}
 uint64_t currentEpoch_()const{return clock.now;}
 bool requestPoolInsight_(bool*,char*,size_t){assert(store.saved.lastAttemptLocalDate!=0);requests++;return !reject;}
 bool requestWeatherRefresh_(bool,char*,size_t);
 bool networkReady_()const;
 void buildScheduleStatus_(AiPoolInsightSchedule&)const;
 bool persistScheduleCheckpoint_(const AiDailySchedule::Checkpoint&);
 void processDailySchedule_();
};
''' + implementations + r'''
int main(){
 _putenv_s("TZ","UTC0");_tzset();
 // 07 October 2026 at 09:00 UTC, after the scheduled 08:00.
 tm date{};date.tm_year=126;date.tm_mon=9;date.tm_mday=7;date.tm_hour=9;
 auto epoch=static_cast<uint64_t>(mktime(&date));
 for(unsigned scenario=0;scenario<10;scenario++){
  AiInsightModule module;module.clock.now=epoch;
  switch(scenario){
   case 0:module.cfgData_.automaticEnabled=false;break;
   case 1:module.cfgData_.enabled=false;break;
   case 2:module.cfgData_.apiKey[0]=0;break;
   case 3:module.cfgData_.model[0]=0;break;
   case 4:module.cfgData_.latitude=91;break;
   case 5:module.clock.valid=false;break;
   case 6:module.connected=false;break;
   case 7:module.schedulePersistenceReady_=false;break;
   case 8:module.owned.insightPending=true;break;
   case 9:memcpy(module.cfgData_.dailyTime,"24:00",6);break;
  }
  module.processDailySchedule_();assert(module.requests==0&&module.store.writes==0);
 }
 AiInsightModule normal;normal.clock.now=epoch;normal.processDailySchedule_();
 assert(normal.requests==1&&normal.store.writes==1&&normal.store.saved.lastAttemptLocalDate==20261007);
 normal.processDailySchedule_();assert(normal.requests==1&&normal.store.writes==1);
 AiInsightModule reboot;reboot.clock.now=epoch;reboot.scheduleCheckpoint_=normal.store.saved;
 reboot.processDailySchedule_();assert(!reboot.requests&&!reboot.store.writes);
 AiInsightModule failure;failure.clock.now=epoch;failure.store.fail=true;failure.processDailySchedule_();
 assert(!failure.requests&&failure.store.writes==1&&!failure.schedulePersistenceReady_);
 failure.processDailySchedule_();assert(failure.store.writes==1);
 AiInsightModule rejected;rejected.clock.now=epoch;rejected.reject=true;rejected.processDailySchedule_();rejected.processDailySchedule_();
 assert(rejected.requests==1&&rejected.store.writes==1); // Failed paid requests are not retried repeatedly.
 AiInsightModule reconnect;reconnect.clock.now=epoch;reconnect.connected=false;reconnect.processDailySchedule_();
 reconnect.connected=true;reconnect.processDailySchedule_();assert(reconnect.requests==1);
 AiInsightModule weather;weather.cfgData_.enabled=false;weather.cfgData_.apiKey[0]=0;
 char error[96];assert(weather.requestWeatherRefresh_(false,error,sizeof(error)));
 assert(weather.owned.refreshPending&&weather.owned.weatherStatus.state==AiWeatherState::Queued);
 assert(weather.requests==0&&weather.store.writes==0);
 assert(!weather.requestWeatherRefresh_(false,error,sizeof(error)));
 AiInsightModule noLocation;noLocation.cfgData_.latitude=91;
 assert(!noLocation.requestWeatherRefresh_(false,error,sizeof(error)));
}
'''
        with tempfile.TemporaryDirectory(prefix='flow-ai-runtime-') as directory:
            cpp = Path(directory) / 'runtime.cpp'
            exe = Path(directory) / 'runtime.exe'
            cpp.write_text(program, encoding='utf-8')
            subprocess.run(['C:/msys64/ucrt64/bin/g++.exe', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            '-I', str(ROOT / 'src'), str(cpp), '-o', str(exe)], check=True)
            subprocess.run([str(exe)], check=True)


if __name__ == '__main__':
    unittest.main()
