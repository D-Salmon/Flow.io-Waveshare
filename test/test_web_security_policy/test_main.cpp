#include <unity.h>

#include <string.h>

#include "Core/Security/WebSecurityPolicy.h"

using namespace Security;

void test_constant_time_token_comparison()
{
    TEST_ASSERT_TRUE(constantTimeEquals("abc123", "abc123", 6U));
    TEST_ASSERT_FALSE(constantTimeEquals("abc123", "abc124", 6U));
    TEST_ASSERT_FALSE(constantTimeEquals("abc123", "abc1234", 7U));
    TEST_ASSERT_FALSE(constantTimeEquals("abc123", "abc12", 5U));
}

void test_csrf_policy()
{
    const char* expected = "0123456789abcdef";
    CsrfRequestFacts facts{};
    TEST_ASSERT_TRUE(csrfRequestAllowed(facts, expected, nullptr, 0U));

    facts.mutating = true;
    TEST_ASSERT_FALSE(csrfRequestAllowed(facts, expected, nullptr, 0U));
    facts.originAllowed = true;
    facts.tokenPresent = true;
    TEST_ASSERT_TRUE(csrfRequestAllowed(facts, expected, expected, strlen(expected)));
    TEST_ASSERT_FALSE(csrfRequestAllowed(facts, expected, "bad", 3U));
    facts.crossSite = true;
    TEST_ASSERT_FALSE(csrfRequestAllowed(facts, expected, expected, strlen(expected)));
}

void test_first_boot_only_exposes_bootstrap_routes()
{
    TEST_ASSERT_TRUE(unauthenticatedWebRouteAllowed(
        false, false, true, WebRouteMethod::Get, "/rescue"));
    TEST_ASSERT_TRUE(unauthenticatedWebRouteAllowed(
        false, false, true, WebRouteMethod::Get, "/api/web/meta"));
    TEST_ASSERT_TRUE(unauthenticatedWebRouteAllowed(
        false, false, true, WebRouteMethod::Get, "/login"));
    TEST_ASSERT_FALSE(unauthenticatedWebRouteAllowed(
        false, false, true, WebRouteMethod::Get, "/api/wifi/config"));
    TEST_ASSERT_FALSE(unauthenticatedWebRouteAllowed(
        false, false, true, WebRouteMethod::Post, "/api/wifi/config"));
    TEST_ASSERT_FALSE(unauthenticatedWebRouteAllowed(
        false, false, true, WebRouteMethod::Post, "/api/mqtt/config"));
    TEST_ASSERT_FALSE(unauthenticatedWebRouteAllowed(
        false, false, true, WebRouteMethod::Post, "/api/poollogic/mode"));
}

void test_boot_recovery_only_opens_network_and_credentials()
{
    TEST_ASSERT_TRUE(unauthenticatedWebRouteAllowed(
        true, true, true, WebRouteMethod::Get, "/api/wifi/config"));
    TEST_ASSERT_TRUE(unauthenticatedWebRouteAllowed(
        true, true, true, WebRouteMethod::Post, "/api/wifi/config"));
    TEST_ASSERT_TRUE(unauthenticatedWebRouteAllowed(
        true, true, true, WebRouteMethod::Post, "/api/mqtt/config"));
    TEST_ASSERT_TRUE(unauthenticatedWebRouteAllowed(
        true, true, true, WebRouteMethod::Post, "/api/recovery/web-credentials"));
    TEST_ASSERT_TRUE(unauthenticatedWebRouteAllowed(
        true, true, true, WebRouteMethod::Post, "/api/recovery/apply"));
    TEST_ASSERT_FALSE(unauthenticatedWebRouteAllowed(
        true, true, true, WebRouteMethod::Post, "/api/fwupdate/config"));
    TEST_ASSERT_FALSE(unauthenticatedWebRouteAllowed(
        true, true, true, WebRouteMethod::Post, "/api/poollogic/mode"));
    TEST_ASSERT_FALSE(unauthenticatedWebRouteAllowed(
        true, true, true, WebRouteMethod::Get, "/webinterface/health"));
}

