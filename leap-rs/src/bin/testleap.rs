//! testleap, the ported validator, as a headless drop-in for the vendor program.
//!
//! Argument handling comes from container::parse_arguments, which mirrors the vendor scan,
//! including the odd part where a dash does not remove an argument from the file list the
//! way a slash does.
//!
//! Two deliberate differences. Wildcard expansion happens here in the current directory
//! and sorts by name, because the vendor uses the Windows directory API and its order is
//! a property of the filesystem rather than of the program; a wildcard in a directory part
//! is left alone rather than expanded wrongly. And nothing is ever written or deleted. The
//! vendor /C flag deletes the file it just inspected, a valid one included, which is not
//! behaviour worth reproducing.

use leap_rs::container::{parse_arguments, run, usage, Input};
use std::env;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process;

/// Whether a name matches a pattern of literal characters, star and question mark. Both
/// are lowercased by the caller, since the vendor's directory lookup ignores case.
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

/// The files one argument names. A name with no wildcard is passed straight through, so a
/// file that is not there still reaches the no-match verdict instead of vanishing.
fn expand(arg: &str) -> Vec<String> {
    if !arg.contains('*') && !arg.contains('?') {
        return vec![arg.to_string()];
    }
    let path = Path::new(arg);
    let plain = path.parent().map_or(true, |p| p.as_os_str().is_empty());
    let pattern = match path.file_name() {
        Some(name) if plain => name.to_string_lossy().to_lowercase(),
        _ => return vec![arg.to_string()],
    };

    let mut matched: Vec<String> = match fs::read_dir(".") {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| glob_matches(&pattern, &name.to_lowercase()))
            .collect(),
        Err(_) => Vec::new(),
    };
    matched.sort();
    matched
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

    // Each argument becomes the files it names, or a single entry meaning it named none.
    let mut chosen: Vec<(String, bool)> = Vec::new();
    for arg in named {
        let hits = expand(arg);
        if hits.is_empty() {
            chosen.push((arg.to_string(), false));
        } else {
            for hit in hits {
                chosen.push((hit, true));
            }
        }
    }

    // Read everything before building the inputs, so the slices live long enough.
    let blobs: Vec<Option<Vec<u8>>> = chosen
        .iter()
        .map(|(path, _)| fs::read(path).ok())
        .collect();
    let inputs: Vec<Input> = chosen
        .iter()
        .zip(blobs.iter())
        .map(|((path, _), blob)| match blob {
            Some(bytes) => Input::File { name: path.as_str(), bytes: bytes.as_slice() },
            None => Input::NoMatch { as_typed: path.as_str() },
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
