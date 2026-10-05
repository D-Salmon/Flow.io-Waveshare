#include "Core/PsramJsonAllocator.h"
ArduinoJson::Allocator* psramPreferredJsonAllocator() { return ArduinoJson::detail::DefaultAllocator::instance(); }
ArduinoJson::Allocator* psramOnlyJsonAllocator() { return ArduinoJson::detail::DefaultAllocator::instance(); }
