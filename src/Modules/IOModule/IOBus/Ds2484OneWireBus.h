#pragma once
/**
 * @file Ds2484OneWireBus.h
 * @brief DS2484 I2C-to-1-Wire bridge for DS18B20 probes.
 */

#include <stdint.h>
#include <DallasTemperature.h>

#include "Core/I2cBus.h"
#include "Modules/IOModule/IOBus/IOneWireTemperatureBus.h"

class Ds2484OneWireBus : public IOneWireTemperatureBus {
public:
    Ds2484OneWireBus() = default;
    Ds2484OneWireBus(I2CBus* bus, uint8_t address);

    void configure(I2CBus* bus, uint8_t address);

    void begin() override;
    void request() override;
    void setWaitForConversion(bool enabled) override;
    bool getAddress(uint8_t index, uint8_t out[8]) const override;
    bool hasAddress(const uint8_t addr[8]) const override;
    float readC(const uint8_t addr[8]) const override;
    uint8_t deviceCount() const override;
    int pin() const override { return -1; }

private:
    bool resetDevice_() const;
    bool waitReady_(uint32_t timeoutMs = 100) const;
    bool setReadPointer_(uint8_t pointer) const;
    bool readStatus_(uint8_t& status) const;
    bool oneWireReset_() const;
    bool oneWireWriteByte_(uint8_t value) const;
    bool oneWireReadByte_(uint8_t& value) const;
    bool oneWireTriplet_(bool searchDirection, uint8_t& status) const;
    bool searchAddress_(uint8_t index, uint8_t out[8]) const;
    static uint8_t crc8_(const uint8_t* data, uint8_t len);

    I2CBus* bus_ = nullptr;
    uint8_t address_ = 0x18;
    bool started_ = false;
    mutable bool scanned_ = false;
    mutable uint8_t deviceCount_ = 0;
    mutable uint8_t addresses_[4][8] = {};
};
