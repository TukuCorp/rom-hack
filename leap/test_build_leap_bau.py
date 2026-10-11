"""Guards for build_leap_bau.py's GPC mapping.

The mapping is the one place the LEAP comparison could produce a plausible wrong
answer without an error: a branch filed under the wrong GPC reference number
still lands in results.csv and still adds up. `src/city_ghg/schema/gpc.py` is the
authority for the reference numbers (I Stationary Energy, II Transportation,
III Waste, IV IPPU, V AFOLU).

Run inside this folder:  .venv/Scripts/python.exe -m pytest -q test_build_leap_bau.py
"""

import importlib.util
import pathlib

import pytest

HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("build_leap_bau", HERE / "build_leap_bau.py")
bau = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bau)

BS = "\\"

# Every entered branch family, with the reference number the repo's table assigns it.
EXPECTED = [
    ("Demand" + BS + "Plants1A1" + BS + "Coal_HP_TPP" + BS + "Anthracite", "I.4.1"),
    ("Demand" + BS + "Industry" + BS + "Other_1A2", "I.3.1"),
    ("Demand" + BS + "IndustryElec", "I.3.2"),
    ("Demand" + BS + "Households", "I.1.2"),
    ("Demand" + BS + "Commercial", "I.2.2"),
    ("Demand" + BS + "Agriculture", "I.5.2"),
    ("Demand" + BS + "Transport" + BS + "Road_1A3b" + BS + "Diesel", "II.1.1"),
    ("Demand" + BS + "Transport" + BS + "Waterborne_1A3dii" + BS + "FuelOil", "II.3.1"),
    ("NonEnergy" + BS + "Waste" + BS + "MSW_4A1", "III.1.1"),
    ("NonEnergy" + BS + "Waste" + BS + "Biological_4B", "III.2.1"),
    ("NonEnergy" + BS + "Waste" + BS + "Incineration_4C1", "III.3.1"),
    ("NonEnergy" + BS + "Waste" + BS + "Wastewater_4D_CH4", "III.4.1"),
    ("NonEnergy" + BS + "IPPU" + BS + "2A1_cement", "IV.1"),
    ("NonEnergy" + BS + "IPPU" + BS + "2C1_steel", "IV.1"),
    ("NonEnergy" + BS + "AFOLU" + BS + "Livestock_3A", "V.1"),
    ("NonEnergy" + BS + "AFOLU" + BS + "Rice_3C7", "V.3"),
    ("NonEnergy" + BS + "AFOLU" + BS + "Urea_3C3", "V.3"),
]


@pytest.mark.parametrize("path,refno", EXPECTED)
def test_branch_maps_to_expected_refno(path, refno):
    assert bau.gpc_ref(path) == refno


def test_every_entered_branch_is_reportable():
    """No row may enter the model without a GPC reference number.

    This is the gap the pre-2026-10-09 revision of `gpc_ref` hid: unmapped
    families returned an empty refno, which results.csv then carried silently.
    """
    unmapped = []
    for path, _unit, _base, _ea, _eb in bau.DEMAND_CATS:
        if not bau.gpc_ref(path):
            unmapped.append(path)
    for cat, name, *_rest in bau.NONENERGY_EFFECTS:
        path = "NonEnergy" + BS + cat + BS + name
        if not bau.gpc_ref(path):
            unmapped.append(path)
    assert unmapped == []


@pytest.mark.parametrize("path,_unit,_base,ea,eb", bau.DEMAND_CATS)
def test_expressions_are_within_leaps_syntax(path, _unit, _base, ea, eb):
    for e in (ea, eb):
        if e is not None:
            assert bau.check_expression(e) == []


# Coal-plant base-year feedstock, read from the ver1 workbook on 2026-10-09
# (`reports/VIE_HPH_BAU … ver1_TAH review 2026-09-28.xlsx`, sheet "Bảng tính PV1",
# row 7 "1A1ai Sản xuất điện"): D7 = 5070185*1.05 tấn, E7 = 4036716*1.05 tấn,
# G7 = 1155*1.05 (1000 lít). The literal is the base-year activity; the x1.05 is
# the workbook's own one-year step, exactly as for steel D55 and cement D45.
PV1_ROW7_BASE_2025 = {"Anthracite": 5070185.0, "SubBituminous": 4036716.0, "DieselDO": 1155000.0}
PV1_ROW7_CELL = {"Anthracite": 5323694.25, "SubBituminous": 4238551.8, "DieselDO": 1212.75}
# G5 declares the DO column in 1000 lít, so the entered litres are 1000x the sheet value.
CELL_TO_BASE = {"Anthracite": 1.0, "SubBituminous": 1.0, "DieselDO": 1000.0}


def test_plant_base_matches_workbook_literals():
    assert bau.PLANT_FUEL_BASE == PV1_ROW7_BASE_2025


def test_plant_base_follows_from_the_workbook_cells():
    """base = cell / 1.05 x unit conversion, and never the literal divided again."""
    for fuel in PV1_ROW7_BASE_2025:
        want = PV1_ROW7_CELL[fuel] / 1.05 * CELL_TO_BASE[fuel]
        assert bau.PLANT_FUEL_BASE[fuel] == pytest.approx(want, rel=1e-6)
        assert bau.PLANT_FUEL_BASE[fuel] != pytest.approx(PV1_ROW7_BASE_2025[fuel] / 1.05, rel=1e-6)


def test_diesel_has_its_own_unit_and_coals_do_not():
    assert bau.CHILD_UNIT == {"DieselDO": "litre"}
    for plant in bau.PLANT_SHARE:
        children = bau.FUEL_CHILDREN[plant]
        assert [s for s, _c, _n in children] == ["Anthracite", "SubBituminous", "DieselDO"]


