//! A LEAP area as a set of files: the `.nx1` tables and the text files beside them.
//!
//! An area ships as a zip with one top folder (`Freedonia/...`) or sits unpacked in a directory.
//! Either way it is read into memory once, keyed by path relative to the area folder, compared
//! without case because the same table is `DataNames.nx1` in one area and `datanames.nx1` in
//! another.

use crate::container;
use crate::table::Table;
use std::collections::BTreeMap;
use std::path::Path;

/// The files of one area, by lower-cased path relative to the area folder, `/`-separated.
#[derive(Debug, Clone, Default)]
pub struct Area {
    files: BTreeMap<String, Vec<u8>>,
}

impl Area {
    /// The area a LEAP area zip holds. Every member sits under one top folder, which is dropped.
    pub fn from_zip(zip: &[u8]) -> Option<Area> {
        let names = container::member_names(zip)?;
        let mut files = BTreeMap::new();
        for name in names.iter().filter(|n| !n.ends_with('/')) {
            let rel = name.split_once('/').map_or(name.as_str(), |(_, rest)| rest);
            let bytes = container::read_member(zip, name)?;
            files.insert(rel.to_lowercase(), bytes);
        }
        Some(Area { files })
    }

    /// The area a zip file on disk holds.
    pub fn from_zip_file(path: impl AsRef<Path>) -> Option<Area> {
        Area::from_zip(&std::fs::read(path).ok()?)
    }

    /// The area an unpacked area directory holds, subfolders included.
    pub fn from_dir(path: impl AsRef<Path>) -> std::io::Result<Area> {
        fn walk(dir: &Path, rel: &str, files: &mut BTreeMap<String, Vec<u8>>) -> std::io::Result<()> {
            for entry in std::fs::read_dir(dir)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_lowercase();
                let rel = if rel.is_empty() { name } else { format!("{rel}/{name}") };
                if entry.file_type()?.is_dir() {
                    walk(&entry.path(), &rel, files)?;
                } else {
                    files.insert(rel, std::fs::read(entry.path())?);
                }
            }
            Ok(())
        }
        let mut files = BTreeMap::new();
        walk(path.as_ref(), "", &mut files)?;
        Ok(Area { files })
    }

    /// The files under a subfolder, as an area of their own (`_RegressionTests/Definitive`).
    pub fn sub(&self, folder: &str) -> Area {
        let prefix = format!("{}/", folder.trim_end_matches('/').to_lowercase());
        Area {
            files: self
                .files
                .iter()
                .filter_map(|(k, v)| k.strip_prefix(&prefix).map(|rest| (rest.to_string(), v.clone())))
                .collect(),
        }
    }

    /// One file's bytes, by path relative to the area folder.
    pub fn file(&self, rel: &str) -> Option<&[u8]> {
        self.files.get(&rel.to_lowercase()).map(Vec::as_slice)
    }

    /// One text file, decoded as UTF-8 with any byte-order mark dropped.
    pub fn text(&self, rel: &str) -> Option<String> {
        let bytes = self.file(rel)?;
        let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf][..]).unwrap_or(bytes);
        Some(String::from_utf8_lossy(bytes).into_owned())
    }

    /// One table of the area folder itself, by name without the `.nx1`.
    pub fn table(&self, name: &str) -> Option<Table> {
        let bytes = self.file(&format!("{name}.nx1"))?;
        Some(Table::read(name, bytes.to_vec()))
    }

    /// One table, or an empty one when the area does not carry it.
    pub fn table_or_empty(&self, name: &str) -> Table {
        self.table(name).unwrap_or_else(|| Table::read(name, Vec::new()))
    }

    /// The paths the area holds.
    pub fn paths(&self) -> impl Iterator<Item = &str> {
        self.files.keys().map(String::as_str)
    }
}
