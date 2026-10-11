"""Build Hai Phong BAU in LEAP via COM API - prepared; needs a registered licence to run.

Area: HaiPhong_BAU (override with --area). Base year 2025, end year 2050, first scenario year 2026.
Data source: inputs.csv in this folder (Phase 2 map; every value cites file+sheet+cell).

Usage (run with an interpreter that can import win32com.client - see README "Which python"; the
build sets AreaCountry to Viet Nam itself, and the GWP report must read AR5 excluding climate-carbon
feedbacks because Current Accounts' AR setting overrides the GWP100 values this build pins):
  python build_leap_bau.py --dump             # read-only inventory of a live area
  python build_leap_bau.py --check            # offline: validates inputs.csv and the model
  python build_leap_bau.py --expect           # offline: writes expected_activity.csv (--out <path>)
  python build_leap_bau.py --build            # COM build + Calculate + results.csv + raw/
  python build_leap_bau.py --verify-activity  # after --build: diff LEAP's activity against the fixture
  python compare.py                           # three views against the reference series

Scenarios: one per (run, band) - `A_Hang_AsFiled`, `B_low`, `B_central`, `B_high`.

Views are sums over branch sets of the same numbers and are applied by compare.py from each row's GPC
reference (never by adding two views together, and never by duplicating scenarios):
  territorial  = demand fuel + the coal plants' fuel + IPPU/AFOLU/waste; purchased electricity is memo.
  GPC BASIC+   = the same minus the plants, plus purchased electricity (the Scope2 rows).
  as filed     = all three, which is Hang's own scope 1 + scope 2 sum - the double count, kept visible.
"""
from __future__ import annotations

import argparse
import csv
import os
import pathlib
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INPUTS_CSV = os.path.join(HERE, "inputs.csv")
RESULTS_CSV = os.path.join(HERE, "results.csv")

AREA = "HaiPhong_BAU"
BASE_YEAR = 2025
COMPARE_YEAR = 2030
END_YEAR = 2050
FIRST_SCEN_YEAR = 2026

GRDP_RATE = 0.152          # the city's GRDP rate in Hang's file (PV2 D4 "15.2% / năm")

KEY_ASSUMPTIONS = [
    ("Population", "Capita", 5000000, "inputs.csv B Population 2025; ver1 PV1 D150+E150"),
    ("GRDP_Index", "Index", 100, "runs A+B GRDP 15.2pct; base index 100"),
    ("Elasticity_OtherInd", "Ratio", 0.7, "B central 0.7 (low 0.6 high 0.8); A uses 1.0"),
    # LEAP units are simple names, so the grid factor carries "Tonne" and its per-MWh meaning is in
    # the note (and in how the Scope2 rows use it); a compound unit string is what the unit check in
    # --build exists to catch.
    ("GridEF", "Tonne", 0.6592, "tCO2e per MWh; B 2023 official; A flat +x1.15 on demand side"),
    ("SteelCap_Mt", "Mt", 2.5, "B central cap; Hoa Phat Hai Duong rated (S06)"),
    ("ClinkerCap_Mt", "Mt", 10.18, "B GEM capacity 5 plants; output=cap x utilisation"),
    ("ElecGrowth", "%", 10, "B PDP8 central (low 8 high 11); A uses PV2 sector rates"),
]

DEMAND_CATS = [
    (r"Demand\Industry\Steel_1A2a", "tonne", None, "Growth(15.2%)", "Growth(0%)"),
    (r"Demand\Industry\CementFuels_1A2f", "tonne", None, "Growth(15.2%)", None),
    (r"Demand\Industry\Other_1A2", "TJ", None, "Growth(15.2%)", "ELASTIC"),
    # Run A = ver1's own trajectory (FINDINGS.md 2): transport 10.9 %/yr (PV1 rows 30/33) and
    # the plants' one 5 % step (PV1 row 7) as the only rate her file states; electricity is
    # per-row as PV2 declares. Run B is the corrected per-sector driver.
    (r"Demand\Transport\Road_1A3b", "litre", None, "Growth(10.9%)", "ELASTIC"),
    (r"Demand\Transport\Waterborne_1A3dii", "litre", None, "Growth(10.9%)", "ELASTIC"),
    # Purchased electricity is not a demand branch: `ILEAPFuel` carries no emission factor (only
    # density, energy and carbon content), so a demand row would take its CO2 from LEAP's own
    # electricity factor - static, not ours, and impossible to vary by scenario or band. It is entered
    # as non-energy rows under Scope2 instead, with the grid factor as a scenario expression.
    # The coal plants' per-fuel children are given their expressions in the plants block (ver1's
    # single 5 % step in Run A, flat in Run B), so these rows carry no expression of their own.
    (r"Demand\Plants1A1\Coal_HP_TPP", "tonne", None, None, None),
    (r"Demand\Plants1A1\Coal_HD_TPP", "tonne", None, None, None),
    (r"Demand\Plants1A1\Coal_PhaLai", "tonne", None, None, None),
]

# 2025 (base-year) transport activity, entered on each fuel child. PV1 row 28 declares
# the 1A3 columns in 1000 lít (D xăng/gasoline, E dầu DO/diesel, F dầu FO/fuel oil);
# the literals are row 30 (1A3b road) and row 33 (1A3dii inland waterway), converted
# here to litres, which is the branch's activity unit.
TRANSPORT_BASE_LITRES = {
    "Road_1A3b": {"Gasoline": 39406000.0, "Diesel": 276360000.0, "FuelOil": 1971000.0},
    "Waterborne_1A3dii": {"Gasoline": 1100000.0, "Diesel": 173533000.0, "FuelOil": 47419000.0},
}

# Run B has to put back the factory fuel that ver1 leaves empty (its 1A2 sheet is all zeros), and
# Current Accounts must stay ver1-faithful, so the 1A2 activity has to live in the B scenario. The
# emissions are r3's 9.4 Mt split by subsector (inputs.csv rows 15-20, from the 1,959-firm survey:
# reports/2026-10-06-hp-1A2-round2-update.csv sum E by sector). The survey carries no fuel column and
# ver1's 1A2 sheet lists five fuel EFs but no consumption, so the conversion uses anthracite's own
# pair from that sheet (98.3 tCO2/TJ x 26.7 TJ/Gg = 2.62461 tCO2 per tonne) — an all-coal
# placeholder, labelled, and the one thing to revisit if a fuel split ever lands.
A2A_COAL_T_PER_T_CO2 = 98.3 * 26.7 / 1000.0          # tCO2 per tonne of anthracite
RUN_B_1A2_MT = {                                     # subsector 2025 emissions, Mt CO2e, and driver
    # city 1A2a 4.73 minus the 4.10 Mt BF coke/coal that 2C1 already carries in 2.5 Mt x 1.46 (brief, GACMO 0.626)
    "Steel_1A2a": (0.63, "CAP"),
    "CementFuels_1A2f": (2.55, "CAP"),
    "Other_1A2": (2.09, "ELASTIC"),
}

PLANT_SHARE = {"Coal_HP_TPP": 1200.0/3440, "Coal_HD_TPP": 1200.0/3440, "Coal_PhaLai": 1040.0/3440}

# 2025 coal-plant feedstock, PV1 row 7 ("1A1ai Sản xuất điện", all thermal plants):
#   D7 = 5070185*1.05  than antraxit (tấn)      -> base-year 5 070 185 t
#   E7 = 4036716*1.05  than sub-bitum (tấn)     -> base-year 4 036 716 t
#   G7 = 1155*1.05     dầu diesel DO (1000 lít) -> base-year 1 155 thousand litres
# The literal inside each formula is the base-year activity and the x1.05 is ver1's
# one-year step, the same convention Run A uses for steel (D55 = 5185608*(1.152)^5)
# and cement (D45) — there the literal is entered unchanged. Dividing the literal
# again (the earlier revision) entered 2024 levels and understated 1A1 by ~4.8 %,
# roughly 1.1 Mt CO2e, with no error raised.
PLANT_FUEL_BASE = {"Anthracite": 5070185.0, "SubBituminous": 4036716.0, "DieselDO": 1155000.0}
# PV1 G5 declares thousand litres, so DO needs its own activity unit; the coals are
# tonnes like their parent branch. AddTechnology takes AcUnit per technology.
CHILD_UNIT = {"DieselDO": "litre"}
# Net calorific values, TJ per activity unit, from ver1's own sheets. PV1's 1A1 sheet carries
# "Nhiet tri (TJ/Gg)" 26.7 / 18.9 / 42.3 / 43.0 / 40.4 for anthracite, sub-bituminous, crude, diesel and
# fuel oil; the transport sheets carry "Nang luong quy doi (TJ)" beside the volumes, which is where the
# per-litre values come from (gasoline 2,184.55326 TJ / 66,102.83469 thousand litres = 3.3047e-05 TJ/l).
#
# LEAP's Activity Analysis computes energy as activity x energy intensity, and the help is explicit that
# the bottom-level technology branches are where the intensity is entered ("For these bottom-level
# branches, you also define the annual energy intensities per unit of activity level",
# Help24/Demand/Final_Energy_Demand_Analysis.htm). Without one, a fuel child has no energy and the whole
# demand side - 1A1, 1A2, 1A3, 1A4, the bulk of the inventory - reports zero.
FUEL_NCV_TJ_PER_UNIT = {
    "Anthracite": 0.0267,        # TJ per tonne, 26.7 TJ/Gg
    "SubBituminous": 0.0189,     # TJ per tonne, 18.9 TJ/Gg
    "Coal": 0.0267,              # placeholder 1A2 split: anthracite
    "DieselDO": 3.612e-05,       # TJ per litre, 43.0 TJ/Gg and 16,744.82667 TJ / 463,588.7782 kl
    "Diesel": 3.612e-05,
    "Gasoline": 3.3047e-05,      # TJ per litre, 2,184.55326 TJ / 66,102.83469 kl
    "FuelOil": 4.0036e-05,       # TJ per litre, 132.3729888 TJ / 3,306.315972 kl (= 40.4 MJ/kg at 0.991 kg/l)
    "Electricity": 0.0036,       # TJ per MWh, 1 MWh = 3.6 GJ
}
INTENSITY_VARS = ("Final Energy Intensity", "Final Energy Intensity Time Sliced")

# IPCC 2006 default CO2 emission factors, t CO2 per TJ - and ver1's own 1A2 sheet states them outright
# ("HSPT CO2 (kg/TJ)" 98300.0 and 96100.0 for anthracite and sub-bituminous, beside "Nhiet tri (TJ/Gg)"
# 26.7 / 18.9 / 43.0). Used only to predict what the licensed run should produce, so the run-day numbers
# can be read against an expectation rather than admired: our energy x these factors reproduces ver1's
# own CO2 rows to -0.00 % for road transport and -0.43 % for the coal fleet, which is the size of tool
# effect to expect on the demand side if LEAP's factors are the IPCC defaults it documents.
IPCC_CO2_T_PER_TJ = {"Anthracite": 98.3, "SubBituminous": 96.1, "Coal": 98.3, "DieselDO": 74.1,
                     "Diesel": 74.1, "Gasoline": 69.3, "FuelOil": 77.4}
B_STEEL_FACTOR = 1.46      # t CO2 per t steel, BF-BOF, 2026-10-08 evidence
B_CEMENT_FACTOR = 0.52     # t CO2 per t clinker in Run B (ver1 factor 0.4357 is Run A)
FUEL_CHILDREN = {
    "Steel_1A2a": [("Coal", ["Coal Anthracite", "Anthracite", "Coal"], "placeholder: 1A2 by-fuel split TBD; anthracite, as the t/t conversion")],
    "CementFuels_1A2f": [("Coal", ["Coal Anthracite", "Anthracite", "Coal"], "placeholder: kiln fuel split TBD; anthracite, as the t/t conversion")],
    "Other_1A2": [("Coal", ["Coal Anthracite", "Anthracite", "Coal"], "placeholder: fuel mix TBD; anthracite, as the t/t conversion")],
    "Road_1A3b": [("Gasoline", ["Gasoline"], "ver1 PV1 D30 base year (1000 lít)"), ("Diesel", ["Diesel"], "ver1 PV1 E30 base year (1000 lít)"), ("FuelOil", ["Fuel Oil", "Residual Fuel Oil"], "ver1 PV1 F30 base year (1000 lít)")],
    "Waterborne_1A3dii": [("Gasoline", ["Gasoline"], "ver1 PV1 D33 base year (1000 lít)"), ("Diesel", ["Diesel"], "ver1 PV1 E33 base year (1000 lít)"), ("FuelOil", ["Fuel Oil", "Residual Fuel Oil"], "ver1 PV1 F33 base year (1000 lít)")],
    "Coal_HP_TPP": [("Anthracite", ["Anthracite"], "PV1 D7 base year (tấn) x capacity share"), ("SubBituminous", ["Sub-Bituminous", "Sub-bituminous"], "PV1 E7 base year (tấn) x capacity share"), ("DieselDO", ["Diesel"], "PV1 G7 base year (1000 lít) x capacity share")],
    "Coal_HD_TPP": [("Anthracite", ["Anthracite"], "PV1 D7 base year (tấn) x capacity share"), ("SubBituminous", ["Sub-Bituminous", "Sub-bituminous"], "PV1 E7 base year (tấn) x capacity share"), ("DieselDO", ["Diesel"], "PV1 G7 base year (1000 lít) x capacity share")],
    "Coal_PhaLai": [("Anthracite", ["Anthracite"], "PV1 D7 base year (tấn) x capacity share"), ("SubBituminous", ["Sub-Bituminous", "Sub-bituminous"], "PV1 E7 base year (tấn) x capacity share"), ("DieselDO", ["Diesel"], "PV1 G7 base year (1000 lít) x capacity share")],
}

