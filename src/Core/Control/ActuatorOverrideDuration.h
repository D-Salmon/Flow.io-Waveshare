#pragma once
#include <stdint.h>
#include <stddef.h>

// A preference for the next request, independent of the active durable lease.
class ActuatorOverrideDuration {
public:
    static constexpr uint16_t DefaultMinutes = 30;
    static constexpr uint16_t MaxMinutes = 1440;
    static constexpr size_t RecordSize = 4;
    using Save = bool (*)(void*, const uint8_t*, size_t);
    uint16_t minutes() const { return minutes_; }
    uint32_t seconds() const { return uint32_t(minutes_) * 60; }
    bool restore(const uint8_t* bytes, size_t len) {
        if (!bytes || len != RecordSize || bytes[0] != 1 || bytes[1] != 0) return false;
        const uint16_t value = uint16_t(bytes[2]) | (uint16_t(bytes[3]) << 8);
        if (!value || value > MaxMinutes) return false;
        minutes_ = value;
        return true;
    }
    bool set(uint16_t value, void* ctx, Save save) {
        if (!value || value > MaxMinutes) return false;
        if (value == minutes_) return true;
        const uint8_t bytes[RecordSize] = {1, 0, uint8_t(value), uint8_t(value >> 8)};
        if (!save || !save(ctx, bytes, sizeof(bytes))) return false;
        minutes_ = value;
        return true;
    }
private:
    uint16_t minutes_ = DefaultMinutes;
};
