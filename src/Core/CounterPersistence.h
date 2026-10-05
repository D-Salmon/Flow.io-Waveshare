#pragma once
#include "Core/ServiceRegistry.h"
#include "Core/ServiceId.h"
#include "Core/Services/IIO.h"

/** Confirm the IO task's current counters in NVS before a controlled restart/update. */
inline IoStatus saveCounterCheckpointStatus(ServiceRegistry* services)
{
    const auto* io = services ? services->get<IOServiceV2>(ServiceId::Io) : nullptr;
    return io && io->saveCounters ? io->saveCounters(io->ctx) : IO_ERR_NOT_READY;
}

inline bool saveCounterCheckpoint(ServiceRegistry* services)
{
    return saveCounterCheckpointStatus(services) == IO_OK;
}
