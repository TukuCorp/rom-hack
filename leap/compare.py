"""Turn `results.csv` into the Phase 4 comparison, and hold the reference series.

The two LEAP reporting views are sums over branch sets of the same numbers, not separate scenarios
(`FINDINGS.md` states the rule):

* direct  - everything the city burns or emits inside its boundary: fuel combustion, plants, IPPU,
            AFOLU, waste.
* scope 2 - purchased electricity (`I.1.2`, `I.2.2`, `I.3.2`, `I.5.2`, `I.6.2`).
* plants  - energy industries (`I.4.1`), the coal fleet.

    territorial = direct + plants            (Decree 06 / IPCC reading; scope 2 is memo only)
    GPC BASIC+  = direct + scope 2           (the fleet's fuel is out, the city's purchases are in)
    as filed    = direct + plants + scope 2  (Hang's own sum; the double count, kept visible)

Usage once a licensed run has written results.csv:

    python compare.py                     # prints the comparison table for 2025 and 2030
    python compare.py --year 2030         # one year
    python compare.py --sectors           # per-sector rows under the chosen view

Nothing here computes emissions; it only groups the file the tool wrote.
"""
from __future__ import annotations

import argparse
import csv
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS_CSV = os.path.join(HERE, "results.csv")

DIRECT = "direct"
SCOPE2 = "scope2"
PLANTS = "plants"

SCOPE2_REFS = ("I.1.2", "I.2.2", "I.3.2", "I.5.2", "I.6.2")   # purchased electricity
PLANT_REFS = ("I.4.1",)                                       # energy industries: the coal fleet

VIEWS = {
    "territorial": (DIRECT, PLANTS),
    "gpc_basic_plus": (DIRECT, SCOPE2),
    "as_filed": (DIRECT, PLANTS, SCOPE2),
}

# Reference series, each with its own year, view and source (see FINDINGS.md). Kept here so
# the comparison is reproducible rather than retyped:  tCO2e.
REFERENCE = [
    {"series": "ver1 (Hang, as filed, scope 1 + scope 2)", "year": 2026, "view": "as_filed",
     "tco2e": 42816933.576527156, "source": "workbook Tong hop C8"},
    {"series": "ver1 (Hang, territorial BAU)", "year": 2030, "view": "territorial",
     "tco2e": 38832857.627, "source": "workbook Bang tinh PV1 W154"},
    {"series": "GACMO runA-hang central", "year": 2025, "view": "territorial",
     "tco2e": 39931000.0, "source": "gacmo/results.csv TOTAL excl LULUCF + Fossil power plants"},
    {"series": "GACMO runA-hang central", "year": 2025, "view": "gpc_basic_plus",
     "tco2e": 31437000.0, "source": "gacmo/results.csv TOTAL excl LULUCF + Grid electricity"},
    {"series": "GACMO runA-hang central", "year": 2030, "view": "territorial",
     "tco2e": 57072000.0, "source": "gacmo/results.csv"},
    {"series": "GACMO runA-hang central", "year": 2030, "view": "gpc_basic_plus",
     "tco2e": 61930000.0, "source": "gacmo/results.csv"},
    {"series": "GACMO runB-corrected central", "year": 2025, "view": "territorial",
     "tco2e": 38745000.0, "source": "gacmo/results.csv"},
    {"series": "GACMO runB-corrected central", "year": 2025, "view": "gpc_basic_plus",
     "tco2e": 29740000.0, "source": "gacmo/results.csv"},
    {"series": "GACMO runB-corrected central", "year": 2030, "view": "territorial",
     "tco2e": 41871000.0, "source": "gacmo/results.csv"},
    {"series": "GACMO runB-corrected central", "year": 2030, "view": "gpc_basic_plus",
     "tco2e": 35775000.0, "source": "gacmo/results.csv"},
    {"series": "repo engine BAU (placeholder data, shape only)", "year": 2025, "view": "territorial",
     "tco2e": 8319100.0, "source": "data/processed/bau_2024_2050.csv sectors I-V"},
    {"series": "repo engine BAU (placeholder data, shape only)", "year": 2030, "view": "territorial",
     "tco2e": 10441000.0, "source": "data/processed/bau_2024_2050.csv sectors I-V"},
]


