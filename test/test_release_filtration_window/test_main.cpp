#include <unity.h>
#include <math.h>

#include "Modules/PoolLogicModule/ReleaseFiltrationWindow.h"

void test_temp_below_low_uses_min_duration()
{
    ReleaseFiltrationWindowInput in{};
    in.waterTemp = 5.0f;

    ReleaseFiltrationWindowOutput out{};
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in, out));
    TEST_ASSERT_EQUAL_UINT16(120, out.durationMinutes);
    TEST_ASSERT_EQUAL_UINT16(22 * 60, out.startMinuteOfDay);
    TEST_ASSERT_EQUAL_UINT16(0, out.stopMinuteOfDay);
    TEST_ASSERT_FALSE(out.continuous);
}

void test_12c_uses_two_off_peak_hours()
{
    ReleaseFiltrationWindowInput in{};
    in.waterTemp = 12.0f;

    ReleaseFiltrationWindowOutput out{};
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in, out));
    TEST_ASSERT_EQUAL_UINT16(120, out.durationMinutes);
    TEST_ASSERT_EQUAL_UINT16(22 * 60, out.startMinuteOfDay);
    TEST_ASSERT_EQUAL_UINT16(0, out.stopMinuteOfDay);
}

void test_20c_starts_at_22h_and_wraps_to_0628()
{
    ReleaseFiltrationWindowInput in{};
    in.waterTemp = 20.0f;

    ReleaseFiltrationWindowOutput out{};
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in, out));
    TEST_ASSERT_EQUAL_UINT16(8 * 60 + 28, out.durationMinutes);
    TEST_ASSERT_EQUAL_UINT16(22 * 60, out.startMinuteOfDay);
    TEST_ASSERT_EQUAL_UINT16(6 * 60 + 28, out.stopMinuteOfDay);
}

void test_above_20c_returns_to_solar_centered_window()
{
    ReleaseFiltrationWindowInput in{};
    in.waterTemp = 20.1f;

    ReleaseFiltrationWindowOutput out{};
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in, out));
    TEST_ASSERT_NOT_EQUAL(22 * 60, out.startMinuteOfDay);
    TEST_ASSERT_EQUAL_UINT16(15 * 60 - out.durationMinutes / 2, out.startMinuteOfDay);
    TEST_ASSERT_EQUAL_UINT16(out.startMinuteOfDay + out.durationMinutes, out.stopMinuteOfDay);
}

void test_24c_uses_low_temperature_linear_ramp()
{
    ReleaseFiltrationWindowInput in{};
    in.waterTemp = 24.0f;

    ReleaseFiltrationWindowOutput out{};
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in, out));
    TEST_ASSERT_EQUAL_UINT16(11 * 60 + 42, out.durationMinutes);
    TEST_ASSERT_EQUAL_UINT16(9 * 60 + 9, out.startMinuteOfDay);
    TEST_ASSERT_EQUAL_UINT16(20 * 60 + 51, out.stopMinuteOfDay);
}

void test_26c_uses_high_temperature_linear_ramp()
{
    ReleaseFiltrationWindowInput in{};
    in.waterTemp = 26.0f;
    in.startMinHour = 0;

    ReleaseFiltrationWindowOutput out{};
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in, out));
    TEST_ASSERT_EQUAL_UINT16(14 * 60 + 48, out.durationMinutes);
    TEST_ASSERT_EQUAL_UINT16(7 * 60 + 36, out.startMinuteOfDay);
    TEST_ASSERT_EQUAL_UINT16(22 * 60 + 24, out.stopMinuteOfDay);
}

void test_29c_moves_earlier_to_respect_latest_stop()
{
    ReleaseFiltrationWindowInput in{};
    in.waterTemp = 29.0f;
    in.startMinHour = 0;
    in.stopMaxHour = 23;

    ReleaseFiltrationWindowOutput out{};
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in, out));
    TEST_ASSERT_EQUAL_UINT16(21 * 60 + 42, out.durationMinutes);
    TEST_ASSERT_EQUAL_UINT16(1 * 60 + 18, out.startMinuteOfDay);
    TEST_ASSERT_EQUAL_UINT16(23 * 60, out.stopMinuteOfDay);
}

void test_32c_is_continuous()
{
    ReleaseFiltrationWindowInput in{};
    in.waterTemp = 32.0f;

    ReleaseFiltrationWindowOutput out{};
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in, out));
    TEST_ASSERT_EQUAL_UINT16(24 * 60, out.durationMinutes);
    TEST_ASSERT_TRUE(out.continuous);
    TEST_ASSERT_TRUE(isReleaseFiltrationWindowActiveAtMinute(out.startMinuteOfDay,
                                                      out.stopMinuteOfDay,
                                                      out.durationMinutes,
                                                      12 * 60));
}

void test_nan_temperature_returns_false()
{
    ReleaseFiltrationWindowInput in{};
    in.waterTemp = NAN;

    ReleaseFiltrationWindowOutput out{};
    TEST_ASSERT_FALSE(computeReleaseFiltrationWindowDeterministic(in, out));
}

