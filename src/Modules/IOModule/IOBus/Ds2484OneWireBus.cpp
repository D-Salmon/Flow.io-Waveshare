/**
 * @file Ds2484OneWireBus.cpp
 * @brief DS2484 I2C-to-1-Wire bridge implementation.
 */

#include "Ds2484OneWireBus.h"

#include <Arduino.h>
#include <string.h>

namespace {
constexpr uint8_t kCmdDeviceReset = 0xF0;
constexpr uint8_t kCmdSetReadPointer = 0xE1;
constexpr uint8_t kCmdOneWireReset = 0xB4;
constexpr uint8_t kCmdOneWireWriteByte = 0xA5;
constexpr uint8_t kCmdOneWireReadByte = 0x96;
constexpr uint8_t kCmdOneWireTriplet = 0x78;

constexpr uint8_t kPtrStatus = 0xF0;
constexpr uint8_t kPtrReadData = 0xE1;

constexpr uint8_t kStatus1WBusy = 0x01;
constexpr uint8_t kStatusPresencePulse = 0x02;
constexpr uint8_t kStatusSingleBitResult = 0x20;
constexpr uint8_t kStatusTripletSecondBit = 0x40;
constexpr uint8_t kStatusBranchDirection = 0x80;

constexpr uint8_t kDs18SkipRom = 0xCC;
constexpr uint8_t kDs18MatchRom = 0x55;
constexpr uint8_t kDs18ConvertT = 0x44;
constexpr uint8_t kDs18ReadScratchpad = 0xBE;
}

Ds2484OneWireBus::Ds2484OneWireBus(I2CBus* bus, uint8_t address)
    : bus_(bus), address_(address)
{
}

void Ds2484OneWireBus::configure(I2CBus* bus, uint8_t address)
{
    bus_ = bus;
    address_ = address;
    started_ = false;
    scanned_ = false;
    deviceCount_ = 0;
    memset(addresses_, 0, sizeof(addresses_));
}

void Ds2484OneWireBus::begin()
{
    if (started_ || !bus_) return;
    started_ = resetDevice_();
}

void Ds2484OneWireBus::request()
{
    if (!started_) return;
    if (!oneWireReset_()) return;
    (void)oneWireWriteByte_(kDs18SkipRom);
    (void)oneWireWriteByte_(kDs18ConvertT);
}

void Ds2484OneWireBus::setWaitForConversion(bool enabled)
{
    (void)enabled;
}

bool Ds2484OneWireBus::getAddress(uint8_t index, uint8_t out[8]) const
{
    if (!started_ || !out) return false;
    if (!scanned_) {
        deviceCount_ = 0;
        memset(addresses_, 0, sizeof(addresses_));
        for (uint8_t i = 0; i < 4; ++i) {
            if (!searchAddress_(i, addresses_[i])) break;
            ++deviceCount_;
        }
        scanned_ = true;
    }
    if (index >= deviceCount_) return false;
    memcpy(out, addresses_[index], 8);
    return true;
}

bool Ds2484OneWireBus::hasAddress(const uint8_t addr[8]) const
{
    if (!started_ || !addr) return false;
    uint8_t found[8] = {};
    const uint8_t count = deviceCount();
    for (uint8_t i = 0; i < count; ++i) {
        if (getAddress(i, found) && memcmp(found, addr, sizeof(found)) == 0) {
            return true;
        }
    }
    return false;
}

float Ds2484OneWireBus::readC(const uint8_t addr[8]) const
{
    if (!started_ || !addr) return DEVICE_DISCONNECTED_C;
    if (!oneWireReset_()) return DEVICE_DISCONNECTED_C;
    if (!oneWireWriteByte_(kDs18MatchRom)) return DEVICE_DISCONNECTED_C;
    for (uint8_t i = 0; i < 8; ++i) {
        if (!oneWireWriteByte_(addr[i])) return DEVICE_DISCONNECTED_C;
    }
    if (!oneWireWriteByte_(kDs18ReadScratchpad)) return DEVICE_DISCONNECTED_C;

    uint8_t scratch[9] = {};
    for (uint8_t i = 0; i < sizeof(scratch); ++i) {
        if (!oneWireReadByte_(scratch[i])) return DEVICE_DISCONNECTED_C;
    }
    if (crc8_(scratch, 8) != scratch[8]) return DEVICE_DISCONNECTED_C;

    const int16_t raw = (int16_t)(((uint16_t)scratch[1] << 8) | scratch[0]);
    return (float)raw / 16.0f;
}

uint8_t Ds2484OneWireBus::deviceCount() const
{
    uint8_t tmp[8] = {};
    if (!scanned_) {
        for (uint8_t i = 0; i < 4; ++i) {
            if (!getAddress(i, tmp)) break;
        }
    }
    return deviceCount_;
}

bool Ds2484OneWireBus::resetDevice_() const
{
    const uint8_t cmd = kCmdDeviceReset;
    if (!bus_->lock(50)) return false;
    const bool ok = bus_->writeBytes(address_, &cmd, 1);
    bus_->unlock();
    if (!ok) return false;
    uint8_t status = 0;
    return readStatus_(status);
}

