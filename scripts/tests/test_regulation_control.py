"""Execute production dosing gates and activation handling on a host compiler."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class RegulationControlTests(unittest.TestCase):
    def test_pause_dosing_preserves_manual_commands_and_other_treatments(self):
        control = (ROOT / 'src/Modules/PoolLogicModule/PoolLogicControl.cpp').read_text(encoding='utf-8')
        start = control.index('    // PID regulation is armed only')
        arm = control[start:control.index('    bool windowActive', start)]
        start = control.index('    // Chemical dosing is computed last')
        dose = control[start:control.index('    bool o2RequestFiltration', start)]
        lifecycle = (ROOT / 'src/Modules/PoolLogicModule/PoolLogicLifecycle.cpp').read_text(encoding='utf-8')
        start = lifecycle.index('        if (p->moduleId == (uint8_t)ConfigModuleId::PoolLogic &&\n            p->localBranchId == kCfgBranchRegulation')
        changed = lifecycle[start:lifecycle.index('        if (p->moduleId', start + 10)]
        program = r'''
#include <cassert>
#include <cstdint>
#include <cstring>
#include <initializer_list>
#define LOGI(...) ((void)0)
enum class ActivityCode {PoolLogicPhRegulationEnabled, PoolLogicOrpRegulationEnabled};
enum class ActivitySource {Pid}; enum class ActivitySeverity {Info};
enum class ActivityRole {Ph,Disinfection}; enum class ActivityState {None}; enum class ActivityReason {Pid};
int systemActor(){return 0;} uint32_t millis(){return 1000;}
enum class ConfigModuleId:uint8_t {PoolLogic=8};
constexpr uint8_t kCfgBranchRegulation=9;
namespace NvsKeys {namespace PoolLogic {constexpr const char* RegulationEnabled="pl_rgen";}}
struct Change {uint8_t moduleId=8,localBranchId=9;const char* nvsKey="pl_rgen";};
struct State {bool initialized=true;uint32_t outputOnMs=100;bool lastDemandOn=true;};
struct Fsm {bool on=true;};
struct PoolLogicModule {
 enum {DisinfectionChlorineBromine,DisinfectionSwg,DisinfectionActiveOxygen,DisinfectionDisabled};
 bool enabled=true,regulationEnabled_=true,phAutoMode_=true,orpAutoMode_=true;
 bool winterMode_=false,forced=false,phPidEnabled_=false,orpPidEnabled_=false;
 bool psiError_=false,flowError_=false,phTankLowError_=false,chlorineTankLowError_=false;
 bool phDesired=true,orpDesired=true,resultPh=false,resultOrp=false;
 int disinfectionType_=DisinfectionChlorineBromine;
 uint8_t delayPidsMin_=5,phPumpDeviceSlot_=1,orpPumpDeviceSlot_=2;
 unsigned pidCalls=0,phWrites=0,orpWrites=0;
 State phPidState_,orpPidState_; Fsm filtrationFsm_,phPumpFsm_,orpPumpFsm_;
 float phSetpoint_=7,orpSetpoint_=700,phKp_=1,phKi_=0,phKd_=0,orpKp_=1,orpKi_=0,orpKd_=0;
 uint32_t phWindowMs_=30000,orpWindowMs_=30000;bool phDosePlus_=false;
 bool isDisinfectionType_(int type)const{return disinfectionType_==type;}
 uint32_t stateUptimeSec_(const Fsm&,uint32_t now)const{return now/1000;}
 template<class... T> void emitActivity_(T... ){}
 bool guidedDeviceOn_(uint8_t slot,bool)const{return slot==phPumpDeviceSlot_?phDesired:orpDesired;}
 bool writeDeviceDesired_(uint8_t slot,bool value){
  if(slot==phPumpDeviceSlot_){phDesired=value;++phWrites;}else{orpDesired=value;++orpWrites;}return true;
 }
 void resetTemporalPidState_(State& state,uint32_t){state={false,0,false};}
 bool stepTemporalPid_(State&,float,float,float,float,float,uint32_t,bool,uint32_t,bool& desired,uint32_t& out){
  ++pidCalls;desired=true;out=100;return true;
 }
 void arm(uint32_t nowMs){const bool automationEnabled=enabled,filtrationForcedOn=forced;
''' + arm + r'''
 }
 void dose(uint32_t nowMs){const bool automationEnabled=enabled,filtrationForcedOn=forced;
 const bool filtrationDesired=filtrationFsm_.on,phFresh=true,orpFresh=true;const float ph=8,orp=500;
''' + dose + r'''
 resultPh=phPumpDesired;resultOrp=orpPumpDesired;
 }
 void changed(Change* p){
''' + changed + r'''
 }
};
int main(){
 PoolLogicModule m;
 m.arm(600000);assert(m.phPidEnabled_&&m.orpPidEnabled_);
 m.dose(600000);assert(m.resultPh&&m.resultOrp&&m.pidCalls==2);
 m.regulationEnabled_=false;m.arm(600000);assert(!m.phPidEnabled_&&!m.orpPidEnabled_);
 // Even stale armed flags cannot dose through a disabled master switch.
 m.phPidEnabled_=m.orpPidEnabled_=true;m.pidCalls=0;m.dose(600000);
 assert(!m.resultPh&&!m.resultOrp&&m.pidCalls==0);
 assert(!m.phPidState_.initialized&&!m.orpPidState_.initialized);
 m.phAutoMode_=m.orpAutoMode_=false;m.dose(600000);
 assert(m.resultPh&&m.resultOrp&&m.pidCalls==0); // Manual desired values remain.
 m.phAutoMode_=m.orpAutoMode_=true;m.regulationEnabled_=true;m.forced=false;
 m.phPidEnabled_=m.orpPidEnabled_=false;m.arm(60000);assert(!m.phPidEnabled_&&!m.orpPidEnabled_);
 m.forced=true;m.arm(60000);assert(!m.phPidEnabled_&&m.orpPidEnabled_);
 m.regulationEnabled_=false;m.arm(600000);assert(!m.phPidEnabled_&&!m.orpPidEnabled_);
 Change event;
 for(bool active:{false,true})for(int type=0;type<=3;++type)for(bool automatic:{false,true}){
  PoolLogicModule n;n.regulationEnabled_=active;n.disinfectionType_=type;
  n.phAutoMode_=n.orpAutoMode_=automatic;n.changed(&event);
  assert(!n.phPidEnabled_&&!n.orpPidEnabled_);
  assert(!n.phPidState_.initialized&&!n.orpPidState_.initialized);
  assert(n.phWrites==(automatic?1U:0U));
  assert(n.orpWrites==(automatic&&type==0?1U:0U));
  assert(n.orpDesired==!(automatic&&type==0)); // SWG/O2/manual requests remain.
 }
 event.nvsKey="pl_pmon";m.phWrites=m.orpWrites=0;m.changed(&event);
 assert(!m.phWrites&&!m.orpWrites); // Editing a timer does not reset either relay.
}
'''
        with tempfile.TemporaryDirectory(prefix='flow-regulation-') as directory:
            cpp = Path(directory) / 'regulation.cpp'
            exe = Path(directory) / 'regulation.exe'
            cpp.write_text(program, encoding='utf-8')
            subprocess.run(['C:/msys64/ucrt64/bin/g++.exe', '-std=c++17', '-Wall', '-Wextra', '-Werror', str(cpp), '-o', str(exe)], check=True)
            subprocess.run([str(exe)], check=True)


if __name__ == '__main__':
    unittest.main()
