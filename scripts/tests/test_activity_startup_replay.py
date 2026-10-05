"""Replay the production reader against truncated SPIFFS and malformed records."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ActivityStartupReplayTest(unittest.TestCase):
    def test_bounded_replay_preserves_readable_history(self):
        source = (ROOT/'src/Modules/Logs/ActivityLogModule/ActivityLogModule.cpp').read_text(encoding='utf-8')
        begin = source.index('void ActivityLogModule::replayFile_(')
        code = source[begin:source.index('\n}', begin)+2]
        program = r'''
#include <cassert>
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <string>
#include <vector>
#include <algorithm>
#include <ArduinoJson.h>
constexpr int FILE_READ=0;
#define LOGW(...) ((void)0)
struct Console {void printf(const char*, ...) {}} Serial;
struct ActivityEvent {uint32_t seq=0;uint16_t code=0;uint8_t state=0;};
std::string content;size_t reportedSize=0,readCalls=0;bool closed=false;
struct File {
 size_t position=0;
 explicit operator bool()const{return true;}
 size_t size(){return reportedSize;}
 size_t read(uint8_t* buffer,size_t requested){
  assert(++readCalls<1000); // a zero-byte short read must never spin
  const size_t n=std::min(requested,content.size()-position);
  memcpy(buffer,content.data()+position,n);position+=n;return n;
 }
 void close(){closed=true;}
};
namespace fs {struct FS {bool exists(const char*){return true;} File open(const char*,int){return {};}};}
fs::FS filesystem;
namespace ReleaseStorage {fs::FS& runtimeFilesystem(){return filesystem;}}
struct ActivityLogModule {
 bool spiffsReady_=true;uint32_t nextSeq_=1;static constexpr size_t kLineMax=512;
 std::vector<uint32_t> history;
 void replayFile_(const char*);
 bool parseLine_(const char* line,ActivityEvent& event){
  JsonDocument doc;if(deserializeJson(doc,line))return false;
  event.seq=doc["seq"]|0u;return event.seq!=0&&!doc["title"].isNull();
 }
 void normalizeEvent_(ActivityEvent& event){if(event.seq>=nextSeq_)nextSeq_=event.seq+1;}
 void appendRing_(const ActivityEvent& event){history.push_back(event.seq);}
 void removeRing_(uint32_t seq,bool all){history.erase(std::remove_if(history.begin(),history.end(),[=](uint32_t id){return all?id<=seq:id==seq;}),history.end());}
};
''' + code + r'''
std::string record(unsigned seq){return "{\"seq\":"+std::to_string(seq)+",\"title\":\"activity\"}\n";}
void replay(ActivityLogModule& journal,const std::string& input,size_t size){
 content=input;reportedSize=size;readCalls=0;closed=false;
 journal.replayFile_("/activity.1.log");assert(closed&&content==input);
}
int main(){
 // Reproduce EOF while metadata still reports unread bytes: old reader spun.
 ActivityLogModule shortRead;std::string data;
 for(unsigned seq=1;seq<=345;++seq)data+=record(seq);
 data+="{\"seq\":346,\"title\":\"partial";
 replay(shortRead,data,data.size()+500);
 assert(shortRead.history.size()==345&&shortRead.history.back()==345);
 assert(shortRead.nextSeq_==346);
 // Drain one oversized/corrupt physical line, then keep following valid events.
 ActivityLogModule malformed;data=record(1)+std::string(800,'x')+"\n"+record(3)+"{\"seq\":9}\n";
 replay(malformed,data,data.size());assert((malformed.history==std::vector<uint32_t>{1,3}));
 assert(malformed.nextSeq_==10); // selective deletion watermark is retained
 ActivityLogModule unterminated;data=record(7);data.pop_back();
 replay(unterminated,data,data.size());assert((unterminated.history==std::vector<uint32_t>{7}));
 ActivityLogModule empty;replay(empty,"",0);assert(empty.history.empty());
}
'''
        includes = list(Path(os.environ.get('FLOWIO_TEST_LIBDEPS', ROOT/'.pio/libdeps')).glob('*/ArduinoJson/src'))
        with tempfile.TemporaryDirectory(prefix='flow-activity-replay-') as folder:
            cpp = Path(folder)/'test.cpp'
            exe = Path(folder)/'test.exe'
            cpp.write_text(program, encoding='utf-8')
            subprocess.run(['C:/msys64/ucrt64/bin/g++.exe','-std=c++17','-I'+str(includes[0]),str(cpp),'-o',str(exe)],check=True)
            subprocess.run([str(exe)],check=True)


if __name__ == '__main__':
    unittest.main()