bool Ds2484OneWireBus::waitReady_(uint32_t timeoutMs) const
{
    const uint32_t start = millis();
    uint8_t status = 0;
    do {
        if (!readStatus_(status)) return false;
        if ((status & kStatus1WBusy) == 0) return true;
        delayMicroseconds(250);
    } while ((uint32_t)(millis() - start) < timeoutMs);
    return false;
}

bool Ds2484OneWireBus::setReadPointer_(uint8_t pointer) const
{
    const uint8_t cmd[2] = {kCmdSetReadPointer, pointer};
    if (!bus_->lock(50)) return false;
    const bool ok = bus_->writeBytes(address_, cmd, sizeof(cmd));
    bus_->unlock();
    return ok;
}

bool Ds2484OneWireBus::readStatus_(uint8_t& status) const
{
    if (!setReadPointer_(kPtrStatus)) return false;
    if (!bus_->lock(50)) return false;
    const bool ok = bus_->readBytes(address_, &status, 1);
    bus_->unlock();
    return ok;
}

bool Ds2484OneWireBus::oneWireReset_() const
{
    if (!waitReady_()) return false;
    const uint8_t cmd = kCmdOneWireReset;
    if (!bus_->lock(50)) return false;
    const bool ok = bus_->writeBytes(address_, &cmd, 1);
    bus_->unlock();
    if (!ok || !waitReady_()) return false;
    uint8_t status = 0;
    if (!readStatus_(status)) return false;
    return (status & kStatusPresencePulse) != 0;
}

bool Ds2484OneWireBus::oneWireWriteByte_(uint8_t value) const
{
    if (!waitReady_()) return false;
    const uint8_t cmd[2] = {kCmdOneWireWriteByte, value};
    if (!bus_->lock(50)) return false;
    const bool ok = bus_->writeBytes(address_, cmd, sizeof(cmd));
    bus_->unlock();
    return ok && waitReady_();
}

bool Ds2484OneWireBus::oneWireReadByte_(uint8_t& value) const
{
    if (!waitReady_()) return false;
    const uint8_t cmd = kCmdOneWireReadByte;
    if (!bus_->lock(50)) return false;
    const bool ok = bus_->writeBytes(address_, &cmd, 1);
    bus_->unlock();
    if (!ok || !waitReady_()) return false;
    if (!setReadPointer_(kPtrReadData)) return false;
    if (!bus_->lock(50)) return false;
    const bool readOk = bus_->readBytes(address_, &value, 1);
    bus_->unlock();
    return readOk;
}

bool Ds2484OneWireBus::oneWireTriplet_(bool searchDirection, uint8_t& status) const
{
    if (!waitReady_()) return false;
    const uint8_t cmd[2] = {kCmdOneWireTriplet, (uint8_t)(searchDirection ? 0x80 : 0x00)};
    if (!bus_->lock(50)) return false;
    const bool ok = bus_->writeBytes(address_, cmd, sizeof(cmd));
    bus_->unlock();
    if (!ok || !waitReady_()) return false;
    return readStatus_(status);
}

bool Ds2484OneWireBus::searchAddress_(uint8_t index, uint8_t out[8]) const
{
    if (!out) return false;

    uint8_t found = 0;
    uint8_t lastDiscrepancy = 0;
    bool lastDevice = false;
    uint8_t rom[8] = {};
    uint8_t prevRom[8] = {};

    while (!lastDevice) {
        memset(rom, 0, sizeof(rom));
        uint8_t nextDiscrepancy = 0;
        if (!oneWireReset_()) return false;
        if (!oneWireWriteByte_(0xF0)) return false;

        for (uint8_t bitNumber = 1; bitNumber <= 64; ++bitNumber) {
            const uint8_t byteIndex = (uint8_t)((bitNumber - 1) / 8);
            const uint8_t bitMask = (uint8_t)(1U << ((bitNumber - 1) & 7));
            bool searchDirection = false;
            if (bitNumber < lastDiscrepancy) {
                searchDirection = (prevRom[byteIndex] & bitMask) != 0;
            } else {
                searchDirection = (bitNumber == lastDiscrepancy);
            }

            uint8_t status = 0;
            if (!oneWireTriplet_(searchDirection, status)) return false;
            const bool sbr = (status & kStatusSingleBitResult) != 0;
            const bool tsb = (status & kStatusTripletSecondBit) != 0;
            const bool dir = (status & kStatusBranchDirection) != 0;
            if (sbr && tsb) return false;
            if (!sbr && !tsb && !dir) nextDiscrepancy = bitNumber;
            if (dir) rom[byteIndex] |= bitMask;
        }

        if (crc8_(rom, 7) != rom[7]) return false;
        if (found == index) {
            memcpy(out, rom, 8);
            return true;
        }
        ++found;
        memcpy(prevRom, rom, sizeof(prevRom));
        lastDiscrepancy = nextDiscrepancy;
        if (lastDiscrepancy == 0) lastDevice = true;
    }

    return false;
}

uint8_t Ds2484OneWireBus::crc8_(const uint8_t* data, uint8_t len)
{
    uint8_t crc = 0;
    while (len--) {
        uint8_t inbyte = *data++;
        for (uint8_t i = 0; i < 8; ++i) {
            const uint8_t mix = (crc ^ inbyte) & 0x01;
            crc >>= 1;
            if (mix) crc ^= 0x8C;
            inbyte >>= 1;
        }
    }
    return crc;
}
