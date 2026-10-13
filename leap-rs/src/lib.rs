//! A headless, function-for-function Rust port of the LEAP computational core.
//!
//! Scope and policy are in `PORTING.md` at the crate root. The short version:
//! every ported function carries the original address and name, preserves the
//! original integer and floating point semantics exactly, and is covered by a
//! parity test asserting bit-for-bit equality against output captured from the
//! original binary.

pub mod calendar;
pub mod container;
pub mod deflate;
pub mod expr;
pub mod nx1;
pub mod oracle_calendar;
pub mod oracle_container;
pub mod oracle_deflate;
pub mod oracle_nx1_expr;
pub mod oracle_nx1;
pub mod oracle_nx1_strings;
pub mod oracle_run;
