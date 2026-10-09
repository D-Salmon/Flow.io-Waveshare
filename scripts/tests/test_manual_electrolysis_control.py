from pathlib import Path
import subprocess,tempfile,unittest
ROOT=Path(__file__).resolve().parents[2]
class ManualElectrolysisControl(unittest.TestCase):
 def test_production_control(self):
  source=(ROOT/'src/Modules/PoolLogicModule/PoolLogicControl.cpp').read_text(encoding='utf-8')
  block=source[source.index('    bool swgDesired = guidedDeviceOn_'):source.index('    bool heaterDesired = guidedDeviceOn_')]
  code=r'''
#include <cassert>
#include <cmath>
#include "Domain/Pool/ManualDosingMode.h"
struct Control {
 struct Fsm { bool on=false; } swgFsm_,filtrationFsm_;
 bool automationEnabled=false,treatmentAutoMode_=false,waterTempFresh=false,orpFresh=false;
 bool filtrationForcedOn=false,psiError_=false,flowError_=false,pressureMonitoringEnabled_=false;
 bool havePsi=false,flowSwitchEnabled_=false,haveFlow=false,flowPresent=false;
 float psi=0,psiLowThreshold_=0.15f,psiHighThreshold_=1.8f,waterTemp=0,secureElectroTempC_=15,orp=0,orpSetpoint_=700;
 unsigned swgDeviceSlot_=2,nowMs=0,delayElectroMin_=2;
 int swgControlMode_=0;
 static constexpr int SwgControlOrp=0,DisinfectionSwg=1;
 bool request=true;
 uint16_t observedBlocks=0;
 bool guidedDeviceOn_(unsigned,bool){return request;}
 bool isDisinfectionType_(int){return true;}
 unsigned stateUptimeSec_(Fsm,unsigned){return 0;}
 bool run(){
'''+block+r'''
 observedBlocks=electrolysisBlocks; return swgDesired; }
};
int main(){
 Control c;c.filtrationFsm_.on=true;
 assert(c.run()); // Direct ON with missing temperature and ORP.
 c.waterTempFresh=true;c.waterTemp=-5;assert(c.run());
 c.request=false;assert(!c.run());c.request=true;
 c.filtrationFsm_.on=false;assert(!c.run());c.filtrationFsm_.on=true;
 c.pressureMonitoringEnabled_=true;assert(!c.run());assert(c.observedBlocks==ACTUATOR_ON_BLOCK_PRESSURE_UNAVAILABLE);
 c.havePsi=true;c.psi=1;assert(c.run());
 c.psi=0;assert(!c.run());assert(c.observedBlocks==ACTUATOR_ON_BLOCK_PRESSURE_LOW);
 c.psi=2;assert(!c.run());assert(c.observedBlocks==ACTUATOR_ON_BLOCK_PRESSURE_HIGH);c.psi=1;
 c.flowSwitchEnabled_=true;assert(!c.run());assert(c.observedBlocks==ACTUATOR_ON_BLOCK_FLOW_UNAVAILABLE);
 c.haveFlow=true;assert(!c.run());assert(c.observedBlocks==ACTUATOR_ON_BLOCK_FLOW_ABSENT);
 c.flowPresent=true;assert(c.run());
 c.psi=c.psiLowThreshold_;assert(c.run());c.psi=c.psiHighThreshold_;assert(c.run());
 c.psi=NAN;assert(!c.run());assert(c.observedBlocks==ACTUATOR_ON_BLOCK_PRESSURE_UNAVAILABLE);c.psi=1;
 c.havePsi=false;c.flowPresent=false;assert(!c.run());
 assert(c.observedBlocks==(ACTUATOR_ON_BLOCK_PRESSURE_UNAVAILABLE|ACTUATOR_ON_BLOCK_FLOW_ABSENT));
 c.pressureMonitoringEnabled_=false;c.flowSwitchEnabled_=false;assert(c.run());
 c.psiError_=true;assert(!c.run());c.psiError_=false;
 c.automationEnabled=true;c.treatmentAutoMode_=true;assert(!c.run());
 c.waterTemp=20;c.orpFresh=true;c.filtrationForcedOn=true;assert(c.run());
 c.waterTempFresh=false;assert(!c.run());
}
'''
  with tempfile.TemporaryDirectory() as directory:
   p=Path(directory);(p/'test.cpp').write_text(code,encoding='utf-8')
   subprocess.run(['C:/msys64/ucrt64/bin/g++.exe','-std=c++17','-Wall','-Wextra','-Werror','-Isrc',str(p/'test.cpp'),'-o',str(p/'test.exe')],cwd=ROOT,check=True)
   subprocess.run([str(p/'test.exe')],check=True)
if __name__=='__main__':unittest.main()
