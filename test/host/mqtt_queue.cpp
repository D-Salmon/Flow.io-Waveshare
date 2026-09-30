// Built by scripts/tests/test_mqtt_queue.py with the production types/methods.
#include "Core/Services/IMqtt.h"
#include <cassert>
#include <cstdio>
#include <cstring>
#include <functional>
#include <string>
#include <vector>

static uint32_t clockMs = 10000;
static int lockDepth = 0;
static std::vector<std::string> warnings;
uint32_t millis() { return clockMs; }
#define portENTER_CRITICAL(mux) do { (void)(mux); assert(lockDepth++ == 0); } while (0)
#define portEXIT_CRITICAL(mux) do { (void)(mux); assert(--lockDepth == 0); } while (0)
template<class... Args> void captureWarning(const char* format, Args... args) {
    assert(lockDepth == 0);
    char text[512];
    snprintf(text, sizeof(text), format, args...);
    warnings.emplace_back(text);
}
#define LOGW(...) captureWarning(__VA_ARGS__)
namespace Limits { namespace Mqtt { namespace Timing { constexpr uint32_t PublishDispatchIntervalMs = 100; } } }
enum class TrackedBufferId { MqttPayloadBuf };
struct BufferUsageTracker { template<class... Args> static void note(Args...) {} };
enum class MQTTState { Connected, ErrorWait };

class MQTTModule {
public:
    // PRODUCTION_TYPES
    static constexpr uint8_t MaxJobs = 8;
    static constexpr uint16_t HighQueueCap = 2, NormalQueueCap = 2, LowQueueCap = 3;
    static constexpr uint16_t RetryMinMs = 250, RetryMaxMs = 10000;
    static constexpr uint8_t ProcessBudgetPerTick = 1;
    struct TxStorage {
        Job jobs[MaxJobs]{};
        JobRing<HighQueueCap> highQ;
        JobRing<NormalQueueCap> normalQ;
        JobRing<LowQueueCap> lowQ;
    } storage;
    struct ScratchBuffers { char topic[64]; char payload[64]; } scratch;
    TxStorage* txStorage_ = &storage;
    ScratchBuffers* scratch_ = &scratch;
    MQTTState state_ = MQTTState::Connected;
    int jobsMux_ = 0;
    uint8_t queueRetryCursor_[3]{};
    uint32_t lastEnqueueIssueLogMs_ = 0, lastPublishDispatchMs_ = 0;
    std::function<MqttBuildResult(uint16_t)> duringBuild;
    bool publishOk = true;
    std::vector<uint16_t> built, published, deferred, dropped;
    MqttPublishProducer producer{};
    MQTTModule() {
        producer.ctx = this;
        producer.buildMessage = [](void* ctx, uint16_t id, MqttBuildContext& out) {
            assert(lockDepth == 0);
            auto& m = *static_cast<MQTTModule*>(ctx);
            m.built.push_back(id);
            strcpy(out.topic, "test"); strcpy(out.payload, "value");
            return m.duringBuild ? m.duringBuild(id) : MqttBuildResult::Ready;
        };
        producer.onMessagePublished = [](void* ctx, uint16_t id) {
            assert(lockDepth == 0); static_cast<MQTTModule*>(ctx)->published.push_back(id);
        };
        producer.onMessageDeferred = [](void* ctx, uint16_t id) {
            assert(lockDepth == 0); static_cast<MQTTModule*>(ctx)->deferred.push_back(id);
        };
        producer.onMessageDropped = [](void* ctx, uint16_t id) {
            assert(lockDepth == 0); static_cast<MQTTModule*>(ctx)->dropped.push_back(id);
        };
    }
    const MqttPublishProducer* findProducer_(uint8_t) const { return &producer; }
    bool tryPublishNow_(const char*, const char*, uint8_t, bool) {
        assert(lockDepth == 0); return publishOk;
    }
    // PRODUCTION_DECLARATIONS
    bool add(uint16_t id, MqttPublishPriority prio = MqttPublishPriority::High) {
        return enqueue(4, id, prio, 0);
    }
    Job& job(uint16_t id) {
        const int16_t idx = findJobSlot_(4, id); assert(idx >= 0); return storage.jobs[idx];
    }
    void tick(uint32_t advance = 100) {
        clockMs += advance; processJobs_(clockMs); check();
    }
    void check() {
        uint16_t used, h, n, l; JobStateCounts states;
        snapshotQueueStatsNoLock_(used, h, n, l, &states);
        assert(used == states.queued + states.processing + states.waiting);
        unsigned references[MaxJobs]{};
        auto inspect = [&](const auto& ring, unsigned cap, uint8_t prio) {
            for (unsigned i = 0; i < ring.count; ++i) {
                const auto item = ring.items[(ring.head + i) % cap];
                assert(item.slot < MaxJobs);
                const auto& j = storage.jobs[item.slot];
                if (j.state == JobState::Queued && j.queueToken == item.token && j.queuedPrio == prio)
                    ++references[item.slot];
            }
        };
        inspect(storage.highQ, HighQueueCap, 2);
        inspect(storage.normalQ, NormalQueueCap, 1);
        inspect(storage.lowQ, LowQueueCap, 0);
        for (unsigned i = 0; i < MaxJobs; ++i)
            assert(references[i] == (storage.jobs[i].state == JobState::Queued ? 1U : 0U));
    }
    void drain() {
        duringBuild = {}; publishOk = true;
        for (unsigned i = 0; i < 50; ++i) tick(1000);
        for (const auto& j : storage.jobs) assert(j.state == JobState::Free);
        assert(storage.highQ.count + storage.normalQ.count + storage.lowQ.count == 0);
    }
};
// PRODUCTION_METHODS

