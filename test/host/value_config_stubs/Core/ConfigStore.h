#pragma once
#include <stdint.h>
#include <vector>
#include <string>
#include <unordered_map>

enum class ConfigType { Bool, UInt16, Double, UInt8, CharArray };
enum class ConfigPersistence { Persistent };
template<typename T, int> struct ConfigVariable {
    const char* nvsKey{};
    const char* name{};
    const char* path{};
    ConfigType type{};
    T* value{};
    ConfigPersistence persistence{};
    int flags{};
};
struct ConfigStore {
    struct Entry { std::string key, name, path; ConfigType type; uint8_t branch; };
    std::vector<Entry> entries;
    std::unordered_map<std::string, bool> persisted;
    bool queryOk = true, writeOk = true;
    unsigned writes = 0;
    bool containsPersistentKey(const char* key, bool* exists) {
        if (!queryOk) return false;
        *exists = persisted.count(key) != 0;
        return true;
    }
    bool set(ConfigVariable<bool, 0>& var, bool value) {
        if (!writeOk) return false;
        *var.value = value;
        persisted[var.nvsKey] = value;
        ++writes;
        return true;
    }
    template<typename T> void registerVar(ConfigVariable<T, 0>& v, uint8_t, uint8_t branch) {
        entries.push_back({v.nvsKey, v.name, v.path, v.type, branch});
    }
};