def test_bands_are_complete_and_monotonic():
    assert set(bau.BANDS) == {"low", "central", "high"}
    assert bau.BAND_CASES == ("low", "central", "high")
    for key in bau.BANDS["central"]:
        vals = [bau.BANDS[b][key] for b in bau.BAND_CASES]
        assert vals == sorted(vals), (key, vals)
    # the band values the driver table fixes (inputs.md 4)
    assert bau.BANDS["central"] == {"elec": 10.0, "grid2030": 0.55, "steel_Mt": 2.5,
                                    "clinker_Mt": 7.38, "waste": 1.0, "rice": 0.0, "pop": 0.8,
                                    "elasticity": 0.7}
    assert (bau.BANDS["low"]["grid2030"], bau.BANDS["high"]["grid2030"]) == (0.50, 0.60)
    assert (bau.BANDS["low"]["elec"], bau.BANDS["high"]["elec"]) == (8.0, 11.0)


def test_scenarios_are_one_per_run_and_band():
    assert [(r, c) for _n, _a, r, c in bau.SCENARIOS] == [
        ("A", "central"), ("B", "low"), ("B", "central"), ("B", "high")]
    names = [n for n, *_ in bau.SCENARIOS]
    assert len(names) == len(set(names))


def test_case_expressions_follow_the_band():
    assert bau.elec_expr("A", "central") is None          # Run A keeps ver1's per-row rates
    assert bau.elec_expr("B", "low") == "Growth(8.0%)"
    assert bau.elec_expr("B", "high") == "Growth(11.0%)"
    assert bau.grid_expr("A", "high") == "0.6592"
    assert bau.grid_expr("B", "high") == "Interp(2023,0.6592,2030,0.6)"
    assert bau.steel_cap_expr("low") == "2000000"
    assert bau.clinker_act_expr("low") == "6620000"
    assert bau.clinker_act_expr("high") == "8140000"
    # banded non-energy growth: waste and rice follow the band, IPPU does not
    assert bau.band_b_expr("MSW_4A1", "high", "Growth(1%)") == "Growth(2.0%)"
    assert bau.band_b_expr("Rice_3C7", "low", "Growth(0%)") == "Growth(-1.0%)"
    assert bau.band_b_expr("2A1_cement", "low", "Growth(0%)") == "Growth(0%)"


def test_banded_rows_are_real_non_energy_rows():
    rows = {n for _c, n, *_ in bau.NONENERGY_EFFECTS}
    assert set(bau.BANDED_B_GROWTH) <= rows


def test_result_unit_prefers_the_variables_own_unit():
    class V:
        DefaultResultUnit = "tCO2e"

    class W:
        DefaultResultUnit = ""

    class X:
        pass

    assert bau.result_unit(V()) == "tCO2e"
    assert bau.result_unit(W()) == "TONNE"
    assert bau.result_unit(X()) == "TONNE"


def test_fuel_picker_prefers_exact_names():
    available = ["Anthracite", "Sub-Bituminous", "Diesel DO", "Diesel", "Electricity", "Fuel Oil"]
    assert bau.pick_fuel(available, ["Diesel"]) == ("Diesel", "exact")
    assert bau.pick_fuel(available, ["DieselDO", "Diesel DO"]) == ("Diesel DO", "exact")
    assert bau.pick_fuel(available, ["Sub-bituminous"]) == ("Sub-Bituminous", "exact")
    assert bau.pick_fuel(available, ["Electricity"]) == ("Electricity", "exact")
    assert bau.pick_fuel(available, ["Residual Fuel Oil"]) == ("Fuel Oil", "fuzzy")
    assert bau.pick_fuel(available, ["Kerosene"]) == (None, None)


def test_offline_check_passes():
    assert bau.run_check() == 0


# PV1 row 28 declares the 1A3 fuel columns in 1000 lít: D xăng (gasoline),
# E dầu DO (diesel), F dầu FO (fuel oil). The literals are row 30 (1A3b road) and
# row 33 (1A3dii inland waterway); the builder enters litres.
PV1_TRANSPORT_BASE_KILO_LITRES = {
    "Road_1A3b": {"Gasoline": 39406.0, "Diesel": 276360.0, "FuelOil": 1971.0},
    "Waterborne_1A3dii": {"Gasoline": 1100.0, "Diesel": 173533.0, "FuelOil": 47419.0},
}
# PV2 B3:B7 literals (MWh): agriculture, industry, commercial, residential, other.
PV2_ELECTRICITY_BASE = {
    "Agriculture": 178668,
    "IndustryElec": 11423637,
    "Commercial": 491889,
    "Households": 5009135,
    "OtherElec": 391391,
}


def test_transport_bases_match_workbook_literals():
    for leaf, fuels in PV1_TRANSPORT_BASE_KILO_LITRES.items():
        entered = bau.TRANSPORT_BASE_LITRES[leaf]
        assert set(entered) == set(fuels)
        for fuel, kilo in fuels.items():
            assert entered[fuel] == pytest.approx(kilo * 1000.0)


def test_transport_children_exist_for_every_based_fuel():
    for leaf, fuels in bau.TRANSPORT_BASE_LITRES.items():
        children = {s for s, _c, _n in bau.FUEL_CHILDREN[leaf]}
        assert set(fuels) <= children