GPC_REF_RE = re.compile(r"^(I|II|III|IV|V)(\.(\d+|x)){1,2}$")


def bucket(gpc_ref):
    """Which sum a row belongs to, from the reference number the builder wrote.

    An empty or malformed reference raises instead of defaulting to direct: a row quietly counted as
    direct would land in both views and inflate the total the comparison reports. The check is
    syntactic (the repo's own `parse_refno` level) - table membership lives in the repo's GPC table,
    which this folder deliberately does not import.
    """
    ref = (gpc_ref or "").strip()
    if ref in PLANT_REFS:
        return PLANTS
    if ref in SCOPE2_REFS:
        return SCOPE2
    if not GPC_REF_RE.match(ref):
        raise ValueError(f"unmapped GPC reference in results.csv: {gpc_ref!r}")
    return DIRECT


def validate_rows(rows):
    """Fail closed on anything that would silently change a total.

    An empty or malformed GPC reference cannot be bucketed, and an empty or non-numeric `co2e_t` would
    be summed as zero - quietly lowering whichever view contains it, which is exactly the kind of
    plausible-looking wrong number this folder keeps hunting. Both name the offending rows.
    """
    bad = sorted({(r.get("gpc_ref") or "") for r in rows
                  if not GPC_REF_RE.match((r.get("gpc_ref") or "").strip())})
    if bad:
        raise ValueError("results.csv has rows whose GPC reference is unknown or empty: "
                         + ", ".join(repr(b) for b in bad))
    empty = sorted({r["sector"] for r in rows if _numeric(r.get("co2e_t")) is None})
    if empty:
        raise ValueError(f"results.csv has rows with no numeric co2e_t ({len(empty)} rows, e.g. "
                         f"{', '.join(empty[:5])}) - summed as zero they would understate a view")


def load_results(path=RESULTS_CSV):
    with open(path, encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh)]
    validate_rows(rows)
    check_scenarios(rows)
    check_cases(rows)
    return rows


