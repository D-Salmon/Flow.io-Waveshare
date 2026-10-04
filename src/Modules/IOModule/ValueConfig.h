#pragma once
#include "Core/ConfigStore.h"
#include "Core/Values/ValueRegistry.h"
#include <stdio.h>

/** Persistent definitions, resolved once after physical producers register. */
struct ValueConfig {
    struct Definition {
        // Derived values require explicit activation when no saved setting exists.
        bool enabled = false;
        uint16_t source = VALUE_INVALID;
        double scale = 1, offset = 0;
        uint8_t mode = 0;
        char name[64]{};
        char path[20]{}, keys[6][12]{};
        ConfigVariable<char, 0> nameVar{};
        ConfigVariable<bool, 0> enabledVar{};
        ConfigVariable<uint16_t, 0> sourceVar{};
        ConfigVariable<double, 0> scaleVar{}, offsetVar{};
        ConfigVariable<uint8_t, 0> modeVar{};
    } definitions[ValueIds::DerivedCapacity];

    void registerConfig(ConfigStore& cfg, uint8_t moduleId) {
        for (uint8_t i = 0; i < ValueIds::DerivedCapacity; ++i) {
            auto& d = definitions[i];
            snprintf(d.path, sizeof(d.path), "io/value/v%02u", unsigned(i));
            for (uint8_t key = 0; key < 6; ++key)
                snprintf(d.keys[key], sizeof(d.keys[key]), "val%02u_%u", unsigned(i), unsigned(key));
            d.sourceVar = {d.keys[0], "source", d.path, ConfigType::UInt16, &d.source, ConfigPersistence::Persistent, 0};
            d.scaleVar = {d.keys[1], "scale", d.path, ConfigType::Double, &d.scale, ConfigPersistence::Persistent, 0};
            d.offsetVar = {d.keys[2], "offset", d.path, ConfigType::Double, &d.offset, ConfigPersistence::Persistent, 0};
            d.modeVar = {d.keys[3], "aggregation", d.path, ConfigType::UInt8, &d.mode, ConfigPersistence::Persistent, 0};
            d.enabledVar = {d.keys[4], "enabled", d.path, ConfigType::Bool, &d.enabled, ConfigPersistence::Persistent, 0};
            d.nameVar = {d.keys[5], "name", d.path, ConfigType::CharArray, d.name, ConfigPersistence::Persistent, sizeof(d.name)};
            const uint8_t branch = 160 + i;
            cfg.registerVar(d.nameVar, moduleId, branch);
            cfg.registerVar(d.enabledVar, moduleId, branch);
            cfg.registerVar(d.sourceVar, moduleId, branch); cfg.registerVar(d.scaleVar, moduleId, branch);
            cfg.registerVar(d.offsetVar, moduleId, branch); cfg.registerVar(d.modeVar, moduleId, branch);
        }
    }
    bool resolve(ValueRegistry& registry) const {
        bool resolved[ValueIds::DerivedCapacity]{};
        for (uint8_t pass = 0; pass < ValueIds::DerivedCapacity; ++pass) {
            bool progress = false;
            for (uint8_t i = 0; i < ValueIds::DerivedCapacity; ++i) {
                const auto& d = definitions[i];
                if (!d.enabled || resolved[i] || d.source == VALUE_INVALID) continue;
                ValueSnapshot source;
                if (!registry.read(d.source, source)) continue;
                if (d.mode > uint8_t(AggregationMode::Counter) ||
                    !registry.defineAffine(ValueIds::Derived + i, d.source, d.scale, d.offset,
                                           static_cast<AggregationMode>(d.mode))) return false;
                resolved[i] = true; progress = true;
            }
            if (!progress) break;
        }
        for (uint8_t i = 0; i < ValueIds::DerivedCapacity; ++i)
            if (definitions[i].enabled && definitions[i].source != VALUE_INVALID && !resolved[i]) return false;
        return true;
    }
};