def test_electricity_bases_cover_all_five_pv2_rows():
    """Purchased electricity lives on the Scope2 non-energy rows, not as demand branches: LEAP's own
    electricity factor is static and not ours, so the grid series has to be an explicit expression."""
    rows = {name: base for cat, name, base, _u, _ea, _eb, _pol, _fac, _note in bau.NONENERGY_EFFECTS
            if cat == "Scope2"}
    assert rows == {("Elec_" + k): v for k, v in PV2_ELECTRICITY_BASE.items()}
    # inputs.csv row 44: the five bases are Hang's 17 494 720 MWh city total.
    assert sum(rows.values()) == 17494720
    assert not [p for p, unit, *_ in bau.DEMAND_CATS if unit == "MWh"]


def test_scope2_rows_keep_ver1s_uplift_and_the_band_rate():
    """Run A carries her x1.15 from 2026 (2030 = literal x 1.15 x (1+rate)^5), Run B does not."""
    rates = {"Elec_Households": 0.13, "Elec_Commercial": 0.109, "Elec_Agriculture": 0.02,
             "Elec_IndustryElec": 0.152, "Elec_OtherElec": 0.13}
    seen = set()
    for cat, name, base, _u, ea, eb, _pol, _fac, _note in bau.NONENERGY_EFFECTS:
        if cat != "Scope2":
            continue
        seen.add(name)
        # Run B no longer carries a shared marker: each row names its own band key (BANDED_B_GROWTH)
        assert eb is None, name
        assert name in bau.BANDED_B_GROWTH, name
        with_uplift = base * 1.15 * (1 + rates[name]) ** 5
        assert bau.evaluate_activity(ea, base, bau.COMPARE_YEAR) == pytest.approx(with_uplift, rel=1e-6)
        assert bau.evaluate_activity(ea, base, bau.BASE_YEAR) == pytest.approx(base)
        for case in bau.BAND_CASES:
            b = bau.expand(bau.band_b_expr(name, case, None), "grdp", case)
            key = bau.BANDED_B_GROWTH[name]
            if key == "elasticity":
                assert b.startswith("GrowthAs("), b
                rate = (1 + bau.GRDP_RATE) ** bau.BANDS[case]["elasticity"] - 1
            else:
                assert b == "Growth({}%)".format(bau.BANDS[case][key]), b
                rate = bau.BANDS[case][key] / 100.0
            # Run B has no uplift: its 2030 value is the literal grown at the band's rate alone
            assert bau.evaluate_activity(b, base, bau.COMPARE_YEAR) == pytest.approx(
                base * (1 + rate) ** 5)
    assert seen == set(rates)


def test_scope2_rows_map_to_the_scope_2_references():
    for cat, name, *_rest in bau.NONENERGY_EFFECTS:
        if cat != "Scope2":
            continue
        ref = bau.gpc_ref("Non Energy" + "\\" + cat + "\\" + name)
        assert ref in ("I.1.2", "I.2.2", "I.3.2", "I.5.2", "I.6.2"), (name, ref)


def test_other_electricity_maps_to_non_specified_sources():
    assert bau.gpc_ref("Demand\\OtherElec") == "I.6.2"


def test_industrial_wastewater_row_carries_ver1_4D2():
    """ver1 4D2 = PV1 U151 31 073.69388 t CH4 = W151 870 063.4285 tCO2e; the builder omitted it."""
    rows = {name: (base, fac) for _cat, name, base, _u, _ea, _eb, pol, fac, _n in bau.NONENERGY_EFFECTS
            if pol == "Methane"}
    base, fac = rows["Wastewater_4D2_industrial"]
    assert base * fac * 28 == pytest.approx(870063.4285, rel=1e-6)
    # 4D1 (domestic) stays exactly ver1's U149/V149: CH4 659 190 + N2O 144 822.5 = W149 803 940.5714
    gases = {"Methane": 28.0, "Nitrous Oxide": 265.0}
    dom = 0.0
    for _cat, name, base, _u, _ea, _eb, pol, fac, _n in bau.NONENERGY_EFFECTS:
        if name.startswith("Wastewater_4D_"):
            dom += base * fac * gases[pol]
    assert dom == pytest.approx(803940.5714, rel=1e-3)


def test_waste_and_afolu_rows_are_present():
    names = {name for _cat, name, *_ in bau.NONENERGY_EFFECTS}
    assert {"MSW_4A1", "Biological_4B", "Incineration_4C1", "Wastewater_4D_CH4",
            "Wastewater_4D_N2O", "Wastewater_4D2_industrial"} <= names
    assert {"Rice_3C7", "Livestock_3A", "Urea_3C3", "Liming_3C2"} <= names


GASES = {"Carbon Dioxide": 1.0, "Methane": 28.0, "Nitrous Oxide": 265.0}


def _row_emissions(prefix, year):
    """tCO2e for every non-energy row whose branch starts with `prefix`."""
    total = 0.0
    for _cat, name, base, _u, ea, _eb, pol, fac, _n in bau.NONENERGY_EFFECTS:
        if not name.startswith(prefix):
            continue
        rate = 0.0
        if ea.startswith("Growth("):
            rate = float(ea[len("Growth("):-2].rstrip("%")) / 100.0
        total += base * (1 + rate) ** (year - 2025) * fac * GASES[pol]
    return total


# ver1 cells (FINDINGS.md 1): PV1 totals, and the flat-row figures from the source sheets.
VER1_IPPU_2030 = {"2A1_cement": 8724187.987, "2A2_lime": 576215.9845,
                  "2A3_glass": 199776.3801, "2C1_steel": 631267.3528}