void test_provisioning_with_admin_keeps_configuration_protected()
{
    TEST_ASSERT_TRUE(unauthenticatedWebRouteAllowed(
        true, false, true, WebRouteMethod::Get, "/webinterface/prov.js"));
    TEST_ASSERT_TRUE(unauthenticatedWebRouteAllowed(
        true, false, true, WebRouteMethod::Get, "/api/web/meta"));
    TEST_ASSERT_TRUE(unauthenticatedWebRouteAllowed(
        true, false, true, WebRouteMethod::Get, "/api/recovery/status"));
    TEST_ASSERT_FALSE(unauthenticatedWebRouteAllowed(
        true, false, true, WebRouteMethod::Get, "/api/wifi/config"));
    TEST_ASSERT_FALSE(unauthenticatedWebRouteAllowed(
        true, false, true, WebRouteMethod::Post, "/api/mqtt/config"));
    TEST_ASSERT_FALSE(unauthenticatedWebRouteAllowed(
        true, false, true, WebRouteMethod::Post, "/api/recovery/apply"));
    TEST_ASSERT_FALSE(unauthenticatedWebRouteAllowed(
        true, false, false, WebRouteMethod::Get, "/api/web/meta"));
    TEST_ASSERT_FALSE(unauthenticatedWebRouteAllowed(
        true, false, false, WebRouteMethod::Get, "/login"));
}

void test_source_auth_throttle_blocks_and_expires()
{
    WebAuthThrottleState state{};
    constexpr uint32_t ip = 0x01020304U;
    for (uint8_t i = 0; i < WebAuthMaxFailures; ++i) {
        const WebAuthFailureResult failure =
            noteWebAuthFailure(state, ip, 1000U + (uint32_t)i);
        TEST_ASSERT_EQUAL_UINT8(i + 1U, failure.sourceFailures);
    }

    WebAuthLimitResult limit = checkWebAuthLimit(state, ip, 2000U);
    TEST_ASSERT_TRUE(limit.limited);
    TEST_ASSERT_GREATER_THAN_UINT32(0U, limit.retryAfterSeconds);

    limit = checkWebAuthLimit(state, ip, 302000U);
    TEST_ASSERT_FALSE(limit.limited);
    TEST_ASSERT_EQUAL_UINT32(0U, limit.retryAfterSeconds);
}

void test_global_auth_throttle()
{
    WebAuthThrottleState state{};
    for (uint8_t i = 0; i < WebAuthGlobalMaxFailures; ++i) {
        (void)noteWebAuthFailure(state, 0x0A000001U + i, 1000U + i);
    }
    const WebAuthLimitResult limit =
        checkWebAuthLimit(state, 0xC0A80101U, 2000U);
    TEST_ASSERT_TRUE(limit.limited);
}

void test_success_clears_source_failures()
{
    WebAuthThrottleState state{};
    constexpr uint32_t ip = 0x01020304U;
    (void)noteWebAuthFailure(state, ip, 1000U);
    noteWebAuthSuccess(state, ip);
    TEST_ASSERT_FALSE(checkWebAuthLimit(state, ip, 1001U).limited);
    TEST_ASSERT_EQUAL_UINT8(1U, noteWebAuthFailure(state, ip, 1002U).sourceFailures);
}

void test_csp_profiles()
{
    TEST_ASSERT_EQUAL(WebCspProfile::StrictApplication,
                      cspProfileForPath("/webinterface"));
    TEST_ASSERT_EQUAL(WebCspProfile::InlineRecovery,
                      cspProfileForPath("/rescue"));
    TEST_ASSERT_EQUAL(WebCspProfile::InlineRecovery,
                      cspProfileForPath("/login"));
    TEST_ASSERT_EQUAL(WebCspProfile::InlineRecovery,
                      cspProfileForPath("/login.html"));
    TEST_ASSERT_EQUAL(WebCspProfile::InlineRecovery,
                      cspProfileForPath("/webserial"));
    TEST_ASSERT_NOT_NULL(strstr(contentSecurityPolicy(WebCspProfile::StrictApplication),
                                "script-src 'self';"));
    TEST_ASSERT_NULL(strstr(contentSecurityPolicy(WebCspProfile::StrictApplication),
                            "script-src 'self' 'unsafe-inline'"));
    TEST_ASSERT_NOT_NULL(strstr(contentSecurityPolicy(WebCspProfile::InlineRecovery),
                                "script-src 'self' 'unsafe-inline'"));
}

