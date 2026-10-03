#include "Core/EventBus/EventBus.h"
#include "Core/DataStore/PendingDataKeys.h"
#include "Core/Log.h"
#include <Arduino.h>
#include <cassert>

int main() {
    EventBus bus;
    PendingDataKeys changes;
    unsigned received[DataKeys::ReservedMax + 1]{};
    unsigned transitions = 0, started = 0;
    bus.subscribe(EventId::DataChanged, [](const Event& e, void* ctx) {
        const auto key = static_cast<const DataChangedPayload*>(e.payload)->id;
        ++static_cast<unsigned*>(ctx)[key];
    }, received);
    bus.subscribe(EventId::SystemStarted, [](const Event&, void* ctx) {
        ++*static_cast<unsigned*>(ctx);
    }, &started);
    bus.subscribe(EventId::ConfigChanged, [](const Event& e, void* ctx) {
        auto& count = *static_cast<unsigned*>(ctx);
        assert(*static_cast<const unsigned*>(e.payload) == count++);
    }, &transitions);
    for (DataKey key = 0; key <= DataKeys::ReservedMax; ++key) {
        assert(changes.mark(key));
        assert(changes.mark(key));
    }
    // Ordinary events occupy the entire queue: retained events must retry.
    for (unsigned i = 0; i < EventBus::QUEUE_LENGTH; ++i)
        assert(bus.post(EventId::ConfigChanged, &i, sizeof(i)));
    auto publish = [&](DataKey key) {
        DataChangedPayload p{key};
        return bus.tryPost(EventId::DataChanged, &p, sizeof(p), ModuleId::DataStore);
    };
    assert(!bus.tryPost(EventId::SystemStarted));
    changes.tryDrain(4, publish);
    assert(eventbusWarnings.empty());
    bool startPending = true;
    for (unsigned pass = 0; pass < DataKeys::ReservedMax + 10U; ++pass) {
        bus.dispatch(16);
        if (startPending) startPending = !bus.tryPost(EventId::SystemStarted);
        if (!startPending) changes.tryDrain(4, publish);
    }
    assert(transitions == EventBus::QUEUE_LENGTH && started == 1);
    for (auto count : received) assert(count == 1);
    assert(eventbusWarnings.empty());
    // Repeat saturation after startup: runtime notifications must also retry.
    for (unsigned round = 0; round < 2; ++round) {
        for (unsigned i = 0; i < EventBus::QUEUE_LENGTH; ++i) {
            const unsigned value = transitions + i;
            assert(bus.post(EventId::ConfigChanged, &value, sizeof(value)));
        }
        for (DataKey key = 0; key <= DataKeys::ReservedMax; ++key) {
            assert(changes.mark(key));
            assert(changes.mark(key));
        }
        for (unsigned blocked = 0; blocked < 20; ++blocked) changes.tryDrain(4, publish);
        for (unsigned pass = 0; pass < DataKeys::ReservedMax + 10U; ++pass) {
            bus.dispatch(16);
            changes.tryDrain(4, publish);
        }
        for (auto count : received) assert(count == round + 2);
        assert(started == 1 && eventbusWarnings.empty());
    }
    // Actual unretained overflow must still count and report a loss.
    for (unsigned i = 0; i < EventBus::QUEUE_LENGTH; ++i) {
        const unsigned value = transitions + i;
        assert(bus.post(EventId::ConfigChanged, &value, sizeof(value)));
    }
    assert(!bus.post(EventId::ConfigChanged));
    assert(eventbusWarnings.size() == 1);
    assert(eventbusWarnings.back().find("drop_total=1") != std::string::npos);
    // Historical loss totals must not warn again in a loss-free window.
    fakeMs = 1; bus.dispatch(EventBus::QUEUE_LENGTH);
    fakeMs = 6001; bus.dispatch(0);
    const auto warningsAfterLossWindow = eventbusWarnings.size();
    bool reportedLossWindow = false;
    for (const auto& warning : eventbusWarnings)
        reportedLossWindow |= warning.find("post stats 5s: drops=1 ") != std::string::npos;
    assert(reportedLossWindow);
    fakeMs = 11001; bus.dispatch(0);
    assert(eventbusWarnings.size() == warningsAfterLossWindow);
    puts("EventBus startup: full queue retry without loss, all keys delivered, transition ordering, single SystemStarted, real loss accounting OK");
}
