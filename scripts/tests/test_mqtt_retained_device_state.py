"""Exercise production runtime dispatch against a broker retaining state for late HA subscribers."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

def strip_includes(text):
    return '\n'.join(line for line in text.splitlines() if not line.startswith(('#include', '#pragma once')))

def method(text, name):
    start = text.index('bool PoolDeviceModule::' + name + '(')
    return text[start:text.index('\n}', start) + 2]

class RetainedDeviceStateTest(unittest.TestCase):
    def test_late_subscriber_gets_state_and_reconnect_refreshes_it(self):
        interface = strip_includes((ROOT / 'src/Core/RuntimeSnapshotProvider.h').read_text())
        header = strip_includes((ROOT / 'src/Modules/Network/MQTTModule/RuntimeProducer.h').read_text())
        producer = strip_includes((ROOT / 'src/Modules/Network/MQTTModule/RuntimeProducer.cpp').read_text())
        device = (ROOT / 'src/Modules/PoolDeviceModule/PoolDeviceRuntime.cpp').read_text()
        policy = '\n'.join(method(device, name) for name in ('snapshotRouteFromIndex_', 'slotRuntimePublishable_', 'runtimeSnapshotRetained'))
        harness = r"""
#include <cassert>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <cstdint>
#include <new>
#include <string>
#include <map>
#include <vector>
using DataKey = uint16_t;
namespace Limits { constexpr size_t TopicBuf=128, MaxRuntimeRoutes=32; }
uint32_t millis() { return 20000; }
uint32_t micros() { return 0; }
constexpr unsigned MALLOC_CAP_SPIRAM=1, MALLOC_CAP_8BIT=2;
void* heap_caps_malloc(size_t n, unsigned) { return std::malloc(n); }
void* heap_caps_calloc(size_t n, size_t s, unsigned) { return std::calloc(n,s); }
enum class MqttBuildResult { Ready, RetryLater, PermanentError, NoLongerNeeded };
enum class MqttPublishPriority { High, Normal };
struct MqttBuildContext { char* topic; size_t topicCapacity; char* payload; size_t payloadCapacity;
    uint16_t topicLen=0, payloadLen=0; uint8_t qos=0; bool retain=false; };
struct MqttService { void* ctx;
    bool (*enqueue)(void*,uint8_t,uint16_t,uint8_t,uint32_t);
    void (*formatTopic)(void*,const char*,char*,size_t); };
""" + interface + r"""
constexpr uint8_t POOL_DEVICE_MAX=8;
class PoolDeviceModule {
public:
    struct PoolDeviceSlot { bool used=true, runtimePublishable=true; };
    PoolDeviceSlot slots_[POOL_DEVICE_MAX]{};
    bool runtimeReady_=true;
    bool lockState_() const { return true; }
    void unlockState_() const {}
    bool runtimeSnapshotRetained(uint8_t idx) const;
    bool snapshotRouteFromIndex_(uint8_t idx,uint8_t& slot,bool& metrics) const;
    bool slotRuntimePublishable_(uint8_t slot) const;
};
""" + policy + header + producer + r"""
struct Provider : IRuntimeSnapshotProvider {
    PoolDeviceModule device;
    bool on=false;
    uint8_t runtimeSnapshotCount() const override { return 2; }
    const char* runtimeSnapshotSuffix(uint8_t i) const override { return i==0?"rt/pdm/state/pd7":"rt/pdm/metrics/pd7"; }
    RuntimeRouteClass runtimeSnapshotClass(uint8_t) const override { return RuntimeRouteClass::ActuatorImmediate; }
    bool runtimeSnapshotRetained(uint8_t i) const override { return device.runtimeSnapshotRetained(16+i); }
    bool runtimeSnapshotAffectsKey(uint8_t, DataKey) const override { return true; }
    bool buildRuntimeSnapshot(uint8_t,char* out,size_t n,uint32_t& ts) const override {
        snprintf(out,n,"{\"on\":%s}",on?"true":"false");ts=on?2:1;return true;
    }
};
int main() {
    PoolDeviceModule policy;
    assert(policy.runtimeSnapshotRetained(0) && policy.runtimeSnapshotRetained(1));
    for(unsigned i=0;i<8;++i) {
        assert(policy.runtimeSnapshotRetained(2+2*i));
        assert(!policy.runtimeSnapshotRetained(3+2*i));
    }
    assert(!policy.runtimeSnapshotRetained(255));
    policy.slots_[7].runtimePublishable=false;
    assert(!policy.runtimeSnapshotRetained(16));
    policy.slots_[0].used=false;
    assert(!policy.runtimeSnapshotRetained(14)); // Sparse slots still resolve heater state.
    policy.slots_[7].runtimePublishable=true;
    assert(policy.runtimeSnapshotRetained(14));
    std::vector<uint16_t> queued;
    MqttService mqtt{&queued,[](void* c,uint8_t,uint16_t id,uint8_t,uint32_t){
        static_cast<std::vector<uint16_t>*>(c)->push_back(id);return true;},
        [](void*,const char* suffix,char* out,size_t n){snprintf(out,n,"flow/device/%s",suffix);}};
    Provider provider;
    RuntimeProducer runtime;
    runtime.configure(&mqtt);
    assert(runtime.registerProvider(&provider));
    std::map<std::string,std::string> broker;
    auto publish=[&](unsigned idx) {
        char topic[128]{},payload[128]{};
        MqttBuildContext ctx{topic,sizeof(topic),payload,sizeof(payload)};
        assert(runtime.buildMessage(idx,ctx)==MqttBuildResult::Ready);
        if(ctx.retain)broker[topic]=payload;
        runtime.onMessagePublished(idx);
    };
    runtime.onConnected();
    publish(0);publish(1);
    // HA joins after publication, without ever operating the heater.
    assert(broker.at("flow/device/rt/pdm/state/pd7")=="{\"on\":false}");
    assert(broker.count("flow/device/rt/pdm/metrics/pd7")==0);
    provider.on=true;
    runtime.onDataChanged(1);publish(0);
    assert(broker.at("flow/device/rt/pdm/state/pd7")=="{\"on\":true}");
    // Firmware reconnect must overwrite stale retained state.
    provider.on=false;
    runtime.onConnected();publish(0);
    assert(broker.at("flow/device/rt/pdm/state/pd7")=="{\"on\":false}");
}
"""
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'retained.cpp'
            binary=Path(tmp)/('retained.exe' if os.name=='nt' else 'retained')
            source.write_text(harness)
            result=subprocess.run([os.environ.get('CXX','c++'),'-std=c++17',str(source),'-o',str(binary)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            subprocess.run([str(binary)],check=True)

if __name__=='__main__':
    unittest.main(verbosity=2)
