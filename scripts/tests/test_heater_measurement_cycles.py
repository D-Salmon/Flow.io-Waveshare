"""Run production heater decisions with wired and disabled water probes."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class HeaterMeasurementTests(unittest.TestCase):
    def test_disabled_probe_cannot_request_filtration(self):
        source = (ROOT / 'src/Modules/PoolLogicModule/PoolLogicControl.cpp').read_text(encoding='utf-8')
        start = source.index('    bool heaterDesired = guidedDeviceOn_')
        control = source[start:source.index('    // Chemical dosing', start)]
        start = source.index('    auto hasHeatAssistFlag =')
        accessors = source[start:source.index('    auto refreshHeatAssistAdaptiveInterval =', start)]
        program = r'''
#include <cassert>
#include <cmath>
#include <cstdint>
#include <initializer_list>
#define LOGD(...) ((void)0)
constexpr uint16_t IO_ID_INVALID=65535;
constexpr float kHeaterHysteresisC=0.3f;
constexpr uint16_t kHeatAssistProbeRunSec=300,kHeatAssistAdaptiveFallbackMin=30;
constexpr uint8_t kHeatAssistFlagProbeRunning=1,kHeatAssistFlagHeatingActive=2,kHeatAssistFlagFastCycle=4;
enum class HeatAssistReason {Disabled,ManualMode,PsiBlocked,SetpointInvalid,TempUnavailable,ProbeWaitAdaptive,
 ProbeRunning,Heating,IdlePumpOn,SetpointReached};
struct Heater {
 uint16_t waterTempIoId_=IO_ID_INVALID;
 bool heaterAutoMode_=true,autoMode_=true,psiError_=false,flowError_=false,sensorHoldWaterTemp_=true;
 bool heatAssistValidatedWaterTempValid_=false,heatAssistAdaptiveInputsValid_=false;
 float heaterSetpoint_=28.5f;uint8_t heaterDeviceSlot_=7;
 uint8_t heatAssistFlags_=0;uint32_t heatAssistTimingPacked_=0;uint16_t heatAssistIntervalMin_=30;
 HeatAssistReason heatAssistReason_=HeatAssistReason::Disabled;
 struct Fsm {bool on=false,lastDesired=false;} filtrationFsm_,heaterFsm_;
 bool resultFiltration=false,resultHeater=false;
 bool guidedDeviceOn_(uint8_t,bool)const{return true;}
 void step(uint32_t nowMs,bool filtrationDesiredBase,bool waterTempFresh=false,float waterTemp=20){
  bool filtrationDesired=filtrationDesiredBase;
''' + accessors + r'''
  auto recordValidatedWaterTemperature = [&](){return waterTempFresh;};
  const bool recordedUnderFlow=waterTempFresh;
''' + control + r'''
  resultFiltration=filtrationDesired;resultHeater=heaterDesired;
 }
};
int main(){
 for(bool base:{false,true})for(uint8_t flags:{0,1,2,3}){
  Heater h;h.heatAssistFlags_=flags;h.heatAssistTimingPacked_=0x001E0001;
  h.heatAssistValidatedWaterTempValid_=h.heatAssistAdaptiveInputsValid_=true;
  h.step(10000,base);
  assert(h.resultFiltration==base&&!h.resultHeater);
  assert(h.heatAssistFlags_==0&&h.heatAssistTimingPacked_==0);
  assert(!h.heatAssistValidatedWaterTempValid_&&!h.heatAssistAdaptiveInputsValid_);
  assert(h.heatAssistReason_==HeatAssistReason::TempUnavailable);
  h.step(3600000,base);assert(h.resultFiltration==base&&!h.resultHeater);
 }
 Heater pipe;pipe.waterTempIoId_=42;pipe.step(10000,false);
 assert(pipe.resultFiltration&&!pipe.resultHeater&&pipe.heatAssistFlags_==1);
 pipe.step(310000,false);assert(!pipe.resultFiltration&&!pipe.resultHeater&&pipe.heatAssistFlags_==0);
 pipe.step(311000,false);assert(!pipe.resultFiltration); // No immediate retry after an unavailable sample.
 Heater coldPipe;coldPipe.waterTempIoId_=42;coldPipe.step(10000,false,true,20);
 assert(coldPipe.resultFiltration&&!coldPipe.resultHeater);
 coldPipe.step(310000,false,true,20);assert(coldPipe.resultFiltration&&coldPipe.resultHeater);
 Heater basin;basin.waterTempIoId_=42;basin.sensorHoldWaterTemp_=false;
 basin.step(10000,false);assert(!basin.resultFiltration&&!basin.resultHeater);
 basin.step(10000,false,true,20);assert(basin.resultFiltration&&basin.resultHeater);
}
'''
        with tempfile.TemporaryDirectory(prefix='flow-heat-cycle-') as directory:
            cpp = Path(directory) / 'heater.cpp'
            exe = Path(directory) / 'heater.exe'
            cpp.write_text(program, encoding='utf-8')
            subprocess.run(['C:/msys64/ucrt64/bin/g++.exe', '-std=c++17', '-Wall', '-Wextra', '-Werror', str(cpp), '-o', str(exe)], check=True)
            subprocess.run([str(exe)], check=True)


if __name__ == '__main__':
    unittest.main()
