#pragma once
/**
 * @file FiltrationWindow.h
 * @brief Deterministic filtration window computation helper.
 */

#include <stdint.h>

struct ReleaseFiltrationWindowInput {
    float waterTemp = 0.0f;
};

struct ReleaseFiltrationWindowOutput {
    uint16_t startMinuteOfDay = 0;
    uint16_t stopMinuteOfDay = 0;
    uint16_t durationMinutes = 0;
    bool continuous = false;
};

bool computeReleaseFiltrationWindowDeterministic(const ReleaseFiltrationWindowInput& in, ReleaseFiltrationWindowOutput& out);
bool isReleaseFiltrationWindowActiveAtMinute(uint16_t startMinuteOfDay,
                                      uint16_t stopMinuteOfDay,
                                      uint16_t durationMinutes,
                                      uint16_t minuteOfDay);
