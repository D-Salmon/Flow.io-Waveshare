"""Disabled and I2C probe configurations must not initialize direct GPIO buses."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

class OneWireLazyStartTest(unittest.TestCase):
    def test_gpio_acquisition_only_on_begin(self):
        with tempfile.TemporaryDirectory(prefix='flow-onewire-start-') as folder:
            folder = Path(folder)
            (folder/'OneWire.h').write_text('''#pragma once
#include <stdint.h>
inline int gpioBegins=0, selectedPin=-1;
class OneWire {public: OneWire()=default; OneWire(int pin){begin(pin);} void begin(uint8_t pin){gpioBegins++;selectedPin=pin;}};
''', encoding='utf-8')
            (folder/'DallasTemperature.h').write_text('''#pragma once
#include <stdint.h>
#include "OneWire.h"
#define DEVICE_DISCONNECTED_C -127
inline int scans=0,requests=0;
class DallasTemperature {public: DallasTemperature()=default;void setOneWire(OneWire*){} void begin(){scans++;} void setWaitForConversion(bool){} void requestTemperatures(){requests++;} bool getAddress(uint8_t*,uint8_t){return false;} float getTempC(const uint8_t*){return 21;}uint8_t getDeviceCount(){return 0;}};
''',encoding='utf-8')
            test = folder/'test.cpp'
            test.write_text('''#include <cassert>
#include "Modules/IOModule/IOBus/OneWireBus.h"
int main(){
 OneWireBus water(20),air(19),disabled(-1);
 assert(gpioBegins==0&&scans==0);
 water.request();assert(requests==0);
 disabled.begin();assert(gpioBegins==0);
 water.begin();assert(gpioBegins==1&&selectedPin==20&&scans==1);
 water.begin();assert(gpioBegins==1&&scans==1);
 water.request();assert(requests==1);
 air.begin();assert(gpioBegins==2&&selectedPin==19&&scans==2);
}
''',encoding='utf-8')
            exe = folder/'test.exe'
            subprocess.run(['C:/msys64/ucrt64/bin/g++.exe','-std=c++17','-I'+str(folder),'-I'+str(ROOT/'src'),str(test),str(ROOT/'src/Modules/IOModule/IOBus/OneWireBus.cpp'),'-o',str(exe)],check=True)
            subprocess.run([str(exe)],check=True)

if __name__=='__main__':
    unittest.main()
