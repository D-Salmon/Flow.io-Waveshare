"""Round-trip the production MQTT web patch with arbitrary credential characters."""
from pathlib import Path
import os
import re, shutil, subprocess, tempfile, unittest
ROOT=Path(__file__).resolve().parents[2]
class MqttWebConfigTest(unittest.TestCase):
    def test_secret_round_trip_and_empty_retention(self):
        source=(ROOT/'src/Modules/Network/WebInterfaceModule/WebInterfaceServer.cpp').read_text(encoding='utf-8')
        post=source[source.index('server_.on("/api/mqtt/config", HTTP_POST'):]
        patch=post[post.index('        JsonDocument patchDoc'):post.index('\n        if (!cfgStore_->applyJson(patchJson))')]
        board=(ROOT/'src/Board/WaveshareBoard.h').read_text(encoding='utf-8')
        sizes=re.search(r'kWaveshareESP32S3MqttBuffers\s*\{([^}]+)',board).group(1)
        capacity=int(sizes.split(',')[2].strip())
        self.assertEqual(capacity,64)
        store=(ROOT/'src/Core/ConfigStore.cpp').read_text(encoding='utf-8')
        start=store.index('        case ConfigType::CharArray: {',store.index('bool ConfigStore::applyJson'))
        end=store.index('\n        }\n        }',start)+10
        assignment=store[start:end]
        program=r'''
#include <ArduinoJson.h>
#include <cassert>
#include <cstring>
#include <string>
ArduinoJson::Allocator* psramPreferredJsonAllocator(){return ArduinoJson::detail::DefaultAllocator::instance();}
struct Request { void send(int,const char*,const char*){assert(false);} };
std::string build(const char* pass){
Request req; auto request=&req;
bool enabled=true; int port=8883;
const char* host="mqtt.example.org"; const char* user="user\\\"name";
const char* baseTopic="pool"; const char* topicDeviceId=""; const char* deviceName="test";
'''+patch.replace('                return;', '                return {};').replace('            return;', '            return {};')+r'''
return patchJson;
}
enum class ConfigType { CharArray };
struct Meta { void* valuePtr; size_t size; };
void apply(JsonVariantConst valueVar, Meta m){ bool changed=false; switch(ConfigType::CharArray){
'''+assignment+r'''
} (void)changed; }
int main(){
const std::string longSecret(63,'x');
for(const auto* secret : {longSecret.c_str(), "normal-password", "quotes\"and\\slashes", "line\nfeed\ttab", ""}){
JsonDocument doc; assert(!deserializeJson(doc,build(secret)));
auto mqtt=doc["mqtt"];
assert(mqtt["user"].as<std::string>()=="user\\\"name");
if(secret[0]) {
assert(mqtt["pass"].as<std::string>()==secret);
char stored[64]={}; apply(mqtt["pass"],{stored,sizeof(stored)});
assert(std::string(stored)==secret);
}
else assert(mqtt["pass"].isUnbound());
assert(mqtt["enabled"].as<bool>()); assert(mqtt["port"].as<int>()==8883);
}
}
'''
        includes=list((ROOT/'.pio/libdeps').glob('*/ArduinoJson/src'))
        if not includes: includes=list(Path(os.environ.get('FLOWIO_TEST_LIBDEPS', ROOT/'.pio/libdeps')).glob('*/ArduinoJson/src'))
        self.assertTrue(includes)
        with tempfile.TemporaryDirectory(prefix='flow-mqtt-web-') as d:
            cpp=Path(d)/'test.cpp'; exe=Path(d)/'test.exe'; cpp.write_text(program,encoding='utf-8')
            subprocess.run([shutil.which('g++') or 'C:/msys64/ucrt64/bin/g++.exe','-std=c++17','-I'+str(includes[0]),str(cpp),'-o',str(exe)],check=True)
            subprocess.run([str(exe)],check=True)
        get=source[source.index('server_.on("/api/mqtt/config", HTTP_GET'):source.index('server_.on("/api/wifi/config", HTTP_POST')]
        self.assertIn('responseDoc["password_configured"]',get)
        self.assertNotIn('responseDoc["pass"]',get)
if __name__=='__main__': unittest.main()
