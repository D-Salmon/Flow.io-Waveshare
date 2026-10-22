"""Validate the production HA switch against every supported disinfection mode."""
from pathlib import Path
import json
import os
import re
import subprocess
import tempfile
import unittest
from jinja2 import Environment, StrictUndefined
ROOT = Path(__file__).resolve().parents[2]

class DisinfectionDiscoveryTests(unittest.TestCase):
    def test_state_projection_and_commands(self):
        source=(ROOT/'src/Modules/PoolLogicModule/PoolLogicLifecycle.cpp').read_text(encoding='utf-8')
        entry=re.search(r'const HASwitchEntry orpAutoModeSwitch\{.*?\n        \};',source,re.S).group(0)
        harness=r"""
#include "Core/Services/IHA.h"
#include <cstdio>
namespace MqttTopics { constexpr const char* SuffixCmd="cmd"; }
"""+entry+r"""
int main() {
 const auto& e=orpAutoModeSwitch;
 printf("{\"id\":\"%s\",\"state_topic\":\"%s\",\"template\":\"%s\",\"command_topic\":\"%s\",\"on\":\"%s\",\"off\":\"%s\"}",e.objectSuffix,e.stateTopicSuffix,e.valueTemplate,e.commandTopicSuffix,e.payloadOn,e.payloadOff);
}
"""
        with tempfile.TemporaryDirectory() as folder:
            cpp=Path(folder)/'ha.cpp';cpp.write_text(harness,encoding='utf-8')
            exe=Path(folder)/('ha.exe' if os.name=='nt' else 'ha')
            subprocess.run([os.environ.get('CXX','c++'),'-std=c++17','-Isrc',str(cpp),'-o',str(exe)],cwd=ROOT,check=True)
            discovery=json.loads(subprocess.check_output([str(exe)],text=True))
        self.assertEqual(discovery['id'],'pl_dis_auto')
        self.assertEqual(discovery['state_topic'],'cfg/poollogic')
        self.assertEqual(discovery['command_topic'],'cmd')
        for mode in ('on','off'):
            self.assertEqual(json.loads(discovery[mode]),{'cmd':'poollogic.dis_auto_mode.set','args':{'value':mode=='on'}})
        template=Environment(undefined=StrictUndefined).from_string(discovery['template'])
        for method in range(4):
            for orp in (False,True):
                for treatment in (False,True):
                    with self.subTest(method=method,orp=orp,treatment=treatment):
                        state=template.render(value_json={'modes':{'disinfection_type':method,'treatment_auto_mode':treatment},'chlorine':{'dis_auto_mode':orp}})
                        expected=orp if method==0 else treatment if method in (1,2) else False
                        self.assertEqual(state,'ON' if expected else 'OFF')

if __name__=='__main__':unittest.main(verbosity=2)
