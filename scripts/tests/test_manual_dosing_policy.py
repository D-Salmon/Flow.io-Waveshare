"""Validate shared manual-mode selection and actual forced-filtration detection."""
from pathlib import Path
import subprocess,tempfile,unittest
ROOT=Path(__file__).resolve().parents[2]
class DosingPolicyTest(unittest.TestCase):
 def test_selected_method_and_forcing(self):
  source=(ROOT/'src/Modules/PoolLogicModule/PoolLogicControl.cpp').read_text(encoding='utf-8')
  start=source.index('bool PoolLogicModule::filtrationForcedOn_() const')
  function=source[start:source.index('\n}',start)+2]
  code=r'''
#include <cassert>
#include <cstring>
#include "Domain/Pool/ManualDosingMode.h"
#include "Core/Services/ActuatorControlState.h"
struct PoolDeviceSvcMeta {ActuatorControlState control;};
constexpr int POOLDEV_SVC_OK=0;
struct Service { void*ctx; int(*meta)(void*,uint8_t,PoolDeviceSvcMeta*);};
struct PoolLogicModule {struct {bool on=false;} filtrationFsm_; Service*poolSvc_=nullptr;uint8_t filtrationDeviceSlot_=0;bool filtrationForcedOn_()const;};
'''+function+r'''
int main(){
 assert(manualElectrolysisAllowed(true,false,false,false,false));
 assert(!manualElectrolysisAllowed(false,false,true,false,true));
 assert(!manualElectrolysisAllowed(true,true,false,false,true));
 assert(!manualElectrolysisAllowed(true,false,true,true,false));
 assert(manualElectrolysisAllowed(true,true,true,true,true));
 using Method=PoolDisinfectionMethod;
 for(auto method:{Method::ChlorineBromine,Method::SaltElectrolysis,Method::ActiveOxygen,Method::Disabled}){
  const auto mode=manualDosingMode(ManualDosingTarget::Disinfection,method);
  if(method==Method::Disabled){assert(!mode.key);continue;}
  assert(std::strcmp(mode.key,method==Method::ChlorineBromine?"dis_auto_mode":"treatment_auto_mode")==0);
  assert(std::strcmp(mode.module,method==Method::ChlorineBromine?"poollogic/chlorine":"poollogic/modes")==0);
  assert(std::strcmp(manualDosingMode(ManualDosingTarget::Ph,method).key,"ph_auto_mode")==0);
 }
 ActuatorControlState state;state.available=true;state.mode=ActuatorControlMode::Forced;state.value=true;
 Service svc{&state,[](void*ctx,uint8_t,PoolDeviceSvcMeta*out){out->control=*static_cast<ActuatorControlState*>(ctx);return POOLDEV_SVC_OK;}};
 PoolLogicModule module;module.poolSvc_=&svc;
 assert(!module.filtrationForcedOn_());module.filtrationFsm_.on=true;assert(module.filtrationForcedOn_());
 state.value=false;assert(!module.filtrationForcedOn_());state.value=true;
 state.available=false;assert(!module.filtrationForcedOn_());state.available=true;
 for(auto mode:{ActuatorControlMode::Guided,ActuatorControlMode::WaitingTime,ActuatorControlMode::PersistenceError}){state.mode=mode;assert(!module.filtrationForcedOn_());}
 module.poolSvc_=nullptr;assert(!module.filtrationForcedOn_());
}
'''
  code='#include <initializer_list>\n'+code
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'test.cpp').write_text(code,encoding='utf-8')
   subprocess.run(['C:/msys64/ucrt64/bin/g++.exe','-std=c++17','-Wall','-Wextra','-Werror','-Isrc',str(p/'test.cpp'),'-o',str(p/'test.exe')],cwd=ROOT,check=True)
   subprocess.run([str(p/'test.exe')],check=True)
if __name__=='__main__':unittest.main()
