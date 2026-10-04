#pragma once
#include <ArduinoJson.h>
#include "Core/Services/PoolSerialTelemetry.h"

inline void writePoolTelemetryJson(JsonObject root, PoolTelemetryProfile profile, const PoolTelemetryState& state,
                                   bool includeUnits = false)
{
    if (profile == PoolTelemetryProfile::None) return;
    auto values = root.createNestedObject("telemetry");
    for (const auto& field : kHeatPumpPolyFields) {
        if (!(state.validBlocks & (1U << field.block))) values[field.key] = nullptr;
        else if (field.mask) values[field.key] = poolTelemetryValue(state, field) != 0;
        else values[field.key] = poolTelemetryValue(state, field);
    }
    root["telemetry_error"] = state.error;
    if (includeUnits) {
        auto units = root.createNestedObject("telemetry_units");
        for (const auto& field : kHeatPumpPolyFields) if (field.unit[0]) units[field.key] = field.unit;
    }
}
