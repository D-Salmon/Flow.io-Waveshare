#pragma once
#include <stdint.h>

// Fixed devices sharing the primary bus. Configuration of I/O providers must
// never claim these addresses, including when a device does not acknowledge.
namespace FixedI2cAddresses {
constexpr uint8_t Pcf85063Rtc = 0x51;
constexpr uint8_t Pcf8574LedPanel = 0x3C;
}
