/**
 * @file PoolLogicScheduler.cpp
 * @brief Scheduler and filtration window logic for PoolLogicModule.
 */

#include "PoolLogicModule.h"
#include "Modules/PoolLogicModule/ReleaseFiltrationWindow.h"

#include <cstring>
#include <math.h>
#include <time.h>

#define LOG_MODULE_ID ((LogModuleId)LogModuleIdValue::PoolLogicModule)
#include "Core/ModuleLog.h"

namespace {
constexpr uint16_t kMinutesPerDay = 24U * 60U;
// A missing probe must not leave an incoherent or obsolete schedule behind.
// 12 °C maps to PoolLogic's minimum filtration policy: 2 hours in the
// off-peak window, from 22:00 to 00:00.
constexpr float kMissingWaterTemperatureFallbackC = 12.0f;
constexpr uint32_t kHeldWaterTemperatureMaxAgeMs = 24UL * 60UL * 60UL * 1000UL;
}

void PoolLogicModule::ensureDailySlot_()
{
    if (!schedSvc_ || !schedSvc_->setSlot) {
        LOGW("time.scheduler service unavailable");
        return;
    }

    // The daily recompute slot is the long-lived scheduler anchor; it does not
    // directly change outputs, it only asks the loop to rebuild the window.
    TimeSchedulerSlot recalc{};
    recalc.slot = SLOT_DAILY_RECALC;
    recalc.eventId = POOLLOGIC_EVENT_DAILY_RECALC;
    recalc.enabled = true;
    recalc.hasEnd = false;
    recalc.replayStartOnBoot = false;
    recalc.mode = TimeSchedulerMode::RecurringClock;
    recalc.weekdayMask = TIME_WEEKDAY_ALL;
    recalc.startHour = PoolDefaults::FiltrationPivotHour;
    recalc.startMinute = 0;
    recalc.endHour = 0;
    recalc.endMinute = 0;
    recalc.startEpochSec = 0;
    recalc.endEpochSec = 0;
    strncpy(recalc.label, "poollogic_daily_recalc", sizeof(recalc.label) - 1);
    recalc.label[sizeof(recalc.label) - 1] = '\0';

    if (!schedSvc_->setSlot(schedSvc_->ctx, &recalc)) {
        LOGW("Failed to set scheduler slot %u", (unsigned)SLOT_DAILY_RECALC);
    }
}

bool PoolLogicModule::computeFiltrationWindow_(float waterTemp,
                                               uint16_t& startMinuteOut,
                                               uint16_t& stopMinuteOut,
                                               uint16_t& durationMinutesOut)
{
    ReleaseFiltrationWindowInput in{};
    in.waterTemp = waterTemp;

    ReleaseFiltrationWindowOutput out{};
    if (!computeReleaseFiltrationWindowDeterministic(in, out)) return false;
    startMinuteOut = out.startMinuteOfDay;
    stopMinuteOut = out.stopMinuteOfDay;
    durationMinutesOut = out.durationMinutes;
    return true;
}

bool PoolLogicModule::currentFiltrationWindowActive_(uint16_t startMinute,
                                                     uint16_t stopMinute,
                                                     uint16_t durationMinutes,
                                                     bool& activeOut) const
{
    if (!timeSvc_ || !timeSvc_->isSynced || !timeSvc_->epoch) return false;
    if (!timeSvc_->isSynced(timeSvc_->ctx)) return false;

    const uint64_t epoch = timeSvc_->epoch(timeSvc_->ctx);
    if (epoch < 1609459200ULL) return false;

    const time_t now = (time_t)epoch;
    struct tm localNow {};
    if (!localtime_r(&now, &localNow)) return false;

    const uint16_t minuteOfDay = (uint16_t)((localNow.tm_hour * 60) + localNow.tm_min);
    activeOut = isReleaseFiltrationWindowActiveAtMinute(startMinute,
                                                 stopMinute,
                                                 durationMinutes,
                                                 minuteOfDay);
    return true;
}

