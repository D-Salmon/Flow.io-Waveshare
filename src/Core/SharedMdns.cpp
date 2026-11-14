#include "SharedMdns.h"
#include <ESPmDNS.h>
#include <mutex>

namespace {
std::mutex mdnsMutex;
SharedMdns<MDNSResponder> responder(MDNS);
}

bool acquireMdns(MdnsInterface interface, const char* hostname)
{
    std::lock_guard<std::mutex> lock(mdnsMutex);
    return responder.acquire(interface, hostname);
}

void releaseMdns(MdnsInterface interface)
{
    std::lock_guard<std::mutex> lock(mdnsMutex);
    responder.release(interface);
}
