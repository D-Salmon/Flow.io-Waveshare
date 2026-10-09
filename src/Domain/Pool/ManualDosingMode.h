#pragma once
#include "Core/Services/IPoolConfiguration.h"
#include "Core/Services/ActuatorControlState.h"

enum class ManualDosingTarget : uint8_t { None, Ph, Disinfection };
struct ManualDosingMode {
    const char* module;
    const char* key;
};
constexpr ManualDosingMode manualDosingMode(ManualDosingTarget target, PoolDisinfectionMethod method)
{
    if (target == ManualDosingTarget::Ph) return {"poollogic/ph", "ph_auto_mode"};
    if (target != ManualDosingTarget::Disinfection) return {nullptr, nullptr};
    switch (method) {
        case PoolDisinfectionMethod::ChlorineBromine: return {"poollogic/chlorine", "dis_auto_mode"};
        case PoolDisinfectionMethod::SaltElectrolysis:
        case PoolDisinfectionMethod::ActiveOxygen: return {"poollogic/modes", "treatment_auto_mode"};
        default: return {nullptr, nullptr};
    }
}

// One decision supplies both the manual control gate and its diagnostics.
// An unavailable optional sensor blocks only when its monitoring is enabled.
// Temperature and ORP remain automatic regulation inputs, not manual start limits.
constexpr uint16_t manualElectrolysisBlocks(bool filtrationOn,
    bool pressureEnabled, bool pressureAvailable, float pressure, float pressureLow, float pressureHigh,
    bool flowEnabled, bool flowAvailable, bool flowPresent, bool pressureAlarm, bool flowAlarm)
{
    uint16_t reasons = filtrationOn ? ACTUATOR_ON_BLOCK_NONE : ACTUATOR_ON_BLOCK_FILTRATION;
    if (pressureEnabled) {
        if (!pressureAvailable) reasons |= ACTUATOR_ON_BLOCK_PRESSURE_UNAVAILABLE;
        else if (pressure < pressureLow) reasons |= ACTUATOR_ON_BLOCK_PRESSURE_LOW;
        else if (pressure > pressureHigh) reasons |= ACTUATOR_ON_BLOCK_PRESSURE_HIGH;
    }
    if (flowEnabled) {
        if (!flowAvailable) reasons |= ACTUATOR_ON_BLOCK_FLOW_UNAVAILABLE;
        else if (!flowPresent) reasons |= ACTUATOR_ON_BLOCK_FLOW_ABSENT;
    }
    if (pressureAlarm) reasons |= ACTUATOR_ON_BLOCK_PRESSURE_ALARM;
    if (flowAlarm) reasons |= ACTUATOR_ON_BLOCK_FLOW_ALARM;
    return reasons;
}
