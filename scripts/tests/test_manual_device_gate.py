"""Direct manual starts must be refused before target and lease mutation."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

class ManualDeviceGateTest(unittest.TestCase):
    def test_production_target_transaction(self):
        source = (ROOT / 'src/Modules/PoolDeviceModule/PoolDeviceControl.cpp').read_text(encoding='utf-8')
        start = source.index('PoolDeviceSvcStatus PoolDeviceModule::setTarget_(')
        function = source[start:source.index('\n}', start)+2]
        program = r'''
#include <cassert>
#include <cstdint>
#include "Core/Services/ActuatorControlState.h"
constexpr unsigned POOL_DEVICE_MAX=2;
enum PoolDeviceSvcStatus { POOLDEV_SVC_OK, POOLDEV_SVC_ERR_INVALID_ARG,
 POOLDEV_SVC_ERR_UNKNOWN_SLOT, POOLDEV_SVC_ERR_NOT_READY, POOLDEV_SVC_ERR_DISABLED,
 POOLDEV_SVC_ERR_INTERLOCK, POOLDEV_SVC_ERR_IO, POOLDEV_SVC_ERR_MAX_UPTIME };
enum class PoolInterlockState {Ready,StartRejected};
struct PoolDeviceTarget { bool running=false; };
struct Timer { unsigned cancellations=0; bool cancel(ActuatorOverrideReason){++cancellations;return true;} };
struct Slot { bool used=true,driverReady=true,desiredOn=false; int driverConfig=0;
 struct {bool enabled=true;} def;
 PoolDeviceTarget desired; PoolInterlockState interlockState=PoolInterlockState::Ready;
 ActuatorOverridePolicy overridePolicy; Timer overrideTimer; };
bool validatePoolTarget(int,const PoolDeviceTarget&){return true;}
unsigned millis(){return 1;}
struct PoolDeviceModule {
 Slot slots_[POOL_DEVICE_MAX];bool runtimeReady_=true,dependencies=true,max=false;
 unsigned ticks=0;int locks=0;
 bool lockState_(){++locks;return true;} void unlockState_(){--locks;}
 bool maxUptimeReached_(const Slot&){return max;}
 bool dependenciesSatisfied_(uint8_t){return dependencies;}
 bool overrideDependenciesSatisfied_(uint8_t){return dependencies;}
 void tickDevices_(unsigned,bool){++ticks;}
 PoolDeviceSvcStatus setTarget_(uint8_t,const PoolDeviceTarget*,bool);
};
''' + function + r'''
int main(){
 PoolDeviceModule module;auto& slot=module.slots_[1];PoolDeviceTarget on{true},off{false};
 slot.overridePolicy.allowOn=false;
 assert(module.setTarget_(1,&on,true)==POOLDEV_SVC_ERR_INTERLOCK);
 assert(!slot.desiredOn && !slot.desired.running && !slot.overrideTimer.cancellations && !module.ticks && !module.locks);
 // OFF remains available during a failed circulation gate.
 assert(module.setTarget_(1,&off,true)==POOLDEV_SVC_OK);
 slot.overridePolicy.allowOn=true;slot.overridePolicy.ready=false;
 assert(module.setTarget_(1,&on,true)==POOLDEV_SVC_ERR_NOT_READY);
 slot.overridePolicy.ready=true;module.dependencies=false;
 assert(module.setTarget_(1,&on,true)==POOLDEV_SVC_ERR_INTERLOCK);
 module.dependencies=true;
 assert(module.setTarget_(1,&on,true)==POOLDEV_SVC_OK && slot.desiredOn);
 // Automatic commands retain their controller-owned policy, not manual start restrictions.
 slot.overridePolicy.allowOn=false;
 assert(module.setTarget_(1,&on,false)==POOLDEV_SVC_OK);
 module.max=true;assert(module.setTarget_(1,&on,true)==POOLDEV_SVC_ERR_MAX_UPTIME);
 assert(!module.locks);
}
'''
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'test.cpp').write_text(program, encoding='utf-8')
            subprocess.run(['C:/msys64/ucrt64/bin/g++.exe', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            '-Isrc', str(path/'test.cpp'), '-o', str(path/'test.exe')], cwd=ROOT, check=True)
            subprocess.run([str(path/'test.exe')], check=True)

if __name__ == '__main__':
    unittest.main()
