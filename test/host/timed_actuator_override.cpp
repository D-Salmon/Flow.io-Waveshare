#include "Core/Control/TimedActuatorOverride.h"
#include <assert.h>
#include <string.h>

struct Flash {
    uint8_t bytes[TimedActuatorOverride::RecordSize]{};
    bool fail = false;
    unsigned writes = 0;
    static bool save(void* ctx, const uint8_t* data, size_t size) {
        auto& flash = *static_cast<Flash*>(ctx);
        ++flash.writes;
        if (flash.fail) return false;
        assert(size == sizeof(flash.bytes));
        memcpy(flash.bytes, data, size);
        return true;
    }
};

int main() {
    constexpr uint64_t utc = 1700000000;
    Flash flash;
    TimedActuatorOverride timer;
    timer.configure(&flash, Flash::save);
    assert(!timer.start(0, 3, true, 0, utc, 0));
    assert(!timer.start(0, 3, true, 86401, utc, 0));
    assert(!timer.start(0, 3, true, 1800, 0, 0));
    assert(flash.writes == 0);
    assert(timer.start(0, 3, true, 1800, utc, 1000));
    timer.tick(utc + 600, 601000);
    assert(timer.state(601000).remainingSec == 1200);
    assert(flash.writes == 1); // no periodic flash wear

    // Reboot downtime counts; restored leases wait for trustworthy UTC.
    TimedActuatorOverride reboot;
    reboot.configure(&flash, Flash::save);
    assert(reboot.restore(flash.bytes, sizeof(flash.bytes)));
    assert(reboot.slot() == 0 && reboot.binding() == 3);
    reboot.tick(0, 1000);
    assert(reboot.state(1000).mode == ActuatorControlMode::WaitingTime);
    reboot.tick(utc + 720, 2000);
    assert(reboot.state(2000).remainingSec == 1080);
    // Live NTP corrections never extend or shorten the monotonic lease.
    reboot.tick(utc - 100, 62000);
    assert(reboot.state(62000).remainingSec == 1020);
    TimedActuatorOverride afterCorrection;
    afterCorrection.configure(&flash, Flash::save);
    assert(afterCorrection.restore(flash.bytes, sizeof(flash.bytes)));
    afterCorrection.tick(utc - 90, 0);
    assert(afterCorrection.state(0).remainingSec == 1010);
    reboot.tick(utc + 99999, 63000);
    assert(reboot.active());
    reboot.tick(utc + 1800, 1082000);
    assert(!reboot.active());
    assert(reboot.state(1082000).reason == ActuatorOverrideReason::Expired);
    assert(flash.writes == 4);

    // Persisted cancellation cannot resurrect on the next reboot.
    TimedActuatorOverride cancelled;
    cancelled.configure(&flash, Flash::save);
    assert(cancelled.restore(flash.bytes, sizeof(flash.bytes)) && !cancelled.active());
    assert(cancelled.start(3, 7, false, 60, utc, 0));
    assert(!cancelled.state(0).value);
    assert(cancelled.start(3, 7, true, 120, utc + 10, 10000));
    assert(cancelled.state(10000).remainingSec == 120);
    assert(cancelled.cancel(ActuatorOverrideReason::Released));
    assert(!cancelled.active());

    // A failed replacement keeps the already committed lease.
    assert(cancelled.start(3, 7, true, 120, utc, 0));
    flash.fail = true;
    assert(!cancelled.start(3, 7, false, 300, utc, 1000));
    assert(cancelled.state(1000).value && cancelled.state(1000).remainingSec == 119);
    // Safety stops are immediate even when persistence fails, and are retried.
    assert(!cancelled.cancel(ActuatorOverrideReason::Safety));
    assert(!cancelled.active());
    assert(cancelled.state(1000).mode == ActuatorControlMode::PersistenceError);
    flash.fail = false;
    assert(cancelled.flush());
    assert(cancelled.state(1000).mode == ActuatorControlMode::Guided);

    // Expired across an outage, clock reversal across a reboot, corrupt records.
    assert(timer.start(0, 3, true, 60, utc, 0));
    assert(reboot.restore(flash.bytes, sizeof(flash.bytes)));
    reboot.tick(utc + 60, 10);
    assert(!reboot.active());
    assert(timer.start(0, 3, true, 60, utc, 0));
    assert(reboot.restore(flash.bytes, sizeof(flash.bytes)));
    reboot.tick(utc - 1, 10);
    assert(!reboot.active() && reboot.state(10).reason == ActuatorOverrideReason::ClockInvalid);
    assert(!reboot.restore(flash.bytes, 3));
    flash.bytes[0] = 99;
    assert(!reboot.restore(flash.bytes, sizeof(flash.bytes)));

    // Monotonic uptime beyond the 32-bit millis wrap does not overflow.
    const uint64_t longUptime = uint64_t(UINT32_MAX) - 1000;
    assert(timer.start(0, 3, true, 60, utc, longUptime));
    timer.tick(utc + 30, longUptime + 30000);
    assert(timer.state(longUptime + 30000).remainingSec == 30);
    timer.tick(utc + 60, longUptime + 60000);
    assert(!timer.active());
}
