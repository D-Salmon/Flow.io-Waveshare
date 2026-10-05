// Harness for the real IOModule::resolveI2cAddresses_ implementation, appended
// by the host test. Only the physical bus and unrelated module services are fake.
#include <stdint.h>
#include <initializer_list>
// Gain is irrelevant to this bus-only test; the peripheral library is absent.
constexpr uint8_t ADS1X15_GAIN_6144MV = 0;
#include "Modules/IOModule/IOModuleTypes.h"
#include "Core/I2cAddressSelection.h"
#include "Core/FixedI2cAddresses.h"
#include <cassert>
#include <cstring>

#define LOGI(...) do {} while (0)
#define LOGW(...) do {} while (0)
struct Bus {
    bool ready = true, lockOk = true, held = false;
    bool present[128]{};
    unsigned probes[128]{}, locks = 0, unlocks = 0;
    bool beginOk() { return ready; }
    bool lock(unsigned) { ++locks; held = lockOk; return lockOk; }
    void unlock() { assert(held); held = false; ++unlocks; }
    bool probe(uint8_t address) {
        assert(held && validI2cDeviceAddress(address));
        ++probes[address]; return present[address];
    }
};
class IOModule {
public:
    IOModuleConfig cfgData_{};
    IOExpanderConfig expanderCfg_[IO_MAX_EXPANDERS]{};
    Bus* i2cBus_{};
    uint8_t analogI2cAddresses_[IO_SRC_COUNT]{}, expanderI2cAddresses_[IO_MAX_EXPANDERS]{};
    uint8_t activeDs2484Address_ = 0, ds2484Address_ = 0x18;
    const uint8_t* reservedI2cAddresses_{};
    uint8_t reservedI2cAddressCount_{};
    bool expanderUsable_(uint8_t index) { return expanderCfg_[index].enabled; }
    void resolveI2cAddresses_(const bool*, bool);
};

int main() {
    const uint8_t fixed[]{FixedI2cAddresses::Pcf85063Rtc, FixedI2cAddresses::Pcf8574LedPanel};
    Bus bus; IOModule io;
    io.i2cBus_ = &bus; io.reservedI2cAddresses_ = fixed; io.reservedI2cAddressCount_ = 2;
    io.cfgData_.sht40Enabled = io.cfgData_.bmp280Enabled = io.cfgData_.bme680Enabled = io.cfgData_.ina226Enabled = false;
    bool need[IO_SRC_COUNT]{};
    need[IO_SRC_ADS_INTERNAL_SINGLE] = need[IO_SRC_ADS_EXTERNAL_DIFF] = true;
    for (uint8_t ph : {0x48, 0x49}) {
        uint8_t pressure = ph == 0x48 ? 0x49 : 0x48;
        io.cfgData_.adsInternalAddr = ph; io.cfgData_.adsExternalAddr = pressure;
        io.cfgData_.adsInternalSecondaryAddr = pressure; io.cfgData_.adsExternalSecondaryAddr = ph;
        std::memset(bus.present, 0, sizeof(bus.present)); bus.present[pressure] = true;
        io.resolveI2cAddresses_(need, false);
        assert(!io.analogI2cAddresses_[IO_SRC_ADS_INTERNAL_SINGLE]);
        assert(io.analogI2cAddresses_[IO_SRC_ADS_EXTERNAL_DIFF] == pressure);
        assert(io.cfgData_.adsInternalAddr == ph && io.cfgData_.adsExternalAddr == pressure);
    }
    // One physical bridge supports both temperatures. Another provider cannot
    // claim it through a fallback while either bridge-connected probe is used.
    need[IO_SRC_ADS_INTERNAL_SINGLE] = need[IO_SRC_ADS_EXTERNAL_DIFF] = false;
    need[IO_SRC_DS18_WATER] = need[IO_SRC_DS18_AIR] = true;
    io.expanderCfg_[0].enabled = true; io.expanderCfg_[0].address = 0x20; io.expanderCfg_[0].secondaryAddress = 0x18;
    bus.present[0x18] = true; std::memset(bus.probes, 0, sizeof(bus.probes));
    io.resolveI2cAddresses_(need, true);
    assert(io.activeDs2484Address_ == 0x18 && !io.expanderI2cAddresses_[0] && bus.probes[0x18] == 1);
    // Duplicate primary, rather than fallback: reject both ambiguous providers.
    io.expanderCfg_[0].address = 0x18;
    io.resolveI2cAddresses_(need, true);
    assert(!io.activeDs2484Address_ && !io.expanderI2cAddresses_[0]);
    // Fixed HMI/RTC addresses remain protected even with temperature transport off.
    io.expanderCfg_[0].address = fixed[1]; bus.present[fixed[1]] = true;
    io.resolveI2cAddresses_(need, false);
    assert(!io.expanderI2cAddresses_[0] && !bus.probes[fixed[1]]);
    io.expanderCfg_[0].address = 0x20; io.expanderCfg_[0].secondaryAddress = fixed[0];
    bus.present[fixed[0]] = true;
    io.resolveI2cAddresses_(need, false);
    assert(!io.expanderI2cAddresses_[0] && !bus.probes[fixed[0]]);
    // Correct relay secondary works without rewriting its persisted primary.
    io.expanderCfg_[0].secondaryAddress = 0x21; bus.present[0x21] = true;
    io.resolveI2cAddresses_(need, false);
    assert(io.expanderI2cAddresses_[0] == 0x21 && io.expanderCfg_[0].address == 0x20);
    assert(bus.locks == bus.unlocks && !bus.held);
    bus.lockOk = false;
    io.resolveI2cAddresses_(need, true);
    assert(!io.activeDs2484Address_ && !io.expanderI2cAddresses_[0] && !bus.held);
    for (auto address : io.analogI2cAddresses_) assert(!address);
}
