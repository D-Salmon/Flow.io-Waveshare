#include "Modules/Network/MQTTModule/PendingMqttRoutes.h"
#include "Core/EventBus/EventPayloads.h"
#include "Core/EventBus/EventId.h"
#include <cassert>
#include <thread>
#include <vector>
struct Event { EventId id; const void* payload; };
struct FakeStore { bool ready = false; };
bool mqttReady(const FakeStore& store) { return store.ready; }
struct FakeService { FakeStore* store; };
class MqttConfigRouteProducer {
public:
    using CustomBuildFn = MqttBuildResult (*)(void*, uint16_t, MqttBuildContext&);
    // ROUTE
    Route routes_[3]{};
    uint8_t routeCount_ = 3;
    bool producerRegistered_ = true, configLoaded_ = true, mqttReadyLatched_ = false;
    FakeService* dsSvc_ = nullptr;
    PendingMqttRoutes requestedRoutes_;
    std::vector<uint8_t> sent;
    std::vector<MqttPublishPriority> priorities;
    bool enqueueByRoute_(uint8_t idx, MqttPublishPriority priority) {
        sent.push_back(idx); priorities.push_back(priority); return true;
    }
    void runRetryTick_(uint32_t) {}
    void reportMetrics_(uint32_t) {}
    void requestFullSync(MqttPublishPriority);
    void refreshReadyGateAndMaybeSync_();
    void onTransportTick_(uint32_t);
    void onEvent_(const Event&);
    static MqttPublishPriority routePriority_(const Route&);
};
// METHODS
int main() {
    FakeStore store;
    FakeService service{&store};
    MqttConfigRouteProducer producer;
    producer.dsSvc_ = &service;
    for (uint8_t i = 0; i < 3; ++i) {
        producer.routes_[i].branch.moduleId = 5;
        producer.routes_[i].branch.localBranchId = i + 1;
    }
    producer.requestFullSync(MqttPublishPriority::Low);
    producer.onTransportTick_(1);
    assert(producer.sent.empty()); // Offline work remains pending.
    store.ready = true;
    producer.onTransportTick_(2);
    assert(producer.sent.size() == 2); // Bounded initial sync.
    producer.onTransportTick_(3);
    assert(producer.sent.size() == 3);
    producer.onTransportTick_(4);
    assert(producer.sent.size() == 3); // Steady readiness does not resync.
    ConfigChangedPayload payload{};
    payload.moduleId = 5; payload.localBranchId = 2;
    producer.onEvent_({EventId::ConfigChanged, &payload});
    assert(producer.sent.size() == 3); // No transport call inside callback.
    producer.onTransportTick_(5);
    assert(producer.sent.size() == 4 && producer.sent.back() == 1);
    store.ready = false;
    producer.onTransportTick_(6);
    store.ready = true;
    producer.onTransportTick_(7);
    producer.onTransportTick_(8);
    assert(producer.sent.size() == 7); // Reconnection resynchronizes all routes.
    PendingMqttRoutes pending;
    pending.mark(95, MqttPublishPriority::High);
    pending.mark(95, MqttPublishPriority::Low);
    unsigned calls = 0;
    pending.drain(1, [&](uint8_t idx, MqttPublishPriority priority) {
        assert(idx == 95 && priority == MqttPublishPriority::High);
        ++calls;
        std::thread writer([&] { pending.mark(idx, MqttPublishPriority::Normal); });
        writer.join();
    });
    pending.drain(2, [&](uint8_t idx, MqttPublishPriority priority) {
        assert(idx == 95 && priority == MqttPublishPriority::Normal); ++calls;
    });
    assert(calls == 2);
}
