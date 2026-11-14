#pragma once

#include <cstring>
#include <cstddef>

enum class MdnsInterface { Wifi, Ethernet, Count };

// One responder serves all interfaces. A disconnect releases only its own lease.
// Callers serialize access, including backend operations.
template<class Responder>
class SharedMdns {
public:
    explicit SharedMdns(Responder& responder) : responder_(responder) {}

    bool acquire(MdnsInterface interface, const char* hostname)
    {
        if (!hostname || !hostname[0] || std::strlen(hostname) >= sizeof(hostname_)) return false;
        const auto index = static_cast<std::size_t>(interface);
        if (index >= static_cast<std::size_t>(MdnsInterface::Count)) return false;
        if (started_ && std::strcmp(hostname_, hostname) == 0) {
            active_[index] = true;
            return true;
        }
        if (started_) responder_.end();
        started_ = false;
        hostname_[0] = '\0';
        if (!responder_.begin(hostname)) return false;
        active_[index] = true;
        std::strcpy(hostname_, hostname);
        started_ = true;
        return true;
    }

    void release(MdnsInterface interface)
    {
        const auto index = static_cast<std::size_t>(interface);
        if (index >= static_cast<std::size_t>(MdnsInterface::Count)) return;
        active_[index] = false;
        for (bool active : active_) if (active) return;
        if (started_) responder_.end();
        started_ = false;
        hostname_[0] = '\0';
    }

private:
    Responder& responder_;
    bool active_[static_cast<std::size_t>(MdnsInterface::Count)]{};
    bool started_ = false;
    char hostname_[64]{};
};

bool acquireMdns(MdnsInterface interface, const char* hostname);
void releaseMdns(MdnsInterface interface);
