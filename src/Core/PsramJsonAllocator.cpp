#include "Core/PsramJsonAllocator.h"

#include <esp_heap_caps.h>

namespace {

class PsramPreferredJsonAllocator final : public ArduinoJson::Allocator {
public:
    void* allocate(size_t size) override
    {
        return heap_caps_malloc_prefer(
            size,
            2,
            MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT,
            MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    }

    void deallocate(void* ptr) override
    {
        heap_caps_free(ptr);
    }

    void* reallocate(void* ptr, size_t newSize) override
    {
        return heap_caps_realloc_prefer(
            ptr,
            newSize,
            2,
            MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT,
            MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    }
};

class PsramOnlyJsonAllocator final : public ArduinoJson::Allocator {
public:
    void* allocate(size_t size) override
    {
        return heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    }

    void deallocate(void* ptr) override
    {
        heap_caps_free(ptr);
    }

    void* reallocate(void* ptr, size_t newSize) override
    {
        return heap_caps_realloc(ptr, newSize, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    }
};

}  // namespace

ArduinoJson::Allocator* psramPreferredJsonAllocator()
{
    static PsramPreferredJsonAllocator allocator;
    return &allocator;
}

ArduinoJson::Allocator* psramOnlyJsonAllocator()
{
    static PsramOnlyJsonAllocator allocator;
    return &allocator;
}
