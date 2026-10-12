//! End-to-end differential test: the ported binary against the vendor program.
//!
//! This is the strongest check here. Every other suite replays vectors captured once from
//! the vendor; this one runs both programs over the same inputs, in the same working
//! directory, and compares the exit code and the whole of stdout as bytes. Nothing is
//! mocked and nothing is pre-recorded.
//!
//! It is skipped, with a printed note, when the vendor binary is not installed, so the
//! crate still builds and tests on a machine without LEAP.
//!
//! The archives are taken from the container oracle rather than built again, so the inputs
//! are known-good bytes that the other suites already agree on.

use leap_rs::oracle_container::CONTAINER_VECTORS;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const VENDOR: &str = "C:/Program Files/LEAP/testleap.exe";
const OUR_BIN: &str = env!("CARGO_BIN_EXE_testleap");

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "hex payload has an odd length");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex payload is not hex"))
        .collect()
}

/// One archive's bytes, looked up by the case name the container oracle gave it.
fn archive(case: &str) -> Vec<u8> {
    let found = CONTAINER_VECTORS
        .iter()
        .find(|v| v.0 == case)
        .unwrap_or_else(|| panic!("no oracle vector named {}", case));
    unhex(found.1)
}

/// The files the workloads refer to, as name to source case.
const WORKLOAD: &[(&str, &str)] = &[
    ("valid.leap", "valid"),
    ("db.leap", "db_present"),
    ("bad.leap", "not_a_zip"),
    ("nometa.leap", "meta_bak_suffix"),
    ("missing.leap", "missing_years_nx1"),
    ("forbid.leap", "forbid_php"),
    ("echo.leap", "meta_echo_order"),
    ("empty.leap", "empty_zip"),
];

const ARGUMENT_LISTS: &[&[&str]] = &[
    &["valid.leap"],
    &["bad.leap"],
    &["db.leap"],
    &["nometa.leap"],
    &["missing.leap"],
    &["forbid.leap"],
    &["echo.leap"],
    &["empty.leap"],
    &["valid.leap", "bad.leap"],
    &["bad.leap", "valid.leap"],
    &["valid.leap", "db.leap"],
    &["db.leap", "bad.leap"],
    &["valid.leap", "bad.leap", "db.leap"],
    &["valid.leap", "valid.leap"],
    &["nosuch.leap"],
    &["nosuch.leap", "valid.leap"],
    &["valid.leap", "nosuch.leap"],
    &["a.nope", "b.nope"],
    &["*.nope"],
    &["*.leap"],
    &["*.L?ap"],
    &["valid.leap", "/Q"],
    &["valid.leap", "/q"],
    &["valid.leap", "-Q"],
    &["valid.leap", "/quiet"],
    &["valid.leap", "/S"],
    &["valid.leap", "/N"],
    &["valid.leap", "/X"],
    &["valid.leap", "-S"],
    &["valid.leap", "/Q", "/S"],
    &["valid.leap", "/S", "/Q"],
    &["valid.leap", "/N", "/S"],
    &["echo.leap", "/S"],
    &["echo.leap", "/N"],
    &["valid.leap", "bad.leap", "/S"],
    &["nosuch.leap", "/S"],
    &["*.nope", "/S"],
    &["*.leap", "/S"],
    &["/Q"],
    &["/S"],
    &["/X"],
];

struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Scratch {
        let mut path = std::env::temp_dir();
        path.push(format!("leap_e2e_{}_{}", std::process::id(), tag));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("scratch directory");
        Scratch(path)
    }

    fn path(&self) -> &PathBuf {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Run one program and hand back its exit code and stdout as raw bytes.
fn run(program: &str, args: &[&str], cwd: &PathBuf) -> (Option<i32>, Vec<u8>) {
    let output = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap_or_else(|err| panic!("could not run {}: {}", program, err));
    (output.status.code(), output.stdout)
}

#[test]
fn the_two_programs_agree_on_every_workload() {
    if !std::path::Path::new(VENDOR).exists() {
        println!("skipping: {} is not installed", VENDOR);
        return;
    }

    let scratch = Scratch::new("workloads");
    for (name, case) in WORKLOAD {
        fs::write(scratch.path().join(name), archive(case)).expect("write archive");
    }

    let mut mismatches = Vec::new();
    for args in ARGUMENT_LISTS {
        let (vendor_code, vendor_out) = run(VENDOR, args, scratch.path());
        let (our_code, our_out) = run(OUR_BIN, args, scratch.path());

        if vendor_code != our_code {
            mismatches.push(format!(
                "{:?}: exit {:?} but the vendor gave {:?}",
                args, our_code, vendor_code
            ));
        }
        if vendor_out != our_out {
            mismatches.push(format!(
                "{:?}:\n     ours   {:?}\n     vendor {:?}",
                args,
                String::from_utf8_lossy(&our_out),
                String::from_utf8_lossy(&vendor_out)
            ));
        }

        // /C deletes whatever it inspects, valid archives included, which would change the
        // working directory under the rest of the run. It is checked on its own instead.
        assert!(
            !args.contains(&"/C") && !args.contains(&"/c"),
            "/C is destructive and must not appear in the shared workload"
        );
    }

    assert!(
        mismatches.is_empty(),
        "{} disagreements across {} argument lists:\n{}",
        mismatches.len(),
        ARGUMENT_LISTS.len(),
        mismatches.join("\n")
    );
}

#[test]
fn the_two_programs_agree_with_no_arguments_and_leave_files_alone() {
    if !std::path::Path::new(VENDOR).exists() {
        println!("skipping: {} is not installed", VENDOR);
        return;
    }

    let scratch = Scratch::new("noargs");
    fs::write(scratch.path().join("valid.leap"), archive("valid")).expect("write archive");

    let (vendor_code, vendor_out) = run(VENDOR, &[], scratch.path());
    let (our_code, our_out) = run(OUR_BIN, &[], scratch.path());
    assert_eq!(our_code, vendor_code, "exit code with no arguments");
    assert_eq!(our_out, vendor_out, "usage text with no arguments");

    // A plain run must not touch the archive. The vendor's help text claims it writes meta
    // info unless /N is given, so this is worth pinning rather than assuming.
    let before = fs::read(scratch.path().join("valid.leap")).expect("read");
    let (_, _) = run(VENDOR, &["valid.leap"], scratch.path());
    let after_vendor = fs::read(scratch.path().join("valid.leap")).expect("read");
    let (_, _) = run(OUR_BIN, &["valid.leap"], scratch.path());
    let after_ours = fs::read(scratch.path().join("valid.leap")).expect("read");
    assert_eq!(before, after_vendor, "the vendor modified the archive");
    assert_eq!(before, after_ours, "the port modified the archive");
}