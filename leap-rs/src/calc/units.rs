//! Unit conversion: any energy, mass or volume amount of a fuel to gigajoules.
//!
//! A unit states what one of it is in its class's base unit (`units.Conversion`): GJ for energy,
//! kg for mass, litres for volume. A fuel states its energy content per one of its own unit
//! (`fuels.EnergyContent` in `NumUnitID` per `UnitID`) and its density in kg per litre, which is how
//! an amount in a mass unit reads in a fuel measured by volume, and the other way round.

use crate::data::Model;

pub const ENERGY: i64 = 2;
pub const MASS: i64 = 1;
pub const VOLUME: i64 = 3;

/// One fuel's energy properties.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FuelEnergy {
    /// GJ per one of the fuel's own unit.
    pub gj_per_unit: f64,
    pub unit: i64,
    pub density: f64,
}

/// The energy properties of a fuel, from the fuels table.
pub fn fuel_energy(m: &Model, fuel: i64) -> Option<FuelEnergy> {
    let t = m.table("fuels")?;
    let row = t.rows.iter().find(|r| t.int(r, "FuelID") == Some(fuel))?;
    let content = t.float(row, "EnergyContent")?;
    let num = t.int(row, "NumUnitID")?;
    let num_conv = m.units.get(&num).map(|u| u.conversion).unwrap_or(1.0);
    Some(FuelEnergy {
        gj_per_unit: content * num_conv,
        unit: t.int(row, "UnitID")?,
        density: t.float(row, "Density").unwrap_or(0.0),
    })
}

/// GJ per one `unit` of `fuel`.
pub fn to_gj(m: &Model, fuel: i64, unit: i64) -> f64 {
    let Some(u) = m.units.get(&unit) else { return 1.0 };
    if u.class == ENERGY {
        return u.conversion;
    }
    let Some(f) = fuel_energy(m, fuel) else { return u.conversion };
    let Some(fu) = m.units.get(&f.unit) else { return u.conversion };
    if fu.class == ENERGY {
        return u.conversion;
    }
    // The amount in the base unit of its own class, then in the fuel unit's class.
    let mut base = u.conversion;
    if u.class != fu.class {
        base = match (u.class, fu.class) {
            (MASS, VOLUME) if f.density != 0.0 => base / f.density,
            (VOLUME, MASS) => base * f.density,
            _ => base,
        };
    }
    base / fu.conversion * f.gj_per_unit
}
