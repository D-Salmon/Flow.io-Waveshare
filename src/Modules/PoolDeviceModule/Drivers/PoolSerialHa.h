#pragma once
#include "Core/Services/PoolActuatorTypes.h"
#include "Core/SpiRamJsonDocument.h"
#include <cstdio>
#include <cstring>

/** HAModule's select command template is inserted in a JSON string: escape it once. */
inline bool buildPoolModeHaTemplates(const PoolRunModes& modes, uint8_t slot,
                                     char* options, size_t optionsSize, char* command, size_t commandSize)
{
    if (!modes.count || modes.count > POOL_MAX_RUN_MODES || !options || !command) return false;
    SpiRamJsonDocument doc(2048);
    auto array = doc.to<JsonArray>();
    for (uint8_t i = 0; i < modes.count; ++i) array.add(modes.options[i].label);
    if (doc.overflowed() || measureJson(doc) >= optionsSize) return false;
    serializeJson(doc, options, optionsSize);
    char raw[640];
    const int n = snprintf(raw, sizeof(raw),
        "{\"cmd\":\"pooldevice.mode\",\"args\":{\"slot\":%u,\"value\":{{ %s.index(value) }}}}", unsigned(slot), options);
    if (n < 0 || size_t(n) >= sizeof(raw)) return false;
    doc.clear(); doc.set(raw);
    if (doc.overflowed() || measureJson(doc) >= commandSize) return false;
    const size_t length = serializeJson(doc, command, commandSize);
    if (length < 2) return false;
    std::memmove(command, command + 1, length - 2);
    command[length - 2] = '\0';
    return true;
}
