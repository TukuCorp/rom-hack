//! One NexusDB table of an area as typed rows, with its blobs resolvable.
//!
//! `records` knows how a table file is laid out; this is the reading a caller wants: the fields
//! the dictionary states, every live row in file order, and a cell by field name. The stride is
//! the one the file's own blocks agree on (`records::stride_of`), so a table reads the same way
//! whichever area it comes from.

use crate::{blobs, records};
use records::{Field, Value};

/// A decoded table.
#[derive(Debug, Clone)]
pub struct Table {
    pub name: String,
    pub fields: Vec<Field>,
    pub rows: Vec<Vec<Value>>,
    bytes: Vec<u8>,
}

impl Table {
    /// Every live row of a table file. A table whose dictionary does not place comes back with no
    /// fields and no rows.
    pub fn read(name: &str, bytes: Vec<u8>) -> Table {
        let fields = records::field_descriptors(&bytes);
        let mut rows = Vec::new();
        let page = records::page_size(&bytes);
        if let Some(stride) = records::stride_of(name, &bytes, &fields) {
            if let Some((base, _)) = records::geometry_in(page, stride) {
                for at in records::data_blocks_in(&bytes, page) {
                    if let Some(block) = bytes.get(at..at + page) {
                        rows.extend(records::live_records(block, base, &fields, stride));
                    }
                }
            }
        }
        Table { name: name.to_string(), fields, rows, bytes }
    }

    /// Where a field sits in a row.
    pub fn col(&self, field: &str) -> Option<usize> {
        self.fields.iter().position(|f| f.name.eq_ignore_ascii_case(field))
    }

    /// A row's cell by field name, `Unset` when the table has no such field.
    pub fn get<'a>(&'a self, row: &'a [Value], field: &str) -> &'a Value {
        const UNSET: &Value = &Value::Unset;
        self.col(field).and_then(|c| row.get(c)).unwrap_or(UNSET)
    }

    /// A cell as an integer: ints and booleans read as themselves, a float only when whole.
    pub fn int(&self, row: &[Value], field: &str) -> Option<i64> {
        match self.get(row, field) {
            Value::Int(v) => Some(*v),
            Value::Bool(b) => Some(*b as i64),
            Value::Float(f) if f.fract() == 0.0 => Some(*f as i64),
            _ => None,
        }
    }

    /// A cell as a float.
    pub fn float(&self, row: &[Value], field: &str) -> Option<f64> {
        match self.get(row, field) {
            Value::Float(v) => Some(*v),
            Value::Int(v) => Some(*v as f64),
            _ => None,
        }
    }

    /// A cell as a boolean.
    pub fn bool(&self, row: &[Value], field: &str) -> Option<bool> {
        match self.get(row, field) {
            Value::Bool(b) => Some(*b),
            Value::Int(v) => Some(*v != 0),
            _ => None,
        }
    }

    /// A cell as text: a string field as it is, a blob field as the memo it names.
    pub fn text(&self, row: &[Value], field: &str) -> Option<String> {
        match self.get(row, field) {
            Value::Text(t) => Some(t.clone()),
            Value::Blob(0) => None,
            Value::Blob(b) => {
                let width = self
                    .col(field)
                    .map(|c| blobs::width_of(&self.fields[c].type_name))
                    .unwrap_or(blobs::Width::Wide);
                blobs::resolve_text(&self.bytes, *b, width)
            }
            _ => None,
        }
    }
}
