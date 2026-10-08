#pragma once

#include <stdint.h>

namespace PoolConfig {

// Shared basin settings may be registered by their consuming module, but
// use one branch identity for configuration events and MQTT publication.
inline constexpr const char* PoolModule = "poollogic/pool";
inline constexpr uint8_t PoolBranchId = 14U;

}  // namespace PoolConfig
