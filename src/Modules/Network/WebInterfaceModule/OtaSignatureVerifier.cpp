/**
 * @file OtaSignatureVerifier.cpp
 * @brief ECDSA P-256 verification for local OTA images.
 */

#include "Modules/Network/WebInterfaceModule/OtaSignatureVerifier.h"

#include <string.h>
#include <mbedtls/base64.h>
#include <mbedtls/pk.h>

#include "Security/OtaPublicKey.h"

bool verifyOtaSignature(const uint8_t digest[32], const char* signatureBase64)
{
    if (!digest || !signatureBase64 || signatureBase64[0] == '\0' ||
        OtaTrust::PublicKeyPem[0] == '\0') return false;

    uint8_t signature[80] = {0};
    size_t signatureLen = 0U;
    if (mbedtls_base64_decode(signature,
                              sizeof(signature),
                              &signatureLen,
                              reinterpret_cast<const unsigned char*>(signatureBase64),
                              strlen(signatureBase64)) != 0) return false;

    mbedtls_pk_context key;
    mbedtls_pk_init(&key);
    const int parseResult = mbedtls_pk_parse_public_key(
        &key,
        reinterpret_cast<const unsigned char*>(OtaTrust::PublicKeyPem),
        strlen(OtaTrust::PublicKeyPem) + 1U
    );
    const int verifyResult = (parseResult == 0)
        ? mbedtls_pk_verify(&key, MBEDTLS_MD_SHA256, digest, 32U, signature, signatureLen)
        : parseResult;
    mbedtls_pk_free(&key);
    return verifyResult == 0;
}
