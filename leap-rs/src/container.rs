//! The `.leap` container validator, ported from the original binary.
//!
//! Sources, all in `testleap.exe` and all traced through Ghidra:
//!
//!   `entry`          original 0x0061a848  the decision chain and the verdict codes
//!   `FUN_0060df1c`   original 0x0060df1c  asks the zip library for a matching member
//!   `FUN_00610058`   original 0x00610058  opens the archive; false means "not a zip"
//!   `FUN_00611e78`   original 0x00611e78  the meta check, sets verdict 7
//!
//! The chain in `entry` assigns its verdict in this order, and the first check that
//! fails wins. Evidence for the order is in the ordering vectors of the oracle:
//! `order_db_and_forbid` returns 1 even though the archive also holds an `.exe`, and
//! `order_forbid_and_missing` returns 3 even though the archive also holds a `.php`.
//!
//!   5   the archive will not open as a zip          (`FUN_00610058` returns false)
//!   1   it holds `masterstructure.db`, the pre-2012 LEAP layout
//!   3   any required `.nx1` member is absent
//!   4   any of the 27 forbidden patterns matches a member
//!   7   no member named `sysinfo.txt`                (`FUN_00611e78`)
//!   0   otherwise
//!
//! Two behaviours here look wrong and are reproduced anyway, because the port aims at
//! equivalence rather than at a corrected validator. Both are pinned by oracle vectors:
//!
//! * Member lookup is by **basename**, compared case-insensitively, so a nested
//!   `sub/years.nx1` satisfies the `years.nx1` requirement. A file merely containing the
//!   name does not, so `xyears.nx1` and `years.nx1.bak` both fail.
//! * The extension test drops **exactly one** trailing `.` before taking the text after
//!   the last dot. So `tool.exe.` is flagged but `tool.exe..` is not. `tool.exe.txt` is
//!   not flagged, because the text after the last dot is `.txt`.
//!
//! The meta step has a further quirk: the 7-check searches by basename, but the
//! following extraction looks the name up at the archive root, so `meta/sysinfo.txt`
//! passes the check and then aborts with the library exception text instead of a result.
//! The exception is reproduced verbatim in [`Report::stdout`], with exit code 0.

/// Verdict codes, taken from the assignments in `entry` between 0x61ab08 and 0x61b465.
pub const CODE_VALID: i32 = 0;
pub const CODE_UNSUPPORTED_VERSION: i32 = 1;
pub const CODE_MISSING_REQUIRED: i32 = 3;
pub const CODE_EXECUTABLE_MEMBER: i32 = 4;
pub const CODE_NOT_ZIP: i32 = 5;
pub const CODE_NO_META: i32 = 7;

/// The pre-2012 marker. `entry` tests for this first, right after the zip check.
pub const MASTER_DB: &str = "masterstructure.db";

/// Required members in the order `entry` tests them, from 0x61abd0 to 0x61ac60.
/// `scenariodata.nx1` really is listed twice; kept as written.
pub const REQUIRED_NX1: [&str; 6] = [
    "masterstructure.nx1",
    "areadata.nx1",
    "scenariodata.nx1",
    "staticdata.nx1",
    "scenariodata.nx1",
    "years.nx1",
];

/// The forbidden patterns in the order `entry` tests them, 0x61b87c to 0x61bc28.
pub const FORBIDDEN_PATTERNS: [&str; 27] = [
    "*.exe",
    "*.com",
    "*.bat",
    "*.js",
    "*.cgi",
    "*.asp",
    "*.aspx",
    "*.php",
    "*.vbs",
    "*.htm",
    "*.html",
    "*.cmd",
    "*.sql",
    "*.vb",
    "*.vbscript",
    "*.wsf",
    "*.ws",
    "*.paf",
    "*.pif",
    "*.msi",
    "*.msp",
    "*.mst",
    "*.msc",
    "*.inf",
    "*.ins",
    "*.cpl",
    "*.command",
];

/// The meta marker, matched by basename in `FUN_00611e78`.
pub const META_FILE: &str = "sysinfo.txt";

/// What the original prints and exits with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    /// The process exit code. The original stores this in the global at 0x62f060 and
    /// hands it to the exit routine, so the observed exit code is the verdict itself.
    pub code: i32,
    /// Everything the run writes to stdout under `/S`, which is what the parity test
    /// compares byte for byte.
    pub stdout: String,
}

/// The text the zip library aborts with when the meta file is not at the archive root.
/// Captured verbatim from the `meta_meta_sysinfo_txt` vector.
pub const META_NOT_AT_ROOT: &str =
    "EZFException: File \"sysinfo.txt\" not found - Native error: 00015\n";

