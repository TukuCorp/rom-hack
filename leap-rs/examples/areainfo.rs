//! Load an area and its oracle and print what they hold: `areainfo <area.zip>`.

use leap_rs::{area::Area, data::Model, results};

fn main() {
    let path = std::env::args().nth(1).expect("an area zip");
    let area = Area::from_zip_file(&path).expect("an area zip");
    let dict = Area::from_zip_file("C:/Program Files/LEAP/_dictionaryNX.zip");
    let m = Model::load(&area, dict.as_ref());
    println!(
        "branches {} statics {} exprs {} scenarios {:?} regions {:?} years {}..{} fsy {} units {} constants {} timeslices {} vars {}",
        m.branches.len(), m.statics.len(), m.exprs.len(),
        m.scenarios.values().map(|s| (s.id, s.parent, s.inherits.clone())).collect::<Vec<_>>(),
        m.regions, m.base_year, m.end_year, m.first_scenario_year, m.units.len(), m.constants.len(),
        m.timeslices.len(), m.variables.len()
    );
    for s in m.scenarios.keys() {
        println!("  chain {s}: {:?}", m.scenario_chain(*s));
    }
    let oracle = results::definitive(&area).expect("a definitive regression set");
    println!("oracle values {}", oracle.len());
}
