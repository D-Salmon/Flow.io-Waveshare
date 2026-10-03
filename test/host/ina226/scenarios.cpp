#include "Modules/IOModule/IODrivers/Ina226Driver.h"
#include <cassert>
#include <cmath>
#include <initializer_list>

int main()
{
    for (uint8_t address : {0x40, 0x44}) {
        I2CBus bus;
        bus.address = address;
        Ina226DriverConfig cfg;
        cfg.address = address;
        cfg.shuntOhms = 0.01f;
        Ina226Driver driver("ina", &bus, cfg);
        assert(driver.begin() && !bus.locked);
        assert(INA226_WE::lastAddress == address && INA226_WE::resistor == cfg.shuntOhms);
        driver.tick(500);
        const float expected[]{10, 12, 100, 1200, 12.01f};
        for (uint8_t channel = 0; channel < 5; ++channel) {
            IOAnalogSample sample;
            assert(driver.readSample(channel, sample));
            assert(std::fabs(sample.value - expected[channel]) < 0.001f);
        }
        bus.manufacturer = 0;
        int before = INA226_WE::initCalls;
        assert(!driver.begin() && !bus.locked && INA226_WE::initCalls == before);
        IOAnalogSample sample;
        assert(!driver.readSample(0, sample));
        bus.manufacturer = 0x5449;
        bus.device = 0x2261; // Revision differences do not change the device identity.
        assert(driver.begin());
        bus.device = 0x3220;
        before = INA226_WE::initCalls;
        assert(!driver.begin() && INA226_WE::initCalls == before);
        bus.device = 0x2260;
        bus.conversionReady = false;
        fakeTime = UINT32_MAX - 50; // Timeout also works across millis wraparound.
        const uint32_t start = fakeTime;
        assert(!driver.begin() && !bus.locked);
        assert(static_cast<uint32_t>(fakeTime - start) == 150);
        bus.readOk = false;
        before = INA226_WE::initCalls;
        assert(!driver.begin() && !bus.locked && INA226_WE::initCalls == before);
        bus.readOk = true;
        bus.conversionReady = true;
        INA226_WE::error = 2;
        assert(!driver.begin() && !bus.locked);
        INA226_WE::error = 0;
    }
}
