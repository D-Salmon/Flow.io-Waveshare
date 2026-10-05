/**
 * @file FiltrationWindow.cpp
 * @brief Deterministic filtration window computation helper implementation.
 */

#include "Modules/PoolLogicModule/ReleaseFiltrationWindow.h"
#include <math.h>

namespace {
constexpr uint16_t kMinutesPerDay = 24U * 60U;
constexpr uint16_t kOffPeakStartMinute = 22U * 60U;
constexpr float kOffPeakMaxWaterTempC = 20.0f;
constexpr uint16_t kSolarPivotMinute = 15U * 60U;

uint16_t normalizeMinute_(int32_t minute)
{
    int32_t normalized = minute % (int32_t)kMinutesPerDay;
    if (normalized < 0) normalized += kMinutesPerDay;
    return (uint16_t)normalized;
}

float durationHoursForTemperature_(float waterTemp)
{
    if (waterTemp <= 12.0f) return 2.0f;

    if (waterTemp <= 25.0f) {
        return 2.0f
             + ((waterTemp - 12.0f) * ((12.5f - 2.0f) / (25.0f - 12.0f)));
    }

    if (waterTemp < 30.0f) {
        return 12.5f
             + ((waterTemp - 25.0f) * ((24.0f - 12.5f) / (30.0f - 25.0f)));
    }

    return 24.0f;
}
}  // namespace

bool computeReleaseFiltrationWindowDeterministic(const ReleaseFiltrationWindowInput& in, ReleaseFiltrationWindowOutput& out)
{
    if (!isfinite(in.waterTemp)) return false;

    const float durationHours = durationHoursForTemperature_(in.waterTemp);
    uint16_t durationMinutes = (uint16_t)lroundf(durationHours * 60.0f);
    if (durationMinutes < 120U) durationMinutes = 120U;
    if (durationMinutes > kMinutesPerDay) durationMinutes = kMinutesPerDay;

    out = {};
    out.durationMinutes = durationMinutes;
    if (durationMinutes >= kMinutesPerDay) {
        out.continuous = true;
        return true;
    }

    if (in.waterTemp <= kOffPeakMaxWaterTempC) {
        out.startMinuteOfDay = kOffPeakStartMinute;
        out.stopMinuteOfDay =
            normalizeMinute_((int32_t)out.startMinuteOfDay + durationMinutes);
        return true;
    }

    const int32_t start = (int32_t)kSolarPivotMinute - (int32_t)(durationMinutes / 2U);
    out.startMinuteOfDay = normalizeMinute_(start);
    out.stopMinuteOfDay = normalizeMinute_((int32_t)out.startMinuteOfDay + durationMinutes);
    return true;
}

bool isReleaseFiltrationWindowActiveAtMinute(uint16_t startMinuteOfDay,
                                      uint16_t stopMinuteOfDay,
                                      uint16_t durationMinutes,
                                      uint16_t minuteOfDay)
{
    if (durationMinutes >= kMinutesPerDay) return true;
    if (durationMinutes == 0U ||
        startMinuteOfDay >= kMinutesPerDay ||
        stopMinuteOfDay >= kMinutesPerDay ||
        minuteOfDay >= kMinutesPerDay ||
        startMinuteOfDay == stopMinuteOfDay) {
        return false;
    }

    return (stopMinuteOfDay <= startMinuteOfDay)
        ? (minuteOfDay >= startMinuteOfDay || minuteOfDay < stopMinuteOfDay)
        : (minuteOfDay >= startMinuteOfDay && minuteOfDay < stopMinuteOfDay);
}