fn u16le(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

fn u32le(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

/// The member names of a zip archive, or `None` when it will not open.
///
/// This stands in for `FUN_00610058` plus the zip library underneath it: it reads the
/// central directory, which is all the validator ever consults. `None` maps to
/// [`CODE_NOT_ZIP`]. A zero-entry archive is a valid archive, which the
/// `raw_eocd_only` and `empty_zip` vectors pin down.
pub fn member_names(bytes: &[u8]) -> Option<Vec<String>> {
    const EOCD: [u8; 4] = [0x50, 0x4b, 0x05, 0x06];
    const CENTRAL: [u8; 4] = [0x50, 0x4b, 0x01, 0x02];
    const MAX_COMMENT: usize = 65_535;

    let len = bytes.len();
    if len < 22 {
        return None;
    }
    let window = if len > MAX_COMMENT + 22 { MAX_COMMENT + 22 } else { len };
    let start = len - window;
    let eocd = (start..=len - 22).rev().find(|&i| bytes[i..i + 4] == EOCD)?;

    let entries = u16le(bytes, eocd + 10) as usize;
    let cd_size = u32le(bytes, eocd + 12) as usize;
    let cd_at = u32le(bytes, eocd + 16) as usize;
    if cd_at.checked_add(cd_size)? > len {
        return None;
    }

    let mut names = Vec::with_capacity(entries);
    let mut at = cd_at;
    for _ in 0..entries {
        if at + 46 > len || bytes[at..at + 4] != CENTRAL {
            return None;
        }
        let name_len = u16le(bytes, at + 28) as usize;
        let extra_len = u16le(bytes, at + 30) as usize;
        let comment_len = u16le(bytes, at + 32) as usize;
        let from = at + 46;
        if from + name_len > len {
            return None;
        }
        names.push(String::from_utf8_lossy(&bytes[from..from + name_len]).into_owned());
        at = from + name_len + extra_len + comment_len;
    }
    Some(names)
}

/// The basename the original ends up comparing against, as observed.
///
/// A trailing separator is dropped, then the text after the last separator. Both
/// `sub/years.nx1` and `dir.exe/` behave this way in the oracle.
fn basename(name: &str) -> &str {
    let trimmed = name.trim_end_matches(['/', '\\']);
    match trimmed.rfind(['/', '\\']) {
        Some(at) => &trimmed[at + 1..],
        None => trimmed,
    }
}

/// Port of the lookup `FUN_0060df1c` performs when asked for a plain name such as
/// `years.nx1`: a basename comparison, case-insensitive, exact.
pub fn has_member(names: &[String], wanted: &str) -> bool {
    names.iter().any(|n| basename(n).eq_ignore_ascii_case(wanted))
}

/// The extension extraction the wildcard lookup ends up using, as pinned by the
/// `ext_*` vectors: drop exactly one trailing `.`, then take the text after the last
/// `.` including that dot. Returns the empty string when there is no dot left.
fn extension_of(name: &str) -> &str {
    let base = basename(name);
    let base = base.strip_suffix('.').unwrap_or(base);
    match base.rfind('.') {
        Some(at) => &base[at..],
        None => "",
    }
}

/// Port of the wildcard lookup: does any member match a pattern such as `*.exe`?
/// The pattern is split at its own dot, and only the extension is compared, which is
/// what the `ext_trailing_space` and `ext_dot_exe_dot_txt` vectors show.
pub fn has_pattern(names: &[String], pattern: &str) -> bool {
    let wanted = match pattern.find('.') {
        Some(at) => &pattern[at..],
        None => return false,
    };
    names.iter().any(|n| extension_of(n).eq_ignore_ascii_case(wanted))
}

/// Run the whole chain over an in-memory archive.
///
/// The original receives a filename and reads it from disk. This takes the bytes
/// instead, so the port stays pure and testable. The `-1` verdicts `entry` produces for
/// a path that does not exist or matches no wildcard are therefore unreachable here.
pub fn validate(bytes: &[u8]) -> Report {
    let verdict = |code: i32| Report { code, stdout: format!("Result: {}\n", code) };

    let names = match member_names(bytes) {
        Some(names) => names,
        None => return verdict(CODE_NOT_ZIP),
    };

    if has_member(&names, MASTER_DB) {
        return verdict(CODE_UNSUPPORTED_VERSION);
    }

    for required in REQUIRED_NX1 {
        if !has_member(&names, required) {
            return verdict(CODE_MISSING_REQUIRED);
        }
    }

    for pattern in FORBIDDEN_PATTERNS {
        if has_pattern(&names, pattern) {
            return verdict(CODE_EXECUTABLE_MEMBER);
        }
    }

    if !has_member(&names, META_FILE) {
        return verdict(CODE_NO_META);
    }

    // The check above searches by basename, but the extraction that follows looks the
    // name up at the root. When they disagree the library aborts and the run ends with
    // code 0 and the exception text as its only output.
    if !names.iter().any(|n| n.eq_ignore_ascii_case(META_FILE)) {
        return Report { code: CODE_VALID, stdout: META_NOT_AT_ROOT.to_string() };
    }

    verdict(CODE_VALID)
}
