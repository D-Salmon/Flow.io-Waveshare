#pragma once
#include "Core/I2cBus.h"
constexpr int INA226_AVERAGE_16 = 16;
constexpr int INA226_CONV_TIME_1100 = 1100;
constexpr int INA226_CONTINUOUS = 7;
class INA226_WE {
public:
    inline static int initCalls = 0;
    inline static uint8_t lastAddress = 0;
    inline static uint8_t error = 0;
    inline static float resistor = 0;
    uint8_t address;
    INA226_WE(TwoWire*, uint8_t addr) : address(addr) {}
    bool init() { ++initCalls; lastAddress = address; return true; }
    void setAverage(int) {}
    void setConversionTime(int, int) {}
    void setMeasureMode(int) {}
    void setResistorRange(float value, float) { resistor = value; }
    uint8_t getI2cErrorCode() { return error; }
    float getShuntVoltage_mV() { return 10; }
    float getBusVoltage_V() { return 12; }
    float getCurrent_mA() { return 100; }
    float getBusPower() { return 1200; }
};