NONENERGY_EFFECTS = [
    # Columns: category, branch, 2025 activity, unit, Run A expression, Run B expression,
    # pollutant, factor, note. Run A now carries ver1's own factor and ver1's own trajectory
    # (see FINDINGS.md): the workbook states a growth rate for IPPU only, and every AFOLU and
    # Waste activity is a flat literal, so Run A is flat there. The earlier revision put
    # Growth(15.2%) on those rows with factors divided by 1.152^5, which matched ver1 at 2030 and
    # was half of it at the base year.
    ("IPPU", "2A1_cement", 9867911, "tonne", "Growth(15.2%)", "Growth(0%)", "Carbon Dioxide", 0.43575, "A ver1 PV1 T44/act2030 = 0.43575 (literal*(1.152)^5); B act=clinker 7.38Mt"),
    ("IPPU", "2A2_lime", 377162, "tonne", "Growth(15.2%)", "ELASTIC", "Carbon Dioxide", 0.7530, "A ver1 PV1 T46/act2030 = 0.75300; B TBD rule"),
    ("IPPU", "2A3_glass", 586101, "tonne", "Growth(15.2%)", "ELASTIC", "Carbon Dioxide", 0.1680, "A ver1 PV1 T48/act2030 = 0.16800; B TBD rule"),
    ("IPPU", "2C1_steel", 5185608, "tonne", "Growth(15.2%)", "Growth(0%)", "Carbon Dioxide", 0.06, "A EAF 0.06 (2C1!M3); B 1.46 override"),
    ("AFOLU", "Rice_3C7", 117808, "ha", "Growth(0%)", "Growth(0%)", "Methane", 0.3679, "A ver1 3C7 U124 43341.36 t CH4 / 117808 ha, flat (E125+F125); B area kept"),
    ("AFOLU", "Livestock_3A", 29243700, "head", "Growth(0%)", "Growth(0%)", "Methane", 0.0002355, "A ver1 W70+W82 = 192851.1 tCO2e / head / 28, flat; species split and manure N2O not separated (FINDINGS.md 2)"),
    ("AFOLU", "Urea_3C3", 24640, "tonne", "Growth(0%)", "Growth(0%)", "Carbon Dioxide", 0.7333, "A ver1 3C3 EF 0.2 tC/t x 3.6667 (QĐ 2626), flat literal"),
    ("AFOLU", "Liming_3C2", 1500, "tonne", "Growth(0%)", "Growth(0%)", "Carbon Dioxide", 0.4455, "A ver1 3C2 0.85x0.12 + 0.15x0.13 tC/t x 3.6667, flat literal"),
    ("Waste", "MSW_4A1", 1204135, "tonne", "Growth(3.7347%)", "Growth(1%)", "Methane", 0.01859, "A 2025 = ver1 PV1 L136 1204135 t (year-keyed row 135), 2030 = Q136 1446405.32 t = 3.7347%/yr; 0.01859 tCH4/t is her U130 26889.49 t CH4 / the 2030 input, reproducing W130 752905.74 exactly; B per-cap"),
    ("Waste", "Biological_4B", 29200, "tonne", "Growth(0%)", "Growth(1%)", "Methane", 0.004, "A ver1 4B EF 4.0 gCH4/kg, flat (80x365)"),
    ("Waste", "Biological_4B_N2O", 29200, "tonne", "Growth(0%)", "Growth(1%)", "Nitrous Oxide", 0.00024, "A ver1 4B EF 0.24 gN2O/kg (U142/V142)"),
    ("Waste", "Incineration_4C1", 955546, "tonne", "Growth(0%)", "Growth(1%)", "Carbon Dioxide", 0.63617, "A ver1 PV1 G145/955546, flat literals (4C1 row 146)"),
    ("Waste", "Incineration_4C1_CH4", 955546, "tonne", "Growth(0%)", "Growth(1%)", "Methane", 1.2e-06, "A ver1 H145 1.146924 t CH4"),
    ("Waste", "Incineration_4C1_N2O", 955546, "tonne", "Growth(0%)", "Growth(1%)", "Nitrous Oxide", 8.2e-06, "A ver1 I145 7.837314 t N2O"),
    ("Waste", "Wastewater_4D_CH4", 5000000, "person", "Growth(0%)", "Growth(0.8%)", "Methane", 0.0047085, "A ver1 U149/5M, flat (D150/E150); B tracks pop"),
    ("Waste", "Wastewater_4D_N2O", 5000000, "person", "Growth(0%)", "Growth(0.8%)", "Nitrous Oxide", 0.0001093, "A ver1 V149/5M, flat; B tracks pop"),
    # ver1 4D2 = 31 073.69388 t CH4 (PV1 U151) = 870 063.43 tCO2e (W151), built there from 15
    # industrial production volumes x wastewater coefficients. LEAP models non-energy rows as
    # activity x factor, so the total is spread per capita: judged proxy, and population growth is
    # an honest stand-in only while industry has no activity driver of its own.
    ("Waste", "Wastewater_4D2_industrial", 5000000, "person", "Growth(0%)", "Growth(0.8%)", "Methane", 0.006214738776, "ver1 4D2 31073.69 t CH4 x 28, flat; per-capita proxy (judgement)"),
]

# Purchased electricity (PV2 B3:B7) is entered as non-energy rows rather than demand branches:
# `ILEAPFuel` carries no emission factor, so a demand row would take its CO2 from LEAP's own static
# electricity factor. Activity is MWh, the factor is the grid emission factor, and the factor is a
# scenario expression pointing at Key Assumptions\GridEF, so the falling series and the band are real.
# Run A reproduces ver1's own cells: 2025 is her plain literal (her x1.15 applies from 2026, so
# multiplying the whole series would lift the base year), and 2030 is her cached column value.
VER1_PV2_2030 = {"Elec_Households": 10613357.52, "Elec_Commercial": 948904.88,
                 "Elec_Agriculture": 226853.4953, "Elec_IndustryElec": 26654137.28,
                 "Elec_OtherElec": 829279.43}
SCOPE2_BASES = [("Elec_Households", 5009135, "PV2 B6"), ("Elec_Commercial", 491889, "PV2 B5"),
                ("Elec_Agriculture", 178668, "PV2 B3"), ("Elec_IndustryElec", 11423637, "PV2 B4"),
                ("Elec_OtherElec", 391391, "PV2 B7")]


def _scope2_run_a_expression(row_name, base):
    """Interp(2025 literal, 2030 ver1 cell, 2050 same rate) - her uplift lands from 2026, not on 2025."""
    v30 = VER1_PV2_2030[row_name]
    v50 = base * (v30 / base) ** ((END_YEAR - BASE_YEAR) / (COMPARE_YEAR - BASE_YEAR))
    return (f"Interp({BASE_YEAR},{base:.2f},{COMPARE_YEAR},{v30:.2f},{END_YEAR},{v50:.2f})")


for _name, _base, _cell in SCOPE2_BASES:
    NONENERGY_EFFECTS.append(("Scope2", _name, _base, "MWh",
                              _scope2_run_a_expression(_name, _base), None,
                              "Carbon Dioxide", 0.6592,
                              f"{_cell}; Run A = ver1 literal to her 2030 cell, factor = GridEF"))

# Bands from the evidence driver table (inputs.csv rows 37-45, inputs.md 4): population 0.5/0.8/1.0,
# grid 2030 0.50/0.55/0.60 tCO2e/MWh, electricity 8/10/11 %/yr, steel cap 2.0/2.5/2.5 Mt, clinker
# output 6.62/7.38/8.14 Mt, waste flat/+1/+2 %/yr, rice -1/flat/+0.5 %/yr.
BANDS = {
    "low": {"elec": 8.0, "grid2030": 0.50, "steel_Mt": 2.0, "clinker_Mt": 6.62,
            "waste": 0.0, "rice": -1.0, "pop": 0.5, "elasticity": 0.6},
    "central": {"elec": 10.0, "grid2030": 0.55, "steel_Mt": 2.5, "clinker_Mt": 7.38,
                "waste": 1.0, "rice": 0.0, "pop": 0.8, "elasticity": 0.7},
    "high": {"elec": 11.0, "grid2030": 0.60, "steel_Mt": 2.5, "clinker_Mt": 8.14,
             "waste": 2.0, "rice": 0.5, "pop": 1.0, "elasticity": 0.8},
}
BAND_CASES = ("low", "central", "high")

# One scenario per (run, band). The two reporting views - territorial (transformation counted once,
# scope 2 memo only) and GPC BASIC+ (transformation out, purchased electricity in) - are sums over
# different branch sets of the same numbers, so they are applied at comparison time (see
# FINDINGS.md) rather than by duplicating scenarios with identical data.
SCENARIOS = [
    ("A_Hang_AsFiled", "A_filed", "A", "central"),
    ("B_low", "B_low", "B", "low"),
    ("B_central", "B_cent", "B", "central"),
    ("B_high", "B_high", "B", "high"),
]

# Non-energy rows whose Run B growth is a band parameter rather than a fixed corrected rate.
# The five Scope2 rows used to share one PDP8 rate - which is what the
# orchestrator ruled against on 2026-10-10: PDP8's ~10 %/yr is mostly *industrial* demand growth, so
# applying it to households overstates their growth. Each row now names its own driver:
#   IndustryElec  the PDP8 band rate (8/10/11 %/yr), the ruling's "industry on PDP8"
#   Households    population + urbanisation (0.5/0.8/1.0 %/yr), labelled judgement, as GACMO does
#   the other three  GRDP x elasticity (0.6/0.7/0.8), labelled judgement-placeholder per Steering (2)
BANDED_B_GROWTH = {
    "Elec_Households": "pop", "Elec_Commercial": "elasticity", "Elec_Agriculture": "elasticity",
    "Elec_IndustryElec": "elec", "Elec_OtherElec": "elasticity",
    "MSW_4A1": "waste", "Biological_4B": "waste", "Biological_4B_N2O": "waste",
    "Incineration_4C1": "waste", "Incineration_4C1_CH4": "waste", "Incineration_4C1_N2O": "waste",
    "Wastewater_4D_CH4": "pop", "Wastewater_4D_N2O": "pop", "Wastewater_4D2_industrial": "pop",
    "Rice_3C7": "rice",
}


def elec_expr(run, case, row_name=None):
    """Run A keeps ver1's own per-row rates (set in DEMAND_CATS); Run B uses the row's own band key.

    `row_name` is what makes this per-row: without it the caller is asking for the old shared PDP8
    rate, which is only correct for Elec_IndustryElec.
    """
    if run == "A":
        return None
    key = BANDED_B_GROWTH.get(row_name, "elec") if row_name else "elec"
    if key == "elasticity":
        return "GrowthAs({}, {})".format("Key Assumptions" + chr(92) + "GRDP_Index",
                                         BANDS[case]["elasticity"])
    return "Growth({}%)".format(BANDS[case][key])


def grid_expr(run, case):
    return "0.6592" if run == "A" else "Interp(2023,0.6592,2030,{})".format(BANDS[case]["grid2030"])


def plant_expr(run, value):
    """Coal-plant feedstock per child.

    Run A carries ver1's own projection: PV1 row 7 reads `literal * 1.05`, a single step, so 2030 is
    the literal x 1.05 and it stays there (a `Growth(5%)` would compound to x1.276 and inflate 1A1 by
    ~4.7 Mt at 2030). Run B holds the fleet flat, which is the corrections' own "no new coal".
    """
    if run == "B":
        return "Growth(0%)"
    stepped = value * 1.05
    # full precision on the first point: LEAP's help for Interp says the base-year value "is always
    # implicit ... and will override any value explicitly entered for that year", so a rounded start
    # would put a step between the Current Accounts value and the scenario path
    return (f"Interp({BASE_YEAR},{value:.4f},{COMPARE_YEAR},{stepped:.4f},{END_YEAR},{stepped:.4f})")


