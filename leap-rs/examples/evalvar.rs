//! Evaluate input variables: `evalvar <area.zip> <scenario> <year> <branch>:<variable>...`.
//! Variable 1604 (Total Activity) reads after the demand calculation has run.
use leap_rs::{area::Area, calc, data::Model};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let area = Area::from_zip_file(&a[1]).unwrap();
    let dict = Area::from_zip_file("C:/Program Files/LEAP/_dictionaryNX.zip");
    let m = Model::load(&area, dict.as_ref());
    let s: i64 = a[2].parse().unwrap();
    let y: i32 = a[3].parse().unwrap();
    let inp = calc::inputs::Inputs::new(&m, s, m.regions[0]);
    let mut out = leap_rs::results::Results::new();
    calc::demand::run(&inp, &mut out);
    for spec in &a[4..] {
        let (b, v) = spec.split_once(':').unwrap();
        let (b, v): (i64, i64) = (b.parse().unwrap(), v.parse().unwrap());
        let e = inp.expression(b, v, s, m.regions[0], y);
        println!("{b}:{v} = {} <- {:?}", inp.value(b, v, y), e);
    }
}