def _numeric(value):
    """float(value), or None when the cell is not a number (the validator's signal)."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _num(value):
    """Summing helper: a validated file has no non-numeric cells, so this stays forgiving."""
    got = _numeric(value)
    return 0.0 if got is None else got


def view_total(rows, view, year, scenario=None, case=None):
    """Sum one of the three views for a year, optionally for one scenario or band."""
    buckets = VIEWS[view]
    total = 0.0
    for r in rows:
        if int(r["year"]) != int(year):
            continue
        if scenario is not None and r["scenario"] != scenario:
            continue
        if case is not None and r.get("case") != case:
            continue
        if bucket(r.get("gpc_ref")) in buckets:
            total += _num(r.get("co2e_t"))
    return total


def by_sector(rows, view, year, scenario=None, case=None):
    """{sector: tCO2e} for the branches inside a view, biggest first."""
    buckets = VIEWS[view]
    out = {}
    for r in rows:
        if int(r["year"]) != int(year):
            continue
        if scenario is not None and r["scenario"] != scenario:
            continue
        if case is not None and r.get("case") != case:
            continue
        if bucket(r.get("gpc_ref")) not in buckets:
            continue
        out[r["sector"]] = out.get(r["sector"], 0.0) + _num(r.get("co2e_t"))
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


# The four the build writes (build_leap_bau.SCENARIOS). A results.csv missing one of them would render a
# shorter table with no error - the reader-side equivalent of the unticked-scenario failure the build
# detects, so it fails closed here too.
EXPECTED_SCENARIOS = ("A_Hang_AsFiled", "B_low", "B_central", "B_high")

# The horizon the builder writes (build_leap_bau.BASE_YEAR / END_YEAR), used only to word the error when
# a results.csv is shorter than it should be.
BASE_YEAR, END_YEAR = 2025, 2050


def check_scenarios(rows):
    seen = set(scenario_names(rows))
    missing = [s for s in EXPECTED_SCENARIOS if s not in seen]
    if missing:
        raise ValueError(f"results.csv is missing scenarios {missing} (found {sorted(seen)}); "
                         "tick them in Scenario Manager and recalculate before comparing")


# The bands each corrected scenario carries. A missing band is a missing sensitivity, and the table would
# simply have one fewer row - so it fails closed like the other two.
EXPECTED_CASES = ("low", "central", "high")


def check_cases(rows):
    """Each corrected scenario carries its own band (B_low is low, B_central is central, B_high is high),
    so the check is that the three bands are present across them - a missing one is a missing sensitivity
    and the table would simply have one fewer row."""
    have = {r.get("case") for r in rows if str(r["scenario"]).startswith("B_")}
    missing = [c for c in EXPECTED_CASES if c not in have]
    if missing:
        raise ValueError(f"the corrected scenarios are missing bands {missing} (found {sorted(have)}); "
                         "the three bands are the sensitivity the comparison reports")
    for scenario in EXPECTED_SCENARIOS:
        if scenario.startswith("B_") and not any(r["scenario"] == scenario for r in rows):
            raise ValueError(f"no rows for {scenario}")


def check_years(rows, years):
    """A year the file does not carry would render as zeros, not as an error - the quietest of the
    silent failures, since a zero total looks like a real answer."""
    have = {int(r["year"]) for r in rows}
    missing = [y for y in years if int(y) not in have]
    if missing:
        raise ValueError(f"results.csv has no rows for {missing} (years present: "
                         f"{sorted(have)[:3]}...{sorted(have)[-1]}); the build writes "
                         f"{BASE_YEAR}-{END_YEAR}, so a missing year means a short run")


def scenario_names(rows):
    seen = []
    for r in rows:
        if r["scenario"] not in seen:
            seen.append(r["scenario"])
    return seen


def growth_rate(first, last, years):
    """Compound annual growth between two totals, as a percentage, or None if it is undefined."""
    if years <= 0 or first is None or last is None or first <= 0 or last <= 0:
        return None
    return ((last / first) ** (1.0 / years) - 1.0) * 100.0


def render(rows, years, with_sectors=False):
    lines = []
    span = max(years) - min(years) if len(years) > 1 else 0
    for year in years:
        lines.append(f"### {year}")
        lines.append("")
        lines.append("| scenario | case | territorial | GPC BASIC+ | as filed | CAGR %/yr 25-30 "
                     "(territorial) |")
        lines.append("|---|---|---|---|---|---|")
        for name in scenario_names(rows):
            cases = sorted({r["case"] for r in rows if r["scenario"] == name})
            for case in cases:
                t = view_total(rows, "territorial", year, name, case)
                g = view_total(rows, "gpc_basic_plus", year, name, case)
                a = view_total(rows, "as_filed", year, name, case)
                if span:
                    first = view_total(rows, "territorial", min(years), name, case)
                    rate = growth_rate(first, view_total(rows, "territorial", max(years), name, case),
                                       span)
                    shown = "n/a" if rate is None else f"{rate:+.2f}"
                else:
                    shown = "-"
                lines.append(f"| {name} | {case} | {t / 1e6:.3f} | {g / 1e6:.3f} | {a / 1e6:.3f} | "
                             f"{shown} |")
        lines.append("")
        lines.append("| reference (different base years - see FINDINGS.md) | view | Mt |")
        lines.append("|---|---|---|")
        for ref in REFERENCE:
            if ref["year"] == year:
                lines.append("| {} | {} | {:.3f} |".format(ref["series"], ref["view"],
                                                     ref["tco2e"] / 1e6))
        lines.append("")
        if with_sectors:
            for name in scenario_names(rows):
                for case in sorted({r["case"] for r in rows if r["scenario"] == name}):
                    lines.append(f"#### {name} / {case} / {year}, territorial, by branch")
                    lines.append("")
                    lines.append("| sector | Mt |")
                    lines.append("|---|---|")
                    for sector, value in by_sector(rows, "territorial", year, name, case).items():
                        if value:
                            lines.append(f"| {sector} | {value / 1e6:.4f} |")
                    lines.append("")
    return "\n".join(lines)


GAP_THRESHOLD = 10.0     # per cent - the brief asks for "the explanation of each gap > 10 %"

# Steering (ruling read from the orchestrator's pane, 2026-10-11 01:38): the gaps that come from ver1's
# own out-of-date 2025 summary column are "ver1 internal inconsistency" and are NOT counted toward a
# tool explanation. Her 2030 column equals her own detail; her 2025 column does not - AFOLU is 0.33 Mt
# above it and Waste 0.58 Mt below (see FINDINGS.md). Any reference to her 2025 figure for those two
# sectors is therefore labelled rather than explained as a tool effect.
VER1_INTERNAL_INCONSISTENCY = {
    ("ver1 (Hang, as filed, scope 1 + scope 2)", 2026): "ver1 internal inconsistency: her 2025 summary "
    "column is 0.33 Mt above her own AFOLU sheets and 0.58 Mt below her Waste sheets",
}


def gaps_over_threshold(rows, years, threshold=GAP_THRESHOLD):
    """Total-level gaps above the brief's threshold, so none can be missed when COMPARISON.md is written.

    A reference series is a single total per year and view, so the comparison is total against total; the
    per-sector explanation the brief also asks for is prose in COMPARISON.md, which has the sector detail
    on both sides (`ver1`'s Tong-hop rows, GACMO's results.csv rows).
    """
    out = []
    for ref in REFERENCE:
        if ref["year"] not in years:
            continue
        for name in scenario_names(rows):
            for case in sorted({r["case"] for r in rows if r["scenario"] == name}):
                ours = view_total(rows, ref["view"], ref["year"], name, case)
                if ours is None or not ref["tco2e"]:
                    continue
                gap = (ours - ref["tco2e"]) / ref["tco2e"] * 100.0
                if abs(gap) <= threshold:
                    continue
                label = VER1_INTERNAL_INCONSISTENCY.get((ref["series"], ref["year"]))
                if label:
                    # excluded from the tool-gap list by steering; reported separately
                    continue
                out.append((abs(gap), name, case, ref["view"], ref["year"], ours, ref["tco2e"], gap,
                            ref["series"]))
    return sorted(out, reverse=True)


def render_gaps(rows, years, threshold=GAP_THRESHOLD):
    gaps = gaps_over_threshold(rows, years, threshold)
    note = ""
    if VER1_INTERNAL_INCONSISTENCY:
        note = ("\n\nExcluded from this list by steering: "
                + "; ".join(sorted(VER1_INTERNAL_INCONSISTENCY.values()))
                + " - labelled, not counted toward a tool explanation.")
    if not gaps:
        return (f"## Gaps over {threshold:.0f} %\n\n"
                f"None at total level between the built scenarios and the reference series." + note)
    lines = [f"## Gaps over {threshold:.0f} %", "",
             "| scenario | case | view | year | ours | reference | gap % | reference series |",
             "|---|---|---|---|---|---|---|---|"]
    for _abs_gap, name, case, view, year, ours, ref, gap, series in gaps:
        lines.append(f"| {name} | {case} | {view} | {year} | {ours:,.0f} | {ref:,.0f} | "
                     f"{gap:+.1f} | {series} |")
    lines.append("")
    lines.append("Each of these needs a driver / factor / boundary explanation in COMPARISON.md." + note)
    return "\n".join(lines)


# GACMO's own output, beside this folder. Module-level rather than a default argument: a call in a
# default is evaluated once at import and reads as if it were dynamic.
GACMO_CSV = os.path.join(os.path.dirname(RESULTS_CSV), "..", "gacmo", "results.csv")


def verify_gacmo_references(gacmo_csv=None):
    """Re-derive the four GACMO rows from its results.csv and report any drift.

    The reference series is hard-coded so the comparison is reproducible rather than retyped, but GACMO
    owns that file and a rebase on its side would silently leave our rows stale. This is the mechanical
    version of the note in FINDINGS.md 4: territorial is `TOTAL excl LULUCF` plus the
    post-processed power row, BASIC+ is `TOTAL excl LULUCF` plus `Grid electricity`.
    """
    gacmo_csv = gacmo_csv or GACMO_CSV
    if not os.path.exists(gacmo_csv):
        print(f"gacmo results not found at {gacmo_csv} - skipping the reference re-check")
        return 0
    rows = []
    with open(gacmo_csv, encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            rows.append(row)

    def total(scenario, case, year, sector):
        return sum(float(r["co2e_t"]) for r in rows
                   if r["scenario"] == scenario and r["case"] == case and r["year"] == str(year)
                   and r["sector"] == sector)

    def has_base(scenario, case, year):
        """Only compare a year the file actually covers: a scenario/year with no TOTAL row has nothing
        to derive from, and treating its zero as drift would make the check useless on a partial file."""
        return any(r["scenario"] == scenario and r["case"] == case and r["year"] == str(year)
                   and r["sector"] == "TOTAL excl LULUCF" for r in rows)

    derived = {}
    for scenario, case, tag in (("runA-hang", "central", "runA-hang central"),
                                ("runB-corrected", "central", "runB-corrected central")):
        for year in (2025, 2030):
            base = total(scenario, case, year, "TOTAL excl LULUCF")
            power = total(scenario, case, year, "Fossil power plants")
            grid = total(scenario, case, year, "Grid electricity")
            derived[(tag, year, "territorial")] = base + power
            derived[(tag, year, "gpc_basic_plus")] = base + grid
    drift, checked = [], 0
    for ref in REFERENCE:
        if not ref["series"].startswith("GACMO"):
            continue
        tag = ref["series"].replace("GACMO ", "")
        key = (tag, ref["year"], ref["view"])
        if key not in derived:
            continue
        scenario, case = ("runA-hang", "central") if tag.startswith("runA") else ("runB-corrected", "central")
        if not has_base(scenario, case, ref["year"]):
            continue
        # the reference figures are rounded to the nearest thousand, so compare relatively: a rebase
        # moves these totals by millions, a rounding artefact by tens
        checked += 1
        if abs(derived[key] - ref["tco2e"]) > abs(ref["tco2e"]) * 1e-4:
            drift.append((key, ref["tco2e"], derived[key]))
    if drift:
        print("GACMO reference rows have DRIFTED - update REFERENCE before writing COMPARISON.md:")
        for key, ours, theirs in drift:
            print(f"  {key}: compare.py has {ours:,.0f}, results.csv now gives {theirs:,.0f}")
        return 1
    print(f"GACMO reference rows still match its results.csv "
          f"({checked} rows checked)")
    return 0


# The 2025 base targets from README run-day step 7 (Run A the plain sum of ver1 rows on the detail bases;
# B_central after the steel move). Printed next to the computed totals so step 7 is a comparison rather
# than a memory test. t CO2e.
BASE_TARGETS = {
    ("A_Hang_AsFiled", "territorial", 2025): 31.5e6,    # 1A2 empty as in ver1; 40.8 would include 1A2 9.4
    ("B_central", "territorial", 2025): 39.7e6,
    ("B_central", "gpc_basic_plus", 2025): 30.5e6,
}


def render_base_check(rows, tolerance=0.02):
    """The run-day base reconciliation, made readable: computed 2025 view totals against the targets."""
    lines = ["## 2025 base check", "",
             "| scenario | view | computed | target | difference |", "|---|---|---|---|---|"]
    worst = 0.0
    for (scenario, view, year), target in BASE_TARGETS.items():
        got = view_total(rows, view, year, scenario, "central")
        gap = (got - target) / target * 100.0 if target else 0.0
        worst = max(worst, abs(gap))
        flag = "" if abs(gap) <= tolerance * 100 else "  **over tolerance**"
        lines.append(f"| {scenario} | {view} | {got:,.0f} | {target:,.0f} | {gap:+.1f} %{flag} |")
    lines.append("")
    lines.append(f"Targets are README step 7; tolerance {tolerance * 100:.0f} %. "
                 f"Worst difference {worst:.1f} %.")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="LEAP results -> Phase 4 comparison")
    ap.add_argument("--results", default=RESULTS_CSV)
    ap.add_argument("--year", type=int, action="append", help="repeatable; default 2025 and 2030")
    ap.add_argument("--sectors", action="store_true", help="also print per-branch rows")
    ap.add_argument("--verify-references", action="store_true",
                    help="re-derive the GACMO reference rows from its results.csv and report drift")
    a = ap.parse_args(argv)
    if a.verify_references:
        return verify_gacmo_references()
    if not os.path.exists(a.results):
        print(f"no results file at {a.results} - the LEAP run needs a registered licence")
        return 2
    rows = load_results(a.results)
    print("# LEAP vs reference series")
    print()
    years = a.year or [2025, 2030]
    check_years(rows, years)
    print(render(rows, years, with_sectors=a.sectors))
    print()
    print(render_gaps(rows, years))
    print()
    print(render_base_check(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
