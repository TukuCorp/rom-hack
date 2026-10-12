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
//! Three behaviours here look wrong and are reproduced anyway, because the port aims at
//! equivalence rather than at a corrected validator. All are pinned by oracle vectors:
//!
//! * Member lookup is by **basename**, compared case-insensitively, so a nested
//!   `sub/years.nx1` satisfies the `years.nx1` requirement. A file merely containing the
//!   name does not, so `xyears.nx1` and `years.nx1.bak` both fail.
//! * The extension test drops **exactly one** trailing `.` before taking the text after
//!   the last dot. So `tool.exe.` is flagged but `tool.exe..` is not, and `tool.exe.txt`
//!   is not flagged because the text after the last dot is `.txt`.
//! * A nested `meta/sysinfo.txt` passes the by-basename meta check and then fails the
//!   extraction that looks the name up at the archive root. The library aborts, the run
//!   exits 0, and the exception text is the only thing it prints.
//!
//! ## Output modes
//!
//! The original changes what it prints based on its flags, and the oracle captures all
//! three: the default prints one message per file, `/S` prints a single `Result: <code>`
//! line instead, and `/Q` prints nothing at all. The exception above is the exception to
//! that: the runtime prints it even under `/Q` or `/S`, and the run never reaches the
//! result line, which is why a quiet run is not always empty.

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
    /// Everything the run writes to stdout for the requested flags.
    pub stdout: String,
}

/// The text the zip library aborts with when the meta file is not at the archive root.
/// Captured verbatim from the `meta_meta_sysinfo_txt` vector.
pub const META_NOT_AT_ROOT: &str =
    "EZFException: File \"sysinfo.txt\" not found - Native error: 00015\n";

/// What the chain decided, before it is turned into text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    NotZip,
    UnsupportedVersion,
    MissingRequired,
    ExecutableMember,
    /// Everything else passed. Carries the data-file count the success message prints,
    /// and the outcome of the meta step that runs afterwards.
    Passed { data_files: usize, meta: Meta },
}

/// The result of the meta step, which `entry` runs only after everything else passed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Meta {
    /// The meta file was found by basename and again at the archive root.
    Ok,
    /// No member has that basename, so the run reports verdict 7.
    Missing,
    /// Found by basename but not at the root, so the library aborts. Verdict stays 0.
    NotAtRoot,
}

/// The flags that change what the original prints.
///
/// `/C` and `/N` are deliberately absent: the first deletes files and the second decides
/// whether a `.meta` file gets written, and this port performs no filesystem side effects.
/// The original also accepts the long spellings `quiet`, `short`, `clean` and `nometa`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Flags {
    /// `/Q`, suppresses the per-file messages.
    pub quiet: bool,
    /// `/S`, suppresses the per-file messages and prints one result line instead.
    pub short: bool,
}

impl Decision {
    pub fn code(&self) -> i32 {
        match self {
            Decision::NotZip => CODE_NOT_ZIP,
            Decision::UnsupportedVersion => CODE_UNSUPPORTED_VERSION,
            Decision::MissingRequired => CODE_MISSING_REQUIRED,
            Decision::ExecutableMember => CODE_EXECUTABLE_MEMBER,
            Decision::Passed { meta: Meta::Missing, .. } => CODE_NO_META,
            Decision::Passed { .. } => CODE_VALID,
        }
    }
}

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

/// Run the chain over an in-memory archive.
///
/// The original takes a filename and reads it from disk. This takes the bytes instead so
/// the port stays pure. Two things `entry` can do are therefore out of reach here: the -1
/// verdicts for a path that does not exist or matches no wildcard, and the loop that runs
/// the same chain over every file a wildcard expanded to.
pub fn decide(bytes: &[u8]) -> Decision {
    let names = match member_names(bytes) {
        Some(names) => names,
        None => return Decision::NotZip,
    };
    let data_files = names.len();

    if has_member(&names, MASTER_DB) {
        return Decision::UnsupportedVersion;
    }
    for required in REQUIRED_NX1 {
        if !has_member(&names, required) {
            return Decision::MissingRequired;
        }
    }
    for pattern in FORBIDDEN_PATTERNS {
        if has_pattern(&names, pattern) {
            return Decision::ExecutableMember;
        }
    }

    let meta = if !has_member(&names, META_FILE) {
        Meta::Missing
    } else if names.iter().any(|n| n.eq_ignore_ascii_case(META_FILE)) {
        Meta::Ok
    } else {
        Meta::NotAtRoot
    };
    Decision::Passed { data_files, meta }
}

/// The per-file messages, in the order the original prints them.
pub fn messages(decision: &Decision, name: &str) -> String {
    match decision {
        Decision::NotZip => format!(
            "File \"{}\" is not a valid leap file: not valid zip format ({}).\n",
            name, CODE_NOT_ZIP
        ),
        Decision::UnsupportedVersion => format!(
            "File \"{}\" is from an unsupported version of LEAP (pre-2012) ({}).\n",
            name, CODE_UNSUPPORTED_VERSION
        ),
        Decision::MissingRequired => format!(
            "File \"{}\" is not valid: missing required data files ({}).\n",
            name, CODE_MISSING_REQUIRED
        ),
        Decision::ExecutableMember => format!(
            "File \"{}\" is not valid: includes executable files ({}).\n",
            name, CODE_EXECUTABLE_MEMBER
        ),
        Decision::Passed { data_files, meta } => {
            let mut out = format!(
                "File \"{}\" is a valid leap file containing {} data files.\n",
                name, data_files
            );
            match meta {
                Meta::Ok => {}
                Meta::Missing => out.push_str(&format!(
                    "File \"{}\" contains no meta information: missing sysinfo.txt.\n",
                    name
                )),
                Meta::NotAtRoot => out.push_str(META_NOT_AT_ROOT),
            }
            out
        }
    }
}

/// The whole of stdout for one archive, under the given flags.
pub fn report(bytes: &[u8], name: &str, flags: Flags) -> Report {
    let decision = decide(bytes);
    let code = decision.code();
    let aborted = matches!(decision, Decision::Passed { meta: Meta::NotAtRoot, .. });
    let stdout = if !flags.short && !flags.quiet {
        // The default mode prints the success line first and the abort after it, which
        // `messages` already does.
        messages(&decision, name)
    } else if aborted {
        // The runtime prints the exception itself, so neither flag suppresses it, and
        // the run never reaches the result line.
        META_NOT_AT_ROOT.to_string()
    } else if flags.short {
        format!("Result: {}\n", code)
    } else {
        String::new()
    };
    Report { code, stdout }
}

/// The short-mode report for a caller that has only the bytes, and wants the verdict and
/// the result line the `/S` flag produces.
pub fn validate(bytes: &[u8]) -> Report {
    report(bytes, "", Flags { quiet: false, short: true })
}
