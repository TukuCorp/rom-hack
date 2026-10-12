//! Calendar arithmetic, ported 1:1 from the original binary.
//!
//! Sources, both verified by emulation and by live instrumentation of the
//! original process:
//!
//!   `IsLeapYear`   original 0x0042669c, Delphi `Boolean IsLeapYear(Word Year)`
//!   `day_number`   original 0x004266d8, Delphi date-validating day-number encoder
//!
//! The original takes its argument in EAX and returns a 1-byte Boolean in AL;
//! the declared Delphi parameter is `Word`, i.e. 16-bit, so the body truncates
//! whatever EAX holds with `MOVZX`. Those details are preserved here rather than
//! normalised away, because the point of the port is behavioural equivalence:
//! `is_leap_year` therefore accepts the full 32-bit EAX value and truncates it
//! itself, exactly as the original does.

/// Days in each month of a common year, in the order the original stores them.
/// Matches the 24-byte record at 0x61cef8 in the original image.
pub const MONTH_LENGTHS_COMMON: [u16; 12] =
    [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/// Days in each month of a leap year: the second 24-byte record at 0x61cf10.
pub const MONTH_LENGTHS_LEAP: [u16; 12] =
    [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/// Epoch offset subtracted by the day-number encoder (0xa955a in the listing).
pub const DAY_NUMBER_EPOCH: i64 = 693_594;

/// Port of the original at 0x0042669c.
///
/// The compiler strength-reduced `year mod 4` to `year AND 3` (see the listing:
/// `AND EAX,0x3`), while `mod 100` and `mod 400` stayed as literal unsigned
/// divides. Both are reproduced here so the arithmetic path is the same one.
///
/// `year` is taken as the full 32-bit argument register. The original truncates
/// it to its declared 16-bit `Word` parameter before doing the arithmetic, so
/// e.g. 65536 behaves as year 0 (leap) and 65537 as year 1 (not leap). The
/// oracle exercises that boundary with 65536, 65537 and 131072, which a `u16`
/// parameter could not express at all.
#[inline]
pub fn is_leap_year(year: u32) -> bool {
    let year = (year & 0xFFFF) as u16;
    (year & 3) == 0 && (year % 100 != 0 || year % 400 == 0)
}

/// The month length the original would use for this year and month.
#[inline]
pub fn month_length(year: u16, month: u16) -> Option<u16> {
    if !(1..=12).contains(&month) {
        return None;
    }
    let table = if is_leap_year(year as u32) {
        &MONTH_LENGTHS_LEAP
    } else {
        &MONTH_LENGTHS_COMMON
    };
    Some(table[(month - 1) as usize])
}

/// Port of the original at 0x004266d8: validate a date and, on success, encode
/// it as a day number.
///
/// The original signature is
/// `undefined1 FUN_004266d8(ushort year, ushort month, ushort day, double *out)`
/// and it follows this shape:
///
/// ```text
/// if (!(year != 0 && year < 10000)) return 0;
/// if (!(month != 0 && month < 13)) return 0;
/// if (!(day != 0 && day <= month_lengths[leap(year)][month - 1])) return 0;
/// day_of_year = day + sum(month_lengths[..month-1]);
/// *out = (year-1)*365 + ((year-1) >> 2) - (year-1)/100 + (year-1)/400
///        + day_of_year - 693594;
/// return 1;
/// ```
///
/// Returns `None` where the original returns false and writes nothing to its
/// out-parameter, and `Some(day_number)` where it returns true.
pub fn day_number_int(year: u16, month: u16, day: u16) -> Option<i64> {
    if year == 0 || year >= 10_000 {
        return None;
    }
    if month == 0 || month > 12 {
        return None;
    }
    let length = month_length(year, month)?;
    if day == 0 || day > length {
        return None;
    }

    let table = if is_leap_year(year as u32) {
        &MONTH_LENGTHS_LEAP
    } else {
        &MONTH_LENGTHS_COMMON
    };
    let mut day_of_year = day as i64;
    for m in 1..month {
        day_of_year += table[(m - 1) as usize] as i64;
    }

    // The original works in 32-bit integers and shifts rather than dividing:
    // `(iVar2 * 0x16d + (iVar4 >> 2)) - iVar2 / 100 + iVar2 / 400`. Kept as
    // written, with i64 so nothing wraps for the accepted input range.
    let k = (year - 1) as i64;
    Some(k * 365 + (k >> 2) - k / 100 + k / 400 + day_of_year - DAY_NUMBER_EPOCH)
}

/// The value the original writes through its out-parameter on success.
///
/// The original stores `(double)(int)(...)`, so for the accepted range the double
/// is exactly representable and `to_bits()` is a safe thing for a parity test to
/// compare. Returns `None` where the original writes nothing at all.
#[inline]
pub fn day_number(year: u16, month: u16, day: u16) -> Option<f64> {
    day_number_int(year, month, day).map(|v| v as f64)
}
