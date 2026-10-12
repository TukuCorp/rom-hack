//! Parity tests: the Rust port against output captured from the original binary.
//!
//! The oracle in `leap_rs::oracle_calendar` was produced by emulating the original
//! functions in Ghidra over the same inputs, and stores the out-parameter as raw
//! IEEE-754 bits. Equality is therefore bit-for-bit, not approximate.

use leap_rs::calendar::{day_number, day_number_int, is_leap_year, month_length};
use leap_rs::oracle_calendar::{DAY_NUMBER_VECTORS, IS_LEAP_YEAR_VECTORS};

#[test]
fn is_leap_year_matches_the_original_on_every_vector() {
    assert_eq!(IS_LEAP_YEAR_VECTORS.len(), 310);
    for (year, expected) in IS_LEAP_YEAR_VECTORS {
        assert_eq!(
            is_leap_year(*year),
            *expected,
            "IsLeapYear disagrees with the original for year {} (0x{:04x})",
            year,
            year
        );
    }
}

#[test]
fn day_number_matches_the_original_bit_for_bit() {
    assert_eq!(DAY_NUMBER_VECTORS.len(), 487);
    for (year, month, day, valid, bits) in DAY_NUMBER_VECTORS {
        match (day_number(*year, *month, *day), *valid) {
            (Some(value), true) => assert_eq!(
                value.to_bits(),
                *bits,
                "day number for {}-{}-{} differs: got 0x{:016x} want 0x{:016x}",
                year,
                month,
                day,
                value.to_bits(),
                bits
            ),
            (None, false) => assert_eq!(
                *bits, 0,
                "the original left its out-parameter untouched for {}-{}-{}",
                year, month, day
            ),
            (got, want) => panic!(
                "date {}-{}-{}: port says {:?}, original says {} valid",
                year, month, day, got, want
            ),
        }
    }
}

#[test]
fn the_integer_and_float_forms_agree() {
    for (year, month, day, _, _) in DAY_NUMBER_VECTORS {
        match (day_number_int(*year, *month, *day), day_number(*year, *month, *day)) {
            (Some(i), Some(f)) => assert_eq!(i as f64, f),
            (None, None) => {}
            other => panic!("int and float forms disagree for {}-{}-{}: {:?}", year, month, day, other),
        }
    }
}

#[test]
fn month_lengths_follow_the_same_rule_as_the_original_table() {
    for year in [1900u16, 1996, 2000, 2023, 2024, 2100, 2400] {
        for month in 1..=12u16 {
            let expected = if month == 2 && is_leap_year(year as u32) { 29 } else {
                [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(month - 1) as usize]
            };
            assert_eq!(month_length(year, month), Some(expected));
        }
    }
    assert_eq!(month_length(2024, 0), None);
    assert_eq!(month_length(2024, 13), None);
}
