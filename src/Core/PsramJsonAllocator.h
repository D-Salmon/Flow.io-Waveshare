#pragma once

#include <ArduinoJson.h>

/**
 * @brief ArduinoJson allocator that prefers PSRAM and falls back to internal RAM.
 *
 * The returned allocator has static lifetime and can therefore be used by local
 * and static JsonDocument instances.
 */
ArduinoJson::Allocator* psramPreferredJsonAllocator();

/**
 * @brief ArduinoJson allocator backed exclusively by PSRAM.
 *
 * Use this for sizeable, short-lived parser documents whose allocation must
 * not consume the ESP32-S3 internal heap. Allocation cleanly fails when PSRAM
 * is unavailable instead of silently moving the document back to DRAM.
 */
ArduinoJson::Allocator* psramOnlyJsonAllocator();
