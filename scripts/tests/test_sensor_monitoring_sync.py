"""Run the production monitoring reconciliation with a minimal ConfigStore."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class SensorMonitoringSyncTests(unittest.TestCase):
    def test_assignment_controls_monitoring_and_stable_state_does_not_write(self):
        source = (ROOT / 'src/Modules/PoolLogicModule/PoolLogicLifecycle.cpp').read_text(encoding='utf-8')
        start = source.index('void PoolLogicModule::syncSensorMonitoring_()')
        end = source.index('void PoolLogicModule::onConfigLoaded(', start)
        function = source[start:end]
        code = r'''
#include <cassert>
#include <cstdint>
constexpr uint16_t IO_ID_INVALID = 65535;
struct Store { int writes=0; bool set(int&,bool) { ++writes; return true; } };
struct PoolLogicModule {
 Store* cfgStore_; uint16_t psiIoId_=IO_ID_INVALID,flowSwitchIoId_=IO_ID_INVALID;
 bool pressureMonitoringEnabled_=false,flowSwitchEnabled_=false;
 int pressureMonitoringEnabledVar_=0,flowSwitchEnabledVar_=0;
 void syncSensorMonitoring_();
};
''' + function + r'''
int main() {
 Store store; PoolLogicModule pool{&store};
 pool.syncSensorMonitoring_(); assert(store.writes==0);
 pool.psiIoId_=194; pool.flowSwitchIoId_=64;
 pool.syncSensorMonitoring_(); assert(pool.pressureMonitoringEnabled_);
 assert(!pool.flowSwitchEnabled_); assert(store.writes==1);
 pool.syncSensorMonitoring_(); assert(store.writes==1);
 pool.flowSwitchEnabled_=true; pool.syncSensorMonitoring_(); assert(store.writes==1);
 pool.psiIoId_=IO_ID_INVALID; pool.flowSwitchIoId_=IO_ID_INVALID;
 pool.syncSensorMonitoring_(); assert(!pool.pressureMonitoringEnabled_ && !pool.flowSwitchEnabled_);
 assert(store.writes==3); pool.syncSensorMonitoring_(); assert(store.writes==3);
 pool.cfgStore_=nullptr; pool.psiIoId_=194; pool.syncSensorMonitoring_();
 assert(pool.pressureMonitoringEnabled_);
}
'''
        compiler = shutil.which('g++') or r'C:\msys64\ucrt64\bin\g++.exe'
        with tempfile.TemporaryDirectory() as directory:
            cpp = Path(directory) / 'test.cpp'
            exe = Path(directory) / ('test.exe' if os.name == 'nt' else 'test')
            cpp.write_text(code, encoding='utf-8')
            subprocess.run([compiler, '-std=c++17', str(cpp), '-o', str(exe)], check=True)
            subprocess.run([str(exe)], check=True)


if __name__ == '__main__':
    unittest.main()
