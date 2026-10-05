#pragma once
/**
 * @file WebSecurityPolicy.h
 * @brief Platform-neutral Web security decisions shared by firmware and tests.
 */

#include <stddef.h>
#include <stdint.h>

namespace Security {

constexpr uint8_t WebAuthThrottleSlots = 32U;
constexpr uint8_t WebAuthMaxFailures = 5U;
constexpr uint32_t WebAuthWindowMs = 60000U;
constexpr uint32_t WebAuthBlockMs = 300000U;
constexpr uint8_t WebAuthGlobalMaxFailures = 40U;
constexpr uint32_t WebAuthGlobalBlockMs = 60000U;

struct WebAuthThrottleEntry {
    uint32_t ip = 0U;
    uint32_t windowStartMs = 0U;
    uint32_t blockedUntilMs = 0U;
    uint32_t lastSeenMs = 0U;
    uint8_t failures = 0U;
    bool used = false;
};

struct WebAuthThrottleState {
    WebAuthThrottleEntry entries[WebAuthThrottleSlots]{};
    uint32_t globalWindowStartMs = 0U;
    uint32_t globalBlockedUntilMs = 0U;
    uint8_t globalFailures = 0U;
};

struct WebAuthLimitResult {
    bool limited = false;
    uint32_t retryAfterSeconds = 0U;
};

struct WebAuthFailureResult {
    uint8_t sourceFailures = 0U;
    bool sourceNewlyBlocked = false;
    bool globalNewlyBlocked = false;
};

bool constantTimeEquals(const char* expected, const char* supplied, size_t suppliedLen);
WebAuthLimitResult checkWebAuthLimit(WebAuthThrottleState& state, uint32_t ip, uint32_t nowMs);
WebAuthFailureResult noteWebAuthFailure(WebAuthThrottleState& state, uint32_t ip, uint32_t nowMs);
void noteWebAuthSuccess(WebAuthThrottleState& state, uint32_t ip);

struct CsrfRequestFacts {
    bool mutating = false;
    bool originAllowed = false;
    bool crossSite = false;
    bool tokenPresent = false;
};

bool csrfRequestAllowed(const CsrfRequestFacts& facts,
                        const char* expectedToken,
                        const char* suppliedToken,
                        size_t suppliedTokenLen);

enum class WebRouteMethod : uint8_t {
    Get = 0,
    Post = 1,
    Other = 2,
};

bool unauthenticatedWebRouteAllowed(bool credentialsReady,
                                    bool physicalRecoveryActive,
                                    bool provisioningOnly,
                                    WebRouteMethod method,
                                    const char* path);

/** Return true when a Web route requires a real administrator session. */
bool webRouteRequiresAdmin(WebRouteMethod method, const char* path);

enum class WebCspProfile : uint8_t {
    StrictApplication = 0,
    InlineRecovery = 1,
};

WebCspProfile cspProfileForPath(const char* path);
const char* contentSecurityPolicy(WebCspProfile profile);

enum class OtaUploadPreflight : uint8_t {
    Allowed = 0,
    PublicKeyMissing,
    SignatureMissing,
};

OtaUploadPreflight evaluateOtaUploadPreflight(bool unsignedUpdatesAllowed,
                                              bool publicKeyProvisioned,
                                              bool signaturePresent);
bool otaSignatureRequired(bool unsignedUpdatesAllowed, bool signaturePresent);

struct FailureWindowState {
    uint32_t windowStartMs = 0U;
    uint32_t lastFailureMs = 0U;
    uint8_t failures = 0U;
};

bool recordFailure(FailureWindowState& state,
                   uint32_t nowMs,
                   uint8_t threshold,
                   uint32_t windowMs);
bool failureAlarmCondition(const FailureWindowState& state,
                           uint32_t nowMs,
                           uint8_t threshold,
                           uint32_t holdMs);

}  // namespace Security
