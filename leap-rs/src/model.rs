//! The model an area holds, table by table.
//!
//! `records` decodes a table into typed rows. This module knows what the tables of a LEAP area
//! mean, starting with the branch tree: the structure table lists every branch with its parent,
//! its level and its name, which is what the arithmetic in the scenario table attaches to.
//!
//! What it is built from is worth stating, because it decides how much a result can be trusted.
//! Reading the table needs the dictionary to place every field, the record size to be derived, and
//! the live slots to be told from the ones nothing was ever written to, and that last rule
//! under-filters: five of the 439 rows of the shipped area structure table are slots that were
//! written and then freed, and they come back as nameless branches. The test says so rather than
//! hiding it, and it checks the tree on the rows that do have names.

use crate::records::{self, Field, Value};

/// One branch of the area tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Branch {
    pub id: i64,
    pub parent: i64,
    pub level: i64,
    pub kind: i64,
    pub name: String,
}

/// Every branch a structure table holds, in the order the file stores them.
pub fn branches(bytes: &[u8]) -> Vec<Branch> {
    branches_with(&records::field_descriptors(bytes), bytes)
}

/// Every branch a structure table holds, from a dictionary and table read apart.
///
/// A table file carries its dictionary in one block and its rows in others, so a caller that
/// holds the two separately -- a test reading a single data block, say -- can hand the fields in.
pub fn branches_with(fields: &[Field], bytes: &[u8]) -> Vec<Branch> {
    let Some(size) = records::record_size(fields) else {
        return Vec::new();
    };
    let Some(id) = records::index_of(fields, "BranchID") else {
        return Vec::new();
    };
    let Some(parent) = records::index_of(fields, "ParentBranchID") else {
        return Vec::new();
    };
    let Some(level) = records::index_of(fields, "BranchLevel") else {
        return Vec::new();
    };
    let Some(kind) = records::index_of(fields, "BranchType") else {
        return Vec::new();
    };
    let Some(name) = records::index_of(fields, "Name") else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for block in records::data_blocks(bytes) {
        let Some(whole) = bytes.get(block..block + records::BLOCK) else {
            continue;
        };
        for row in records::live_records(whole, fields, size) {
            let (Some(Value::Int(id)), Some(Value::Int(parent))) = (row.get(id), row.get(parent))
            else {
                continue;
            };
            let (Some(Value::Int(level)), Some(Value::Int(kind))) = (row.get(level), row.get(kind))
            else {
                continue;
            };
            let Some(Value::Text(name)) = row.get(name) else {
                continue;
            };
            out.push(Branch {
                id: *id,
                parent: *parent,
                level: *level,
                kind: *kind,
                name: name.clone(),
            });
        }
    }
    out
}
