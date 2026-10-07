"""Compile and exercise the production daily schedule across resets and DST."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class AiDailyScheduleTests(unittest.TestCase):
    def test_calendar_and_once_per_day(self):
        program = r'''
#include <ctime>
tm* localtime_r(const time_t* value,tm* out){return localtime_s(out,value)==0?out:nullptr;}
#include "Modules/AiInsightModule/AiDailySchedule.h"
#include <cassert>
#include <cstdlib>
#include <cstring>
uint64_t local(int year,int month,int day,int hour,int minute,int isdst=-1){
 tm date{};date.tm_year=year-1900;date.tm_mon=month-1;date.tm_mday=day;
 date.tm_hour=hour;date.tm_min=minute;date.tm_isdst=isdst;
 return static_cast<uint64_t>(mktime(&date));
}
int main(){
 // Windows CRT supports North American DST rules; the calendar policy is zone-independent.
 _putenv_s("TZ","EST5EDT");_tzset();
 for(const char* valid:{"00:00","08:00","23:59"}) assert(AiDailySchedule::validTime(valid));
 for(const char* bad:{"","8:00","08:0","24:00","12:60","08:00x","aa:bb"}) assert(!AiDailySchedule::validTime(bad));
 assert(!AiDailySchedule::validTime(nullptr));
 assert(!AiDailySchedule::plan(0,"08:00",0).valid);
 auto before=AiDailySchedule::plan(local(2026,10,7,7,59),"08:00",0);
 assert(before.valid&&!before.due&&before.localDate==20261007);
 assert(before.nextUtc==local(2026,10,7,8,0));
 auto due=AiDailySchedule::plan(local(2026,10,7,8,0),"08:00",0);
 assert(due.due);
 auto late=AiDailySchedule::plan(local(2026,10,7,23,59),"08:00",0);
 assert(late.due); // Network or time may become available after the planned hour.
 AiDailySchedule::Checkpoint state{};state.lastAttemptLocalDate=due.localDate;
 unsigned char saved[sizeof(state)];memcpy(saved,&state,sizeof(state));
 AiDailySchedule::Checkpoint rebooted{};memcpy(&rebooted,saved,sizeof(rebooted));
 auto tomorrow=AiDailySchedule::plan(local(2026,10,7,8,1),"08:00",rebooted.lastAttemptLocalDate);
 assert(!tomorrow.due&&tomorrow.nextUtc==local(2026,10,8,8,0));
 assert(AiDailySchedule::plan(local(2026,10,8,8,0),"08:00",rebooted.lastAttemptLocalDate).due);
 auto rolledBack=AiDailySchedule::plan(local(2026,10,5,8,1),"08:00",rebooted.lastAttemptLocalDate);
 assert(!rolledBack.due&&rolledBack.nextUtc==local(2026,10,8,8,0));
 // A changed hour or a re-enabled schedule does not consume a second request today.
 assert(!AiDailySchedule::plan(local(2026,10,7,12,0),"11:00",20261007).due);
 auto spring=AiDailySchedule::plan(local(2026,3,7,8,0),"08:00",20260307);
 assert(spring.nextUtc-local(2026,3,7,8,0)==23*3600);
 auto autumn=AiDailySchedule::plan(local(2026,10,31,8,0),"08:00",20261031);
 assert(autumn.nextUtc-local(2026,10,31,8,0)==25*3600);
 assert(!AiDailySchedule::plan(local(2026,11,1,1,30,0),"01:30",20261101).due);
 auto midnight=AiDailySchedule::plan(local(2026,12,31,23,59),"00:00",20261231);
 assert(midnight.nextUtc==local(2027,1,1,0,0));
 char formatted[24];AiDailySchedule::formatLocal(tomorrow.nextUtc,formatted,sizeof(formatted));
 assert(strcmp(formatted,"08/10/2026 08:00")==0);
 AiDailySchedule::formatLocal(0,formatted,sizeof(formatted));assert(!formatted[0]);
}
'''
        with tempfile.TemporaryDirectory(prefix='flow-ai-calendar-') as directory:
            cpp = Path(directory) / 'calendar.cpp'
            exe = Path(directory) / 'calendar.exe'
            cpp.write_text('#include <initializer_list>\n' + program, encoding='utf-8')
            subprocess.run(['C:/msys64/ucrt64/bin/g++.exe', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            '-I', str(ROOT / 'src'), str(cpp), '-o', str(exe)], check=True)
            subprocess.run([str(exe)], check=True)


if __name__ == '__main__':
    unittest.main()