def steel_cap_expr(case):
    return str(int(BANDS[case]["steel_Mt"] * 1e6))


def clinker_act_expr(case):
    return str(int(BANDS[case]["clinker_Mt"] * 1e6))


def band_b_expr(row_name, case, default):
    key = BANDED_B_GROWTH.get(row_name)
    if key is None:
        return default
    if key == "elasticity":
        # GRDP x elasticity is LEAP's own GrowthAs, so the band's elasticity is what varies
        return f"GrowthAs(Key Assumptions{chr(92)}GRDP_Index, {BANDS[case]['elasticity']})"
    return f"Growth({BANDS[case][key]}%)"

# Decree 06 wants AR5 (IPCC 2013); ver1's own sheets carry the same set (1 / 28 / 265, sheet 4B's GWP
# block). GWP_AR5 is the single source for those three numbers; the alias table below spells them out
# for LEAP's Effects list, which may name a pollutant by formula or in words, and a test keeps the two
# in agreement.
GWP_AR5 = {"CO2": 1.0, "CH4": 28.0, "N2O": 265.0}
GWP_ALIASES = {
    "CO2": GWP_AR5["CO2"], "CARBON DIOXIDE": GWP_AR5["CO2"],
    "CH4": GWP_AR5["CH4"], "METHANE": GWP_AR5["CH4"],
    "N2O": GWP_AR5["N2O"], "NITROUS OXIDE": GWP_AR5["N2O"],
}

RESULT_COLS = ["tool", "scenario", "case", "sector", "gpc_ref", "year", "co2e_t",
               "territory", "source"]

# Steering(2) asks for judgement placeholders to be labelled in results.csv's `source`, not only in the
# input map: a driver still TBD enters as GRDP x 0.7, and the plant split and the all-coal 1A2 fill are
# judgements too. This is that label, keyed by the branch path prefix it applies to.
PLACEHOLDER_BRANCHES = (
    "Demand" + chr(92) + "Transport",          # TBD driver -> GRDP x 0.7
    "Demand" + chr(92) + "Industry",           # 1A2 fuel mix (all-coal) and its split
    "Demand" + chr(92) + "Plants1A1",          # capacity-share split of the fleet's fuel
    "Non Energy" + chr(92) + "IPPU" + chr(92) + "2A2",   # lime/glass driver TBD
    "Non Energy" + chr(92) + "IPPU" + chr(92) + "2A3",
)

SOURCE_BASE = "inputs.csv Phase2 map"
SOURCE_PLACEHOLDER = "inputs.csv Phase2 map; judgement-placeholder"


def result_source(branch_path):
    for prefix in PLACEHOLDER_BRANCHES:
        if branch_path.startswith(prefix):
            return SOURCE_PLACEHOLDER
    return SOURCE_BASE


