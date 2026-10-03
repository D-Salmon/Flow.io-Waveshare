#pragma once

#include "Core/DataKeys.h"
#include <freertos/FreeRTOS.h>

/** Bounded mailbox for latest-state notifications (not commands or transitions).
 * Multiple producers may mark keys; one consumer drains them fairly.
 * Clear before processing so concurrent updates remain pending for the next pass.
 */
class PendingDataKeys {
public:
    bool mark(DataKey key) {
        if (key > DataKeys::ReservedMax) return false;
        portENTER_CRITICAL(&mux_);
        bits_[key / 32U] |= uint32_t(1) << (key % 32U);
        portEXIT_CRITICAL(&mux_);
        return true;
    }

    template<class Consume>
    void drain(uint16_t budget, Consume consume) {
        tryDrain(budget, [&](DataKey key) { consume(key); return true; });
    }

    // A refused publication stays pending, including concurrent updates.
    template<class Publish>
    void tryDrain(uint16_t budget, Publish publish) {
        for (uint16_t scanned = 0; scanned < KeyCount && budget; ++scanned) {
            const DataKey key = cursor_;
            cursor_ = (cursor_ + 1U) % KeyCount;
            auto& word = bits_[key / 32U];
            const uint32_t mask = uint32_t(1) << (key % 32U);
            portENTER_CRITICAL(&mux_);
            const bool pending = (word & mask) != 0;
            word &= ~mask;
            portEXIT_CRITICAL(&mux_);
            if (!pending) continue;
            --budget;
            if (!publish(key)) {
                mark(key);
                return;
            }
        }
    }

private:
    static constexpr uint16_t KeyCount = DataKeys::ReservedMax + 1U;
    uint32_t bits_[(KeyCount + 31U) / 32U]{};
    uint16_t cursor_ = 0;
    portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
};