bool PoolLogicModule::applyFiltrationWindowSlot_(uint16_t startMinute,
                                                 uint16_t stopMinute,
                                                 uint16_t durationMinutes)
{
    if (!schedSvc_ || !schedSvc_->setSlot) {
        LOGW("No time.scheduler service available");
        return false;
    }
    if (startMinute >= kMinutesPerDay ||
        stopMinute >= kMinutesPerDay ||
        durationMinutes < 120U ||
        durationMinutes > kMinutesPerDay) {
        LOGW("Invalid filtration window start=%u stop=%u duration=%u",
             (unsigned)startMinute,
             (unsigned)stopMinute,
             (unsigned)durationMinutes);
        return false;
    }

    const bool continuous = durationMinutes == kMinutesPerDay;
    TimeSchedulerSlot window{};
    window.slot = SLOT_FILTR_WINDOW;
    window.eventId = POOLLOGIC_EVENT_FILTRATION_WINDOW;
    window.enabled = !continuous;
    window.hasEnd = true;
    window.replayStartOnBoot = true;
    window.mode = TimeSchedulerMode::RecurringClock;
    window.weekdayMask = TIME_WEEKDAY_ALL;
    window.startHour = (uint8_t)(startMinute / 60U);
    window.startMinute = (uint8_t)(startMinute % 60U);
    window.endHour = (uint8_t)(stopMinute / 60U);
    window.endMinute = (uint8_t)(stopMinute % 60U);
    window.startEpochSec = 0;
    window.endEpochSec = 0;
    strncpy(window.label, "poollogic_filtration", sizeof(window.label) - 1);
    window.label[sizeof(window.label) - 1] = '\0';

    if (!schedSvc_->setSlot(schedSvc_->ctx, &window)) {
        LOGW("Failed to set filtration window slot=%u", (unsigned)SLOT_FILTR_WINDOW);
        return false;
    }

    bool windowActive = continuous;
    if (currentFiltrationWindowActive_(startMinute, stopMinute, durationMinutes, windowActive)) {
        // Keep PoolLogic deterministic during the short gap after setSlot(),
        // before TimeModule has rebuilt its active mask.
    } else if (!continuous && schedSvc_->isActive) {
        windowActive = schedSvc_->isActive(schedSvc_->ctx, SLOT_FILTR_WINDOW);
    }

    portENTER_CRITICAL(&pendingMux_);
    filtrationWindowActive_ = windowActive;
    pendingFiltrationReconcile_ = true;
    portEXIT_CRITICAL(&pendingMux_);

    LOGI("Filtration window duration=%umin start=%02u:%02u stop=%02u:%02u continuous=%u",
         (unsigned)durationMinutes,
         (unsigned)(startMinute / 60U),
         (unsigned)(startMinute % 60U),
         (unsigned)(stopMinute / 60U),
         (unsigned)(stopMinute % 60U),
         continuous ? 1U : 0U);
    return true;
}

