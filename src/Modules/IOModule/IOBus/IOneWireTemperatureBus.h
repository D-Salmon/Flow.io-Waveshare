#pragma once
/**
 * @file IOneWireTemperatureBus.h
 * @brief Minimal temperature-oriented 1-Wire bus abstraction.
 */

#include <stdint.h>

class IOneWireTemperatureBus {
public:
    virtual ~IOneWireTemperatureBus() = default;

    virtual void begin() = 0;
    virtual void request() = 0;
    virtual void setWaitForConversion(bool enabled) = 0;
    virtual bool getAddress(uint8_t index, uint8_t out[8]) const = 0;
    virtual bool hasAddress(const uint8_t addr[8]) const = 0;
    virtual float readC(const uint8_t addr[8]) const = 0;
    virtual uint8_t deviceCount() const = 0;
    virtual int pin() const = 0;
};
