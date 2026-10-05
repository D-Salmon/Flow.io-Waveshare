"""Execute production buzzer policy and level conditions with hardware/service fakes."""
from pathlib import Path
import tempfile, subprocess, unittest, shutil
ROOT=Path(__file__).resolve().parents[2]
def function(source,signature):
 a=source.index(signature);b=source.index('\n}',a)+2
 return source[a:b]
class NotificationsTest(unittest.TestCase):
 def test_disabled_alarm_notifications_and_unwired_levels(self):
  buzzer=(ROOT/'src/Modules/HMIBuzzerModule/HMIBuzzerModule.cpp').read_text(encoding='utf-8')
  pool=(ROOT/'src/Modules/PoolLogicModule/PoolLogicControl.cpp').read_text(encoding='utf-8')
  parts=[function(buzzer,s) for s in ['void HmiBuzzer::stopAlarm()', 'void HMIBuzzerModule::loop()', 'void HMIBuzzerModule::requestPattern_', 'void HMIBuzzerModule::playPending_', 'bool HMIBuzzerModule::alarmNotificationsEnabled_', 'void HMIBuzzerModule::handleAlarmRaised_', 'void HMIBuzzerModule::tickAlarmReminder_']]
  parts += [function(pool,'AlarmCondState PoolLogicModule::'+name) for name in ['condPhTankLowStatic_','condChlorineTankLowStatic_','condWaterLevelLowStatic_']]
  pre=r'''
#include <cassert>
#include <atomic>
#include <cstdint>
#include <cstdio>
enum class BuzzerPattern:uint8_t {ConfigSuccess,DeviceOn,DeviceOff,AlarmActive,AlarmCritical};
enum class AlarmSeverity {Info,Alarm,Critical};
enum class AlarmCondState {False,Unknown,True};
constexpr uint16_t IO_ID_INVALID=0xffff;
static uint32_t now=100;
uint32_t millis(){return now;}
constexpr uint32_t kAlarmRepeatMs=8000;
struct AlarmService {void* ctx;bool(*isEnabled)(void*);uint8_t(*activeCount)(void*);AlarmSeverity(*highestSeverity)(void*);};
struct HmiBuzzer {
 BuzzerPattern currentPattern_=BuzzerPattern::ConfigSuccess;bool playing=false;int alarmPlays=0,configPlays=0,stops=0;
 void stop(){playing=false;stops++;}void stopAlarm();void tick(uint32_t){}
 void play(BuzzerPattern p){currentPattern_=p;playing=true;if(p==BuzzerPattern::AlarmActive||p==BuzzerPattern::AlarmCritical)alarmPlays++;else configPlays++;}
};
struct HMIBuzzerModule {
 bool hardwareAvailable_=true;struct {bool enable=true;}cfgData_;HmiBuzzer buzzer_;
 AlarmService*alarmSvc_;std::atomic<uint32_t> pendingPatterns_{0};uint32_t lastAlarmPatternMs_=0;
 void loop();void requestPattern_(BuzzerPattern);void playPending_(uint32_t);bool alarmNotificationsEnabled_()const;void handleAlarmRaised_();void tickAlarmReminder_(uint32_t);
};
struct PoolLogicModule {
 bool enabled_=true,available=true,low=false;uint16_t phLevelIoId_=1,chlorineLevelIoId_=2,levelIoId_=3;
 mutable int reads=0;
 bool loadDigitalSensor_(uint16_t,bool&out)const {reads++;out=low;return available;}
 static AlarmCondState condPhTankLowStatic_(void*,uint32_t);static AlarmCondState condChlorineTankLowStatic_(void*,uint32_t);static AlarmCondState condWaterLevelLowStatic_(void*,uint32_t);
};
'''
  program=r'''
int main(){
 bool enabled=true;uint8_t active=2;
 struct State {bool*enabled;uint8_t*active;}state{&enabled,&active};
 AlarmService svc{&state,[](void*p){return *static_cast<State*>(p)->enabled;},[](void*p){return *static_cast<State*>(p)->active;},[](void*){return AlarmSeverity::Critical;}};
 HMIBuzzerModule module;module.alarmSvc_=&svc;
 module.handleAlarmRaised_();module.loop();assert(module.buzzer_.alarmPlays==1);
 now+=100;module.loop();assert(module.buzzer_.alarmPlays==1);
 module.requestPattern_(BuzzerPattern::AlarmActive);enabled=false;
 module.loop();assert(!module.buzzer_.playing);assert(module.buzzer_.alarmPlays==1);assert(active==2);
 module.handleAlarmRaised_();assert(module.pendingPatterns_.load()==0);
 module.requestPattern_(BuzzerPattern::ConfigSuccess);module.loop();assert(module.buzzer_.configPlays==1);assert(module.buzzer_.playing);
 module.loop();assert(module.buzzer_.playing); // unrelated acknowledgement is preserved
 enabled=true;now+=9000;module.loop();assert(module.buzzer_.alarmPlays==2);
 PoolLogicModule pool;
 auto check=[&](auto callback,uint16_t&binding){
  binding=IO_ID_INVALID;pool.reads=0;assert(callback(&pool,0)==AlarmCondState::False);assert(pool.reads==0);
  binding=1;pool.available=false;assert(callback(&pool,0)==AlarmCondState::Unknown);
  pool.available=true;pool.low=false;assert(callback(&pool,0)==AlarmCondState::False);
  pool.low=true;assert(callback(&pool,0)==AlarmCondState::True);
  pool.enabled_=false;assert(callback(&pool,0)==AlarmCondState::False);pool.enabled_=true;
 };
 check(PoolLogicModule::condPhTankLowStatic_,pool.phLevelIoId_);
 check(PoolLogicModule::condChlorineTankLowStatic_,pool.chlorineLevelIoId_);
 check(PoolLogicModule::condWaterLevelLowStatic_,pool.levelIoId_);
 puts("Production policy: disabled alarms stop ongoing/queued reminders, preserve acknowledgements and latches; unwired levels clear, wired failures remain unknown");
}
'''
  with tempfile.TemporaryDirectory() as folder:
   cpp=Path(folder)/'notifications.cpp';exe=Path(folder)/'notifications.exe'
   cpp.write_text(pre+'\n'.join(parts)+program,encoding='utf-8')
   compiler=shutil.which('g++') or 'C:/msys64/ucrt64/bin/g++.exe'
   subprocess.run([compiler,'-std=c++17',str(cpp),'-o',str(exe)],check=True)
   subprocess.run([str(exe)],check=True)
if __name__=='__main__':unittest.main()
