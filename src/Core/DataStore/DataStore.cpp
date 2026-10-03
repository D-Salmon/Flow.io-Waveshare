/**
 * @file DataStore.cpp
 * @brief Implementation file.
 */
#include "Core/DataStore/DataStore.h"
#include "Core/ModuleId.h"

void DataStore::notifyChanged(DataKey key)
{
    pendingChanges_.mark(key);
}

void DataStore::flushPendingChanges(uint16_t budget)
{
    if (!_bus) return;
    pendingChanges_.tryDrain(budget, [this](DataKey key) {
        const DataChangedPayload payload{key};
        return _bus->tryPost(EventId::DataChanged, &payload, sizeof(payload), ModuleId::DataStore);
    });
}