VER1_FLAT_2025 = {"Rice_3C7": 1213558.163, "Livestock_3A": 76193.6 + 116657.54,
                  "Urea_3C3": 18069.33333, "Liming_3C2": 668.25,
                  "Biological_4B": 5127.52, "Incineration_4C1": 609925.2261,
                  "Wastewater_4D_CH4": 659190.0, "Wastewater_4D_N2O": 546.2285714 * 265.0,
                  "Wastewater_4D2_industrial": 870063.4285}
# Landfill is the one row with a ver1 trajectory: 2025 = PV1 L136, 2030 = Q136 (year-keyed row 135).
VER1_MSW_2030 = 752905.7415


@pytest.mark.parametrize("prefix,expected", sorted(VER1_IPPU_2030.items()))
def test_ippu_reproduces_ver1_2030(prefix, expected):
    assert _row_emissions(prefix, 2030) == pytest.approx(expected, rel=2e-3)


@pytest.mark.parametrize("prefix,expected", sorted(VER1_FLAT_2025.items()))
def test_flat_rows_reproduce_ver1_2025(prefix, expected):
    assert _row_emissions(prefix, 2025) == pytest.approx(expected, rel=2e-3)


def test_afolu_and_waste_run_a_is_flat_like_ver1():
    """ver1 writes a growth rate for IPPU only; every AFOLU/Waste activity is a literal
    except landfill, whose series PV1 L136-Q136 keys 2025 = 1 204 135 and 2030 = 1 446 405.32."""
    for cat, name, _base, _u, ea, _eb, _pol, _fac, _n in bau.NONENERGY_EFFECTS:
        if cat in ("AFOLU", "Waste"):
            assert ea in ("Growth(0%)", "Growth(3.7347%)"), (name, ea)


def test_landfill_reproduces_ver1_2030():
    assert _row_emissions("MSW_4A1", 2030) == pytest.approx(VER1_MSW_2030, rel=2e-3)
    assert _row_emissions("MSW_4A1", 2025) == pytest.approx(1204135 * 0.01859 * 28, rel=1e-3)


def test_transport_uses_ver1_rate_and_plants_use_ver1s_single_step():
    rates = {path.split("\\")[-1]: ea for path, _u, _b, ea, _eb in bau.DEMAND_CATS}
    assert rates["Road_1A3b"] == "Growth(10.9%)"
    assert rates["Waterborne_1A3dii"] == "Growth(10.9%)"
    # plant children are set per scenario, not through DEMAND_CATS
    for plant in bau.PLANT_SHARE:
        assert plant not in rates or rates[plant] is None


def test_plant_step_reproduces_ver1s_2030_feedstock():
    """PV1 row 7: 5070185*1.05, 4036716*1.05, 1155*1.05 (1000 litres). A compounding Growth(5%)
    would give x1.276 and inflate 1A1 by ~4.7 Mt at 2030."""
    expr = bau.plant_expr("A", bau.PLANT_FUEL_BASE["Anthracite"])
    assert bau.evaluate_activity(expr, bau.PLANT_FUEL_BASE["Anthracite"], 2030) == pytest.approx(
        bau.PLANT_FUEL_BASE["Anthracite"] * 1.05)
    assert bau.evaluate_activity(expr, bau.PLANT_FUEL_BASE["Anthracite"], 2025) == pytest.approx(
        bau.PLANT_FUEL_BASE["Anthracite"])
    assert bau.evaluate_activity(expr, bau.PLANT_FUEL_BASE["Anthracite"], 2050) == pytest.approx(
        bau.PLANT_FUEL_BASE["Anthracite"] * 1.05)
    # the three plants together carry the whole fleet's feedstock, share by share
    for suffix, ver1_2030 in (("Anthracite", 5323694.25), ("SubBituminous", 4238551.8),
                              ("DieselDO", 1212750.0)):
        total = sum(bau.evaluate_activity(bau.plant_expr("A", bau.PLANT_FUEL_BASE[suffix] * s),
                                          bau.PLANT_FUEL_BASE[suffix] * s, 2030)
                    for s in bau.PLANT_SHARE.values())
        assert total == pytest.approx(ver1_2030, rel=1e-6), suffix
    assert bau.plant_expr("B", 1.0) == "Growth(0%)"


def test_root_resolution_matches_leap_templates_names():
    """The area template (masterstructure.nx1) names roots in words: "Key Assumptions", "Non Energy"."""
    assert bau.pick_root(["Key Assumptions", "Demand", "Resources"], bau.ROOT_CANDIDATES["key"]) == \
        "Key Assumptions"
    assert bau.pick_root(["Non Energy", "Demand"], bau.ROOT_CANDIDATES["nonenergy"]) == "Non Energy"
    # case-insensitive and falls back to the shorthand if a build ever names them that way
    assert bau.pick_root(["nonenergy"], bau.ROOT_CANDIDATES["nonenergy"]) == "nonenergy"
    assert bau.pick_root(["Demand"], bau.ROOT_CANDIDATES["key"]) is None


def test_key_assumptions_define_both_referenced_variables():
    defined = {n for n, _u, _v, _note in bau.KEY_ASSUMPTIONS}
    assert {"GRDP_Index", "GridEF"} <= defined
    # every key assumption carries a unit and a value for the Current Accounts entry
    for name, unit, value, _note in bau.KEY_ASSUMPTIONS:
        assert unit and isinstance(value, (int, float)), name


def test_run_a_electricity_reproduces_ver1_pv2_cells():
    """PV2 B3:B7 cached values: literal x 1.15 x (1+rate)^5, on the Scope2 rows."""
    ver1 = {"Households": 10613357.52, "Commercial": 948904.88, "Agriculture": 226853.4953,
            "IndustryElec": 26654137.28, "OtherElec": 829279.43}
    seen = set()
    for cat, name, base, _unit, ea, _eb, _pol, _fac, _note in bau.NONENERGY_EFFECTS:
        if cat != "Scope2":
            continue
        leaf = name[len("Elec_"):]
        seen.add(leaf)
        assert bau.evaluate_activity(ea, base, bau.COMPARE_YEAR) == pytest.approx(
            ver1[leaf], rel=1e-6), leaf
    assert seen == set(ver1)          # a name change must not silently empty this test


