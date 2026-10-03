/**
 * @file Ina226Driver.cpp
 * @brief Implementation file.
 */

#include "Ina226Driver.h"

#define LOG_MODULE_ID ((LogModuleId)LogModuleIdValue::IOModule)
#include "Core/ModuleLog.h"

namespace {
constexpr float kIna226FullScaleShuntVoltage = 0.0819f;
constexpr uint8_t kManufacturerRegister = 0xFE;
constexpr uint8_t kDeviceRegister = 0xFF;
constexpr uint8_t kMaskEnableRegister = 0x06;
constexpr uint16_t kManufacturerId = 0x5449;
constexpr uint16_t kDeviceId = 0x2260;
constexpr uint16_t kDeviceIdMask = 0xFFF0; // Low nibble is the silicon revision.
constexpr uint16_t kConversionReady = 0x0008;
constexpr uint32_t kConversionTimeoutMs = 150; // 16 * (1.1 + 1.1) ms nominal.

bool readWord(I2CBus& bus, uint8_t address, uint8_t reg, uint16_t& value)
{
    uint8_t bytes[2]{};
    if (!bus.readReg(address, reg, bytes, sizeof(bytes))) return false;
    value = (static_cast<uint16_t>(bytes[0]) << 8) | bytes[1];
    return true;
}

bool waitForConversion(I2CBus& bus, uint8_t address)
{
    uint16_t flags = 0;
    if (!readWord(bus, address, kMaskEnableRegister, flags)) return false;
    const uint32_t start = millis();
    do {
        if (!readWord(bus, address, kMaskEnableRegister, flags)) return false;
        if (flags & kConversionReady) return true;
        delay(1);
    } while (static_cast<uint32_t>(millis() - start) < kConversionTimeoutMs);
    return false;
}
}

Ina226Driver::Ina226Driver(const char* driverId, I2CBus* bus, const Ina226DriverConfig& cfg)
    : driverId_(driverId), bus_(bus), cfg_(cfg), ina_(bus ? bus->wire() : &Wire, cfg.address)
{
}

bool Ina226Driver::begin()
{
    ready_ = false;
    valid_ = false;
    if (!bus_) return false;
    if (cfg_.shuntOhms <= 0.0f) {
        LOGW("INA226 %s invalid shunt %.6f Ohm", driverId_ ? driverId_ : "sensor", (double)cfg_.shuntOhms);
        return false;
    }
    if (!bus_->lock(50)) return false;

    // Allocation follows configuration priority; identity verification must
    // precede reset/calibration writes to a potentially unrelated responder.
    uint16_t manufacturer = 0;
    uint16_t device = 0;
    bool ok = readWord(*bus_, cfg_.address, kManufacturerRegister, manufacturer) &&
              readWord(*bus_, cfg_.address, kDeviceRegister, device) &&
              manufacturer == kManufacturerId && (device & kDeviceIdMask) == kDeviceId;
    if (ok) ok = ina_.init();
    if (ok) {
        const float maxCurrentA = kIna226FullScaleShuntVoltage / cfg_.shuntOhms;
        ina_.setAverage(INA226_AVERAGE_16);
        ina_.setConversionTime(INA226_CONV_TIME_1100, INA226_CONV_TIME_1100);
        ina_.setMeasureMode(INA226_CONTINUOUS);
        ina_.setResistorRange(cfg_.shuntOhms, maxCurrentA);
        ok = ina_.getI2cErrorCode() == 0 && waitForConversion(*bus_, cfg_.address);
    }
    if (ok) {
        ready_ = true;
        valid_ = false;
        lastPollMs_ = 0;
        seq_ = 0;
    }

    bus_->unlock();

    if (!ok) {
        LOGW("INA226 %s not ready at 0x%02X", driverId_ ? driverId_ : "sensor", cfg_.address);
    }
    return ok;
}

void Ina226Driver::tick(uint32_t nowMs)
{
    if (!ready_ || !bus_) return;
    if ((uint32_t)(nowMs - lastPollMs_) < cfg_.pollMs) return;
    lastPollMs_ = nowMs;

    if (!bus_->lock(20)) return;

    const float shuntMv = ina_.getShuntVoltage_mV();
    if (ina_.getI2cErrorCode() != 0) {
        bus_->unlock();
        return;
    }

    const float busV = ina_.getBusVoltage_V();
    if (ina_.getI2cErrorCode() != 0) {
        bus_->unlock();
        return;
    }

    const float currentMa = ina_.getCurrent_mA();
    if (ina_.getI2cErrorCode() != 0) {
        bus_->unlock();
        return;
    }

    const float powerMw = ina_.getBusPower();
    if (ina_.getI2cErrorCode() != 0) {
        bus_->unlock();
        return;
    }

    bus_->unlock();

    values_[0] = shuntMv;
    values_[1] = busV;
    values_[2] = currentMa;
    values_[3] = powerMw;
    values_[4] = busV + (shuntMv / 1000.0f);
    valid_ = true;
    ++seq_;
}

bool Ina226Driver::readSample(uint8_t channel, IOAnalogSample& out) const
{
    out = IOAnalogSample{};
    if (!valid_ || channel > 4) return false;

    out.value = values_[channel];
    out.seq = seq_;
    out.hasSeq = true;
    return true;
}