bool PoolLogicModule::recalcAndApplyFiltrationWindow_(uint16_t* startMinuteOut,
                                                      uint16_t* stopMinuteOut,
                                                      uint16_t* durationMinutesOut,
                                                      bool keepCurrentStart)
{
    if (!schedSvc_ || !schedSvc_->setSlot) {
        LOGW("No time.scheduler service available");
        return false;
    }

    float waterTemp = NAN;
    bool hasWaterTemp = false;
    bool waterTempHeld = false;
    uint32_t waterTempTsMs = 0U;
    if (ioSvc_ && ioSvc_->readValue) {
        hasWaterTemp = loadAnalogSensor_(waterTempIoId_,
                                         waterTemp,
                                         &waterTempTsMs,
                                         &waterTempHeld);
    }
    const bool heldTemperatureExpired =
        hasWaterTemp && waterTempHeld &&
        (waterTempTsMs == 0U ||
         (uint32_t)(millis() - waterTempTsMs) > kHeldWaterTemperatureMaxAgeMs);
    if (heldTemperatureExpired) {
        hasWaterTemp = false;
        LOGW("Held water temperature is older than 24h; applying minimum filtration fallback");
    }
    const bool usingTemperatureFallback = !hasWaterTemp;
    const float calculationTemp = usingTemperatureFallback
        ? kMissingWaterTemperatureFallbackC
        : waterTemp;
    if (!ioSvc_ || !ioSvc_->readValue) {
        LOGW("No IOServiceV2 available for water temperature; applying minimum filtration fallback");
    } else if (!hasWaterTemp) {
        LOGW("Water temperature unavailable on ioId=%u; applying minimum filtration fallback",
             (unsigned)waterTempIoId_);
    }

    uint16_t startMinute = 0U;
    uint16_t stopMinute = 0U;
    uint16_t durationMinutes = 0U;
    if (!computeFiltrationWindow_(calculationTemp, startMinute, stopMinute, durationMinutes)) {
        LOGW("Filtration window calculation failed");
        return false;
    }

    if (keepCurrentStart && !usingTemperatureFallback) {
        startMinute = filtrationCalcStartMinute_;
        stopMinute = (uint16_t)(((uint32_t)startMinute + durationMinutes) % (24U * 60U));
    }

    // PoolLogic stores the computed window back into the shared scheduler so
    // filtration state changes continue to arrive as regular scheduler events.
    if (!applyFiltrationWindowSlot_(startMinute, stopMinute, durationMinutes)) return false;
    filtrationRecalcWhenWaterTempFresh_ = usingTemperatureFallback;
    filtrationFreshRecalcRetryMs_ = 0U;

    bool startStored = false;
    bool stopStored = false;
    bool durationStored = false;
    if (cfgStore_) {
        startStored = cfgStore_->set(calcStartMinuteVar_, startMinute);
        stopStored = cfgStore_->set(calcStopMinuteVar_, stopMinute);
        durationStored = cfgStore_->set(calcDurationMinuteVar_, durationMinutes);
        if (!startStored || !stopStored || !durationStored) {
            LOGW("Failed to persist filtration window start=%u stop=%u duration=%u",
                 (unsigned)startMinute,
                 (unsigned)stopMinute,
                 (unsigned)durationMinutes);
        }
    }
    if (!cfgStore_ || !startStored) filtrationCalcStartMinute_ = startMinute;
    if (!cfgStore_ || !stopStored) filtrationCalcStopMinute_ = stopMinute;
    if (!cfgStore_ || !durationStored) filtrationCalcDurationMinute_ = durationMinutes;

    filtrationCalcStart_ = (uint8_t)(startMinute / 60U);
    filtrationCalcStop_ = (uint8_t)(stopMinute / 60U);
    if (cfgStore_) {
        (void)cfgStore_->set(calcStartVar_, filtrationCalcStart_);
        (void)cfgStore_->set(calcStopVar_, filtrationCalcStop_);
    }
    if (cfgMqttPub_) {
        // Recompute commands should always refresh MQTT cfg consumers, even if
        // computed values stayed identical and ConfigStore emitted no change.
        cfgMqttPub_->requestFullSync(MqttPublishPriority::Normal);
    }
    if (startMinuteOut) *startMinuteOut = startMinute;
    if (stopMinuteOut) *stopMinuteOut = stopMinute;
    if (durationMinutesOut) *durationMinutesOut = durationMinutes;

    LOGI("Filtration duration=%umin water=%.2fC fallback=%u start=%02u:%02u stop=%02u:%02u",
         (unsigned)durationMinutes,
         (double)calculationTemp,
         usingTemperatureFallback ? 1U : 0U,
         (unsigned)(startMinute / 60U),
         (unsigned)(startMinute % 60U),
         (unsigned)(stopMinute / 60U),
         (unsigned)(stopMinute % 60U));
    char detail[128] = {0};
    if (usingTemperatureFallback) {
        snprintf(detail,
                 sizeof(detail),
                 "Sonde indisponible : durée minimale %u min, plage %02u:%02u-%02u:%02u.",
                 (unsigned)durationMinutes,
                 (unsigned)(startMinute / 60U),
                 (unsigned)(startMinute % 60U),
                 (unsigned)(stopMinute / 60U),
                 (unsigned)(stopMinute % 60U));
    } else {
        snprintf(detail,
                 sizeof(detail),
                 "Température eau %.2f °C, durée %u min, plage %02u:%02u-%02u:%02u.",
                 (double)waterTemp,
                 (unsigned)durationMinutes,
                 (unsigned)(startMinute / 60U),
                 (unsigned)(startMinute % 60U),
                 (unsigned)(stopMinute / 60U),
                 (unsigned)(stopMinute % 60U));
    }
    emitActivity_(ActivityCode::PoolLogicFiltrationWindowCalculated,
                  ActivitySource::Scheduler,
                  ActivitySeverity::Info,
                  ActivityRole::Filtration,
                  ActivityState::None,
                  ActivityReason::Scheduler,
                  filtrationDeviceSlot_,
                  "Plage de filtration recalculée",
                  detail,
                  "schedule",
                  systemActor());
    return true;
}
