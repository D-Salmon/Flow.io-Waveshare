#pragma once
#include <stdint.h>

enum class ActuatorOverrideCommand : uint8_t { FromArgs, On, Off, Release, Duration, Select };

enum class ActuatorControlMode : uint8_t { Guided, Forced, WaitingTime, PersistenceError };
enum class ActuatorOverrideReason : uint8_t { None, Expired, Released, Safety, Configuration, ClockInvalid };

enum ActuatorOnBlock : uint16_t {
    ACTUATOR_ON_BLOCK_NONE = 0,
    ACTUATOR_ON_BLOCK_FILTRATION = 1U << 0,
    ACTUATOR_ON_BLOCK_PRESSURE_UNAVAILABLE = 1U << 1,
    ACTUATOR_ON_BLOCK_PRESSURE_LOW = 1U << 2,
    ACTUATOR_ON_BLOCK_PRESSURE_HIGH = 1U << 3,
    ACTUATOR_ON_BLOCK_FLOW_UNAVAILABLE = 1U << 4,
    ACTUATOR_ON_BLOCK_FLOW_ABSENT = 1U << 5,
    ACTUATOR_ON_BLOCK_PRESSURE_ALARM = 1U << 6,
    ACTUATOR_ON_BLOCK_FLOW_ALARM = 1U << 7
};

inline const char* actuatorOnBlockName(uint16_t reason) {
    switch (reason) {
        case ACTUATOR_ON_BLOCK_FILTRATION: return "filtration_off";
        case ACTUATOR_ON_BLOCK_PRESSURE_UNAVAILABLE: return "pressure_unavailable";
        case ACTUATOR_ON_BLOCK_PRESSURE_LOW: return "pressure_low";
        case ACTUATOR_ON_BLOCK_PRESSURE_HIGH: return "pressure_high";
        case ACTUATOR_ON_BLOCK_FLOW_UNAVAILABLE: return "flow_unavailable";
        case ACTUATOR_ON_BLOCK_FLOW_ABSENT: return "flow_absent";
        case ACTUATOR_ON_BLOCK_PRESSURE_ALARM: return "pressure_alarm";
        case ACTUATOR_ON_BLOCK_FLOW_ALARM: return "flow_alarm";
        default: return nullptr;
    }
}

// Controller policy is independent of the temporary request. Hardware interlocks
// are always checked by PoolDevice after this policy and the lease are applied.
struct ActuatorOverridePolicy {
    bool automatic = false;
    bool ready = true;
    bool allowOn = true;
    bool allowOff = true;
    uint16_t requiredOnMask = 0;
    uint16_t onBlockReasons = ACTUATOR_ON_BLOCK_NONE;
};

struct ActuatorControlState {
    bool supported = false;
    bool available = false;
    bool automatic = false;
    ActuatorControlMode mode = ActuatorControlMode::Guided;
    ActuatorOverrideReason reason = ActuatorOverrideReason::None;
    bool value = false;
    uint32_t remainingSec = 0;
    uint64_t endsAtUtc = 0;
};

inline const char* actuatorControlModeName(ActuatorControlMode mode) {
    switch (mode) {
        case ActuatorControlMode::Forced: return "forced";
        case ActuatorControlMode::WaitingTime: return "waiting_time";
        case ActuatorControlMode::PersistenceError: return "persistence_error";
        default: return "guided";
    }
}
inline const char* actuatorOverrideReasonName(ActuatorOverrideReason reason) {
    switch (reason) {
        case ActuatorOverrideReason::Expired: return "expired";
        case ActuatorOverrideReason::Released: return "released";
        case ActuatorOverrideReason::Safety: return "safety";
        case ActuatorOverrideReason::Configuration: return "configuration";
        case ActuatorOverrideReason::ClockInvalid: return "clock_invalid";
        default: return "none";
    }
}

// Shared wire representation for MQTT, device options and digital-output views.
template<class Json> void writeActuatorControlJson(Json& doc, const ActuatorControlState& state) {
    doc["override_supported"] = state.supported;
    doc["override_available"] = state.available;
    doc["control_automatic"] = state.automatic;
    doc["control_mode"] = actuatorControlModeName(state.mode);
    doc["override_reason"] = actuatorOverrideReasonName(state.reason);
    if (state.mode == ActuatorControlMode::Guided) doc["override_value"] = nullptr;
    else doc["override_value"] = state.value;
    if (state.mode == ActuatorControlMode::WaitingTime) doc["override_remaining_s"] = nullptr;
    else doc["override_remaining_s"] = state.remainingSec;
    doc["override_ends_at_utc"] = state.endsAtUtc;
}
