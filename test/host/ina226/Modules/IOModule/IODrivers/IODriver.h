#pragma once
#include <stdint.h>
struct IOAnalogSample { float value = 0; uint32_t seq = 0; bool hasSeq = false; };
class IAnalogSourceDriver {
public:
    virtual ~IAnalogSourceDriver() = default;
    virtual const char* id() const = 0;
    virtual bool begin() = 0;
    virtual void tick(uint32_t) = 0;
    virtual bool readSample(uint8_t, IOAnalogSample&) const = 0;
};
