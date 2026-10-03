#pragma once
#include <stdint.h>
struct TwoWire {};
inline TwoWire Wire;
inline uint32_t fakeTime = 0;
inline uint32_t millis() { return fakeTime; }
inline void delay(uint32_t ms) { fakeTime += ms; }
class I2CBus {
public:
    uint8_t address = 0x40;
    uint16_t manufacturer = 0x5449;
    uint16_t device = 0x2260;
    bool locked = false;
    bool available = true;
    bool readOk = true;
    bool conversionReady = true;
    TwoWire* wire() { return &Wire; }
    bool lock(uint32_t) { return locked = available; }
    void unlock() { locked = false; }
    bool readReg(uint8_t addr, uint8_t reg, uint8_t* bytes, uint16_t len) {
        if (!locked || !readOk || addr != address || len != 2) return false;
        const uint16_t value = reg == 0xFE ? manufacturer : reg == 0xFF ? device : conversionReady ? 8 : 0;
        bytes[0] = value >> 8;
        bytes[1] = value & 0xFF;
        return true;
    }
};
