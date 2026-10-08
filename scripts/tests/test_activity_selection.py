"""Production async deletion: durable markers, failures and reboot replay."""
from pathlib import Path
import os
import subprocess, tempfile, unittest, shutil
ROOT=Path(__file__).resolve().parents[2]
def function(source, signature):
    a=source.index(signature)
    return source[a:source.index('\n}',a)+2]
class ActivitySelectionTest(unittest.TestCase):
 def test_async_persistence_and_replay(self):
  s=(ROOT/'src/Modules/Logs/ActivityLogModule/ActivityLogModule.cpp').read_text(encoding='utf-8')
  code='\n'.join(function(s,sig) for sig in (
   'static void copyText_(', 'uint32_t ActivityLogModule::requestDelete_(',
   'uint16_t ActivityLogModule::removeRing_(', 'uint16_t ActivityLogModule::removeRingBatch_(', 'void ActivityLogModule::processDelete_(',
   'bool ActivityLogModule::formatLine_(', 'bool ActivityLogModule::parseLine_(',
   'bool ActivityLogModule::persist_(', 'size_t ActivityLogModule::appendLines_(', 'void ActivityLogModule::rotateIfNeeded_(',
   'void ActivityLogModule::appendRing_(', 'void ActivityLogModule::replayFile_('))
  program=r"""
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <string>
#include <map>
#include <deque>
#include <vector>
#include <algorithm>
#include <functional>
#include <ArduinoJson.h>
#include "Core/Services/IActivityLog.h"
constexpr int FILE_READ=0,FILE_APPEND=1;constexpr bool pdTRUE=true;
using UBaseType_t=unsigned;constexpr unsigned MALLOC_CAP_SPIRAM=1,MALLOC_CAP_8BIT=2;
int critical=0;
#define portENTER_CRITICAL(x) (++critical)
#define portEXIT_CRITICAL(x) (--critical)
#define LOGW(...) ((void)0)
struct Console{void printf(const char*,...){}} Serial;
struct ActivityStorageLock {explicit ActivityStorageLock(void*){}};
void* heap_caps_calloc(size_t n,size_t s,unsigned){return calloc(n,s);}void heap_caps_free(void* p){free(p);}
int yields=0;void vTaskDelay(int){++yields;}
struct Allocator:ArduinoJson::Allocator{void* allocate(size_t n)override{return malloc(n);}void* reallocate(void* p,size_t n)override{return realloc(p,n);}void deallocate(void* p)override{free(p);}} allocator;
ArduinoJson::Allocator* psramPreferredJsonAllocator(){return &allocator;}
std::deque<ActivityEvent> queue;
UBaseType_t uxQueueMessagesWaiting(void*){return queue.size();}
bool xQueueReceive(void*,ActivityEvent* e,int){if(queue.empty())return false;*e=queue.front();queue.pop_front();return true;}
int opens=0,appendOpens=0,writeCalls=0,failWrite=0;size_t partialBytes=0;
std::function<void()> onClose;
struct File {
 std::string* data=nullptr;size_t pos=0;
 explicit operator bool()const{return data;}
 size_t size()const{return data?data->size():0;}
 size_t read(uint8_t* out,size_t n){n=std::min(n,data->size()-pos);memcpy(out,data->data()+pos,n);pos+=n;return n;}
 size_t write(const uint8_t* bytes,size_t n){assert(!critical);if(++writeCalls==failWrite)n=std::min(n,partialBytes);data->append(reinterpret_cast<const char*>(bytes),n);return n;}
 void close(){assert(!critical);if(onClose)onClose();data=nullptr;}
};
namespace fs {struct FS {
 std::map<std::string,std::string> files;
 bool exists(const char* p){return files.count(p);}
 bool remove(const char* p){return files.erase(p)>0;}
 bool rename(const char* from,const char* to){if(!exists(from))return false;files[to]=files[from];files.erase(from);return true;}
 File open(const char* p,int mode){assert(!critical);++opens;if(mode==FILE_APPEND){++appendOpens;files.try_emplace(p,"");}if(!exists(p))return {};return {&files[p],0};}
};}
fs::FS filesystem;namespace ReleaseStorage {fs::FS& runtimeFilesystem(){return filesystem;}}
struct ActivityLogModule {
 static constexpr uint16_t kCapacity=768;static constexpr size_t kLineMax=512;
 static constexpr const char* kLogPath="/activity.log";static constexpr const char* kRotatedLogPath="/activity.1.log";
 static constexpr size_t kFileMaxBytes=96U*1024U;
 struct DeleteRequest {uint32_t sequences[kCapacity];uint16_t count;bool all;};
 std::vector<ActivityEvent> storage=std::vector<ActivityEvent>(kCapacity);ActivityEvent* entries_=storage.data();
 uint16_t capacity_=kCapacity,count_=0,head_=0,deleteRemoved_=0;uint32_t nextSeq_=1,deleteId_=0,persistedCount_=0,persistDropCount_=0,droppedCount_=0;
 bool spiffsReady_=true;void* storageMutex_=this;void* persistQueue_=this;void* mux_=nullptr;
 uint8_t deleteState_=0;DeleteRequest* pendingDelete_=nullptr;
 uint32_t requestDelete_(const uint32_t*,uint16_t,bool);void processDelete_();uint16_t removeRing_(uint32_t,bool);
 uint16_t removeRingBatch_(const uint32_t*,uint16_t,bool);size_t appendLines_(const char*,size_t);
 bool formatLine_(const ActivityEvent&,char*,size_t)const;bool parseLine_(const char*,ActivityEvent&)const;
 bool persist_(const ActivityEvent&);void replayFile_(const char*);void rotateIfNeeded_(size_t);
 void normalizeEvent_(ActivityEvent& e){if(!e.seq)e.seq=nextSeq_++;else if(e.seq>=nextSeq_)nextSeq_=e.seq+1;}
 void appendRing_(const ActivityEvent&);
};
ActivityEvent event(unsigned seq){ActivityEvent e;e.seq=seq;e.code=130;snprintf(e.title,sizeof(e.title),"activity %u",seq);return e;}
void setup(ActivityLogModule& m){filesystem={};queue.clear();onClose={};partialBytes=0;opens=writeCalls=failWrite=yields=0;for(unsigned i=1;i<=4;++i){auto e=event(i);m.normalizeEvent_(e);m.appendRing_(e);if(i<4)assert(m.persist_(e));}queue.push_back(event(4));}
std::vector<uint32_t> ids(const ActivityLogModule& m){std::vector<uint32_t> out;for(unsigned i=0;i<m.count_;++i)out.push_back(m.entries_[(m.head_+i)%m.capacity_].seq);return out;}
"""+code+r"""
int main(){
 ActivityLogModule m;setup(m);const uint32_t selected[]={2,4};
 const auto original=filesystem.files;const int oldOpens=opens;const auto id=m.requestDelete_(selected,2,false);
 assert(id&&m.deleteState_==1&&opens==oldOpens&&filesystem.files==original); // HTTP path never touches flash
 assert(!m.requestDelete_(selected,2,false));
 onClose=[&](){assert((ids(m)==std::vector<uint32_t>{1,2,3,4}));};
 m.processDelete_();onClose={};assert(m.deleteState_==2&&m.deleteRemoved_==2&&yields>=2);assert((ids(m)==std::vector<uint32_t>{1,3}));
 ActivityLogModule reboot;reboot.replayFile_(m.kLogPath);assert((ids(reboot)==std::vector<uint32_t>{1,3}));assert(reboot.nextSeq_==5);
 // Partial write failure never removes an unconfirmed event from RAM or reports success.
 ActivityLogModule failure;setup(failure);failure.requestDelete_(selected,2,false);
 const std::string firstMarker="{\"seq\":2,\"code\":65535,\"state\":0}\n";
 failWrite=writeCalls+2;partialBytes=firstMarker.size()+8;failure.processDelete_();
 assert(failure.deleteState_==3&&failure.deleteRemoved_==1);assert((ids(failure)==std::vector<uint32_t>{1,3,4}));
 ActivityLogModule failedReplay;failedReplay.replayFile_(failure.kLogPath);assert((ids(failedReplay)==std::vector<uint32_t>{1,3,4}));
 // A queue write failure prevents any deletion marker from being written.
 ActivityLogModule queueFailure;setup(queueFailure);queueFailure.requestDelete_(selected,2,false);failWrite=writeCalls+1;queueFailure.processDelete_();
 assert(queueFailure.deleteState_==3&&queueFailure.deleteRemoved_==0&&queueFailure.persistDropCount_==1);assert(ids(queueFailure).size()==4);
 // A purge snapshots its boundary: a later event survives both RAM deletion and replay.
 ActivityLogModule all;setup(all);assert(all.requestDelete_(nullptr,0,true));auto later=event(0);all.normalizeEvent_(later);all.appendRing_(later);queue.push_back(later);all.processDelete_();
 assert(all.deleteState_==2&&(ids(all)==std::vector<uint32_t>{5}));ActivityLogModule after;after.replayFile_(all.kLogPath);assert((ids(after)==std::vector<uint32_t>{5})&&after.nextSeq_==6);
 // No new IDs are assigned to deletion markers; invalid/future requests are refused.
 const uint32_t bad[]={0},future[]={100};assert(!after.requestDelete_(bad,1,false));assert(!after.requestDelete_(future,1,false));assert(!after.requestDelete_(selected,0,false));
 // More than one visible page can be deleted in a single worker job.
 ActivityLogModule large;filesystem={};queue.clear();failWrite=0;std::vector<uint32_t> many;
 for(unsigned i=1;i<=300;++i){auto e=event(i);large.normalizeEvent_(e);large.appendRing_(e);large.persist_(e);many.push_back(i);}
 assert(large.requestDelete_(many.data(),many.size(),false));const int beforeBatch=appendOpens;
 large.processDelete_();assert(large.deleteState_==2&&large.count_==0&&large.deleteRemoved_==300);
 assert(appendOpens-beforeBatch==38); // Eight tombstones share one append/close.
 ActivityLogModule restart;restart.replayFile_(large.kLogPath);assert(restart.count_==0&&restart.nextSeq_==301);
 // A grouped append still rotates before crossing the file-size boundary.
 ActivityLogModule rotating;setup(rotating);queue.clear();auto fourth=event(4);assert(rotating.persist_(fourth));
 auto& content=filesystem.files[rotating.kLogPath];content.append(rotating.kFileMaxBytes-40-content.size(),'\n');
 rotating.requestDelete_(selected,2,false);rotating.processDelete_();
 assert(filesystem.exists(rotating.kRotatedLogPath));
 ActivityLogModule rotatedReplay;rotatedReplay.replayFile_(rotating.kRotatedLogPath);rotatedReplay.replayFile_(rotating.kLogPath);
 assert((ids(rotatedReplay)==std::vector<uint32_t>{1,3})&&rotatedReplay.nextSeq_==5);
 // Wrapped ring, duplicates, nonadjacent IDs and a new event while closing.
 ActivityLogModule wrapped;filesystem={};queue.clear();failWrite=0;
 for(unsigned i=1;i<=800;++i){auto e=event(i);wrapped.normalizeEvent_(e);wrapped.appendRing_(e);}
 const uint32_t mixed[]={33,400,33,800,34,700,100,101,102};
 wrapped.requestDelete_(mixed,9,false);bool added=false;
 onClose=[&](){if(!added){added=true;auto e=event(801);wrapped.normalizeEvent_(e);wrapped.appendRing_(e);}};
 wrapped.processDelete_();onClose={};
 auto remaining=ids(wrapped);assert(remaining.back()==801&&wrapped.deleteState_==2);
 for(auto seq:mixed)assert(std::find(remaining.begin(),remaining.end(),seq)==remaining.end());
 assert(!critical);
}
"""
  includes=list(Path(os.environ.get('FLOWIO_TEST_LIBDEPS', ROOT/'.pio/libdeps')).glob('*/ArduinoJson/src'))
  with tempfile.TemporaryDirectory(prefix='flow-activity-selection-') as d:
   cpp=Path(d)/'main.cpp';exe=Path(d)/'test.exe';cpp.write_text(program,encoding='utf-8')
   subprocess.run([shutil.which('g++') or 'C:/msys64/ucrt64/bin/g++.exe','-std=c++17','-I'+str(includes[0]),'-I'+str(ROOT/'src'),str(cpp),'-o',str(exe)],check=True);subprocess.run([str(exe)],check=True)
if __name__=='__main__':unittest.main()
