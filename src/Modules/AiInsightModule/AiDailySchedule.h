#pragma once

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <time.h>

namespace AiDailySchedule {

struct Checkpoint {
    uint32_t version = 1U;
    uint32_t lastAttemptLocalDate = 0U;
    uint64_t lastSuccessUtc = 0U;
};
static_assert(sizeof(Checkpoint) == 16U, "Stable schedule checkpoint layout");

struct Plan {
    bool valid = false;
    bool due = false;
    uint32_t localDate = 0U;
    uint64_t nextUtc = 0U;
};

inline bool parseTime(const char* text, unsigned& hour, unsigned& minute)
{
    if (!text || strnlen(text, 6U) != 5U || text[2] != ':' ||
        text[0] < '0' || text[0] > '9' || text[1] < '0' || text[1] > '9' ||
        text[3] < '0' || text[3] > '9' || text[4] < '0' || text[4] > '9') return false;
    hour = (text[0] - '0') * 10U + (text[1] - '0');
    minute = (text[3] - '0') * 10U + (text[4] - '0');
    return hour < 24U && minute < 60U;
}

inline bool validTime(const char* text)
{
    unsigned hour = 0U, minute = 0U;
    return parseTime(text, hour, minute);
}

inline Plan plan(uint64_t nowUtc, const char* time, uint32_t lastAttemptLocalDate)
{
    Plan result{};
    unsigned hour = 0U, minute = 0U;
    if (nowUtc < 1577836800ULL || nowUtc >= 4102444800ULL || !parseTime(time, hour, minute)) return result;
    const time_t now = static_cast<time_t>(nowUtc);
    tm local{};
    if (!localtime_r(&now, &local)) return result;
    result.localDate = (local.tm_year + 1900U) * 10000U + (local.tm_mon + 1U) * 100U + local.tm_mday;
    tm candidate = local;
    candidate.tm_hour = hour; candidate.tm_min = minute; candidate.tm_sec = 0; candidate.tm_isdst = -1;
    time_t scheduled = mktime(&candidate);
    if (scheduled < 0) return result;
    result.due = result.localDate > lastAttemptLocalDate && now >= scheduled;
    if (!result.due && (result.localDate <= lastAttemptLocalDate || now > scheduled)) {
        candidate = local;
        if (lastAttemptLocalDate >= result.localDate) {
            candidate.tm_year = static_cast<int>(lastAttemptLocalDate / 10000U) - 1900;
            candidate.tm_mon = static_cast<int>((lastAttemptLocalDate / 100U) % 100U) - 1;
            candidate.tm_mday = static_cast<int>(lastAttemptLocalDate % 100U);
        }
        candidate.tm_mday += 1;
        candidate.tm_hour = hour; candidate.tm_min = minute; candidate.tm_sec = 0; candidate.tm_isdst = -1;
        scheduled = mktime(&candidate);
        if (scheduled < 0) return result;
    }
    result.nextUtc = static_cast<uint64_t>(scheduled);
    result.valid = true;
    return result;
}

inline void formatLocal(uint64_t utc, char* out, size_t capacity)
{
    if (!out || capacity == 0U) return;
    out[0] = '\0';
    if (utc == 0U) return;
    const time_t epoch = static_cast<time_t>(utc);
    tm local{};
    if (localtime_r(&epoch, &local)) strftime(out, capacity, "%d/%m/%Y %H:%M", &local);
}

} // namespace AiDailySchedule
