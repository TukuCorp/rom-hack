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
/// The verdict for an argument that resolved to no file at all. The original writes
/// -1 and exits with the same 32-bit value, which Windows reports as 4294967295.
pub const CODE_NO_MATCH: i32 = -1;

/// What the program prints when it is handed no arguments at all. The leading byte is
/// a bare newline, not CRLF, which is why it is written out rather than assembled.
///
/// The last line promises that a meta file is generated unless `/N` is given. Measured
/// on this build, it is not: inspecting a valid archive leaves its bytes untouched, so
/// the port writes nothing either.
pub const USAGE: &str = "\nTestLEAP Filename or Wildcard [/Q] [/C]\r\n\r\n   /Q  Quiet - no messages on screen.\r\n   /C  Clean - delete any disallowed LEAP files.\r\n   /S  Short - just outputs error codes.\r\n   /N  Nometa - no meta file generated, otherwise writes meta info on leap file.\r\n";

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
    "EZFException: File \"sysinfo.txt\" not found - Native error: 00015\r\n";

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
    /// `/N`, suppresses the echo of the meta lines.
    pub nometa: bool,
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

/// One central-directory record: what the archive holds, and where its bytes begin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    /// Compression method: 0 is stored, 8 is deflated.
    pub method: u16,
    /// Offset of this member local header, from the central directory field at +42.
    pub local_at: usize,
    pub compressed_size: usize,
}

/// The central directory of a zip archive, or `None` when it will not open.
///
/// This stands in for `FUN_00610058` plus the zip library underneath it: the validator
/// only ever consults the directory. `None` maps to [`CODE_NOT_ZIP`]. A zero-entry
/// archive is a valid archive, which the `raw_eocd_only` and `empty_zip` vectors pin down.
pub fn entries(bytes: &[u8]) -> Option<Vec<Entry>> {
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

    let count = u16le(bytes, eocd + 10) as usize;
    let cd_size = u32le(bytes, eocd + 12) as usize;
    let cd_at = u32le(bytes, eocd + 16) as usize;
    if cd_at.checked_add(cd_size)? > len {
        return None;
    }

    let mut out = Vec::with_capacity(count);
    let mut at = cd_at;
    for _ in 0..count {
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
        out.push(Entry {
            name: String::from_utf8_lossy(&bytes[from..from + name_len]).into_owned(),
            method: u16le(bytes, at + 10),
            local_at: u32le(bytes, at + 42) as usize,
            compressed_size: u32le(bytes, at + 20) as usize,
        });
        at = from + name_len + extra_len + comment_len;
    }
    Some(out)
}

/// The member names, which is all most callers want.
pub fn member_names(bytes: &[u8]) -> Option<Vec<String>> {
    Some(entries(bytes)?.into_iter().map(|e| e.name).collect())
}

/// The bytes of one member, matched at the archive root and case-insensitively, which is
/// how `FUN_0060d88c` looks a member up. `None` is what makes the meta step abort.
pub fn read_member(bytes: &[u8], wanted: &str) -> Option<Vec<u8>> {
    let found = entries(bytes)?;
    let entry = found.iter().find(|e| e.name.eq_ignore_ascii_case(wanted))?;
    let header = bytes.get(entry.local_at..entry.local_at + 30)?;
    if header[0..4] != [0x50, 0x4b, 0x03, 0x04] {
        return None;
    }
    let name_len = u16le(header, 26) as usize;
    let extra_len = u16le(header, 28) as usize;
    let from = entry.local_at + 30 + name_len + extra_len;
    let to = from.checked_add(entry.compressed_size)?;
    let data = bytes.get(from..to)?;
    match entry.method {
        0 => Some(data.to_vec()),
        8 => crate::deflate::inflate(data),
        _ => None,
    }
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

/// The ten meta keys `FUN_00611e78` looks for, from 0x61b5d0 onward. Each keeps its
/// colon, and a line only has to start with one of them.
pub const META_KEYS: [&str; 10] = [
    "Area Name:",
    "Base Year:",
    "End Year:",
    "Scope:",
    "First Scenario Year:",
    "Regions:",
    "Scenarios:",
    "Scenario Names:",
    "Time Slices:",
    "User Variables:",
];

/// Port of `FUN_00611da8`: does this line begin with one of the meta keys? The compare
/// is ASCII case-insensitive and the keys keep their colons, which `meta_prefix_only`
/// shows: `Area Name` without a colon is not echoed.
pub fn is_meta_line(line: &str) -> bool {
    let bytes = line.as_bytes();
    META_KEYS.iter().any(|key| {
        let key = key.as_bytes();
        bytes.len() >= key.len() && key.iter().zip(bytes).all(|(k, b)| k.eq_ignore_ascii_case(b))
    })
}

/// Split the way the original string list does: on CRLF, on a lone CR, or on a lone LF.
/// A final line with no terminator still counts, which `meta_no_final_newline` pins.
fn meta_lines(text: &str) -> Vec<&str> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\n' {
            out.push(&text[start..i]);
            i += 1;
            start = i;
        } else if bytes[i] == b'\r' {
            out.push(&text[start..i]);
            i += 1;
            if i < bytes.len() && bytes[i] == b'\n' {
                i += 1;
            }
            start = i;
        } else {
            i += 1;
        }
    }
    if start < bytes.len() {
        out.push(&text[start..]);
    }
    out
}