def test_run_a_transport_reproduces_ver1_row30_cells():
    """PV1 row 30: literal x (1.109)^5, in thousand litres."""
    ver1_kilo = {"Gasoline": 66102.83469, "Diesel": 463588.7782, "FuelOil": 3306.315972}
    ea = [x for p, _u, _b, x, _eb in bau.DEMAND_CATS if p.endswith("Road_1A3b")][0]
    for fuel, kilo in ver1_kilo.items():
        litres = bau.TRANSPORT_BASE_LITRES["Road_1A3b"][fuel]
        assert bau.evaluate_activity(ea, litres, bau.COMPARE_YEAR) / 1000.0 == pytest.approx(kilo)


def test_evaluate_activity_handles_every_form_the_builder_emits():
    assert bau.evaluate_activity("Growth(10%)", 100.0, 2030) == pytest.approx(100 * 1.1 ** 5)
    assert bau.evaluate_activity("Growth(13%)*1.15", 100.0, 2030) == pytest.approx(100 * 1.13 ** 5 * 1.15)
    assert bau.evaluate_activity("GrowthAs(x, 0.7)", 100.0, 2030) == pytest.approx(
        100 * (1 + bau.GRDP_RATE) ** (0.7 * 5))  # LEAP Help24: index raised to the elasticity, 10.41 %/yr
    assert bau.evaluate_activity("Interp(2025,100,2030,200,2050,300)", 0.0, 2027) == pytest.approx(140.0)
    assert bau.evaluate_activity(None, 100.0, 2030) is None
    for leaf in bau.RUN_B_1A2_MT:
        expr = bau.run_b_1a2_expression(leaf)
        assert expr.startswith(f"Interp({bau.BASE_YEAR},")
        assert bau.evaluate_activity(expr, 1.0, bau.BASE_YEAR) is not None


def test_gwp_aliases_cover_every_pollutant_the_builder_enters():
    """A spelled-out effect name must still receive its AR5 value (LEAP's own naming is unverified)."""
    names = {pol.upper() for _c, _n, _b, _u, _ea, _eb, pol, _f, _note in bau.NONENERGY_EFFECTS}
    assert names <= set(bau.GWP_ALIASES)
    for spelled in ("CARBON DIOXIDE", "METHANE", "NITROUS OXIDE"):
        assert bau.GWP_ALIASES[spelled] == bau.GWP_AR5[{"CARBON DIOXIDE": "CO2", "METHANE": "CH4",
                                                       "NITROUS OXIDE": "N2O"}[spelled]]
    # and the old formula-only test really would have missed these names
    for spelled, formula in (("CARBON DIOXIDE", "CO2"), ("METHANE", "CH4"), ("NITROUS OXIDE", "N2O")):
        assert formula not in spelled


def test_run_b_industry_fuel_uses_ver1_anthracite_pair():
    """ver1's 1A2 sheet lists the EFs but no consumption: 98.3 tCO2/TJ at 26.7 TJ/Gg."""
    assert bau.A2A_COAL_T_PER_T_CO2 == pytest.approx(98.3 * 26.7 / 1000.0)
    # each branch's 2025 tCO2e converts back exactly through that pair
    for _leaf, (mt, _driver) in bau.RUN_B_1A2_MT.items():
        tonnes = mt * 1e6 / bau.A2A_COAL_T_PER_T_CO2
        assert tonnes * bau.A2A_COAL_T_PER_T_CO2 / 1e6 == pytest.approx(mt)


def test_run_b_industry_split_matches_the_r3_subsector_emissions():
    """inputs.csv rows 15-20: 4.73 + 2.55 + 2.09 = 9.37 Mt CO2e at 2025, less 4.10 Mt BF coke moved to 2C1."""
    assert dict((k, v[0]) for k, v in bau.RUN_B_1A2_MT.items()) == {
        "Steel_1A2a": 0.63, "CementFuels_1A2f": 2.55, "Other_1A2": 2.09}
    assert sum(mt for mt, _d in bau.RUN_B_1A2_MT.values()) == pytest.approx(5.27)
    assert {d for _m, d in bau.RUN_B_1A2_MT.values()} == {"CAP", "ELASTIC"}


def test_run_b_steel_counts_bf_coke_once():
    """City 1A2a 4.73 Mt holds 4.10 Mt BF coke/coal; 2C1 at 2.5 Mt x 1.46 carries it, so 1A2a + 2C1 = 4.73 + 3.65 - 4.10."""
    steel_2c1 = bau.BANDS["central"]["steel_Mt"] * bau.B_STEEL_FACTOR
    assert steel_2c1 == pytest.approx(3.65)
    assert bau.RUN_B_1A2_MT["Steel_1A2a"][0] + steel_2c1 == pytest.approx(4.73 + 3.65 - 4.10)


