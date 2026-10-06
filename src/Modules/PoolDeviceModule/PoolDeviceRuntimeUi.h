#pragma once

#include "Domain/Pool/PoolIds.h"

// Shared by the module, HTTP snapshots and live-change comparisons.
namespace PoolDeviceRuntimeUi {
enum ValueId : uint8_t {
    FiltrationOn = 1,
    PhPumpOn = 2,
    ChlorinePumpOn = 3,
    RobotOn = 4,
    DeviceCount = 5,
    HeaterOn = 6,
};

constexpr uint8_t deviceSlot(uint8_t valueId)
{
    switch (valueId) {
        case FiltrationOn: return PoolIds::DeviceFiltrationPump;
        case PhPumpOn: return PoolIds::DevicePhPump;
        case ChlorinePumpOn: return PoolIds::DeviceChlorinePump;
        case RobotOn: return PoolIds::DeviceRobot;
        case HeaterOn: return PoolIds::DeviceWaterHeater;
        default: return POOL_DEVICE_INVALID;
    }
}
} // namespace PoolDeviceRuntimeUi
