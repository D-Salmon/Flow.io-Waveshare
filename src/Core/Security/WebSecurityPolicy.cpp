/**
 * @file WebSecurityPolicy.cpp
 * @brief Platform-neutral Web security policy implementation.
 */

#include "Core/Security/WebSecurityPolicy.h"

#include <limits.h>
#include <string.h>

namespace Security {
namespace {

bool deadlineActive(uint32_t deadlineMs, uint32_t nowMs)
{
    return deadlineMs != 0U && (int32_t)(deadlineMs - nowMs) > 0;
}

}  // namespace

bool constantTimeEquals(const char* expected, const char* supplied, size_t suppliedLen)
{
    if (!expected || !supplied) return false;
    const size_t expectedLen = strlen(expected);
    size_t diff = expectedLen ^ suppliedLen;
    const size_t compareLen = (expectedLen > suppliedLen) ? expectedLen : suppliedLen;
    for (size_t i = 0; i < compareLen; ++i) {
        const uint8_t left = (i < expectedLen) ? (uint8_t)expected[i] : 0U;
        const uint8_t right = (i < suppliedLen) ? (uint8_t)supplied[i] : 0U;
        diff |= (size_t)(left ^ right);
    }
    return diff == 0U;
}

WebAuthLimitResult checkWebAuthLimit(WebAuthThrottleState& state, uint32_t ip, uint32_t nowMs)
{
    WebAuthLimitResult result{};
    if (deadlineActive(state.globalBlockedUntilMs, nowMs)) {
        const uint32_t remainingMs = state.globalBlockedUntilMs - nowMs;
        result.retryAfterSeconds = (remainingMs + 999U) / 1000U;
        result.limited = true;
    } else if (state.globalBlockedUntilMs != 0U) {
        state.globalBlockedUntilMs = 0U;
        state.globalWindowStartMs = nowMs;
        state.globalFailures = 0U;
    }

    for (uint8_t i = 0; i < WebAuthThrottleSlots; ++i) {
        WebAuthThrottleEntry& entry = state.entries[i];
        if (!entry.used || entry.ip != ip) continue;
        entry.lastSeenMs = nowMs;
        if (deadlineActive(entry.blockedUntilMs, nowMs)) {
            const uint32_t remainingMs = entry.blockedUntilMs - nowMs;
            const uint32_t sourceRetryAfter = (remainingMs + 999U) / 1000U;
            if (sourceRetryAfter > result.retryAfterSeconds) {
                result.retryAfterSeconds = sourceRetryAfter;
            }
            result.limited = true;
        } else if (entry.blockedUntilMs != 0U) {
            entry.blockedUntilMs = 0U;
            entry.windowStartMs = nowMs;
            entry.failures = 0U;
        }
        break;
    }
    return result;
}

WebAuthFailureResult noteWebAuthFailure(WebAuthThrottleState& state, uint32_t ip, uint32_t nowMs)
{
    WebAuthFailureResult result{};
    int8_t selected = -1;
    int8_t oldestEvictable = -1;
    for (uint8_t i = 0; i < WebAuthThrottleSlots; ++i) {
        WebAuthThrottleEntry& entry = state.entries[i];
        if (entry.used && entry.ip == ip) {
            selected = (int8_t)i;
            break;
        }
        if (!entry.used) {
            selected = (int8_t)i;
            break;
        }
        const bool activelyBlocked = deadlineActive(entry.blockedUntilMs, nowMs);
        if (!activelyBlocked &&
            (oldestEvictable < 0 ||
             (int32_t)(entry.lastSeenMs -
                       state.entries[(uint8_t)oldestEvictable].lastSeenMs) < 0)) {
            oldestEvictable = (int8_t)i;
        }
    }
    if (selected < 0) selected = oldestEvictable;
    if (selected >= 0) {
        WebAuthThrottleEntry& entry = state.entries[(uint8_t)selected];
        if (!entry.used || entry.ip != ip) {
            entry = WebAuthThrottleEntry{};
            entry.used = true;
            entry.ip = ip;
            entry.windowStartMs = nowMs;
        } else if ((uint32_t)(nowMs - entry.windowStartMs) >= WebAuthWindowMs) {
            entry.windowStartMs = nowMs;
            entry.failures = 0U;
        }
        entry.lastSeenMs = nowMs;
        if (entry.failures < UINT8_MAX) ++entry.failures;
        result.sourceFailures = entry.failures;
        if (entry.failures >= WebAuthMaxFailures &&
            !deadlineActive(entry.blockedUntilMs, nowMs)) {
            entry.blockedUntilMs = nowMs + WebAuthBlockMs;
            result.sourceNewlyBlocked = true;
        }
    }

    if (state.globalWindowStartMs == 0U ||
        (uint32_t)(nowMs - state.globalWindowStartMs) >= WebAuthWindowMs) {
        state.globalWindowStartMs = nowMs;
        state.globalFailures = 0U;
    }
    if (state.globalFailures < UINT8_MAX) ++state.globalFailures;
    if (state.globalFailures >= WebAuthGlobalMaxFailures &&
        !deadlineActive(state.globalBlockedUntilMs, nowMs)) {
        state.globalBlockedUntilMs = nowMs + WebAuthGlobalBlockMs;
        result.globalNewlyBlocked = true;
    }
    return result;
}

void noteWebAuthSuccess(WebAuthThrottleState& state, uint32_t ip)
{
    for (uint8_t i = 0; i < WebAuthThrottleSlots; ++i) {
        WebAuthThrottleEntry& entry = state.entries[i];
        if (entry.used && entry.ip == ip) {
            entry = WebAuthThrottleEntry{};
            return;
        }
    }
}

bool csrfRequestAllowed(const CsrfRequestFacts& facts,
                        const char* expectedToken,
                        const char* suppliedToken,
                        size_t suppliedTokenLen)
{
    if (!facts.mutating) return true;
    if (!facts.originAllowed || facts.crossSite || !facts.tokenPresent) return false;
    return constantTimeEquals(expectedToken, suppliedToken, suppliedTokenLen);
}

bool unauthenticatedWebRouteAllowed(bool credentialsReady,
                                    bool physicalRecoveryActive,
                                    bool provisioningOnly,
                                    WebRouteMethod method,
                                    const char* path)
{
    if (!path) return false;

    const bool isGet = method == WebRouteMethod::Get;
    const bool isPost = method == WebRouteMethod::Post;
    const bool isRootOrRecoveryPage =
        strcmp(path, "/") == 0 ||
        strcmp(path, "/rescue") == 0 ||
        strcmp(path, "/webinterface/rescue") == 0;
    const bool isCaptivePortalProbe =
        strcmp(path, "/generate_204") == 0 ||
        strcmp(path, "/gen_204") == 0 ||
        strcmp(path, "/hotspot-detect.html") == 0 ||
        strcmp(path, "/connecttest.txt") == 0 ||
        strcmp(path, "/ncsi.txt") == 0;
    const bool isWebInterfaceEntry =
        strcmp(path, "/webinterface") == 0 ||
        strcmp(path, "/webinterface/") == 0;
    const bool isWebInterfaceAsset =
        strncmp(path, "/webinterface/", strlen("/webinterface/")) == 0 &&
        strcmp(path, "/webinterface/health") != 0;
    const bool isPublicBootstrapApi =
        strcmp(path, "/api/web/meta") == 0 ||
        strcmp(path, "/api/recovery/status") == 0;

    if (physicalRecoveryActive) {
        if (isGet) {
            return isRootOrRecoveryPage ||
                   isCaptivePortalProbe ||
                   isWebInterfaceEntry ||
                   isWebInterfaceAsset ||
                   isPublicBootstrapApi ||
                   strcmp(path, "/api/network/mode") == 0 ||
                   strcmp(path, "/api/wifi/ap") == 0 ||
                   strcmp(path, "/api/wifi/config") == 0 ||
                   strcmp(path, "/api/wifi/scan") == 0 ||
                   strcmp(path, "/api/mqtt/config") == 0;
        }
        return isPost &&
               (strcmp(path, "/api/recovery/web-credentials") == 0 ||
                strcmp(path, "/api/recovery/apply") == 0 ||
                strcmp(path, "/api/wifi/config") == 0 ||
                strcmp(path, "/api/wifi/scan") == 0 ||
                strcmp(path, "/api/mqtt/config") == 0);
    }

    if (!credentialsReady) {
        return isGet &&
               (isRootOrRecoveryPage ||
                isCaptivePortalProbe ||
                isWebInterfaceEntry ||
                isPublicBootstrapApi ||
                strcmp(path, "/login") == 0);
    }

    if (provisioningOnly && isGet) {
        return isRootOrRecoveryPage ||
               isCaptivePortalProbe ||
               isWebInterfaceEntry ||
               isWebInterfaceAsset ||
               isPublicBootstrapApi;
    }

    return false;
}

bool webRouteRequiresAdmin(WebRouteMethod method, const char* path)
{
    if (!path) return true;

    const bool mutating = method == WebRouteMethod::Post || method == WebRouteMethod::Other;
    const auto startsWith = [path](const char* prefix) {
        return strncmp(path, prefix, strlen(prefix)) == 0;
    };

    if (strcmp(path, "/rescue") == 0 ||
        strcmp(path, "/webinterface/rescue") == 0 ||
        startsWith("/api/fwupdate/") ||
        startsWith("/api/upgrade/") ||
        startsWith("/api/recovery/") ||
        startsWith("/api/system/") ||
        startsWith("/api/flow/system/") ||
        startsWith("/api/wifi/") ||
        startsWith("/api/network/") ||
        startsWith("/api/mqtt/") ||
        startsWith("/api/cfgdoc/") ||
        startsWith("/api/supervisorcfg/") ||
        startsWith("/api/auth/users") ||
        startsWith("/fwupdate/")) {
        return true;
    }

    if (mutating &&
        (startsWith("/api/activity/") || startsWith("/api/flowcfg/"))) {
        return true;
    }
    return false;
}

WebCspProfile cspProfileForPath(const char* path)
{
    if (!path) return WebCspProfile::StrictApplication;
    if (strcmp(path, "/login") == 0 ||
        strcmp(path, "/login.html") == 0 ||
        strcmp(path, "/rescue") == 0 ||
        strcmp(path, "/webinterface/rescue") == 0 ||
        strcmp(path, "/webserial") == 0) {
        return WebCspProfile::InlineRecovery;
    }
    return WebCspProfile::StrictApplication;
}

const char* contentSecurityPolicy(WebCspProfile profile)
{
    static constexpr char kStrict[] =
        "default-src 'self'; base-uri 'none'; object-src 'none'; "
        "frame-ancestors 'none'; form-action 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' data: https://fonts.gstatic.com; "
        "img-src 'self' data:; connect-src 'self' ws: wss:";
    static constexpr char kInlineRecovery[] =
        "default-src 'self'; base-uri 'none'; object-src 'none'; "
        "frame-ancestors 'none'; form-action 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' data: https://fonts.gstatic.com; "
        "img-src 'self' data:; connect-src 'self' ws: wss:";
    return profile == WebCspProfile::InlineRecovery ? kInlineRecovery : kStrict;
}

OtaUploadPreflight evaluateOtaUploadPreflight(bool unsignedUpdatesAllowed,
                                              bool publicKeyProvisioned,
                                              bool signaturePresent)
{
    if (unsignedUpdatesAllowed) return OtaUploadPreflight::Allowed;
    if (!publicKeyProvisioned) return OtaUploadPreflight::PublicKeyMissing;
    if (!signaturePresent) return OtaUploadPreflight::SignatureMissing;
    return OtaUploadPreflight::Allowed;
}

bool otaSignatureRequired(bool unsignedUpdatesAllowed, bool signaturePresent)
{
    return !unsignedUpdatesAllowed || signaturePresent;
}

bool recordFailure(FailureWindowState& state,
                   uint32_t nowMs,
                   uint8_t threshold,
                   uint32_t windowMs)
{
    if (threshold == 0U) return false;
    if (state.windowStartMs == 0U ||
        (uint32_t)(nowMs - state.windowStartMs) >= windowMs) {
        state.windowStartMs = nowMs;
        state.failures = 0U;
    }
    state.lastFailureMs = nowMs;
    if (state.failures < UINT8_MAX) ++state.failures;
    return state.failures >= threshold;
}

bool failureAlarmCondition(const FailureWindowState& state,
                           uint32_t nowMs,
                           uint8_t threshold,
                           uint32_t holdMs)
{
    if (threshold == 0U || state.failures < threshold || state.lastFailureMs == 0U) {
        return false;
    }
    return (uint32_t)(nowMs - state.lastFailureMs) < holdMs;
}

}  // namespace Security
