#include "PoolDeviceModule.h"
#include "PoolDeviceOverrideDiscovery.h"
#include "Core/PsramJsonAllocator.h"
#define LOG_MODULE_ID ((LogModuleId)LogModuleIdValue::PoolDeviceModule)
#include "Core/ModuleLog.h"

void PoolDeviceModule::registerOverrideHa_()
{
    using namespace PoolDeviceOverrideDiscovery;
    JsonDocument options(psramOnlyJsonAllocator());
    auto array = options.to<JsonArray>();
    for (uint8_t i = 0; i < POOL_DEVICE_MAX; ++i) {
        if (!overrideSupported_(i)) continue;
        auto& slot = slots_[i];
        const char* label = slot.def.haDisplayName ? slot.def.haDisplayName : slot.def.label;
        unsigned duplicates = 0;
        for (uint8_t j = 0; j < POOL_DEVICE_MAX; ++j) {
            if (!overrideSupported_(j)) continue;
            const auto& other = slots_[j].def;
            const char* otherLabel = other.haDisplayName ? other.haDisplayName : other.label;
            if (strcmp(label, otherLabel) == 0) ++duplicates;
        }
        if (duplicates > 1) {
            snprintf(slot.overrideOption, sizeof(slot.overrideOption), "%s (%u)", label, unsigned(i + 1));
        } else {
            snprintf(slot.overrideOption, sizeof(slot.overrideOption), "%s", label);
        }
        array.add(slot.overrideOption);
        if (overrideSelection_ == 0xFF) overrideSelection_ = i;
    }
    if (options.overflowed() || measureJson(options) >= sizeof(overrideOptions_)) {
        LOGE("Override selector catalogue exceeds capacity"); return;
    }
    serializeJson(options, overrideOptions_, sizeof(overrideOptions_));
    if (!haSvc_) return;
    bool ok = true;
    for (const auto& removal : Removals)
        if (!haSvc_->addDiscoveryRemoval || !haSvc_->addDiscoveryRemoval(haSvc_->ctx, &removal)) ok = false;
    if (array.size() == 0) {
        for (const auto& removal : PanelRemovals)
            if (!haSvc_->addDiscoveryRemoval || !haSvc_->addDiscoveryRemoval(haSvc_->ctx, &removal)) ok = false;
        if (!ok) LOGE("Override discovery cleanup incomplete");
        return;
    }
    if (!haSvc_->addNumber || !haSvc_->addNumber(haSvc_->ctx, &Duration)) ok = false;
    for (const auto& sensor : Sensors) if (!haSvc_->addSensor || !haSvc_->addSensor(haSvc_->ctx, &sensor)) ok = false;
    for (const auto& button : Buttons) if (!haSvc_->addButton || !haSvc_->addButton(haSvc_->ctx, &button)) ok = false;
    const HASelectEntry selector = {"pooldevice", "pdm_ovr_target", "Équipement à forcer", Selected,
        "{{ value_json.selection }}", "cmd",
        "{{ {'cmd': 'pooldevice.override.select', 'args': {'option': value}} | to_json }}",
        overrideOptions_, "mdi:format-list-bulleted", nullptr, "Override Actuator"};
    if (!haSvc_->addSelect || !haSvc_->addSelect(haSvc_->ctx, &selector)) ok = false;
    if (!ok) LOGE("Consolidated override discovery registration incomplete");
}