def load_inputs():
    with open(INPUTS_CSV, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_inputs_raw():
    with open(INPUTS_CSV, encoding="utf-8") as f:
        return list(csv.reader(f))


def check_inputs_csv(errs):
    """Schema, vocabulary, uniqueness and field count for the Phase 2 map."""
    raw = load_inputs_raw()
    if not raw:
        errs.append("inputs.csv is empty")
        return
    if raw[0] != INPUT_COLUMNS:
        errs.append(f"inputs.csv header is {raw[0]}, expected {INPUT_COLUMNS}")
        return
    seen = set()
    for line_no, fields in enumerate(raw[1:], start=2):
        if len(fields) != len(INPUT_COLUMNS):
            errs.append(f"inputs.csv line {line_no} has {len(fields)} fields, expected "
                        f"{len(INPUT_COLUMNS)} (unquoted comma in a note?)")
            continue
        row = dict(zip(INPUT_COLUMNS, fields, strict=False))
        if row["run"] not in REQUIRED_RUNS:
            errs.append(f"inputs.csv line {line_no} run {row['run']!r} not in "
                        f"{sorted(REQUIRED_RUNS)}")
        if row["territory"] not in TERRITORY_TAGS:
            errs.append(f"inputs.csv line {line_no} territory {row['territory']!r} not one of "
                        f"{list(TERRITORY_TAGS)}")
        for field in ("source", "status", "branch", "parameter"):
            if not row[field].strip():
                errs.append(f"inputs.csv line {line_no} has an empty {field}")
        if row["status"].strip() and row["status"] not in STATUS_VALUES:
            errs.append(f"inputs.csv line {line_no} status {row['status']!r} not one of "
                        f"{list(STATUS_VALUES)}")
        key = (row["run"], row["branch"], row["parameter"])
        if key in seen:
            errs.append(f"inputs.csv line {line_no} duplicates {key}")
        seen.add(key)
        ref = row["gpc_ref"].strip()
        if ref and not re.match(GPC_REF_PATTERN, ref):
            errs.append(f"inputs.csv line {line_no} gpc_ref {ref!r} is not a GPC reference "
                        "(or its .x shorthand)")


REQUIRED_RUNS = {"A", "B"}
# inputs.csv is hand-maintained provenance, so its schema and vocabulary are checked, not assumed:
# an unquoted comma inside a note silently shifts every later column of that row.
INPUT_COLUMNS = ["run", "branch", "parameter", "value", "unit", "basis_year", "territory",
                 "gpc_ref", "source", "status"]
TERRITORY_TAGS = ("merged", "hp_legacy", "hd_legacy")
# The provenance vocabulary the map uses. Steering (2) names one of these explicitly
# ("label it judgement-placeholder"), so a typo here would make the CSV and the documents disagree.
STATUS_VALUES = ("hang", "corrected", "judgement", "judgement-placeholder", "hang-gap",
                 "hang-carried-open-question")
GPC_REF_PATTERN = r"^(I|II|III|IV|V)(\.(\d+|x)){1,2}$"
REQUIRED_SNIPPETS = [
    "GRDP growth rate", "Grid emission factor", "Steel output cap",
    "Clinker capacity cap", "Plant capacities HP TPP", "Demand growth to 2030",
    "Clinker output = capacity x utilisation", "2025 territorial total",
]
ALLOWED_FUNCS = ("Growth(", "GrowthAs(", "Interp(", "If(", "Step(")


def check_expression(expr):
    problems = []
    if expr is None:
        return problems
    if expr in ("ELASTIC", "CLINKER"):
        return problems
    if expr.count("(") != expr.count(")"):
        problems.append(f"unbalanced parens: {expr!r}")
    if not expr.startswith(ALLOWED_FUNCS) and "*1.15" not in expr:
        try:
            float(expr)
        except ValueError:
            problems.append(f"unknown function form: {expr!r}")
    return problems


def expand(expr, grdp_path, case="central"):
    if expr == "ELASTIC":
        return f"GrowthAs({grdp_path}, {BANDS[case]['elasticity']})"
    if expr == "CLINKER":
        return "Growth(0%)"
    return expr


# ver1's own Tong-hop sheet, columns C (2025) and E (2030), t CO2e - the anchor the brief's Steering
# (3) sets for Run A: "per sector, Run A must hit ver1 Tong-hop column C (2025) and column E (2030)".
# Extracted from the workbook by this folder (see FINDINGS.md 2 for the cell references), rows 5, 6 and the IPPU/Scope2
# rows). Used by `run_check` to prove Run A is ver1-native rather than merely labelled so.
# ver1's own detail sheets, at their own years - the figures her Tong-hop column C disagrees with for
# AFOLU and Waste (see FINDINGS.md). Waste 2025 is her 4A1/4B/4C1/4D at the 2025 input (PV1 L136
# 1,204,135 t against the 2030 Q136 1,446,405 t), which is what the builder reproduces.
VER1_DETAIL = {
    "Waste": {"2025": 2915757.0, "2030": 3041962.488},
    "AFOLU": {"2030": 1425146.889},
}

VER1_TONGHOP = {
    "IPPU": (4993546.65, 10131447.7),
    "AFOLU": (1756384.43, 1425146.889),
    "Waste": (2332499.14, 3041962.488),
    "Scope2": (11532519.42, None),
}


def run_a_sector_totals():
    """Our Run A non-energy sector totals in t CO2e, from the builder's own tables and expressions.

    Offline: the row factors are per gas tonne, so each row is activity x factor x AR5 GWP, which is
    what the fold writes into LEAP's single non-energy loading variable.
    """
    totals = {}
    for cat, _nm, base, _unit, ea, _eb, pol, fac, _note in NONENERGY_EFFECTS:
        gwp = gwp_of(pol)
        for year, key in ((BASE_YEAR, 0), (COMPARE_YEAR, 1)):
            value = evaluate_activity(ea, base, year)
            if value is None:
                continue
            bucket = totals.setdefault(cat, [0.0, 0.0])
            bucket[key] += value * fac * gwp
    return totals


def gwp_of(pollutant):
    """The AR5 GWP of the gas a non-energy row reports, so its factor can be expressed in CO2e.

    The row factors in NONENERGY_EFFECTS are per gas tonne (ver1's own sheets: 0.01859 t CH4 per t
    waste, 0.3679 t CH4 per ha of rice), but LEAP's non-energy branch holds the **annual total
    emissions loading** - in CO2e for a GWP effect. Without this multiplication Run A's waste and AFOLU
    came out 10-30x below ver1's own Tong-hop sheet (0.69 Mt against 2.33 Mt at 2025), which is exactly
    what the brief's anchor - Run A must hit her column C and column E per sector - exists to catch.
    """
    text = (pollutant or "").lower()
    if "methane" in text or text.strip() in ("ch4",):
        return GWP_AR5["CH4"]
    if "nitrous" in text or text.strip() in ("n2o",):
        return GWP_AR5["N2O"]
    return GWP_AR5["CO2"]


def check_dead_constants(errs):
    """A module-level name nothing else in the folder references is rot - constants and functions alike.

    Two were found this way: `FAC_VARS` after the non-energy fold replaced it, and `GWP_AR5` when the
    alias table spelled the same numbers out again. This is a lint-style check, not a test of behaviour,
    so it lives in `--check` where the builder validates its own tables.
    """
    import ast
    here = os.path.dirname(os.path.abspath(__file__))
    files = [f for f in sorted(os.listdir(here)) if f.endswith(".py")]
    corpus = ""
    for f in files:
        try:
            corpus += pathlib.Path(here, f).read_text(encoding="utf-8-sig")
        except OSError:
            continue
    for name in ("build_leap_bau.py", "compare.py"):
        try:
            src = pathlib.Path(here, name).read_text(encoding="utf-8-sig")
        except OSError:
            continue
        try:
            tree = ast.parse(src)
        except SyntaxError as exc:
            errs.append(f"{name} does not parse: {exc}")
            continue
        consts = [n.targets[0].id for n in tree.body
                  if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
                  and n.targets[0].id.isupper()]
        dead = sorted(c for c in consts if corpus.count(c) <= 1)
        if dead:
            errs.append(f"{name} has unused module constants: {dead}")
        # functions rot the same way: a refactor can leave one behind, and the corpus includes the test
        # files, so a function only a test calls still counts as used - checked 2026-10-10, both modules
        # were already clean (52 and 18 top-level functions, all referenced)
        funcs = [n.name for n in tree.body if isinstance(n, ast.FunctionDef)]
        dead_funcs = sorted(f for f in funcs if corpus.count(f) <= 1)
        if dead_funcs:
            errs.append(f"{name} has unused module functions: {dead_funcs}")


def check_docs(rows=None, n_expr=None):
    """Lint the folder's own prose for the two defects that were found by hand and cost real time.

    Both are cosmetic but both mislead: a citation to a file or a step that does not exist sends a reader
    looking for something that is not there, and a blank line inside a sentence breaks one paragraph into
    fragments when it renders. One document here had 375 of the second kind. Warnings, not errors - they
    cannot make a run wrong, so they must not block one. Deliberately not checked: whether a stated count
    matches the list under it, which needs reading and is a job for a person.
    """
    import re
    here = pathlib.Path(__file__).resolve().parent
    # COMPARISON.md is the output of run-day step 8: citing it before it exists is the point, not a fault
    written_by_the_run = {"COMPARISON.md"}
    for path in sorted(here.glob("*.md")):
        text = path.read_bytes().decode("utf-8")
        nl = "\r\n" if "\r\n" in text else "\n"      # this file's own newline, not another's
        lines = text.split(nl)
        for i, line in enumerate(lines, 1):
            for target in re.findall(r"`([A-Za-z][A-Za-z0-9_.-]*\.md)`", line):
                in_folder = (here / target).exists()
                # the repo root is a legitimate place to cite from: CLAUDE.md, activeContext.md and the
                # brief's lessons.md all live there and are named by these documents on purpose
                at_root = (here / ".." / ".." / target).exists()
                if not in_folder and not at_root and target not in written_by_the_run:
                    print(f"WARNING: {path.name}:{i} cites {target}, which does not exist", flush=True)
        for i, line in enumerate(lines, 1):
            m = re.search(r"README[^.]*?step (\d+)", line)
            if m:
                # look in the README, not in the file doing the citing - the first version of this check
                # searched its own lines and so reported a step that is plainly there
                # each file is split on its *own* newline: deriving one from the citing file broke this
                # as soon as a document here was written with LF while the rest were CRLF
                readme = here / "README.md"
                raw = readme.read_bytes().decode("utf-8") if readme.exists() else ""
                targets = raw.split("\r\n" if "\r\n" in raw else "\n")
                if not any(re.match(rf"^{m.group(1)}\. ", l) for l in targets):
                    print(f"WARNING: {path.name}:{i} cites README step {m.group(1)}, which is not there",
                          flush=True)
        for i in range(1, len(lines) - 1):
            if lines[i].strip() == "" and lines[i - 1].strip() and lines[i + 1].strip():
                prev, nxt = lines[i - 1].rstrip(), lines[i + 1].lstrip()
                if not prev.endswith((".", ":", "|", "*", ")")) and nxt[:1].islower():
                    print(f"WARNING: {path.name}:{i} has a blank line inside a sentence", flush=True)

    # The README states the counts --check prints, and they are the numbers a reader trusts before a run.
    # They have been edited by hand several times; this is the lint that notices when one is missed.
    if rows is not None and n_expr is not None:
        readme = here / "README.md"
        if readme.exists():
            text = readme.read_bytes().decode("utf-8")
            for m in re.finditer(r"(\d+)\s*rows,\s*(\d+)\s*expressions", text):
                if int(m.group(1)) != len(rows) or int(m.group(2)) != n_expr:
                    print(f"WARNING: README says {m.group(0)!r} but --check counts "
                          f"{len(rows)} rows and {n_expr} expressions", flush=True)


# Facts that live both in a constant here and in an inputs.csv row, where only the constant is read.
# The row is what a reader checks, so the copies have to agree or the CSV describes a model we do not run.
# Keyed by the CSV's own parameter string; values are (constant value, what it is).
# Keyed by a stable prefix of the CSV's parameter string, never the whole string: several of these
# names carry the very value being checked ("(central; low 0.6 high 0.8)"), so an exact key would miss
# exactly when the value had changed - the one case the check exists for.
CHECKED_INPUT_VALUES = {
    "GRDP growth rate": (GRDP_RATE * 100, "GRDP_RATE"),
    "Grid emission factor 2023": (0.6592, "KEY_ASSUMPTIONS GridEF"),
    "Other-industry elasticity to GRDP": (0.7, "KEY_ASSUMPTIONS Elasticity_OtherInd"),
    "Steel output cap": (2.5, "KEY_ASSUMPTIONS SteelCap_Mt"),
    "Clinker capacity cap": (10.18, "KEY_ASSUMPTIONS ClinkerCap_Mt"),
}


def check_input_values_agree(errs, rows):
    """Values that live twice - a constant here, a row in inputs.csv - and were only half-checked.

    `REQUIRED_SNIPPETS` required these rows to *exist* and never to *agree*, so editing one left the CSV
    describing a rate or a cap the model does not use, with `--check` still green. The constants are what
    the expressions read; the rows are what a reader reads."""
    for row in rows:
        parameter = row["parameter"].strip()
        spec = next((v for k, v in CHECKED_INPUT_VALUES.items() if parameter.startswith(k)), None)
        if spec is None:
            continue
        want, label = spec
        try:
            stated = float(row["value"])
        except ValueError:
            errs.append(f"inputs.csv {parameter!r} value {row['value']!r} is not a number")
            continue
        if abs(stated - want) > 1e-9:
            errs.append(f"inputs.csv {parameter!r} is {stated}, but {label} is {want}")
        # The elasticity row states its band values in its own name - "central; low 0.6 high 0.8" -
        # and all three must agree with BANDS, or the CSV describes a band the model does not run.
        # Only this row: other names carry band figures for other parameters (the steel cap's "low
        # 2.0 Mt"), which BANDS holds under their own keys and checks elsewhere.
        if label.endswith("Elasticity_OtherInd"):
            for band, value in re.findall(r"(low|central|high)\s+([0-9.]+)", parameter):
                if band in BANDS and abs(float(value) - BANDS[band]["elasticity"]) > 1e-9:
                    errs.append(f"inputs.csv {parameter!r} says {band} {value}, but BANDS says "
                                f"{BANDS[band]['elasticity']}")


def run_check():
    rows = load_inputs()
    errs = []
    check_inputs_csv(errs)
    check_dead_constants(errs)
    runs = {r["run"] for r in rows}
    if not REQUIRED_RUNS <= runs:
        errs.append("inputs.csv missing runs: %s" % (REQUIRED_RUNS - runs))
    params = " ".join(r["parameter"] for r in rows)
    for s in REQUIRED_SNIPPETS:
        if s not in params:
            errs.append(f"inputs.csv missing: {s}")
    check_input_values_agree(errs, rows)
    n_expr = 0
    for _path, _unit, _base, ea, eb in DEMAND_CATS:
        for e in (ea, eb):
            errs.extend(check_expression(e))
            n_expr += e is not None
    for _cat, _name, _base, _unit, ea, eb, _pol, _fac, _note in NONENERGY_EFFECTS:
        for e in (ea, eb):
            errs.extend(check_expression(e))
            n_expr += e is not None
    sep = chr(92)
    leaves = set()
    for path, _unit, _base, _ea, _eb in DEMAND_CATS:
        leaves.add(path.split(sep)[-1])
    for leaf in FUEL_CHILDREN:
        if leaf not in leaves:
            errs.append("unknown leaf: " + leaf)
    for leaf, fuels in TRANSPORT_BASE_LITRES.items():
        if leaf not in leaves:
            errs.append("TRANSPORT_BASE_LITRES leaf not in DEMAND_CATS: " + leaf)
            continue
        child_names = {s for s, _c, _n in FUEL_CHILDREN.get(leaf, [])}
        missing = set(fuels) - child_names
        if missing:
            errs.append(f"TRANSPORT_BASE_LITRES fuel not a child of {leaf}: {sorted(missing)}")
    for path, cat_unit, _base, ea, eb in DEMAND_CATS:
        if cat_unit != "MWh":
            continue
        if ea is not None and "*1.15" not in ea:
            errs.append(f"Run A scope-2 row lost ver1's x1.15: {path} -> {ea!r}")
        if eb is not None and "*1.15" in eb:
            errs.append(f"Run B scope-2 row must not carry x1.15: {path}")
    if abs(sum(PLANT_SHARE.values()) - 1.0) > 0.001:
        errs.append("PLANT_SHARE sum is not 1")
    plant_suffixes = {s for leaf in PLANT_SHARE for s, _c, _n in FUEL_CHILDREN.get(leaf, [])}
    if plant_suffixes != set(PLANT_FUEL_BASE):
        errs.append(f"PLANT_FUEL_BASE keys {sorted(PLANT_FUEL_BASE)} != plant fuel children {sorted(plant_suffixes)}")
    known_suffixes = {s for entries in FUEL_CHILDREN.values() for s, _c, _n in entries}
    unknown_units = set(CHILD_UNIT) - known_suffixes
    if unknown_units:
        errs.append(f"CHILD_UNIT names unknown technologies: {sorted(unknown_units)}")
    a2_total = sum(mt for mt, _d in RUN_B_1A2_MT.values())
    if abs(a2_total - 5.27) > 0.05:
        errs.append(f"RUN_B_1A2_MT sums to {a2_total:.2f} Mt; r3's 9.37 Mt minus 4.10 Mt BF coke moved to 2C1 is 5.27 Mt")
    for leaf, (_mt, driver) in RUN_B_1A2_MT.items():
        if leaf not in leaves:
            errs.append("RUN_B_1A2_MT leaf not in DEMAND_CATS: " + leaf)
        if driver not in ("CAP", "ELASTIC"):
            errs.append(f"RUN_B_1A2_MT unknown driver {driver!r} on {leaf}")
    errs.extend(check_expression("Interp(2025,1802173,2030,1802173)"))
    for band in BAND_CASES:
        # every Scope2 row's Run B expression, which is per-row now rather than one shared rate
        for _row in sorted(BANDED_B_GROWTH):
            if _row.startswith("Elec_"):
                _e = elec_expr("B", band, _row)
                errs.extend(check_expression(_e) if _e else [])
    key_names = {n for n, _u, _v, _note in KEY_ASSUMPTIONS}
    for needed in ("GRDP_Index", "GridEF"):
        if needed not in key_names:
            errs.append(f"KEY_ASSUMPTIONS must define {needed}: expressions reference it")
    for kind, cands in ROOT_CANDIDATES.items():
        if not cands:
            errs.append(f"ROOT_CANDIDATES[{kind}] is empty")
    keys = set(BANDS["central"])
    for band, params in BANDS.items():
        if set(params) != keys:
            errs.append(f"BANDS[{band}] keys differ from central: {sorted(set(params) ^ keys)}")
    for key in sorted(keys):
        vals = [BANDS[b][key] for b in BAND_CASES]
        if vals != sorted(vals):
            errs.append(f"bands are not monotonic for {key}: {vals}")
    for row_name, key in BANDED_B_GROWTH.items():
        if key not in keys:
            errs.append(f"BANDED_B_GROWTH[{row_name}] names unknown band key {key!r}")
        if row_name not in {n for _c, n, *_ in NONENERGY_EFFECTS}:
            errs.append(f"BANDED_B_GROWTH[{row_name}] is not a non-energy row")
    for name, _abbrev, run, case in SCENARIOS:
        if case not in BANDS:
            errs.append(f"scenario {name} uses unknown band {case}")
        if run not in REQUIRED_RUNS:
            errs.append(f"scenario {name} uses unknown run {run}")
    for case in BAND_CASES:
        for run in ("A", "B"):
            errs.extend(check_expression(grid_expr(run, case)))
            for _row in sorted(BANDED_B_GROWTH):
                if _row.startswith("Elec_"):
                    _e = elec_expr(run, case, _row)
                    errs.extend(check_expression(_e) if _e else [])
    errs.extend(check_expression("Interp(2023,0.6592,2030,0.55)"))
    key_path = ROOT_CANDIDATES["key"][0] + sep + "GRDP_Index"
    g = expand("ELASTIC", key_path)
    if g != "GrowthAs(" + key_path + ", 0.7)":
        errs.append(f"expand() mismatch: {g!r}")
    if expand("CLINKER", key_path) != "Growth(0%)":
        errs.append("expand() CLINKER mismatch")
    for path, _unit, _base, _ea, _eb in DEMAND_CATS:
        if "" in path.split(sep):
            errs.append(f"empty path component (doubled separator): {path!r}")
    for cat, name, *_rest in NONENERGY_EFFECTS:
        if "" in ("NonEnergy" + sep + cat + sep + name).split(sep):
            errs.append(f"empty path component: NonEnergy/{cat}/{name}")
    print(f"inputs.csv rows: {len(rows)} (runs {sorted(runs)})")
    print(f"expression strings validated: {n_expr + 1}")
    check_docs(rows, n_expr + 1)
    print("scenarios planned: {}".format(", ".join(s[0] for s in SCENARIOS)))
    if errs:
        print("CHECK FAILED:")
        for e in errs:
            print("  - " + e)
        return 1
    print("CHECK OK: ready to --build once licensed.")
    return 0


def _iter(com_obj):
    try:
        n = com_obj.Count
    except Exception:
        return []
    out = []
    k = 1
    while k <= n:
        try:
            out.append(com_obj.Item(k))
        except Exception:
            break
        k += 1
    return out


def find_branch(leap, fullname):
    for b in _iter(leap.Branches):
        try:
            if b.FullName == fullname or b.Name == fullname:
                return b
        except Exception:
            continue
    return None


def branch_id(leap, fullname):
    b = find_branch(leap, fullname)
    if b is None:
        actuals = []
        for x in _iter(leap.Branches):
            try:
                actuals.append(x.FullName)
            except Exception:
                pass
        raise RuntimeError(f"branch not found: {fullname!r}; actual: {actuals[:40]}")
    return b.BranchID


def gwp_variable(branch):
    """Return the branch's 100-year GWP loading variable.

    Dictionary v534 spells the integration window as a word. [INSTALL-FILE READ - a withdrawn method,
    see FINDINGS.md 5; kept as attributed provenance, do not repeat the read]
    (`Program Files\\LEAP\\_dictionaryNX.zip` → `dictionary.po`): `Twenty Year GWP …`,
    `One_Hundred Year GWP …`, `Five_Hundred Year GWP …`. Decree 06 needs the 100-year
    column, so match it by name; a bare `Hundred Year GWP` substring test also matches
    `Five_Hundred` and would silently report the wrong column.
    """
    vars_ = []
    for v in _iter(branch.Variables):
        try:
            vars_.append((v.Name, v))
        except Exception:
            continue
    for needle in ("One_Hundred Year GWP", "100 Year GWP", "100-year GWP"):
        for name, v in vars_:
            if needle in name:
                return v
    for name, v in vars_:
        if "Hundred Year GWP" in name and "Five_Hundred" not in name and "Twenty" not in name:
            return v
    raise RuntimeError("no 100-year GWP variable on branch; actual: %s"
                       % [n for n, _ in vars_])


# "Activity Level" is the variable the modeller enters; "Total Activity" is LEAP's own computed result
# ("Calculated total activity: the product of multiplying each chain of activity..."), so it is only a
# fallback - LEAP's shipped dictionary `_dictionaryNX/Variables.nx1` carries both strings with those
# descriptions. [INSTALL-FILE READ - withdrawn method, see FINDINGS.md 5; do not repeat the read] Trying the computed one first would attach the build to a read-only result.
ACT_VARS = ("Activity Level", "Total Activity")
# Non-energy rows are the exception: LEAP's own help (`Help24/Non-Energy/Non-Energy_Sector_Analysis.htm`)
# says an effect branch holds "annual total emissions loadings" and that, unlike an energy demand
# analysis, there is no "product of energy consumption and an emission factor" - so the branch has a
# loading variable, not an activity and not a factor. There is no variable called "Emission Factor"
# anywhere in LEAP either. A row's value is therefore resolved from the activity names *and* the
# loading names, and a row whose branch carries only the loading still resolves instead of dying.
ROW_VARS = ACT_VARS + ("Avg Environmental Loading", "Non Energy Effect Loading",
                       "New Device Environmental Loading")
# Variable names as LEAP actually spells them. The loading/factor variable is NOT called
KEY_VARS = ("Value", "Base Year Value")

# LEAP's area template names its roots in words, not in our shorthand: `masterstructure.nx1` in the
# installed Freedonia sample carries "Key Assumptions", "Demand", "Transformation", "Resources",
# "Indicators", "Non Energy", "Load Shapes", "Effects". The names are resolved at run time rather
# than assumed, and `--dump` prints what the area actually has.
ROOT_CANDIDATES = {
    "key": ("Key Assumptions", "Key", "KeyAssumptions"),
    "nonenergy": ("Non Energy", "NonEnergy", "Non-Energy", "Non-energy"),
}


def pick_root(top_level_names, candidates):
    """First candidate that the area actually has (case-insensitive), else None."""
    lowered = {n.lower(): n for n in top_level_names}
    for cand in candidates:
        if cand.lower() in lowered:
            return lowered[cand.lower()]
    return None


def unit_strings():
    """Every unit name the build passes to LEAP: branch activities, key assumptions and the energy unit."""
    units = {"TJ"}
    units.update(u for _p, u, _b, _ea, _eb in DEMAND_CATS)
    units.update(u for _n, u, _v, _note in KEY_ASSUMPTIONS)
    units.update(u for _c, _n, _b, u, _ea, _eb, _p, _f, _note in NONENERGY_EFFECTS)
    return {u for u in units if u}


def check_units(leap):
    """Report the build's unit strings against LEAP's own unit list.

    A unit LEAP does not know is either a mid-build failure or, worse, a silently different meaning for
    the branch's activity, so it is worth naming before anything is written. Matching is by name or
    abbreviation, case-insensitively; unknown units are reported and the build continues, because LEAP
    accepts custom units and the log is the record.
    """
    known = {}
    classes = {}
    for unit in _iter(leap.Units):
        try:
            name = unit.Name
        except Exception:
            continue
        # LEAPUnit carries UnitClass - "energy, power, mass, volume, area, length, currency, etc."
        # (Help24/API/Units_API.htm) - so a name that resolves to the wrong class is visible here
        classes[name] = getattr(unit, "UnitClass", "")
        known[name.lower()] = name
        abbr = getattr(unit, "Abbreviation", "")
        if abbr:
            known.setdefault(abbr.lower(), name)
    unknown = sorted(u for u in unit_strings() if u.lower() not in known)
    print(f"units: {len(unit_strings())} used, {len(unknown)} not in LEAP's list {unknown}", flush=True)
    resolved = sorted({known[u.lower()] for u in unit_strings() if u.lower() in known})
    print("unit classes: " + ", ".join(f"{u}={classes.get(u, '?')}" for u in resolved), flush=True)
    if unknown:
        print("WARNING: LEAP does not recognise these units; check the branch units in --dump", flush=True)
    return unknown


BASE_SCENARIO_NAMES = ("Current Accounts", "Reference")


def base_scenario_id(leap):
    """Parent id for the new scenarios, preferring LEAP's own flag over a name.

    The B scenarios inherit everything they do not set from Current Accounts, so if LEAP spells its base
    scenario differently - or localises it - a name lookup alone would leave every scenario unparented
    and therefore empty, with nothing raising. `ILEAPScenario.IsCurrentAccounts` is the flag that says
    which one is the base, so it is checked first; the name is the fallback.
    """
    fallback = (0, None)
    for scenario in _iter(leap.Scenarios):
        try:
            if getattr(scenario, "IsCurrentAccounts", False):
                return scenario.ScenarioID, scenario.Name
        except Exception:
            pass
        try:
            if fallback[0] == 0 and scenario.Name in BASE_SCENARIO_NAMES:
                fallback = (scenario.ScenarioID, scenario.Name)
        except Exception:
            continue
    return fallback


def confirm_years(leap):
    """Read the area's years back after setting them, because every expression depends on them.

    LEAP fixes an area's base year once data exists, so a write can be refused or clamped without an
    error. A wrong base year shifts the origin of every Growth/Interp expression, which would show up
    only as numbers the comparison cannot explain - so a base-year or end-year mismatch stops the build
    instead of producing them; the first scenario year is reported but not fatal, since LEAP may clamp
    it for its own reasons.
    """
    wanted = {"BaseYear": BASE_YEAR, "EndYear": END_YEAR}
    wrong = {}
    for attribute, value in wanted.items():
        actual = getattr(leap, attribute, None)
        if actual != value:
            wrong[attribute] = (value, actual)
    first = getattr(leap, "FirstScenarioYear", None)
    print(f"years: base={getattr(leap, 'BaseYear', None)} end={getattr(leap, 'EndYear', None)} "
          f"first_scenario={first}", flush=True)
    if first != FIRST_SCEN_YEAR:
        print(f"WARNING: first scenario year is {first}, wanted {FIRST_SCEN_YEAR}", flush=True)
    if wrong:
        raise RuntimeError(
            f"LEAP did not accept {sorted(wrong)} (wanted, got {wrong}) - every expression's origin "
            "depends on these; build into a fresh area")


def check_effects(leap):
    """Resolve the pollutant names the build passes against LEAP's own effect list.

    Phase 1.1 is entered as non-energy effect rows, and `AddNonEnergySectorEffect` takes the pollutant
    by name - a name LEAP does not have fails mid-build or, worse, lands on a different pollutant, which
    silently changes every GWP in the row. Reported before anything is written, exactly like the units.
    """
    used = sorted({pol for _c, _n, _b, _u, _ea, _eb, pol, _f, _note in NONENERGY_EFFECTS})
    names = {}
    for effect in _iter(leap.Effects):
        try:
            names[effect.Name.lower()] = effect.Name
        except Exception:
            continue
    resolved, unknown = {}, []
    for pollutant in used:
        if pollutant.lower() in names:
            resolved[pollutant] = names[pollutant.lower()]
            continue
        # LEAP splits CO2 into 'Biogenic' / 'Non Biogenic'; a biogenic match would drop the row from the
        # GWP total, so biogenic names are never a substring match and >1 candidate is unresolved.
        matches = [actual for low, actual in names.items()
                   if pollutant.lower() in low and ("biogenic" not in low or "non biogenic" in low)]
        if len(matches) == 1:
            resolved[pollutant] = matches[0]
        else:
            if len(matches) > 1:
                print(f"WARNING: {pollutant!r} is ambiguous in LEAP's list {matches}", flush=True)
            unknown.append(pollutant)
    print(f"effects: {len(used)} used, {len(unknown)} not in LEAP's list {unknown}", flush=True)
    if unknown:
        print("WARNING: LEAP has no pollutant by those names; AddNonEnergySectorEffect will fail",
              flush=True)
    return resolved, unknown


def ensure_area_country(leap):
    """Set the area's country to Viet Nam, which LEAP's country-specific TED fuel data depends on.

    `ILEAPArea.CountryName` is read-only, but `ILEAPApplication.AreaCountry` is get/set, so the build
    does not have to leave this to the operator: the exact spelling is taken from LEAP's own country
    list rather than guessed.
    """
    current = getattr(leap, "AreaCountry", "") or ""
    if current.strip().lower() in ("viet nam", "vietnam"):
        print(f"area country: {current!r}", flush=True)
        return current
    wanted = None
    for country in _iter(leap.Countries):
        try:
            if "viet" in country.Name.lower():
                wanted = country.Name
                break
        except Exception:
            continue
    if wanted is None:
        print("WARNING: no Viet Nam in LEAP's country list - set it in Settings:Scope before "
              "trusting fuel factors", flush=True)
        return current
    leap.AreaCountry = wanted
    print(f"area country set to {wanted!r} (was {current!r})", flush=True)
    return wanted


def top_level_names(leap):
    names = []
    for b in _iter(leap.Branches):
        try:
            full = b.FullName
        except Exception:
            continue
        if chr(92) not in full:
            names.append(full)
    return names


def resolve_root(leap, kind):
    names = top_level_names(leap)
    found = pick_root(names, ROOT_CANDIDATES[kind])
    if found is None:
        raise RuntimeError(f"no {kind} root branch in area; top level is {names} (see ROOT_CANDIDATES)")
    return found


def ensure_key_assumptions(leap, key_root):
    """Create every Key Assumptions branch from KEY_ASSUMPTIONS that the area does not already have.

    Nothing else in the build creates them, yet the scenario expressions reference
    `Key Assumptions\\GRDP_Index` and the grid factor sits there too, so a fresh area would fail at
    the first expression rather than at this step.
    """
    created = []
    root_id = branch_id(leap, key_root)
    for name, unit, _value, _note in KEY_ASSUMPTIONS:
        path = key_root + chr(92) + name
        if find_branch(leap, path) is None:
            leap.AddKeyAssumption(root_id, name, "1", unit)
            created.append(name)
    return created

def _name_key(text):
    """Compare names ignoring case and the separators LEAP varies: space, hyphen, underscore.

    Evidence: LEAP's own fuel list (the sample area's `datanames.nx1`) spells coal as
    "Coal Anthracite" and "Coal Sub bituminous", while our candidates say "Anthracite" and
    "Sub-Bituminous" - the hyphen versus space would defeat a plain substring test.
    """
    return re.sub(r"[\s_\-]+", "", text.lower())


def pick_fuel(available, candidates):
    """Exact match, else normalised substring match; returns (actual_name, how) or (None, None)."""
    lowered = {_name_key(n): n for n in available}
    for c in candidates:
        if _name_key(c) in lowered:
            return lowered[_name_key(c)], "exact"
    # A fuzzy hit must be unique and never a bio-fuel ("Diesel" in "Biodiesel" has no fossil CO2);
    # several hits (e.g. "Coal" in every coal type) is unresolved, so the caller fails with the list.
    for c in candidates:
        key = _name_key(c)
        hits = [actual for low, actual in lowered.items()
                if (key in low or low in key) and ("bio" not in low or "bio" in key)]
        if len(hits) == 1:
            return hits[0], "fuzzy"
    return None, None


def resolve_fuel(leap, candidates):
    """Resolve a fuel by exact name first, then by substring, and say which one it picked.

    The log line matters: a fuzzy hit (e.g. "Diesel" -> LEAP's "Diesel DO") is a silent substitution
    otherwise, and the unit tables in results depend on which fuel was actually attached.
    """
    available = []
    for f in _iter(leap.Fuels):
        try:
            available.append(f.Name)
        except Exception:
            continue
    actual, how = pick_fuel(available, candidates)
    if actual is None:
        raise RuntimeError(f"fuel not found for {list(candidates)}; area has {sorted(available)}")
    if how == "fuzzy":
        print(f"fuel: {list(candidates)!r} -> {actual!r} (fuzzy match, check the unit tables)",
              flush=True)
    return actual


def write_intensity(leap, child_path, suffix):
    """Give a fuel technology its energy intensity, so LEAP's activity x intensity yields energy.

    Returns True when written, False when the fuel has no NCV in the table - which is reported rather
    than guessed, because a silent zero here removes an entire sector from the results.
    """
    ncv = FUEL_NCV_TJ_PER_UNIT.get(suffix)
    if ncv is None:
        print(f"WARNING: no NCV for fuel child {suffix!r} at {child_path} - its energy would be zero",
              flush=True)
        return False
    get_var(leap, child_path, INTENSITY_VARS).Expression = repr(ncv)
    return True


def get_var(leap, branch_path, candidates):
    for c in candidates:
        try:
            return leap.BranchVariable(branch_path + ":" + c)
        except Exception:
            continue
    b = find_branch(leap, branch_path)
    names = []
    if b is not None:
        for v in _iter(b.Variables):
            try:
                names.append(v.Name)
            except Exception:
                pass
    raise RuntimeError(f"no variable match on {branch_path!r} for {list(candidates)}; actual: {names}")


def has_fuel_children(path):
    """True when this demand path is the parent of fuel technology children.

    LEAP multiplies activity levels down the branch to get a device's activity ("The product of these
    terms yields the overall level of activity for a given device", Help24/Demand/Activity_Level.htm), so
    a parent that carried its own absolute *and* gave its children absolutes would square the quantity -
    for road transport that is 3.9e7 x 3.9e7 litres. The parent of a fuel group therefore holds 1 and the
    children hold the quantities, so the product is the quantity itself.
    """
    leaf = path.split(chr(92))[-1]
    if leaf in FUEL_CHILDREN:
        return True
    # the coal plants are a second family: each plant carries one child per fuel (PLANT_FUEL_BASE), so
    # the plant itself is a parent too
    return leaf in PLANT_SHARE


def demand_path(leaf):
    """Full DEMAND_CATS branch path for a leaf name (e.g. 'Road_1A3b')."""
    for path, _unit, _base, _ea, _eb in DEMAND_CATS:
        if path.split(chr(92))[-1] == leaf:
            return path
    raise RuntimeError(f"no DEMAND_CATS branch for leaf {leaf!r}")


def scenario_by_name(leap, name):
    for s in _iter(leap.Scenarios):
        try:
            if s.Name == name:
                return s
        except Exception:
            continue
    return None


def gpc_ref(path):
    """Map a LEAP branch path to the repo's GPC BASIC+ reference number.

    Convention fixed by `src/city_ghg/schema/gpc.py` and
    `docs/methodology-gpc-reference-set.md`: I Stationary Energy, II Transportation,
    III Waste, IV IPPU, V AFOLU; third component is the scope. An earlier revision of
    this file had IPPU and Waste swapped and filed purchased electricity under II.2 —
    both are silent wrong answers, so each branch family is named explicitly here
    instead of being inferred from the sector letter.
    """
    p = path.lower()
    # Stationary Energy (I)
    if "plants1a1" in p:
        return "I.4.1"           # energy industries, scope 1
    if "households" in p:
        return "I.1.2"           # residential buildings, purchased electricity
    if "industryelec" in p:
        return "I.3.2"           # manufacturing industries, purchased electricity
    if "commercial" in p:
        return "I.2.2"           # commercial and institutional buildings
    if "agriculture" in p:
        return "I.5.2"           # agriculture, forestry and fishing activities
    if "otherelec" in p:
        return "I.6.2"           # non-specified sources, purchased electricity
    if "1a2" in p:
        return "I.3.1"           # manufacturing industries, fuel combustion
    # Transportation (II)
    if "road" in p:
        return "II.1.1"
    if "waterborne" in p:
        return "II.3.1"
    # Waste (III) — everywhere generated and treated in the city, so scope 1
    if "4a1" in p:
        return "III.1.1"
    if "4b" in p:
        return "III.2.1"
    if "4c1" in p:
        return "III.3.1"
    if "4d" in p:
        return "III.4.1"
    # IPPU (IV) — two-component reference numbers, no scope component
    if "2a1" in p or "2a2" in p or "2a3" in p or "2c1" in p:
        return "IV.1"
    # AFOLU (V)
    if "livestock" in p:
        return "V.1"
    if "rice" in p or "urea" in p or "liming" in p:
        return "V.3"
    return ""


def _dispatch():
    """Import pywin32 lazily, naming the interpreter when it is missing.

    The folder venv and the project venv are easy to confuse on this machine: `./.venv` from the repo
    root is the project environment, which has no pywin32, while this folder's own venv does. Naming
    `sys.executable` turns a bare ImportError into a one-line diagnosis on licence day.
    """
    try:
        from win32com.client import Dispatch
    except ImportError:
        print(f"needs pywin32: this interpreter is {sys.executable}", flush=True)
        print("   use the venv inside this folder, e.g. "
              ".venv" + chr(92) + "Scripts" + chr(92) + "python.exe build_leap_bau.py --build",
              flush=True)
        return None
    return Dispatch


BUILD_TIMEOUT_SECONDS = 900


def start_watchdog(seconds=BUILD_TIMEOUT_SECONDS):
    """Turn a silent COM hang into a diagnosis.

    LEAP blocks its automation server while a modal dialog is up - an error box, a "save changes?"
    prompt, or (before the licence is registered) the Evaluation Mode notice - and the caller simply
    stops, which is what happened twice while this folder was being built. A watchdog cannot unblock
    COM, but it can say what is wrong and exit non-zero instead of hanging forever.

    It is a cap on the whole run, not a progress timer: a slow but healthy build also stops here, which
    is why the message tells the user to re-run with a larger `--timeout` and to restore the version
    saved at the start of the build.
    """
    import threading

    def bark():
        # a total-run cap, not a progress timer: a slow but healthy build also stops here
        print(f"WATCHDOG: build not finished after {seconds}s. A modal LEAP dialog is the usual cause - "
              "bring the LEAP window to the front and dismiss it. If LEAP was simply still calculating, "
              "re-run with a larger --timeout. The area may be partly built: restore the version saved "
              "at the start of this build before re-running (if the log shows 'save version FAILED', "
              "there is none - rebuild into a fresh area instead).", flush=True)
        os._exit(3)

    timer = threading.Timer(seconds, bark)
    timer.daemon = True
    timer.start()
    return timer


def run_build(area_name=AREA, timeout=BUILD_TIMEOUT_SECONDS):
    Dispatch = _dispatch()
    if Dispatch is None:
        return 2
    watchdog = start_watchdog(timeout)
    BS = chr(92)
    leap = Dispatch("LEAP.LEAPApplication")
    leap.Visible = True
    print("build-start: attached to LEAP", flush=True)
    leap.ShowAnalysisView()
    print("analysis-view-shown", flush=True)
    names = []
    for a in _iter(leap.Areas):
        try:
            names.append(a.Name)
        except Exception:
            pass
    area = None
    if area_name in names:
        print("reusing area " + area_name)
    else:
        area = leap.Areas.Add(area_name, "")
        print("created area " + area_name)
    if area is None:
        k = 1
        while k <= leap.Areas.Count:
            a = leap.Areas.Item(k)
            if a.Name == area_name:
                area = a
                break
            k += 1
    print("opening area", flush=True)
    area.Open()
    print("area-active", flush=True)
    # Report the starting tree size: a fresh area starts near-empty, so a large number here means an
    # earlier session left branches behind. The build overwrites every expression it owns, but a stale
    # branch would keep its own activity and add emissions nothing accounts for (README run-day step 5).
    try:
        before = len(_iter(leap.Branches))
        print(f"branches before the build: {before}"
              + ("  (not a fresh area - see README run-day step 5)" if before > 50 else ""), flush=True)
    except Exception:
        pass
    leap.SaveArea()
    try:
        leap.RefreshBranches()
    except Exception:
        pass
    # LEAP's TED fuel data is country-specific, so every coal, diesel and gasoline factor depends on
    # this; it is set here rather than left to the operator (AreaCountry is get/set in Leap.tlb).
    ensure_area_country(leap)
    check_units(leap)
    effect_names, _unknown_effects = check_effects(leap)
    # A named restore point before anything is written: the build edits a live area, and SaveVersion is
    # the one snapshot available through COM (`ILEAPArea.Backup` takes an unknown mode enum). Best
    # effort - a failure here is logged and the build continues.
    try:
        leap.SaveVersion(f"pre-build snapshot: {area_name} {BASE_YEAR}-{END_YEAR} BAU", False)
        print("save version: pre-build snapshot taken", flush=True)
    except Exception as exc:      # noqa: BLE001 - any failure is reported, not fatal
        print(f"save version FAILED: {exc}", flush=True)
    key_root = resolve_root(leap, "key")
    ne_root = resolve_root(leap, "nonenergy")
    created_keys = ensure_key_assumptions(leap, key_root)
    print(f"roots: key={key_root!r} nonenergy={ne_root!r} "
          f"key-branches-created={len(created_keys)}", flush=True)
    leap.BaseYear = BASE_YEAR
    leap.EndYear = END_YEAR
    leap.FirstScenarioYear = FIRST_SCEN_YEAR
    confirm_years(leap)
    leap.ShowTransformation = True
    leap.ShowNonEnergy = True
    grdp_path = key_root + BS + "GRDP_Index"
    for path, unit, _base, _ea, _eb in DEMAND_CATS:
        parts = path.split(BS)
        for i in range(2, len(parts)):
            sub = BS.join(parts[:i])
            if find_branch(leap, sub) is None:
                leap.AddCategory(branch_id(leap, BS.join(parts[:i - 1])), parts[i - 1], "1", unit)
        if find_branch(leap, path) is None:
            leap.AddCategory(branch_id(leap, BS.join(parts[:-1])), parts[-1], "1", unit)
        leaf = parts[-1]
        for suffix, cands, _note in FUEL_CHILDREN.get(leaf, []):
            if find_branch(leap, path + BS + suffix) is None:
                leap.AddTechnology(branch_id(leap, path), suffix, "1",
                                   CHILD_UNIT.get(suffix, unit),
                                   resolve_fuel(leap, cands), "TJ")
                write_intensity(leap, path + BS + suffix, suffix)
    for eff in _iter(leap.Effects):
        try:
            nm = eff.Name.upper()
        except Exception:
            continue
        # Match the effect by either the formula or the spelled-out name: LEAP's Effects table is
        # created from its own default area (ScenarioEffects.nx1 help text uses "Carbon dioxide
        # (CO2)", "Methane (CH4)", "Nitrous oxide"), and a bare "CO2"/"CH4"/"N2O" test would silently
        # match nothing if the installed build spells them out without the formula.
        for alias, val in GWP_ALIASES.items():
            if alias in nm:
                try:
                    eff.GWP100 = val
                except Exception:
                    pass
                break
    for cat, name, _base, unit, _ea, _eb, pol, _fac, _note in NONENERGY_EFFECTS:
        catpath = ne_root + BS + cat
        if find_branch(leap, catpath) is None:
            leap.AddNonEnergySectorCategory(branch_id(leap, ne_root), cat)
        full = catpath + BS + name
        if find_branch(leap, full) is None:
            # use the name LEAP actually has, not our spelling of it
            leap.AddNonEnergySectorEffect(branch_id(leap, catpath), name, "1", unit,
                                          effect_names.get(pol, pol))
    scen_names = []
    for s in _iter(leap.Scenarios):
        try:
            scen_names.append(s.Name)
        except Exception:
            pass
    parent_id, parent_name = base_scenario_id(leap)
    if parent_id == 0:
        print("WARNING: LEAP has no Current Accounts scenario (no IsCurrentAccounts flag and no "
              "known name); new scenarios will be unparented and inherit nothing", flush=True)
    else:
        print(f"scenario parent: {parent_name!r} (id {parent_id})", flush=True)
    for name, abbrev, _run, _view in SCENARIOS:
        if name not in scen_names:
            leap.Scenarios.Add(name, abbrev, parent_id)
        s = scenario_by_name(leap, name)
        if s is None:
            raise RuntimeError("scenario missing after Add: " + name)
        # Sub-scenarios are not shown in results by default, and Calculate() only
        # computes scenarios whose results are shown - without this every row for
        # that scenario comes back empty and nothing raises.
        s.ResultsShown = True
    leap.ActiveScenario = "Current Accounts"
    for name, _unit, value, _note in KEY_ASSUMPTIONS:
        get_var(leap, key_root + BS + name, KEY_VARS).Expression = str(value)
    for path, _unit, base, _ea, _eb in DEMAND_CATS:
        if has_fuel_children(path):
            # written even when this row has no base of its own (the coal plants): its children carry the
            # quantities, and an unset parent is either 1 or 0 depending on the tool - not a thing to
            # leave to chance when the whole fleet's emissions sit under it
            get_var(leap, path, ACT_VARS).Expression = "1"
            continue
        if base is not None:
            get_var(leap, path, ACT_VARS).Expression = str(base)
    for leaf, fuels in TRANSPORT_BASE_LITRES.items():
        parent = demand_path(leaf)
        for suffix, value in fuels.items():
            get_var(leap, parent + BS + suffix, ACT_VARS).Expression = str(value)
    for plant, share in PLANT_SHARE.items():
        for suffix in ("Anthracite", "SubBituminous", "DieselDO"):
            child = "Demand" + BS + "Plants1A1" + BS + plant + BS + suffix
            if find_branch(leap, child) is None:
                continue
            get_var(leap, child, ACT_VARS).Expression = str(PLANT_FUEL_BASE[suffix] * share)
    for cat, name, base, _unit, _ea, _eb, _pol, fac, _note in NONENERGY_EFFECTS:
        full = ne_root + BS + cat + BS + name
        if base is not None:
            # LEAP's non-energy branch carries ONE writable variable - the annual effect loading - so a
            # row's activity and its factor are folded into emissions here (see the scenario block),
            # with the gas's AR5 GWP applied: the branch holds CO2e, the factor is per gas tonne.
            get_var(leap, full, ROW_VARS).Expression = str(base * fac * gwp_of(_pol))
    for name, _abbrev, run, case in SCENARIOS:
        leap.ActiveScenario = name
        for path, unit, _base, ea, eb in DEMAND_CATS:
            leaf = path.split(BS)[-1]
            if leaf in PLANT_SHARE:
                continue              # set per child below: ver1's step in A, flat in B
            if run == "A":
                e = expand(ea, grdp_path, case)
            elif leaf in RUN_B_1A2_MT:
                # Factory fuel ver1 leaves empty, entered in the B scenarios only, endpoints explicit:
                # Interp is linear, so the path differs from a compounding curve while 2025 and 2030 -
                # the two years the comparison quotes - are exact, and the 2050 point keeps the rate.
                e = run_b_1a2_expression(leaf, case)
            elif unit == "MWh":
                e = elec_expr(run, case)
            else:
                e = expand(eb, grdp_path, case)
            if e is None:
                continue
            get_var(leap, path, ACT_VARS).Expression = "1" if has_fuel_children(path) else e
        # Non-energy growth is written for both runs. Run A follows ver1 (IPPU 15.2 %/yr, landfill on
        # her series, everything else flat); Run B follows the corrected drivers and its band. Leaving
        # the Run A case unwritten lets LEAP inherit Current Accounts, which would flatten the 15.2 %
        # IPPU growth and the landfill series - about 7 Mt of the 2030 total, silently.
        for cat, nm, _base, _unit, ea, eb, pol, fac, _note in NONENERGY_EFFECTS:
            row_path = ne_root + BS + cat + BS + nm
            e = expand(ea if run == "A" else band_b_expr(nm, case, eb), grdp_path, case)
            if e is not None:
                # A non-energy branch has ONE writable variable (Avg Environmental Loading, read live
                # 2026-10-10), so activity and factor cannot sit side by side: the row's emissions are
                # folded into the loading. Writing the factor to a second variable would clobber the
                # activity, which is exactly what the earlier version did. The split stays in inputs.md.
                if nm.startswith("Elec_"):
                    # the grid factor is a literal in Run A and a Key Assumptions path in Run B, and the
                    # effect is CO2, so no GWP multiplication applies
                    factor_expr = "0.6592" if run == "A" else key_root + BS + "GridEF"
                else:
                    factor_expr = repr(fac * gwp_of(pol))
                get_var(leap, row_path, ROW_VARS).Expression = f"{e}*{factor_expr}"
        for plant, share in PLANT_SHARE.items():
            for suffix in PLANT_FUEL_BASE:
                child = "Demand" + BS + "Plants1A1" + BS + plant + BS + suffix
                if find_branch(leap, child) is None:
                    continue
                get_var(leap, child, ACT_VARS).Expression = plant_expr(
                    run, PLANT_FUEL_BASE[suffix] * share)
        if run == "B":
            # Corrections that replace the generic values above, so they must come after them.
            ippu = ne_root + BS + "IPPU" + BS
            get_var(leap, ippu + "2C1_steel", ROW_VARS).Expression = (
                f"{steel_cap_expr(case)}*{B_STEEL_FACTOR}")
            get_var(leap, ippu + "2A1_cement", ROW_VARS).Expression = (
                f"{clinker_act_expr(case)}*{B_CEMENT_FACTOR}")
        get_var(leap, key_root + BS + "GridEF", KEY_VARS).Expression = grid_expr(run, case)
        # The GRDP index drives every GrowthAs(..., elasticity) row in Run B, and Run A's IPPU rows
        # use the rate directly: without a trajectory here those rows would resolve to zero.
        get_var(leap, key_root + BS + "GRDP_Index", KEY_VARS).Expression = "Growth(%s%%)" % (
            GRDP_RATE * 100)
    leap.SaveArea()
    leap.Calculate()
    stale = []
    for name, _abbrev, _run, _view in SCENARIOS:
        s = scenario_by_name(leap, name)
        try:
            if s is not None and s.NeedsCalculation:
                stale.append(name)
        except Exception:
            pass
    if stale:
        raise RuntimeError(f"Calculate() left scenarios uncalculated: {stale}")
    # Raw tool output beside the tidy file: the brief asks for both, and LEAP's own export is the
    # evidence that results.csv was read out of the tool rather than assembled by hand. Best effort -
    # a failure here is logged and does not stop the tidy extraction.
    raw_dir = os.path.join(HERE, "raw")
    try:
        os.makedirs(raw_dir, exist_ok=True)
    except OSError as exc:
        print(f"raw export: cannot create {raw_dir} ({exc})", flush=True)
    raw_missing = []      # the brief requires raw output, so a gap makes the run INCOMPLETE (exit 4)
    for name, _abbrev, _run, _case in SCENARIOS:
        leap.ActiveScenario = name
        path = os.path.join(raw_dir, f"{name}.csv")
        try:
            leap.ExportResultsCSV(path)
            print(f"raw export: {os.path.relpath(path, HERE)}", flush=True)
        except Exception as exc:      # noqa: BLE001 - any failure is reported, not fatal
            print(f"raw export FAILED for {name}: {exc}", flush=True)
            raw_missing.append(name)
    # The expressions the build wrote are the other half of "raw tool outputs": without them a reader
    # cannot tell what was entered, only what came out. The API help defers the signature to LEAP's
    # Script Editor, so both documented shapes are tried and whichever works is logged.
    for label, call in (("ExportExpressions", getattr(leap, "ExportExpressions", None)),):
        if call is None:
            print(f"raw export: {label} not available on this build", flush=True)
            raw_missing.append(label)
            continue
        target = os.path.join(raw_dir, "expressions")
        try:
            call(target)
            print(f"raw export: {label} -> {os.path.relpath(target, HERE)}", flush=True)
        except Exception as exc:      # noqa: BLE001
            try:
                call()
                print(f"raw export: {label} (no path argument)", flush=True)
            except Exception as exc2:  # noqa: BLE001
                print(f"raw export FAILED for {label}: {exc} / {exc2}", flush=True)
                raw_missing.append(label)
    watchdog.cancel()      # the build got here, so nothing should fire later in this process
    # Closed at the end of the write loop rather than in a `with`: this is a top-level command, so the
    # only path that skips the close also ends the process and reclaims the handle. Left as it is
    # deliberately - converting it would indent the whole extraction loop for no runtime benefit.
    out = open(RESULTS_CSV, "w", newline="", encoding="utf-8")
    w = csv.DictWriter(out, fieldnames=RESULT_COLS)
    w.writeheader()
    n_rows = 0
    n_empty = 0
    totals = {}          # (scenario, case) -> summed tCO2e, for the plausibility check below
    for name, _abbrev, _run, case in SCENARIOS:
        leap.ActiveScenario = name
        for b in _iter(leap.Branches):
            try:
                full = b.FullName
            except Exception:
                continue
            # Leaf branches only. A parent demand category can expose the same 100-year GWP loading as
            # its fuel children, and summing both would double count the sector - the comparison reads
            # this file as a sum over branch sets, so only the level that owns the emission is written.
            try:
                if b.Children.Count:
                    continue
            except Exception:
                pass
            try:
                v = gwp_variable(b)
            except RuntimeError:
                continue
            unit_name = result_unit(v)
            for yr in range(BASE_YEAR, END_YEAR + 1):
                try:
                    val = v.Value(yr, unit_name, "")
                except Exception:
                    val = ""
                if val in ("", None):
                    n_empty += 1
                else:
                    try:
                        totals[(name, case)] = totals.get((name, case), 0.0) + float(val)
                    except (TypeError, ValueError):
                        n_empty += 1
                w.writerow({"tool": "LEAP", "scenario": name, "case": case, "sector": full,
                            "gpc_ref": gpc_ref(full), "year": yr, "co2e_t": val,
                            "territory": "merged", "source": result_source(full)})
                n_rows += 1
    out.close()
    print(f"BUILD done: {n_rows} rows ({n_empty} without a value) -> {RESULTS_CSV}")
    if n_rows == 0:
        raise RuntimeError("results.csv is empty: no branch exposed a 100-year GWP variable")
    if n_empty == n_rows:
        print("every row came back without a value. Two causes worth checking first: the build may not "
              "have calculated (look for 'Calculate()' above), or `Variable.Value(year, unit, region)` "
              "may take different arguments in this LEAP build - its signature is documented only in "
              "LEAP's Script Editor object browser.", flush=True)
        raise RuntimeError("every results cell came back empty: check the result unit names")
    check_all_scenarios(totals)      # after the whole-file causes, so their more specific message wins
    check_plausible(totals)
    if raw_missing:
        print(f"INCOMPLETE: raw export missing for {raw_missing}; results.csv was written but the brief's "
              "raw tool output is not complete - re-export before writing COMPARISON.md", flush=True)
        return 4
    return 0


def run_b_1a2_expression(leaf, case="central"):
    """The Run B activity expression for a 1A2 branch (single source for the build and --expect)."""
    mt, driver = RUN_B_1A2_MT[leaf]
    v25 = mt * 1e6 / A2A_COAL_T_PER_T_CO2
    rate = GRDP_RATE * BANDS[case]["elasticity"] if driver == "ELASTIC" else 0.0
    v30 = v25 * (1 + rate) ** (COMPARE_YEAR - BASE_YEAR)
    v_end = v25 * (1 + rate) ** (END_YEAR - BASE_YEAR)
    return (f"Interp({BASE_YEAR},{v25:.0f},{COMPARE_YEAR},{v30:.0f},{END_YEAR},{v_end:.0f})")


def evaluate_activity(expr, base, year, subs=None):
    """Offline value of one of the builder's own activity expressions, or None.

    Only the forms the builder emits are handled: a bare constant, Growth(r), Growth(r)*1.15,
    GrowthAs(path, e), Interp(year, value, ...), and any of those times a factor - a literal (the
    scope-2 grid factor in Run A) or a Key Assumptions path passed in through `subs` (the falling grid
    series in Run B). This is an expectation table for checking LEAP's own output, not a second
    implementation of the model - nothing here computes emissions.
    """
    if expr is None or base is None:
        return None
    if expr in ("ELASTIC", "CLINKER"):
        expr = expand(expr, ROOT_CANDIDATES["key"][0] + chr(92) + "GRDP_Index")
    try:
        return float(expr)      # a bare constant (a capped clinker output) holds every year
    except ValueError:
        pass
    mult = 1.0
    if "*" in expr and not expr.endswith(")"):
        head, _, tail = expr.rpartition("*")
        if subs and tail in subs:
            expr, mult = head, float(subs[tail])
        else:
            try:
                mult = float(tail)
                expr = head
            except ValueError:
                pass
        try:
            return float(expr) * mult      # a bare constant times a factor
        except ValueError:
            pass
    if expr.startswith("Interp("):
        pairs = [float(x) for x in expr[len("Interp("):-1].split(",")]
        points = list(zip(pairs[0::2], pairs[1::2], strict=False))
        if year <= points[0][0]:
            value = points[0][1]
        elif year >= points[-1][0]:
            value = points[-1][1]
        else:
            value = None
            for (y0, v0), (y1, v1) in zip(points, points[1:], strict=False):
                if y0 <= year <= y1:
                    value = v0 + (v1 - v0) * (year - y0) / (y1 - y0)
                    break
        return None if value is None else value * mult
    if expr.startswith("GrowthAs("):
        elasticity = float(expr.rsplit(",", 1)[1].strip().rstrip(")").strip())
        # LEAP Help24 GrowthAs: the branch follows the index "raised to the power of the elasticity",
        # so (1.152)^0.7 - 1 = 10.41 %/yr, not GACMO's linear 15.2 x 0.7 = 10.64 %/yr (method difference)
        rate = (1 + GRDP_RATE) ** elasticity - 1
    elif expr.startswith("Growth("):
        rate = float(expr[len("Growth("):-2].rstrip("%")) / 100.0
    else:
        return None
    return base * (1 + rate) ** (year - BASE_YEAR) * mult


def check_all_scenarios(totals):
    """Every built scenario must have results: LEAP returns none for a scenario unticked in Scenario
    Manager ("Unchecking a scenario will ... prevent you from seeing its results"), with no error."""
    missing = [name for name, _a, _r, case in SCENARIOS if (name, case) not in totals]
    if missing:
        raise RuntimeError(f"no results for {missing}: tick them in Scenario Manager and recalculate")


def check_plausible(totals):
    """Sanity-check the numbers before they are handed over as results.

    Two failure modes are visible only in the totals: a scenario that came out empty (guarded earlier
    per cell, but a zero *sum* is a different thing), and a band ordering that is not low <= central <=
    high - which means an expression or a band value is wrong, and would otherwise be published as a
    sensitivity range.
    """
    empty = sorted(name for (name, _case), value in totals.items() if value <= 0)
    if empty:
        raise RuntimeError(f"these scenarios summed to zero: {empty}")
    for case_lo, case_mid, case_hi in (("low", "central", "high"),):
        bands = {case: totals.get(("B_" + case, case)) for case in (case_lo, case_mid, case_hi)}
        if all(value is not None for value in bands.values()):
            ordered = [bands[case] for case in (case_lo, case_mid, case_hi)]
            if not (ordered[0] <= ordered[1] <= ordered[2]):
                raise RuntimeError("band totals are not low <= central <= high: "
                                   f"{ {k: round(v) for k, v in bands.items()} }")
    print(f"plausibility: {len(totals)} scenario totals, all non-zero, bands ordered", flush=True)


def result_unit(variable):
    """Unit name to read a result in: the variable's own declared result unit, else tonnes.

    `Value(Year, UnitName, Filter)` is the only read the type library exposes for a single variable,
    and the unit has to be one LEAP knows for that variable. Its own `DefaultResultUnit` is the safe
    first choice; "TONNE" is the mass fallback for CO2-equivalent loadings.
    """
    try:
        unit = variable.DefaultResultUnit
    except Exception:
        unit = None
    if isinstance(unit, str) and unit.strip():
        return unit
    return "TONNE"


def run_expect(out_path):
    """Write the activity levels LEAP should report at 2025 and 2030 for every entered row."""
    rows = []
    grdp_path = ROOT_CANDIDATES["key"][0] + chr(92) + "GRDP_Index"
    for name, _abbrev, run, case in SCENARIOS:
        for path, unit, base, ea, eb in DEMAND_CATS:
            leaf = path.split(chr(92))[-1]
            if run == "A":
                expr = ea
            elif leaf in RUN_B_1A2_MT:
                expr = run_b_1a2_expression(leaf, case)
            elif unit == "MWh":
                expr = elec_expr(run, case)
            else:
                expr = eb
            for year in (BASE_YEAR, COMPARE_YEAR):
                value = evaluate_activity(expr, base, year)
                if value is not None:
                    rows.append((name, path, unit, year, f"{value:.8f}", 1.0, ""))
            for child, fuels in TRANSPORT_BASE_LITRES.items():
                if leaf != child:
                    continue
                for suffix, base_l in fuels.items():
                    for year in (BASE_YEAR, COMPARE_YEAR):
                        value = evaluate_activity(expr, base_l, year)
                        if value is not None:
                            rows.append((name, path + chr(92) + suffix, unit, year, f"{value:.8f}", 1.0,
                                         FUEL_NCV_TJ_PER_UNIT.get(suffix, "")))
        for plant, share in PLANT_SHARE.items():
            for suffix, base_t in PLANT_FUEL_BASE.items():
                value_per_child = base_t * share
                expr = plant_expr(run, value_per_child)
                for year in (BASE_YEAR, COMPARE_YEAR):
                    value = evaluate_activity(expr, value_per_child, year)
                    if value is not None:
                        rows.append((name, "Demand" + chr(92) + "Plants1A1" + chr(92) + plant
                                     + chr(92) + suffix, "tonne", year, f"{value:.8f}", 1.0,
                                 FUEL_NCV_TJ_PER_UNIT.get(suffix, "")))
        for cat, nm, base, unit, ea, eb, _pol, _fac, _note in NONENERGY_EFFECTS:
            # expand() as the build does: a row whose Run B is a marker (ELASTIC) has to be turned
            # into an expression here too, or evaluate_activity returns None and the fixture silently
            # omits the row - which is what the golden test caught
            expr = expand(ea if run == "A" else band_b_expr(nm, case, eb), grdp_path, case)
            if run == "B" and nm == "2C1_steel":
                base = BANDS[case]["steel_Mt"] * 1e6      # Run B overrides the steel activity cap
            elif run == "B" and nm == "2A1_cement":
                base = BANDS[case]["clinker_Mt"] * 1e6    # and the clinker output
            for year in (BASE_YEAR, COMPARE_YEAR):
                value = evaluate_activity(expr, base, year)
                if value is not None:
                    # the build folds each non-energy row's factor into the single loading variable,
                    # so the fixture must fold it the same way or the licence-day diff would mismatch
                    factor = _fac * gwp_of(_pol)
                    if run == "B":
                        if nm == "2C1_steel":
                            factor = B_STEEL_FACTOR
                        elif nm == "2A1_cement":
                            factor = B_CEMENT_FACTOR
                        elif nm.startswith("Elec_"):
                            factor = (0.6592 if year == BASE_YEAR
                                      else BANDS[case]["grid2030"]) * gwp_of(_pol)
                    value *= factor
                    # same shape as the branch path the build writes, so the fixture can be diffed
                    # against --dump without translating names
                    out_unit = "tCO2e" if nm.startswith("Elec_") else unit
                    rows.append((name, ROOT_CANDIDATES["nonenergy"][0] + chr(92) + cat + chr(92) + nm,
                                 out_unit, year, f"{value:.8f}", factor, ""))
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["scenario", "branch", "unit", "year", "activity_expected", "factor",
                    "intensity_tj_per_unit"])
        w.writerows(rows)
    print(f"expected activity rows: {len(rows)} -> {out_path}")
    return 0


