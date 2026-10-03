#include "Core/I2cAddressSelection.h"
#include <algorithm>
#include <array>
#include <cassert>
#include <initializer_list>

using Device = I2cAddressSelection;
using Status = I2cAddressStatus;

template <size_t N>
void resolve(std::array<Device, N>& devices, std::initializer_list<uint8_t> present)
{
    resolveI2cAddresses(devices.data(), devices.size(), [&](uint8_t address) {
        assert(validI2cDeviceAddress(address));
        return std::find(present.begin(), present.end(), address) != present.end();
    });
}

int main()
{
    // Requested deployment scenarios, with and without the SHT40 reservation.
    for (bool shtEnabled : {false, true}) {
        std::array<Device, 2> devices{{{0x40, 0x44, true}, {0x44, 0, shtEnabled}}};
        resolve(devices, {0x44});
        assert(devices[0].active == (shtEnabled ? 0 : 0x44));
        assert(devices[1].active == (shtEnabled ? 0x44 : 0));
        resolve(devices, {0x40, 0x44});
        assert(devices[0].active == 0x40);
        assert(devices[1].active == (shtEnabled ? 0x44 : 0));
        resolve(devices, {});
        assert(devices[0].active == 0 && devices[1].active == 0);
        assert(devices[0].primary == 0x40 && devices[0].secondary == 0x44);
    }
    {
        std::array<Device, 2> devices{{{0x40, 0x44, true}, {0x44, 0x45, true}}};
        resolve(devices, {0x45});
        assert(devices[0].status == Status::SecondaryReserved);
        assert(devices[1].active == 0x45);
    }
    {
        std::array<Device, 2> devices{{{0x40, 0x44, true}, {0x40, 0x45, true}}};
        resolve(devices, {0x40, 0x44, 0x45});
        for (auto d : devices) assert(d.status == Status::PrimaryConflict && !d.active);
    }
    {
        std::array<Device, 3> devices{{{0x40, 0x44, true}, {0x41, 0x44, true}, {0x42, 0x44, true}}};
        resolve(devices, {0x44});
        for (auto d : devices) assert(d.status == Status::SecondaryConflict && !d.active);
        resolve(devices, {0x40, 0x41, 0x44});
        assert(devices[0].active == 0x40 && devices[1].active == 0x41 && devices[2].active == 0x44);
    }
    {
        std::array<Device, 4> devices{{{0x40, 0, true}, {0x41, 0x41, true}, {0, 0x44, true}, {0x42, 0x78, true}}};
        resolve(devices, {0x44});
        for (auto d : devices) assert(!d.active);
        assert(devices[2].status == Status::Invalid && devices[3].status == Status::Invalid);
    }
    // Invariants and order independence across all small bus plans and presence masks.
    constexpr uint8_t addresses[]{0, 0x40, 0x44, 0x48};
    for (uint8_t a : addresses) for (uint8_t b : addresses)
    for (uint8_t c : addresses) for (uint8_t d : addresses)
    for (unsigned mask = 0; mask < 8; ++mask) {
        std::array<Device, 3> original{{{a, b, true}, {c, d, true}, {0x48, 0x44, true}}};
        const auto probe = [mask](uint8_t address) {
            assert(validI2cDeviceAddress(address));
            return (address == 0x40 && (mask & 1)) ||
                   (address == 0x44 && (mask & 2)) ||
                   (address == 0x48 && (mask & 4));
        };
        auto expected = original;
        resolveI2cAddresses(expected.data(), expected.size(), probe);
        for (size_t i = 0; i < expected.size(); ++i) {
            const auto& device = expected[i];
            if (!device.active) continue;
            assert(probe(device.active));
            for (size_t j = 0; j < expected.size(); ++j) {
                if (i == j) continue;
                assert(device.active != expected[j].active);
                assert(device.active != original[j].primary);
            }
        }
        std::array<size_t, 3> order{{0, 1, 2}};
        do {
            std::array<Device, 3> reordered{{original[order[0]], original[order[1]], original[order[2]]}};
            resolveI2cAddresses(reordered.data(), reordered.size(), probe);
            for (size_t i = 0; i < order.size(); ++i) {
                assert(reordered[i].active == expected[order[i]].active);
                assert(reordered[i].status == expected[order[i]].status);
            }
        } while (std::next_permutation(order.begin(), order.end()));
    }
}
