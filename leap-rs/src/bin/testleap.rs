//! testleap, the ported validator, as a headless drop-in for the vendor program.
//!
//! Argument handling comes from container::parse_arguments, and turning an argument into
//! files is resolve below. Neither follows the obvious rule, because the vendor does not:
//! see the comments on resolve for what was measured.
//!
//! Nothing is ever written or deleted. The vendor /C flag deletes the file it just
//! inspected, a valid one included, which is not behaviour worth reproducing.

use leap_rs::container::{parse_arguments, run, usage, Input};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process;

/// Whether a name matches a pattern of literal characters, star and question mark. Both
/// are lowercased by the caller, since the vendor lookup ignores case.
fn glob_matches(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let n: Vec<char> = name.chars().collect();
    let (mut pi, mut ni) = (0usize, 0usize);
    let (mut star, mut resume) = (usize::MAX, 0usize);
    while ni < n.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == n[ni]) {
            pi += 1;
            ni += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = pi;
            resume = ni;
            pi += 1;
        } else if star != usize::MAX {
            pi = star + 1;
            resume += 1;
            ni = resume;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

/// One argument, resolved the way the vendor resolves it.
enum Resolved {
    /// The entries it named, as a display name and the path to read.
    Files(Vec<(String, PathBuf)>),
    /// It named nothing at all, which is the no-match verdict.
    None,
    /// It contributed nothing: no message, no verdict, nothing.
    Silent,
}

/// Resolve one argument into the entries it names.
///
/// None of these rules is the obvious one, and every one is pinned by the end to end
/// suite rather than guessed:
///
/// * The vendor splits the argument on the BACKSLASH only. So sub-inner path searches in
///   the subdirectory and is reported by its bare name, an absolute backslash path works,
///   and a forward slash is not a separator at all.
/// * A forward slash anywhere makes the argument contribute nothing whatever: no message,
///   no verdict, not even the no-match one. That reads like a fault rather than a rule, but
///   a leading dot-slash, a subdirectory path, a subdirectory wildcard and a bare
///   directory followed by a slash all behave that way.
/// * The reported name is the entry name as the filesystem spells it, never the argument as
///   typed and never with the directory part, so an upper case argument is reported in the
///   lower case the file really has.
/// * A wildcard scan reaches the dot and dot-dot entries too, which the vendor then reports
///   as missing files, because a directory is not something it can read.
fn resolve(arg: &str) -> Resolved {
    if arg.contains('/') {
        return Resolved::Silent;
    }
    let (dir, mask) = match arg.rfind('\\') {
        Some(at) => (&arg[..at], &arg[at + 1..]),
        None => ("", arg),
    };
    let in_dir = if dir.is_empty() { Path::new(".") } else { Path::new(dir) };
    let listed = match fs::read_dir(in_dir) {
        Ok(entries) => entries,
        Err(_) => return Resolved::None,
    };
    let names: Vec<String> = listed
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    let path_of = |name: &str| {
        if dir.is_empty() {
            PathBuf::from(name)
        } else {
            in_dir.join(name)
        }
    };

    if mask.contains('*') || mask.contains('?') {
        let wanted = mask.to_lowercase();
        let mut hits: Vec<String> = [".", ".."]
            .iter()
            .filter(|special| glob_matches(&wanted, special))
            .map(|special| special.to_string())
            .collect();
        hits.extend(
            names
                .iter()
                .filter(|name| glob_matches(&wanted, &name.to_lowercase()))
                .cloned(),
        );
        hits.sort();
        if hits.is_empty() {
            return Resolved::None;
        }
        return Resolved::Files(
            hits.into_iter()
                .map(|name| {
                    let path = path_of(&name);
                    (name, path)
                })
                .collect(),
        );
    }

    if let Some(found) = names.iter().find(|name| name.eq_ignore_ascii_case(mask)) {
        let path = path_of(found);
        return Resolved::Files(vec![(found.clone(), path)]);
    }

    // The scan resolves a dot entry to the directory itself, and names it as that
    // directory spells its own name, which is why asking for the parent reports the
    // directory above rather than the two dots.
    if mask == "." || mask == ".." {
        let target = path_of(mask);
        if let Some(name) = fs::canonicalize(&target)
            .ok()
            .and_then(|real| real.file_name().map(|part| part.to_string_lossy().into_owned()))
        {
            return Resolved::Files(vec![(name, target)]);
        }
    }
    Resolved::None
}

/// What to do for one resolved entry.
enum Plan {
    Read(String, PathBuf),
    NoMatch(String),
}

fn main() {
    let owned: Vec<String> = env::args().skip(1).collect();
    if owned.is_empty() {
        let report = usage();
        emit(&report.stdout);
        process::exit(report.code);
    }

    let args: Vec<&str> = owned.iter().map(String::as_str).collect();
    let (flags, named) = parse_arguments(&args);

    let mut plans: Vec<Plan> = Vec::new();
    for arg in named {
        match resolve(arg) {
            Resolved::Files(files) => {
                for (display, path) in files {
                    plans.push(Plan::Read(display, path));
                }
            }
            Resolved::None => plans.push(Plan::NoMatch(arg.to_string())),
            Resolved::Silent => {}
        }
    }

    // Read everything before building the inputs, so the slices outlive them. A failure to
    // read is not a separate error to report: it is the same outcome the vendor reaches for
    // a directory, which is the missing-file verdict.
    let blobs: Vec<Option<Vec<u8>>> = plans
        .iter()
        .map(|plan| match plan {
            Plan::Read(_, path) => fs::read(path).ok(),
            Plan::NoMatch(_) => None,
        })
        .collect();

    let inputs: Vec<Input> = plans
        .iter()
        .zip(blobs.iter())
        .map(|(plan, blob)| match (plan, blob) {
            (Plan::Read(display, _), Some(bytes)) => Input::File {
                name: display.as_str(),
                bytes: bytes.as_slice(),
            },
            (Plan::Read(display, _), None) => Input::Missing { name: display.as_str() },
            (Plan::NoMatch(typed), _) => Input::NoMatch { as_typed: typed.as_str() },
        })
        .collect();

    let report = run(&inputs, flags);
    emit(&report.stdout);
    process::exit(report.code);
}

fn emit(text: &str) {
    let stdout = std::io::stdout();
    let mut handle = stdout.lock();
    let _ = handle.write_all(text.as_bytes());
    let _ = handle.flush();
}