void test_overnight_window_wraps_across_midnight()
{
    TEST_ASSERT_FALSE(isReleaseFiltrationWindowActiveAtMinute(22 * 60, 6 * 60, 8 * 60, 21 * 60 + 59));
    TEST_ASSERT_TRUE(isReleaseFiltrationWindowActiveAtMinute(22 * 60, 6 * 60, 8 * 60, 18));
    TEST_ASSERT_FALSE(isReleaseFiltrationWindowActiveAtMinute(22 * 60, 6 * 60, 8 * 60, 6 * 60));
}


void test_warm_bounds_preserve_duration_by_starting_earlier()
{
    ReleaseFiltrationWindowInput in{};
    in.waterTemp = 26.0f;
    in.startMinHour = 8;
    in.stopMaxHour = 23;
    ReleaseFiltrationWindowOutput out{};
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in,out));
    TEST_ASSERT_EQUAL_UINT16(888,out.durationMinutes);
    TEST_ASSERT_EQUAL_UINT16(480,out.startMinuteOfDay);
    TEST_ASSERT_EQUAL_UINT16(1368,out.stopMinuteOfDay);
    TEST_ASSERT_FALSE(out.limitedBySchedule);
    in.stopMaxHour=22;
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in,out));
    TEST_ASSERT_EQUAL_UINT16(840,out.durationMinutes);
    TEST_ASSERT_EQUAL_UINT16(888,out.requestedDurationMinutes);
    TEST_ASSERT_TRUE(out.limitedBySchedule);
    TEST_ASSERT_EQUAL_UINT16(1320,out.stopMinuteOfDay);
}
void test_short_warm_window_and_thresholds()
{
    ReleaseFiltrationWindowInput in{};
    ReleaseFiltrationWindowOutput out{};
    in.waterTemp=29.0f;
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in,out));
    TEST_ASSERT_EQUAL_UINT16(900,out.durationMinutes);
    TEST_ASSERT_EQUAL_UINT16(1302,out.requestedDurationMinutes);
    TEST_ASSERT_TRUE(out.limitedBySchedule);
    TEST_ASSERT_EQUAL_UINT16(480,out.startMinuteOfDay);
    TEST_ASSERT_EQUAL_UINT16(1380,out.stopMinuteOfDay);
    in.waterTemp=20.0f;in.startMinHour=23;in.stopMaxHour=1;
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in,out));
    TEST_ASSERT_EQUAL_UINT16(1320,out.startMinuteOfDay);
    in.waterTemp=20.01f;
    TEST_ASSERT_FALSE(computeReleaseFiltrationWindowDeterministic(in,out));
    in.waterTemp=30.0f;
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in,out));
    TEST_ASSERT_TRUE(out.continuous);
    in.waterTemp=29.999f;in.startMinHour=8;in.stopMaxHour=23;
    TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in,out));
    TEST_ASSERT_FALSE(out.continuous);
    TEST_ASSERT_TRUE(out.limitedBySchedule);
}
void test_bounds_for_all_warm_temperatures()
{
    for(int temp=2001;temp<3000;temp+=7) {
        for(int earliest=0;earliest<23;earliest+=3) {
            ReleaseFiltrationWindowInput in{};
            in.waterTemp=float(temp)/100.0f;
            in.startMinHour=earliest;in.stopMaxHour=23;
            ReleaseFiltrationWindowOutput out{};
            TEST_ASSERT_TRUE(computeReleaseFiltrationWindowDeterministic(in,out));
            TEST_ASSERT_TRUE(out.startMinuteOfDay>=earliest*60);
            TEST_ASSERT_TRUE(out.stopMinuteOfDay<=23*60);
            TEST_ASSERT_EQUAL_UINT16(out.durationMinutes,out.stopMinuteOfDay-out.startMinuteOfDay);
            TEST_ASSERT_TRUE(isReleaseFiltrationWindowActiveAtMinute(out.startMinuteOfDay,out.stopMinuteOfDay,out.durationMinutes,out.startMinuteOfDay));
            TEST_ASSERT_FALSE(isReleaseFiltrationWindowActiveAtMinute(out.startMinuteOfDay,out.stopMinuteOfDay,out.durationMinutes,out.stopMinuteOfDay));
        }
    }
}

int main()
{
    UNITY_BEGIN();
    RUN_TEST(test_warm_bounds_preserve_duration_by_starting_earlier);
    RUN_TEST(test_short_warm_window_and_thresholds);
    RUN_TEST(test_bounds_for_all_warm_temperatures);
    RUN_TEST(test_temp_below_low_uses_min_duration);
    RUN_TEST(test_12c_uses_two_off_peak_hours);
    RUN_TEST(test_20c_starts_at_22h_and_wraps_to_0628);
    RUN_TEST(test_above_20c_returns_to_solar_centered_window);
    RUN_TEST(test_24c_uses_low_temperature_linear_ramp);
    RUN_TEST(test_26c_uses_high_temperature_linear_ramp);
    RUN_TEST(test_29c_moves_earlier_to_respect_latest_stop);
    RUN_TEST(test_32c_is_continuous);
    RUN_TEST(test_nan_temperature_returns_false);
    RUN_TEST(test_overnight_window_wraps_across_midnight);
    return UNITY_END();
}