/// The meta lines the original echoes, in file order, each trimmed of the whitespace it
/// trims and terminated with CRLF.
pub fn meta_echo(bytes: &[u8]) -> String {
    let data = match read_member(bytes, META_FILE) {
        Some(data) => data,
        None => return String::new(),
    };
    let text = String::from_utf8_lossy(&data);
    let mut out = String::new();
    for line in meta_lines(&text) {
        // DELPHI Trim strips anything at or below the space character, at both ends.
        let trimmed = line.trim_matches(|c: char| c <= ' ');
        if is_meta_line(trimmed) {
            out.push_str(trimmed);
            out.push_str("\r\n");
        }
    }
    out
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
            "File \"{}\" is not a valid leap file: not valid zip format ({}).\r\n",
            name, CODE_NOT_ZIP
        ),
        Decision::UnsupportedVersion => format!(
            "File \"{}\" is from an unsupported version of LEAP (pre-2012) ({}).\r\n",
            name, CODE_UNSUPPORTED_VERSION
        ),
        Decision::MissingRequired => format!(
            "File \"{}\" is not valid: missing required data files ({}).\r\n",
            name, CODE_MISSING_REQUIRED
        ),
        Decision::ExecutableMember => format!(
            "File \"{}\" is not valid: includes executable files ({}).\r\n",
            name, CODE_EXECUTABLE_MEMBER
        ),
        Decision::Passed { data_files, meta } => {
            let mut out = format!(
                "File \"{}\" is a valid leap file containing {} data files.\r\n",
                name, data_files
            );
            match meta {
                Meta::Ok => {}
                Meta::Missing => out.push_str(&format!(
                    "File \"{}\" contains no meta information: missing sysinfo.txt.\r\n",
                    name
                )),
                Meta::NotAtRoot => out.push_str(META_NOT_AT_ROOT),
            }
            out
        }
    }
}

/// One command-line argument, and what the operating system resolved it to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Input<'a> {
    /// A file the argument resolved to, with its bytes.
    File { name: &'a str, bytes: &'a [u8] },
    /// An argument that resolved to no file at all, which is the -1 verdict.
    NoMatch { as_typed: &'a str },
}

/// The message an argument that matched nothing produces.
pub fn no_match_message(as_typed: &str) -> String {
    format!("No file(s) matching: \"{}\" ({}).\r\n", as_typed, CODE_NO_MATCH)
}

/// Port of the argument loop in `entry`.
///
/// Every resolved file is run through the chain in argument order and its output is
/// appended in that order, but the exit code is the LAST verdict rather than the worst
/// one, which the `bad_then_good` and `db_then_bad` vectors pin down. `/S` suppresses
/// the per-file success messages while leaving the meta echo and the no-match message
/// alone, and prints one result line at the very end rather than one per file. An
/// archive whose meta step aborts ends the whole run, printing no result line.
///
/// Passing no inputs at all reproduces the usage text. Wildcard expansion is not here:
/// the order a filesystem hands back matches is not a property of the program, so the
/// caller supplies each argument already resolved.
pub fn run(inputs: &[Input<'_>], flags: Flags) -> Report {
    if inputs.is_empty() {
        return Report { code: 0, stdout: USAGE.to_string() };
    }

    let mut stdout = String::new();
    let mut code = 0;
    let mut aborted = false;

    for input in inputs {
        match input {
            Input::NoMatch { as_typed } => {
                code = CODE_NO_MATCH;
                if !flags.quiet {
                    stdout.push_str(&no_match_message(as_typed));
                }
            }
            Input::File { name, bytes } => {
                let decision = decide(bytes);
                code = decision.code();
                if matches!(decision, Decision::Passed { meta: Meta::NotAtRoot, .. }) {
                    // The runtime prints the exception itself, so neither flag
                    // suppresses it, and the abort ends the run before any result line.
                    if flags.short || flags.quiet {
                        stdout.push_str(META_NOT_AT_ROOT);
                    } else {
                        stdout.push_str(&messages(&decision, name));
                    }
                    aborted = true;
                    break;
                }
                // The meta step only runs when every other check passed, so an
                // archive rejected for the pre-2012 layout, a missing member or a
                // forbidden extension is never echoed even when it carries meta lines.
                let reached_meta = matches!(decision, Decision::Passed { .. });
                let echo = if reached_meta && !flags.nometa {
                    meta_echo(bytes)
                } else {
                    String::new()
                };
                if flags.quiet {
                    // Nothing at all is printed under `/Q`.
                } else if flags.short {
                    // `/S` drops the success line but keeps the echoed meta lines.
                    stdout.push_str(&echo);
                } else {
                    stdout.push_str(&messages(&decision, name));
                    stdout.push_str(&echo);
                }
            }
        }
    }

    if flags.short && !aborted {
        stdout.push_str(&format!("Result: {}\r\n", code));
    }
    Report { code, stdout }
}

/// The whole of stdout for one archive, under the given flags.
pub fn report(bytes: &[u8], name: &str, flags: Flags) -> Report {
    run(&[Input::File { name, bytes }], flags)
}

/// The short-mode report for a caller that has only the bytes, and wants the verdict and
/// the result line the `/S` flag produces.
pub fn validate(bytes: &[u8]) -> Report {
    report(bytes, "", Flags { quiet: false, short: true, nometa: false })
}