def test_run_b_industry_2030_endpoint():
    """Capped branches stay flat; other industry follows GRDP x 0.7 to 2030, not to 2050."""
    f = bau.A2A_COAL_T_PER_T_CO2
    for _leaf, (mt, driver) in bau.RUN_B_1A2_MT.items():
        v25 = mt * 1e6 / f
        rate = bau.GRDP_RATE * bau.BANDS["central"]["elasticity"] if driver == "ELASTIC" else 0.0
        v30 = v25 * (1 + rate) ** (bau.COMPARE_YEAR - bau.BASE_YEAR)
        if driver == "CAP":
            assert v30 == pytest.approx(v25)
        else:
            # GRDP x elasticity as a compounded rate over the five years to 2030 (~1.64, not the
            # 1.152^17.5 the pre-fix code produced by compounding to the 2050 area horizon)
            assert v30 / v25 == pytest.approx(
                (1 + bau.GRDP_RATE * bau.BANDS["central"]["elasticity"]) ** (bau.COMPARE_YEAR - bau.BASE_YEAR))
            assert v30 / v25 == pytest.approx(1.152 ** 3.5, rel=0.02)
            assert v30 / v25 != pytest.approx(1.152 ** 17.5, rel=1e-3)
        assert v25 * f / 1e6 == pytest.approx(mt)


def test_check_rejects_a_malformed_inputs_csv(tmp_path, monkeypatch):
    """An unquoted comma shifts every later column of a row; the schema check must catch it."""
    bad = tmp_path / "inputs.csv"
    good = pathlib.Path(bau.INPUTS_CSV).read_text(encoding="utf-8").splitlines()
    body = good[:2]
    body.append("B,Demand|Industry|Steel (1A2a),Activity,1,t,2025,merged,I.3.1,note with, a comma,hang")
    body.append("B,Somewhere,Thing,1,t,2025,elsewhere,I.3.1,note,hang")
    bad.write_text("\n".join(body) + "\n", encoding="utf-8")
    monkeypatch.setattr(bau, "INPUTS_CSV", str(bad))
    errs = []
    bau.check_inputs_csv(errs)
    assert any("unquoted comma" in e for e in errs)
    assert any("territory" in e for e in errs)
    assert bau.run_check() == 1


def test_check_accepts_the_real_inputs_csv():
    errs = []
    bau.check_inputs_csv(errs)
    assert errs == []


def test_committed_activity_fixture_is_current(tmp_path):
    """Golden file: expected_activity.csv must be exactly what the code produces today.

    A stale fixture would have the licensed session diffing LEAP's output against superseded numbers,
    which is worse than having no fixture at all.
    """
    out = tmp_path / "expected_activity.csv"
    bau.run_expect(str(out))
    committed = pathlib.Path(bau.HERE) / "expected_activity.csv"
    assert out.read_bytes() == committed.read_bytes(), "regenerate with --expect and commit it"



def test_run_a_hits_ver1s_tonghop_2030_per_non_energy_sector():
    """The brief's Steering (3) anchor: "per sector, Run A must hit ver1 Tong-hop column C (2025) and
    column E (2030)". 2030 must match within rounding; the two 2025 rows that do not are ver1's own
    calc-sheet-versus-Tong-hop disagreements, listed in FINDINGS.md rather than hidden here."""
    totals = bau.run_a_sector_totals()
    for sector, (_c2025, e2030) in bau.VER1_TONGHOP.items():
        if e2030 is None:
            continue
        ours = totals[sector][1]
        assert ours == pytest.approx(e2030, rel=5e-5), (sector, ours, e2030)


def test_run_a_hits_ver1s_tonghop_2025_where_ver1_is_self_consistent():
    """IPPU and Scope 2 match her 2025 column exactly; AFOLU and Waste do not, and those are her
    inconsistencies (see FINDINGS.md), so they are asserted as deviations rather than parity."""
    totals = bau.run_a_sector_totals()
    for sector in ("IPPU", "Scope2"):
        ours = totals[sector][0]
        # 2030 matches to 5e-5; 2025 carries ver1's own rounding through her factor cells, so 2e-4
        assert ours == pytest.approx(bau.VER1_TONGHOP[sector][0], rel=2e-4), (sector, ours)
    # 2025 against her *detail* sheets, which is what the builder reproduces; her Tong-hop column C is
    # the outlier for these two sectors (see FINDINGS.md), so the ratios to C are asserted as such.
    assert totals["Waste"][0] == pytest.approx(bau.VER1_DETAIL["Waste"]["2025"], rel=1e-3)
    assert totals["AFOLU"][0] == pytest.approx(bau.VER1_DETAIL["AFOLU"]["2030"], rel=1e-4)
    for sector, expected_ratio in (("AFOLU", 0.811), ("Waste", 1.250)):
        ratio = totals[sector][0] / bau.VER1_TONGHOP[sector][0]
        assert ratio == pytest.approx(expected_ratio, abs=0.002), (sector, ratio)


def test_elasticity_varies_by_band_and_matches_the_csv_prose():
    """The elasticity is a band parameter, not a fixed 0.7: the orchestrator ruled on 2026-10-10 that
    low/central/high carry 0.6/0.7/0.8, which is what inputs.csv's row already said in its own name
    ("central; low 0.6 high 0.8"). A band that stopped varying it would make the three B scenarios
    share one growth rate for every elasticity-driven row, including Scope2's commercial, agriculture
    and other."""
    key = bau.ROOT_CANDIDATES["key"][0] + chr(92) + "GRDP_Index"
    exprs = {band: bau.expand("ELASTIC", key, band) for band in bau.BAND_CASES}
    assert len(set(exprs.values())) == 3, exprs
    for band, elasticity in (("low", 0.6), ("central", 0.7), ("high", 0.8)):
        assert exprs[band].endswith(f", {elasticity})"), (band, exprs[band])
        assert bau.BANDS[band]["elasticity"] == elasticity


