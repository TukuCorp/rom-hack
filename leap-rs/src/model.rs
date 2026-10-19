//! The model an area holds, table by table.
//!
//! `records` decodes a table into typed rows. This module knows what the tables of a LEAP area
//! mean, starting with the branch tree: the structure table lists every branch with its parent,
//! its level and its name, which is what the arithmetic in the scenario table attaches to.
//!
//! What it is built from is worth stating, because it decides how much a result can be trusted.
//! Reading the table needs the dictionary to place every field, the record size to be derived, and
//! the live slots to be told from the free ones. The last comes from each block's used-slot map,
//! which leaves out the slots that were written and then freed: the shipped structure table reads
//! as 434 branches, every one named, where the signature of an unwritten slot let five freed slots
//! through as nameless branches.

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
    let Some((base, _)) = records::geometry(size) else {
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
        for row in records::live_records(whole, base, fields, size) {
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

/// One row of an area scenario table.
///
/// The row says which branch and variable it sets, and where the expression for it lives. That
/// expression is not text in the record: the field is a blob reference of two numbers, and the
/// second is the number of a data block in the same file -- the seven blocks `scenariodata.nx1`
/// refers to are exactly its seven `NXHD` blocks -- while the first is the memo position within
/// that block. Reading the memo itself means reading the blob heap, which `crate::blobs` does:
/// `blobs::expression_text` resolves one of these rows to the text it points at, or to nothing when
/// the memo is not text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioRow {
    pub branch: i64,
    pub variable: i64,
    pub region: i64,
    pub scenario: i64,
    /// The memo position in its block, or zero when the row has no expression.
    pub memo_index: u64,
    /// The block the memo lives in, or zero when the row has no expression.
    pub memo_block: u64,
}

/// Every row of a scenario table, in the order the file stores them.
pub fn scenarios(bytes: &[u8]) -> Vec<ScenarioRow> {
    scenarios_with(&records::field_descriptors(bytes), bytes)
}

/// Every row of a scenario table, from a dictionary and table read apart.
pub fn scenarios_with(fields: &[Field], bytes: &[u8]) -> Vec<ScenarioRow> {
    let Some(size) = records::record_size(fields) else {
        return Vec::new();
    };
    let Some((base, _)) = records::geometry(size) else {
        return Vec::new();
    };
    let Some(branch) = records::index_of(fields, "BranchID") else {
        return Vec::new();
    };
    let Some(variable) = records::index_of(fields, "VariableID") else {
        return Vec::new();
    };
    let Some(region) = records::index_of(fields, "RegionID") else {
        return Vec::new();
    };
    let Some(scenario) = records::index_of(fields, "ScenarioID") else {
        return Vec::new();
    };
    let Some(expression) = records::index_of(fields, "Expression") else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for block in records::data_blocks(bytes) {
        let Some(whole) = bytes.get(block..block + records::BLOCK) else {
            continue;
        };
        for row in records::live_records(whole, base, fields, size) {
            let (Some(branch), Some(variable)) = (integer(&row, branch), integer(&row, variable))
            else {
                continue;
            };
            let (Some(region), Some(scenario)) = (integer(&row, region), integer(&row, scenario))
            else {
                continue;
            };
            let (memo_index, memo_block) = match row.get(expression) {
                Some(Value::Blob(raw)) => (raw & 0xffff_ffff, raw >> 32),
                _ => (0, 0),
            };
            out.push(ScenarioRow {
                branch,
                variable,
                region,
                scenario,
                memo_index,
                memo_block,
            });
        }
    }
    out
}

/// A decoded integer field, when the row holds one.
fn integer(row: &[Value], at: usize) -> Option<i64> {
    match row.get(at) {
        Some(Value::Int(value)) => Some(*value),
        _ => None,
    }
}
