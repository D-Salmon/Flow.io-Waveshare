#pragma once
#include <stdint.h>
#include <stddef.h>
#include "Core/Services/ActuatorControlState.h"

/** One durable lease. Caller serializes access and supplies trusted UTC (0 if unknown).
 * Storage is an explicit versioned byte format, independent of struct padding.
 * Starts/replacements require a durable write. Stops apply immediately and
 * retain a visible pending-save state if their durable cancellation fails.
 */
class TimedActuatorOverride {
public:
    static constexpr uint32_t MaxDurationSec = 86400;
    static constexpr size_t RecordSize = 32;
    using Save = bool (*)(void*, const uint8_t*, size_t);

    void configure(void* ctx, Save save) {
        ctx_ = ctx;
        save_ = save;
    }
    bool restore(const uint8_t* bytes, size_t len) {
        if (!bytes || len != RecordSize || bytes[0] != 1 || bytes[1] > 1 || bytes[2] > 1) return false;
        const uint64_t start = read64(bytes + 8);
        const uint64_t end = read64(bytes + 16);
        if (bytes[1] && (!start || end <= start || end - start > MaxDurationSec)) return false;
        slot_ = bytes[3];
        binding_ = read32(bytes + 4);
        active_ = bytes[1];
        value_ = bytes[2];
        startUtc_ = start;
        endUtc_ = end;
        anchored_ = false;
        dirty_ = false;
        reason_ = ActuatorOverrideReason::None;
        return true;
    }
    bool start(uint8_t slot, uint32_t binding, bool value, uint32_t seconds,
               uint64_t utc, uint64_t monotonicMs) {
        if (!utc || !seconds || seconds > MaxDurationSec || utc > UINT64_MAX - seconds) return false;
        uint8_t bytes[RecordSize]{};
        encode(bytes, true, slot, binding, value, utc, utc + seconds);
        if (!save_ || !save_(ctx_, bytes, sizeof(bytes))) return false;
        slot_ = slot;
        binding_ = binding;
        value_ = value;
        active_ = anchored_ = true;
        startUtc_ = utc;
        endUtc_ = utc + seconds;
        deadlineMs_ = monotonicMs + uint64_t(seconds) * 1000;
        dirty_ = false;
        reason_ = ActuatorOverrideReason::None;
        return true;
    }
    bool cancel(ActuatorOverrideReason reason) {
        if (!active_ && !dirty_) return true;
        // Safety/expiry stops take effect even if flash fails; retry the tombstone.
        active_ = false;
        anchored_ = false;
        dirty_ = true;
        reason_ = reason;
        return flush();
    }
    bool flush() {
        if (!dirty_) return true;
        uint8_t bytes[RecordSize]{};
        encode(bytes, false, slot_, binding_, false, 0, 0);
        if (!save_ || !save_(ctx_, bytes, sizeof(bytes))) return false;
        dirty_ = false;
        return true;
    }
    void tick(uint64_t utc, uint64_t monotonicMs) {
        if (!active_) return;
        if (!anchored_) {
            if (!utc) return;
            if (utc < startUtc_) {
                cancel(ActuatorOverrideReason::ClockInvalid);
                return;
            }
            if (utc >= endUtc_) {
                cancel(ActuatorOverrideReason::Expired);
                return;
            }
            deadlineMs_ = monotonicMs + (endUtc_ - utc) * 1000;
            anchored_ = true;
        }
        if (monotonicMs >= deadlineMs_) {
            cancel(ActuatorOverrideReason::Expired);
            return;
        }
        // Persist only real UTC corrections, not countdown ticks. Otherwise a
        // reboot after NTP corrected the clock could extend the original lease.
        if (utc) {
            const uint64_t remaining = (deadlineMs_ - monotonicMs + 999) / 1000;
            const uint64_t correctedEnd = utc + remaining;
            const uint64_t difference = correctedEnd > endUtc_ ? correctedEnd - endUtc_ : endUtc_ - correctedEnd;
            if (difference > 2) {
                const uint64_t duration = endUtc_ - startUtc_;
                if (correctedEnd < duration) {
                    cancel(ActuatorOverrideReason::ClockInvalid);
                    return;
                }
                uint8_t bytes[RecordSize]{};
                encode(bytes, true, slot_, binding_, value_, correctedEnd - duration, correctedEnd);
                if (!save_ || !save_(ctx_, bytes, sizeof(bytes))) {
                    cancel(ActuatorOverrideReason::ClockInvalid);
                    return;
                }
                startUtc_ = correctedEnd - duration;
                endUtc_ = correctedEnd;
            }
        }
    }
    ActuatorControlState state(uint64_t monotonicMs) const {
        ActuatorControlState out;
        out.reason = reason_;
        out.value = value_;
        out.mode = dirty_ ? ActuatorControlMode::PersistenceError : !active_ ? ActuatorControlMode::Guided
            : anchored_ ? ActuatorControlMode::Forced : ActuatorControlMode::WaitingTime;
        out.endsAtUtc = active_ ? endUtc_ : 0;
        if (active_ && anchored_ && deadlineMs_ > monotonicMs)
            out.remainingSec = uint32_t((deadlineMs_ - monotonicMs + 999) / 1000);
        return out;
    }
    bool active() const { return active_; }
    bool pendingSave() const { return dirty_; }
    uint8_t slot() const { return slot_; }
    uint32_t binding() const { return binding_; }
private:
    static uint32_t read32(const uint8_t* bytes) {
        uint32_t value = 0;
        for (unsigned i = 0; i < 4; ++i) value |= uint32_t(bytes[i]) << (8 * i);
        return value;
    }
    static uint64_t read64(const uint8_t* bytes) {
        uint64_t value = 0;
        for (unsigned i = 0; i < 8; ++i) value |= uint64_t(bytes[i]) << (8 * i);
        return value;
    }
    static void write64(uint8_t* bytes, uint64_t value) {
        for (unsigned i = 0; i < 8; ++i) bytes[i] = uint8_t(value >> (8 * i));
    }
    static void encode(uint8_t* p, bool active, uint8_t slot, uint32_t binding, bool value, uint64_t start, uint64_t end) {
        p[0] = 1;
        p[1] = active;
        p[2] = value;
        p[3] = slot;
        for (unsigned i = 0; i < 4; ++i) p[4 + i] = uint8_t(binding >> (8 * i));
        write64(p + 8, start);
        write64(p + 16, end);
    }
    void* ctx_ = nullptr;
    Save save_ = nullptr;
    uint8_t slot_ = 0;
    uint32_t binding_ = 0;
    bool active_ = false;
    bool value_ = false;
    bool anchored_ = false;
    bool dirty_ = false;
    uint64_t startUtc_ = 0;
    uint64_t endUtc_ = 0;
    uint64_t deadlineMs_ = 0;
    ActuatorOverrideReason reason_ = ActuatorOverrideReason::None;
};
