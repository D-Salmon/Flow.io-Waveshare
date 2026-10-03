#include "Core/DataStore/PendingDataKeys.h"
#include <cassert>
#include <thread>
#include <atomic>

int main() {
    PendingDataKeys pending;
    assert(!pending.mark(DataKeys::ReservedMax + 1));
    unsigned calls[DataKeys::ReservedMax + 1]{};
    for (DataKey key = 0; key <= DataKeys::ReservedMax; ++key) {
        assert(pending.mark(key)); assert(pending.mark(key));
    }
    unsigned total = 0;
    for (unsigned pass = 0; pass <= DataKeys::ReservedMax; ++pass) {
        unsigned batch = 0;
        pending.drain(8, [&](DataKey key) { ++calls[key]; ++total; ++batch; });
        assert(batch <= 8);
    }
    assert(total == DataKeys::ReservedMax + 1);
    for (auto count : calls) assert(count == 1);
    // An update during processing must survive until another drain.
    pending.mark(15);
    pending.drain(1, [&](DataKey key) { assert(key == 15); pending.mark(key); });
    unsigned repeated = 0;
    pending.drain(8, [&](DataKey key) { assert(key == 15); ++repeated; });
    assert(repeated == 1);
    // Producer and consumer overlap; after completion every final state is seen.
    std::atomic<unsigned> versions[DataKeys::ReservedMax + 1]{};
    unsigned observed[DataKeys::ReservedMax + 1]{};
    std::atomic<bool> done{false};
    std::thread writer([&] {
        for (unsigned version = 1; version <= 100; ++version)
            for (DataKey key = 0; key <= DataKeys::ReservedMax; ++key) {
                versions[key].store(version);
                pending.mark(key);
            }
        done.store(true);
    });
    auto read = [&](DataKey key) { observed[key] = versions[key].load(); };
    while (!done.load()) pending.drain(8, read);
    writer.join();
    pending.drain(DataKeys::ReservedMax + 1, read);
    for (auto version : observed) assert(version == 100);
}