static void promotion() {
    MQTTModule m;
    assert(m.add(1, MqttPublishPriority::Normal));
    assert(m.add(2)); assert(m.add(3));
    const auto token = m.job(1).queueToken;
    warnings.clear();
    assert(m.add(1)); // Accepted even though promotion is delayed.
    assert(m.job(1).state == MQTTModule::JobState::Queued);
    assert(m.job(1).queueToken == token && m.job(1).queuedPrio == 1 && m.job(1).priority == 2);
    assert(warnings.size() == 1 && warnings[0].find("enqueue deferred reason=promotion_full") != std::string::npos);
    m.check(); m.tick();
    assert(m.job(1).queuedPrio == 2);
    m.drain(); assert(m.published.size() == 3);
}

static void interruptedDispatch(MqttBuildResult result, bool publishOk) {
    MQTTModule m;
    assert(m.add(1)); assert(m.add(2));
    m.publishOk = publishOk;
    bool inject = true;
    m.duringBuild = [&](uint16_t id) {
        if (id == 1 && inject) {
            inject = false;
            assert(m.add(3)); // Occupy the slot freed while message 1 is being built.
            if (result != MqttBuildResult::RetryLater && publishOk) assert(m.add(1));
            return result;
        }
        return MqttBuildResult::Ready;
    };
    m.tick();
    assert(m.job(1).state == MQTTModule::JobState::WaitingForQueue);
    if (result == MqttBuildResult::RetryLater || !publishOk) {
        const auto due = m.job(1).notBeforeMs;
        assert(m.add(1)); // Must neither duplicate nor reset the retry deadline.
        assert(m.job(1).notBeforeMs == due);
        m.tick(100); m.tick(100);
        assert(m.job(1).state == MQTTModule::JobState::WaitingForQueue);
        assert(m.built.size() == 3); // Only messages 2 and 3 built during backoff.
        m.tick(50);
        assert(m.findJobSlot_(4, 1) >= 0); // Dispatch pacing still applies.
    }
    m.drain();
    assert(m.findJobSlot_(4, 1) < 0);
    if (result == MqttBuildResult::Ready && publishOk) assert(m.published.size() == 4);
    if (result == MqttBuildResult::PermanentError) assert(m.dropped.empty());
}

static void disconnectAndPriority() {
    MQTTModule m;
    assert(m.add(1, MqttPublishPriority::Normal));
    m.duringBuild = [&](uint16_t id) {
        if (id == 1) {
            assert(m.add(2)); assert(m.add(3)); assert(m.add(1));
            return MqttBuildResult::RetryLater;
        }
        return MqttBuildResult::Ready;
    };
    m.tick();
    assert(m.job(1).state == MQTTModule::JobState::WaitingForQueue && m.job(1).priority == 2);
    m.state_ = MQTTState::ErrorWait;
    const auto built = m.built.size();
    m.tick(1000); assert(m.built.size() == built);
    assert(!m.add(4));
    m.state_ = MQTTState::Connected;
    m.drain(); assert(m.published.size() == 3);
}

static void fairnessAndRejections() {
    MQTTModule m;
    assert(m.add(1)); assert(m.add(2));
    assert(!m.add(3)); assert(m.findJobSlot_(4, 3) < 0);
    // Three retained jobs compete for two ring positions. Each callback updates
    // its own message, exercising round-robin readmission under sustained load.
    assert(m.add(3, MqttPublishPriority::Normal)); assert(m.add(3));
    m.duringBuild = [&](uint16_t id) { assert(m.add(id)); return MqttBuildResult::Ready; };
    for (unsigned i = 0; i < 18; ++i) m.tick();
    for (uint16_t id = 1; id <= 3; ++id) {
        unsigned count = 0; for (auto value : m.published) count += value == id;
        assert(count >= 4);
    }
    m.drain();
    // Fill the pool with retained work waiting for its deadline.
    for (uint16_t id = 1; id <= MQTTModule::MaxJobs; ++id) {
        assert(m.add(id));
        m.duringBuild = [](uint16_t) { return MqttBuildResult::RetryLater; };
        m.tick(1);
        // Make existing delays long enough to fill the pool deterministically.
        m.job(id).notBeforeMs = clockMs + 5000;
    }
    assert(!m.add(99));
    m.drain();
}

static void staleSlotReuse() {
    MQTTModule m;
    assert(m.add(1, MqttPublishPriority::Low)); assert(m.add(1));
    const auto stale = m.storage.lowQ.items[m.storage.lowQ.head];
    m.tick(); // Message 1 finishes while its obsolete low reference remains.
    assert(m.add(2, MqttPublishPriority::Low));
    assert(m.findJobSlot_(4, 2) == stale.slot);
    assert(m.job(2).queueToken != stale.token);
    m.drain(); assert(m.published.size() == 2);
    assert(m.add(4));
    m.duringBuild = [](uint16_t) { return MqttBuildResult::PermanentError; };
    m.tick(); assert(m.dropped.size() == 1 && m.findJobSlot_(4, 4) < 0);
}

int main() {
    promotion();
    interruptedDispatch(MqttBuildResult::Ready, true);
    interruptedDispatch(MqttBuildResult::RetryLater, true);
    interruptedDispatch(MqttBuildResult::Ready, false);
    interruptedDispatch(MqttBuildResult::PermanentError, true);
    disconnectAndPriority(); fairnessAndRejections(); staleSlotReuse();
    assert(lockDepth == 0);
    puts("MQTT: promotion, three requeue paths, send failure, backoff, deduplication, reconnection, fairness, rejection, stale references and complete drain OK");
}
