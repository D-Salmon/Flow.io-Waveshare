"""Exercise production error diagnostics with remapped, unavailable and running dependencies."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
ARDUINO_JSON = Path(os.environ.get('FLOWIO_TEST_LIBDEPS', ROOT / '.pio/libdeps')) / 'Flowio-waveshare-esp32-s3/ArduinoJson/src'

PROGRAM = r'''
#include "Modules/PoolDeviceModule/PoolDeviceCommandError.h"
#include <cassert>
#include <cstring>
namespace Log { void warn(LogModuleId, const char*, ...) {} }
struct Fixture { bool on=false; bool available=true; uint16_t mask=1U<<8; };
int main() {
  Fixture fixture;
  PoolDeviceService service{}; service.ctx=&fixture;
  service.meta=[](void* ctx,uint8_t slot,PoolDeviceSvcMeta* meta) {
    if(slot!=1 && slot!=8) return POOLDEV_SVC_ERR_UNKNOWN_SLOT;
    meta->slot=slot; meta->used=1;
    if(slot==1) meta->dependsOnMask=static_cast<Fixture*>(ctx)->mask;
    else std::strcpy(meta->label,"Filtration \"B\"");
    return POOLDEV_SVC_OK;
  };
  service.readActualOn=[](void* ctx,uint8_t,uint8_t* on,uint32_t*) {
    auto& state=*static_cast<Fixture*>(ctx); *on=state.on;
    return state.available?POOLDEV_SVC_OK:POOLDEV_SVC_ERR_NOT_READY;
  };
  char reply[512]; JsonDocument result;
  auto read=[&](char* buffer) { assert(!deserializeJson(result,static_cast<const char*>(buffer))); };
  auto diagnose=[&] { assert(writePoolDeviceCommandError(reply,sizeof(reply),ErrorCode::InterlockBlocked,"poollogic.ph_pump.write",1,&service)); read(reply); };
  diagnose();
  assert(result["slot"]==1 && result["err"]["code"]=="InterlockBlocked");
  assert(result["err"]["dependency"]["slot"]==8); // Configured dependency, not fixed pd0.
  assert(result["err"]["dependency"]["name"]=="Filtration \"B\"");
  assert(result["err"]["dependency"]["state"]=="off");
  fixture.available=false; diagnose(); assert(result["err"]["dependency"]["state"]=="unavailable");
  fixture.available=true; fixture.on=true; diagnose(); assert(result["err"]["dependency"].isUnbound());
  fixture.on=false; fixture.mask=1U<<1; diagnose(); assert(result["err"]["dependency"].isUnbound()); // No self-dependency guess.
  fixture.mask=1U<<8;
  assert(writePoolDeviceCommandError(reply,sizeof(reply),ErrorCode::Disabled,"poollogic.ph_pump.write",1,&service));
  read(reply); assert(result["err"]["code"]=="Disabled" && result["err"]["dependency"].isUnbound());
  char small[125];
  assert(writePoolDeviceCommandError(small,sizeof(small),ErrorCode::InterlockBlocked,"poollogic.ph_pump.write",1,&service));
  read(small); assert(result["err"]["code"]=="InterlockBlocked" && result["err"]["dependency"].isUnbound());
  assert(writePoolDeviceCommandError(reply,sizeof(reply),ErrorCode::InterlockBlocked,"poollogic.ph_pump.write",1,nullptr));
  read(reply); assert(result["err"]["dependency"].isUnbound());
}
'''

class ManualCommandFeedbackTest(unittest.TestCase):
    def test_dependency_error_is_precise_and_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'test.cpp'
            binary = Path(directory) / 'test.exe'
            source.write_text(PROGRAM, encoding='utf-8')
            subprocess.run(['C:/msys64/ucrt64/bin/g++.exe', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            '-Itest/host/stubs', '-Iinclude', '-Isrc', '-I'+str(ARDUINO_JSON), str(source),
                            'test/host/json_allocator.cpp', '-o', str(binary)], cwd=ROOT, check=True)
            subprocess.run([str(binary)], check=True)

if __name__ == '__main__':
    unittest.main()
