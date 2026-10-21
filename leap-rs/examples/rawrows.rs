//! Raw blob refs of scenariodata rows: `rawrows <scenariodata.nx1>`.
use leap_rs::table::Table;
fn main() {
    let p = std::env::args().nth(1).unwrap();
    let t = Table::read("scenariodata", std::fs::read(&p).unwrap());
    for r in &t.rows {
        let blob = match t.get(r, "Expression") { leap_rs::records::Value::Blob(b) => *b, _ => 0 };
        println!("{}\t{}\t{}\t{}\t{}\t{}", t.int(r,"BranchID").unwrap_or(0), t.int(r,"VariableID").unwrap_or(0), t.int(r,"ScenarioID").unwrap_or(0), blob >> 32, blob & 0xffffffff, t.text(r, "Expression").unwrap_or_default().replace(['\r','\n','\t'], " "));
    }
}
