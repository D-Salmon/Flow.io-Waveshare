#pragma once
/**
 * @file OtaSignatureVerifier.h
 * @brief ECDSA P-256 verification for local OTA images.
 */

#include <stdint.h>

bool verifyOtaSignature(const uint8_t digest[32], const char* signatureBase64);
