#pragma once
#include "Core/Services/IPoolConfiguration.h"

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

// Manual electrolysis depends on circulation feedback; temperature is an automatic-only limit.
constexpr bool manualElectrolysisAllowed(bool filtrationOn, bool pressureEnabled, bool pressureOk,
                                        bool flowEnabled, bool flowOk)
{
    return filtrationOn && (!pressureEnabled || pressureOk) && (!flowEnabled || flowOk);
}