def run_verify_activity(fixture_path, tolerance=1e-3):
    """Compare what LEAP now reports for each branch against expected_activity.csv.

    Run-day step 6, made mechanical. Reads the fixture the build wrote, resolves each row's variable the
    same way the build did (activity for demand rows, the loading for non-energy ones) and reports any
    mismatch. A match with mismatching emissions means the gap is in LEAP's own fuel tables - the tool
    effect the comparison wants - which is why this checks activity and not emissions.
    """
    Dispatch = _dispatch()
    if Dispatch is None:
        return 2
    leap = Dispatch("LEAP.LEAPApplication")
    leap.ShowAnalysisView()
    with open(fixture_path, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    checked, bad = 0, []
    for row in rows:
        path, year = row["branch"], int(row["year"])
        candidates = ROW_VARS if row["branch"].startswith("Non Energy") else ACT_VARS
        try:
            var = get_var(leap, path, candidates)
            got = var.Value(year, row["unit"], "")
        except Exception as exc:      # noqa: BLE001 - reported as a mismatch, not fatal
            bad.append((path, year, row["activity_expected"], f"<{str(exc)[:40]}>"))
            continue
        try:
            want = float(row["activity_expected"])
            value = float(got)
        except (TypeError, ValueError):
            bad.append((path, year, row["activity_expected"], got))
            continue
        checked += 1
        if abs(value - want) > max(abs(want) * tolerance, 1e-6):
            bad.append((path, year, f"{want:.6g}", f"{value:.6g}"))
    print(f"activity check: {checked} rows read, {len(bad)} mismatched", flush=True)
    for path, year, want, got in bad[:20]:
        print(f"  {path} {year}: expected {want}, LEAP reports {got}", flush=True)
    return 1 if bad else 0


def run_dump(area, depth):
    """Read-only inventory of a live area: roots, effects with their GWP, scenarios, fuels, tree.

    Needs the licence. LEAP's shipped terms say the LOCKED copy "disallows the ability to save changes
    to datasets or to use the API" and is "intended only for evaluation purposes", so this must not be
    run against the evaluation copy (see FINDINGS.md). Once licensed it answers what the offline
    files cannot: the area template's real root names, how the effects are named, and what each branch
    type's variables are called. Two conditions, both from LEAP's own error text, learned while the
    copy was still being probed: `ShowAnalysisView()` must run before any area call ("Cannot open an
    area - Analysis View is not enabled"), and no modal LEAP dialog may be open ("Area.Open not
    available when a supporting screen is open").
    """
    Dispatch = _dispatch()
    if Dispatch is None:
        return 2
    BS = chr(92)
    leap = Dispatch("LEAP.LEAPApplication")
    leap.ShowAnalysisView()          # required before Area.Open; see the docstring
    target = None
    for a in _iter(leap.Areas):
        if a.Name == area:
            target = a
            break
    if target is None:
        print(f"no area named {area!r} in {[x.Name for x in _iter(leap.Areas)]}")
        return 2
    target.Open()
    try:
        leap.RefreshBranches()
    except Exception:
        pass
    print(f"area {area} base={leap.BaseYear} end={leap.EndYear} first_scenario={leap.FirstScenarioYear}")
    print(f"country {getattr(target, 'CountryName', '?')!r} "
          f"({getattr(target, 'CountryCode2', '?')}/{getattr(target, 'CountryCode3', '?')}) "
          f"area_country={getattr(leap, 'AreaCountry', '?')!r} - LEAP's TED fuel data is "
          "country-specific; --build sets AreaCountry to Viet Nam itself")
    print("roots", top_level_names(leap))
    # Database-backed collections are the ones LEAP refuses in evaluation mode: `Units`, `Fuels` and
    # `Countries` raise "Scripting disabled in LEAP evaluation version" (seen 2026-10-10), while tree
    # navigation - Areas, Branches, Variables - is allowed. Each read is guarded so --dump still
    # reports the tree it can see instead of dying on a collection it cannot.
    for label, getter in (("scenarios", lambda: [s.Name for s in _iter(leap.Scenarios)]),
                          ("effects", lambda: [(e.Name, getattr(e, "GWP100", None))
                                               for e in _iter(leap.Effects)]),
                          ("fuels", lambda: [f.Name for f in _iter(leap.Fuels)][:40]),
                          ("units", lambda: [u.Name for u in _iter(leap.Units)][:40])):
        try:
            print(label, getter())
        except Exception as exc:
            print(f"{label}: not readable here ({str(exc)[:60]}) - "
                  "database-backed collections need the licence")
    for b in _iter(leap.Branches):
        try:
            full = b.FullName
        except Exception:
            continue
        if full.count(BS) >= depth:
            continue
        names = []
        for v in _iter(b.Variables):
            try:
                names.append(v.Name)
            except Exception:
                pass
        print("BR {} | {} | {}".format(full, getattr(b, "BranchTypeName", "?"), names))
    print("DUMP done")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Hai Phong BAU LEAP builder (licence-gated)")
    ap.add_argument("--check", action="store_true", help="offline validation only")
    ap.add_argument("--build", action="store_true", help="COM build (needs licence)")
    ap.add_argument("--dump", action="store_true",
                    help="read-only area inventory (needs the licence: the locked copy disallows API use)")
    ap.add_argument("--area", default=AREA,
                    help=f"area for --build/--dump (default {AREA})")
    ap.add_argument("--depth", type=int, default=2, help="tree depth for --dump (default 2)")
    ap.add_argument("--timeout", type=int, default=BUILD_TIMEOUT_SECONDS,
                    help="abort the COM build if it makes no progress for this many seconds "
                         "(a modal LEAP dialog is the usual cause); default 900")
    ap.add_argument("--expect", action="store_true",
                    help="write the activity levels LEAP should report (offline)")
    ap.add_argument("--verify-activity", action="store_true",
                    help="compare LEAP's current activity against expected_activity.csv (needs the "
                         "licence and a completed --build)")
    ap.add_argument("--out", default=None,
                    help="where --expect writes its checklist (default expected_activity.csv in this "
                         "folder; use a path outside the repo when you only want to inspect it)")
    a = ap.parse_args(argv)
    if a.verify_activity:
        return run_verify_activity(a.out or os.path.join(HERE, "expected_activity.csv"))
    if a.build:
        return run_build(a.area, a.timeout)
    if a.dump:
        return run_dump(a.area, a.depth)
    if a.expect:
        return run_expect(a.out or os.path.join(HERE, "expected_activity.csv"))
    return run_check()


if __name__ == "__main__":
    sys.exit(main())