def test_ncvs_match_ver1s_energy_rows():
    """Each NCV is her own energy row divided by her own activity row, so it is checkable arithmetic.

    1A3 sheet: gasoline 2,184.55326 TJ / 66,102.83469 thousand litres; diesel 16,744.82667 /
    463,588.7782; fuel oil 132.3729888 / 3,306.315972. 1A1 sheet: the "Nhiet tri (TJ/Gg)" row gives
    26.7 / 18.9 for the coals. A wrong per-litre value is invisible in the fixture but scales a whole
    fuel's energy, so it is pinned here rather than left to the comment."""
    ncv = bau.FUEL_NCV_TJ_PER_UNIT
    assert ncv["Gasoline"] == pytest.approx(2184.55326 / 66102.83469 / 1000, rel=1e-4)
    assert ncv["Diesel"] == pytest.approx(16744.82667 / 463588.7782 / 1000, rel=1e-4)
    assert ncv["FuelOil"] == pytest.approx(132.3729888 / 3306.315972 / 1000, rel=1e-4)
    assert ncv["Anthracite"] == pytest.approx(26.7 / 1000, rel=1e-9)
    assert ncv["SubBituminous"] == pytest.approx(18.9 / 1000, rel=1e-9)


def test_2030_demand_energy_matches_ver1s_energy_rows():
    """The demand model's output is energy, and ver1's sheets carry her own "Nang luong quy doi (TJ)"
    rows, so the whole chain - quantity x NCV x growth - is checkable against her numbers rather than
    against itself.

    1A1 sheet: 142,142.6365 TJ anthracite and 80,108.62902 TJ sub-bituminous at 2030 (her stepped
    quantities 5,323,694.25 t and 4,238,551.8 t). 1A3 sheet: 2,184.55326 TJ gasoline, 16,744.82667 TJ
    diesel and 132.3729888 TJ fuel oil for road transport.
    """
    ncv = bau.FUEL_NCV_TJ_PER_UNIT
    # coal fleet: base x 1.05 step x NCV
    anthracite = bau.PLANT_FUEL_BASE["Anthracite"] * 1.05 * ncv["Anthracite"]
    subbit = bau.PLANT_FUEL_BASE["SubBituminous"] * 1.05 * ncv["SubBituminous"]
    assert anthracite == pytest.approx(142142.6365, rel=1e-5)
    assert subbit == pytest.approx(80108.62902, rel=1e-5)
    # road transport: 2025 litres x 1.109^5 x NCV
    road = bau.TRANSPORT_BASE_LITRES["Road_1A3b"]
    assert road["Gasoline"] * 1.109 ** 5 * ncv["Gasoline"] == pytest.approx(2184.55326, rel=1e-4)
    assert road["Diesel"] * 1.109 ** 5 * ncv["Diesel"] == pytest.approx(16744.82667, rel=1e-4)
    assert road["FuelOil"] * 1.109 ** 5 * ncv["FuelOil"] == pytest.approx(132.3729888, rel=1e-4)


def test_pre_run_prediction_matches_ver1s_co2_rows():
    """A prediction, not a result: our energy x IPCC default factors against her own CO2 rows.

    Road transport should land within 0.05 % and the coal fleet within 1 % - if the licensed run comes
    back far outside that, the difference is LEAP's factor data and is worth explaining in COMPARISON.md;
    if it comes back exactly on top, the tool effect is nil.
    """
    ncv, ef = bau.FUEL_NCV_TJ_PER_UNIT, bau.IPCC_CO2_T_PER_TJ
    fleet = sum(bau.PLANT_FUEL_BASE[f] * 1.05 * ncv[f] * ef[f] for f in bau.PLANT_FUEL_BASE)
    assert fleet == pytest.approx(21768884.89, rel=0.01)
    road = bau.TRANSPORT_BASE_LITRES["Road_1A3b"]
    co2 = sum(road[f] * 1.109 ** 5 * ncv[f] * ef[f] for f in road)
    assert co2 == pytest.approx(1402426.866, rel=5e-4)


def test_every_documented_command_runs(tmp_path):
    """The README tells a reader which commands to run; this runs them.

    Offline ones must succeed. The two COM ones must fail cleanly with the interpreter named, which is
    what a licence-day user sees if they pick the wrong python - not a traceback.
    """
    import os
    import subprocess
    import sys

    here = pathlib.Path(bau.HERE)
    env = dict(os.environ)
    # keep the offline commands inside a temp area so nothing is written into the folder
    ok = subprocess.run([sys.executable, "build_leap_bau.py", "--check"], cwd=here, env=env,
                        capture_output=True, text=True)
    assert ok.returncode == 0, ok.stdout[-300:]
    assert "CHECK OK" in ok.stdout

    # write the checklist to a temp path: a test must not overwrite the golden fixture in the repo
    expect = subprocess.run([sys.executable, "build_leap_bau.py", "--expect",
                             "--out", str(tmp_path / "expected.csv")],
                            cwd=here, env=env, capture_output=True, text=True)
    assert expect.returncode == 0, expect.stdout[-300:]
    assert "expected activity rows" in expect.stdout

    refs = subprocess.run([sys.executable, "compare.py", "--verify-references"], cwd=here, env=env,
                          capture_output=True, text=True)
    assert refs.returncode in (0, 1), refs.stdout[-300:]
    assert "reference rows" in refs.stdout

    # Never drive the real LEAP from a test: on an interpreter with pywin32 these commands would use the
    # API on the locked copy (forbidden by LEAP's terms) and --build would write an area. Only the
    # wrong-interpreter path (no win32com -> exit 2, interpreter named) is exercised here.
    import importlib.util
    if importlib.util.find_spec("win32com") is not None:
        return
    for flag in ("--dump", "--build", "--verify-activity"):
        com = subprocess.run([sys.executable, "build_leap_bau.py", flag], cwd=here, env=env,
                             capture_output=True, text=True)
        # either pywin32 is missing (2, with the interpreter named) or LEAP answers; never a traceback
        assert "Traceback" not in com.stderr, com.stderr[-300:]
        assert com.returncode in (0, 2, 3, 4), com.returncode


