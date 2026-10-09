#pragma once

#include "Core/ErrorCodes.h"
#include "Core/PsramJsonAllocator.h"
#include "Core/Services/IPoolDevice.h"

/** Describe a known unmet dependency without reproducing the control policy.
 * If every dependency is observed running, the normal safety error is retained
 * (confirmation, minimum setpoint or another protection may still block it).
 */
inline bool writePoolDeviceCommandError(char* out, size_t length, ErrorCode code,
                                        const char* where, uint8_t slot,
                                        const PoolDeviceService* service)
{
    if (!writeErrorJsonWithSlot(out, length, code, where, slot)) return false;
    if (code != ErrorCode::InterlockBlocked || !service || !service->meta)
        return true;
    PoolDeviceSvcMeta target{};
    if (service->meta(service->ctx, slot, &target) != POOLDEV_SVC_OK) return true;
    if (target.onBlockReasons) {
        JsonDocument doc(psramOnlyJsonAllocator());
        if (deserializeJson(doc, out)) return true;
        auto reasons = doc["err"]["safety_reasons"].to<JsonArray>();
        for (uint16_t bit = 1; bit != 0; bit <<= 1) {
            if (!(target.onBlockReasons & bit)) continue;
            const char* name = actuatorOnBlockName(bit);
            if (name) reasons.add(name);
        }
        if (!doc.overflowed() && measureJson(doc) < length) serializeJson(doc, out, length);
        return true;
    }
    if (!service->readActualOn) return true;
    for (uint8_t dependency = 0; dependency < 16U; ++dependency) {
        if (dependency == slot || !(target.dependsOnMask & (uint16_t(1U) << dependency))) continue;
        uint8_t on = 0;
        const auto state = service->readActualOn(service->ctx, dependency, &on, nullptr);
        if (state == POOLDEV_SVC_OK && on) continue;
        PoolDeviceSvcMeta meta{};
        if (service->meta(service->ctx, dependency, &meta) != POOLDEV_SVC_OK) continue;
        JsonDocument doc(psramOnlyJsonAllocator());
        if (deserializeJson(doc, out)) return true;
        auto detail = doc["err"]["dependency"].to<JsonObject>();
        detail["slot"] = dependency;
        detail["name"] = meta.label;
        detail["state"] = state == POOLDEV_SVC_OK ? "off" : "unavailable";
        if (!doc.overflowed() && measureJson(doc) < length) serializeJson(doc, out, length);
        return true;
    }
    return true;
}
