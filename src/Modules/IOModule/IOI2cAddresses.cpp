#include "IOModule.h"
#include "Core/I2cAddressSelection.h"

#define LOG_MODULE_ID ((LogModuleId)LogModuleIdValue::IOModule)
#include "Core/ModuleLog.h"

void IOModule::resolveI2cAddresses_(const bool* needAnalogSource, bool needDs2484)
{
    constexpr size_t bridgeSlot = IO_SRC_COUNT + IO_MAX_EXPANDERS;
    constexpr size_t deviceCount = bridgeSlot + 1;
    I2cAddressSelection devices[deviceCount]{};
    const char* names[IO_SRC_COUNT]{};
    const auto addAnalog = [&](uint8_t source, const char* name, bool enabled,
                               uint8_t primary, uint8_t secondary) {
        devices[source] = {primary, secondary, enabled};
        names[source] = name;
    };
    // ADS providers have no enable switch: a configured binding enables them.
    addAnalog(IO_SRC_ADS_INTERNAL_SINGLE, "ads1115_int", needAnalogSource[IO_SRC_ADS_INTERNAL_SINGLE],
              cfgData_.adsInternalAddr, cfgData_.adsInternalSecondaryAddr);
    addAnalog(IO_SRC_ADS_EXTERNAL_DIFF, "ads1115_ext", needAnalogSource[IO_SRC_ADS_EXTERNAL_DIFF],
              cfgData_.adsExternalAddr, cfgData_.adsExternalSecondaryAddr);
    addAnalog(IO_SRC_SHT40, "sht40", cfgData_.sht40Enabled,
              cfgData_.sht40Address, cfgData_.sht40SecondaryAddress);
    addAnalog(IO_SRC_BMP280, "bmp280", cfgData_.bmp280Enabled,
              cfgData_.bmp280Address, cfgData_.bmp280SecondaryAddress);
    addAnalog(IO_SRC_BME680, "bme680", cfgData_.bme680Enabled,
              cfgData_.bme680Address, cfgData_.bme680SecondaryAddress);
    addAnalog(IO_SRC_INA226, "ina226", cfgData_.ina226Enabled,
              cfgData_.ina226Address, cfgData_.ina226SecondaryAddress);
    for (uint8_t i = 0; i < IO_MAX_EXPANDERS; ++i) {
        devices[IO_SRC_COUNT + i] = {expanderCfg_[i].address,
                                    expanderCfg_[i].secondaryAddress,
                                    expanderUsable_(i)};
        expanderI2cAddresses_[i] = 0;
    }
    for (auto& address : analogI2cAddresses_) address = 0;
    activeDs2484Address_ = 0;
    // Both temperature probes share one bridge, so its address is claimed once.
    devices[bridgeSlot] = {ds2484Address_, 0, needDs2484};
    if (!i2cBus_ || !i2cBus_->beginOk() || !i2cBus_->lock(50)) {
        LOGW("I2C address selection: bus unavailable");
        return;
    }
    // Snapshot each address once under the bus lock. Arbitration remains
    // deterministic even if a flaky device acknowledges only intermittently.
    bool present[128]{};
    bool probed[128]{};
    resolveI2cAddresses(devices, deviceCount,
        [&](uint8_t address) {
            if (!probed[address]) {
                present[address] = i2cBus_->probe(address);
                probed[address] = true;
            }
            return present[address];
        }, reservedI2cAddresses_, reservedI2cAddressCount_);
    i2cBus_->unlock();

    for (uint8_t i = 0; i < IO_SRC_COUNT; ++i) {
        analogI2cAddresses_[i] = devices[i].active;
        if (!devices[i].enabled) continue;
        LOGI("I2C %s primary=0x%02X secondary=0x%02X active=0x%02X: %s",
             names[i], devices[i].primary, devices[i].secondary, devices[i].active,
             i2cAddressStatusName(devices[i].status));
    }
    for (uint8_t i = 0; i < IO_MAX_EXPANDERS; ++i) {
        const auto& device = devices[IO_SRC_COUNT + i];
        expanderI2cAddresses_[i] = device.active;
        if (!device.enabled) continue;
        LOGI("I2C expander=%u primary=0x%02X secondary=0x%02X active=0x%02X: %s",
             (unsigned)i, device.primary, device.secondary, device.active,
             i2cAddressStatusName(device.status));
    }
    activeDs2484Address_ = devices[bridgeSlot].active;
    if (needDs2484) {
        LOGI("I2C DS2484 primary=0x%02X active=0x%02X: %s",
             ds2484Address_, activeDs2484Address_,
             i2cAddressStatusName(devices[bridgeSlot].status));
    }
}