def test_check_rejects_a_typo_in_the_status_vocabulary(monkeypatch, tmp_path):
    """Steering (2) names 'judgement-placeholder' explicitly, so a typo here would put the CSV and the
    documents out of step with nothing raising."""
    csv_path = tmp_path / "inputs.csv"
    rows = pathlib.Path(bau.HERE, "inputs.csv").read_text(encoding="utf-8").splitlines()
    rows[1] = rows[1].replace(",hang", ",judgment")      # the American spelling, a plausible slip
    csv_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    monkeypatch.setattr(bau, "HERE", str(tmp_path))
    monkeypatch.setattr(bau, "INPUTS_CSV", str(csv_path), raising=False)
    errs = []
    bau.check_inputs_csv(errs)
    assert any("not one of" in e and "judgment" in e for e in errs), errs


def test_doc_lint_catches_a_citation_that_does_not_resolve(tmp_path, monkeypatch, capsys):
    """check_docs is a lint, not a test of behaviour: it warns about the two prose defects that were found
    by hand and cost time - a citation to a file or step that is not there, and a blank line inside a
    sentence. It must stay a warning, so it can never block a run, and it must allow the one file the run
    is supposed to write."""
    # nest two deep so `../../CLAUDE.md` lands inside tmp_path rather than in the system temp dir
    here = tmp_path / "tool-comparison" / "leap"
    here.mkdir(parents=True)
    (here / "good.md").write_text("see `good.md` 1\n", encoding="utf-8")
    (here / "bad.md").write_text("see `nowhere.md` 2\n\n" + "a sentence that is broken" + "\n\n" +
                                 "in the middle of itself\n", encoding="utf-8")
    (here / "README.md").write_text("76 rows, 54 expressions\n", encoding="utf-8")
    monkeypatch.setattr(bau, "__file__", str(here / "build_leap_bau.py"))
    bau.check_docs(rows=[1] * 76, n_expr=54)
    out = capsys.readouterr().out
    assert "cites nowhere.md" in out, out
    assert "blank line inside a sentence" in out, out
    assert "good.md" not in out, out
    # the count check compares the README's stated counts with what --check just printed
    bau.check_docs(rows=[1] * 75, n_expr=54)
    out = capsys.readouterr().out
    assert "README says" in out and "counts 75 rows" in out, out
    # a citation to a file at the repo root is legitimate and must stay quiet
    (here / ".." / ".." / "CLAUDE.md").write_text("law\n", encoding="utf-8")
    (here / "root.md").write_text("see `CLAUDE.md` for the law\n", encoding="utf-8")
    bau.check_docs(rows=[1] * 76, n_expr=54)
    out = capsys.readouterr().out
    assert "CLAUDE.md" not in out, out
    # a README written with LF while the citing document uses CRLF must still resolve its steps: the
    # check has to split each file on its own newline, or it sees one enormous line and reports every
    # step as missing
    # step 8 is the second line, so a one-line split cannot match it by accident
    (here / "README.md").write_bytes(b"7. Reconcile the base\n8. Run compare.py\n")
    (here / "steps.md").write_bytes(b"see README step 8\r\n")
    bau.check_docs(rows=[1] * 76, n_expr=54)
    out = capsys.readouterr().out
    assert "README step 8" not in out, out


def test_check_rejects_a_row_that_disagrees_with_its_constant():
    """Five facts live twice - a constant the expressions read, and an inputs.csv row a reader reads.
    REQUIRED_SNIPPETS only required the rows to exist, so editing one left the CSV describing a rate or a
    cap the model does not use. Every pair in CHECKED_INPUT_VALUES must be caught."""
    base = bau.load_inputs()          # the builder's own reader, so the test sees what the check sees
    # keys are prefixes of the CSV's parameter strings, so every one must still match a real row
    for prefix in bau.CHECKED_INPUT_VALUES:
        assert any(r["parameter"].strip().startswith(prefix) for r in base), f"no row starts with {prefix!r}"
    # the elasticity row states its band values in its own name, and all three must match BANDS
    elastic = [r for r in base if r["parameter"].strip().startswith("Other-industry elasticity")][0]
    # the name carries low and high; central is the row's own value
    for stated, band in (("0.6", "low"), ("0.8", "high")):
        assert stated in elastic["parameter"], (band, elastic["parameter"])
        assert bau.BANDS[band]["elasticity"] == float(stated)
    assert bau.BANDS["central"]["elasticity"] == float(elastic["value"])
    for parameter, (want, label) in bau.CHECKED_INPUT_VALUES.items():
        rows = [dict(r) for r in base]
        target = next(r for r in rows if r["parameter"].strip().startswith(parameter))
        target["value"] = str(want + 1)
        errs = []
        bau.check_input_values_agree(errs, rows)
        assert any(parameter in e for e in errs), (parameter, label, errs)
    # and the band figures the elasticity row states in its own name must match BANDS for all three
    rows = [dict(r) for r in base]
    target = next(r for r in rows if r["parameter"].strip().startswith("Other-industry elasticity"))
    target["parameter"] = target["parameter"].replace("high 0.8", "high 0.9")
    errs = []
    bau.check_input_values_agree(errs, rows)
    assert any("high 0.9" in e for e in errs), errs
