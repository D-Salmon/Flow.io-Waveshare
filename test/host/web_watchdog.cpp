#include <cstdint>
#include <cassert>
struct WebInterfaceHealth {
    bool started = true, paused = false;
    uint32_t lastLoopMs = 0, lastWsActivityMs = 0, lastHttpActivityMs = 0;
    uint16_t wsSerialClients = 0, wsLogClients = 0;
};
uint32_t clockMs = 0;
uint32_t millis() { return clockMs; }
WebInterfaceHealth nextHealth;
struct Service {
    void* ctx = nullptr;
    bool (*getHealth)(void*, WebInterfaceHealth*) = [](void*, WebInterfaceHealth* out) {
        *out = nextHealth;
        clockMs += 2; // Simulates a snapshot newer than the caller's time sample.
        return true;
    };
} service;
Service* webInterfaceSvc_ = &service;
struct Config { int32_t webWatchdogStaleMs = 5000; } cfgData_;
constexpr uint32_t kWebWatchdogMinStaleMs = 1000, kWebWatchdogClientIdleFactor = 3;
uint8_t webWatchdogConsecutiveFailures_ = 0;
bool webWatchdogRebootIssued_ = false;
uint32_t age, idle;
bool stale, clientsIdle;
void calculate() {
    // PRODUCTION_CALCULATION
    age = loopAgeMs; idle = clientIdleMs; stale = loopStale; clientsIdle = clientsStale;
}
int main() {
    clockMs = 100000;
    nextHealth.lastLoopMs = 100001;
    nextHealth.wsLogClients = 1;
    nextHealth.lastWsActivityMs = 100002;
    calculate();
    assert(age == 1 && !stale && idle == 0 && !clientsIdle);
    clockMs = 100000;
    nextHealth.lastLoopMs = 100002;
    calculate();
    assert(age == 0 && !stale); // Former UINT32_MAX - 1 case.
    clockMs = 100000;
    nextHealth.lastLoopMs = 95001;
    calculate();
    assert(age == 5001 && stale); // Genuine stalled loop remains detectable.
    clockMs = UINT32_MAX;
    nextHealth.lastLoopMs = UINT32_MAX - 2;
    nextHealth.lastWsActivityMs = UINT32_MAX - 10;
    nextHealth.lastHttpActivityMs = 1;
    calculate();
    assert(age == 4 && !stale && idle == 0); // Clock wraps while reading snapshot.
    clockMs = 6000;
    nextHealth.lastLoopMs = UINT32_MAX - 100;
    calculate();
    assert(age == 6103 && stale); // A real stall across wrap must still warn.
    nextHealth.lastLoopMs = 0;
    calculate();
    assert(age == UINT32_MAX && stale); // Missing heartbeat keeps existing semantics.
}