void test_local_operator_sensitive_routes_require_admin()
{
    TEST_ASSERT_TRUE(webRouteRequiresAdmin(WebRouteMethod::Get, "/api/wifi/config"));
    TEST_ASSERT_TRUE(webRouteRequiresAdmin(WebRouteMethod::Get, "/api/cfgdoc/index"));
    TEST_ASSERT_TRUE(webRouteRequiresAdmin(WebRouteMethod::Get, "/api/auth/users"));
    TEST_ASSERT_TRUE(webRouteRequiresAdmin(WebRouteMethod::Post, "/api/system/reboot"));
    TEST_ASSERT_TRUE(webRouteRequiresAdmin(WebRouteMethod::Post, "/api/activity/purge"));
    TEST_ASSERT_TRUE(webRouteRequiresAdmin(WebRouteMethod::Post, "/api/activity/delete"));
    TEST_ASSERT_TRUE(webRouteRequiresAdmin(WebRouteMethod::Get, "/rescue"));
    TEST_ASSERT_TRUE(webRouteRequiresAdmin(WebRouteMethod::Post, "/api/flowcfg/apply"));
    TEST_ASSERT_FALSE(webRouteRequiresAdmin(WebRouteMethod::Get, "/api/flowcfg/module"));
    TEST_ASSERT_FALSE(webRouteRequiresAdmin(WebRouteMethod::Post, "/api/poollogic/mode"));
    TEST_ASSERT_FALSE(webRouteRequiresAdmin(WebRouteMethod::Get, "/api/pool/history"));
}

void test_ota_preflight_fails_closed()
{
    TEST_ASSERT_EQUAL(OtaUploadPreflight::PublicKeyMissing,
                      evaluateOtaUploadPreflight(false, false, false));
    TEST_ASSERT_EQUAL(OtaUploadPreflight::SignatureMissing,
                      evaluateOtaUploadPreflight(false, true, false));
    TEST_ASSERT_EQUAL(OtaUploadPreflight::Allowed,
                      evaluateOtaUploadPreflight(false, true, true));
    TEST_ASSERT_EQUAL(OtaUploadPreflight::Allowed,
                      evaluateOtaUploadPreflight(true, false, false));
    TEST_ASSERT_TRUE(otaSignatureRequired(false, false));
    TEST_ASSERT_TRUE(otaSignatureRequired(true, true));
    TEST_ASSERT_FALSE(otaSignatureRequired(true, false));
}

void test_repeated_failure_alarm_window()
{
    FailureWindowState state{};
    TEST_ASSERT_FALSE(recordFailure(state, 1000U, 3U, 600000U));
    TEST_ASSERT_FALSE(recordFailure(state, 2000U, 3U, 600000U));
    TEST_ASSERT_TRUE(recordFailure(state, 3000U, 3U, 600000U));
    TEST_ASSERT_TRUE(failureAlarmCondition(state, 4000U, 3U, 600000U));
    TEST_ASSERT_FALSE(failureAlarmCondition(state, 603000U, 3U, 600000U));
    TEST_ASSERT_FALSE(recordFailure(state, 604000U, 3U, 600000U));
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_constant_time_token_comparison);
    RUN_TEST(test_csrf_policy);
    RUN_TEST(test_first_boot_only_exposes_bootstrap_routes);
    RUN_TEST(test_boot_recovery_only_opens_network_and_credentials);
    RUN_TEST(test_provisioning_with_admin_keeps_configuration_protected);
    RUN_TEST(test_source_auth_throttle_blocks_and_expires);
    RUN_TEST(test_global_auth_throttle);
    RUN_TEST(test_success_clears_source_failures);
    RUN_TEST(test_csp_profiles);
    RUN_TEST(test_local_operator_sensitive_routes_require_admin);
    RUN_TEST(test_ota_preflight_fails_closed);
    RUN_TEST(test_repeated_failure_alarm_window);
    return UNITY_END();
}
