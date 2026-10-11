"""Tests for the Phase 4 comparison reader (`compare.py`).

The view rule is the one thing the comparison cannot get wrong: adding plants and purchased
electricity together is the double count this project exists to expose. The first test pins the rule
against the totals the October review recorded on the same branch sets (inputs.md 3).

Run:  .venv/Scripts/python.exe -m pytest -q test_compare.py
"""
import csv
import importlib.util
import pathlib

import pytest

HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("compare", HERE / "compare.py")
cmp_ = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cmp_)


def row(sector, gpc_ref, year, tco2e, scenario="A_Hang_AsFiled", case="central"):
    return {"tool": "LEAP", "scenario": scenario, "case": case, "sector": sector,
            "gpc_ref": gpc_ref, "year": str(year), "co2e_t": str(tco2e),
            "territory": "merged", "source": "test"}


# The October review's own branch sets at 2030, in Mt: plants 20.7, industry fuel 9.4,
# other direct 10.6, purchased electricity 11.5 -> territorial 40.7, GPC BASIC+ 31.5.
OCT_REVIEW_2030 = [
    row("Demand\\Plants1A1\\Coal_HP_TPP\\Anthracite", "I.4.1", 2030, 20.7e6),
    row("Demand\\Industry\\Other_1A2\\Coal", "I.3.1", 2030, 9.4e6),
    row("Non Energy\\Waste\\MSW_4A1", "III.1.1", 2030, 10.6e6),
    row("Demand\\Households\\Electricity", "I.1.2", 2030, 11.5e6),
]


def test_views_match_the_october_review_checkpoints():
    assert cmp_.view_total(OCT_REVIEW_2030, "territorial", 2030) == 40.7e6
    assert cmp_.view_total(OCT_REVIEW_2030, "gpc_basic_plus", 2030) == 31.5e6
    assert cmp_.view_total(OCT_REVIEW_2030, "as_filed", 2030) == 52.2e6


def test_bucket_classifies_every_reference_the_builder_writes():
    assert cmp_.bucket("I.4.1") == cmp_.PLANTS
    for ref in cmp_.SCOPE2_REFS:
        assert cmp_.bucket(ref) == cmp_.SCOPE2
    for ref in ("I.3.1", "I.1.1", "II.1.1", "III.4.1", "IV.1", "V.3"):
        assert cmp_.bucket(ref) == cmp_.DIRECT
    # a row that cannot be bucketed must not be folded into direct
    # syntax is what this layer checks (the repo's own parse_refno vs validate_refno split): a
    # well-formed but non-GPC reference such as I.9.9 is left to the builder's mapping
    for bad in ("", "   ", "nonsense", "XV.1", "I"):
        with pytest.raises(ValueError):
            cmp_.bucket(bad)


def test_validate_refuses_a_file_with_unmapped_rows(tmp_path):
    rows = OCT_REVIEW_2030 + [row("Mystery", "", 2030, 1e6)]
    with pytest.raises(ValueError) as excinfo:
        cmp_.validate_rows(rows)
    assert "unknown or empty" in str(excinfo.value)
    path = tmp_path / "results.csv"
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    with pytest.raises(ValueError):
        cmp_.load_results(str(path))


def test_view_total_filters_scenario_case_and_year():
    rows = OCT_REVIEW_2030 + [
        row("Demand\\Households\\Electricity", "I.1.2", 2025, 5.0e6, case="low"),
        row("Demand\\Households\\Electricity", "I.1.2", 2030, 9.0e6, case="low"),
    ]
    assert cmp_.view_total(rows, "gpc_basic_plus", 2030, case="low") == 9.0e6
    assert cmp_.view_total(rows, "gpc_basic_plus", 2025, case="central") == 0.0
    assert cmp_.view_total(rows, "gpc_basic_plus", 2030) == 31.5e6 + 9.0e6


def test_by_sector_is_ranked_and_bucketed():
    top = cmp_.by_sector(OCT_REVIEW_2030, "territorial", 2030)
    assert list(top)[0].endswith("Anthracite")
    assert "Demand\\Households\\Electricity" not in top     # scope 2 is memo in this view
    assert abs(top["Non Energy\\Waste\\MSW_4A1"] - 10.6e6) < 1


def test_render_includes_reference_series_and_flags_missing_file(tmp_path, capsys):
    text = cmp_.render(OCT_REVIEW_2030, [2030])
    assert "territorial" in text and "GPC BASIC+" in text
    assert "ver1 (Hang, territorial BAU)" in text
    missing = tmp_path / "nope.csv"
    assert cmp_.main(["--results", str(missing)]) == 2
    assert "needs a registered licence" in capsys.readouterr().out


def test_reference_rows_carry_their_provenance():
    for ref in cmp_.REFERENCE:
        assert ref["source"], ref
        assert ref["view"] in cmp_.VIEWS
        assert ref["tco2e"] > 0


# bind the builder's dry run so the comparison can be exercised on the file the builder actually writes
_dry_spec = importlib.util.spec_from_file_location("dry_builder", HERE / "test_build_dryrun.py")
dry_builder = importlib.util.module_from_spec(_dry_spec)
_dry_spec.loader.exec_module(dry_builder)


def test_views_on_the_builders_own_output(tmp_path, monkeypatch):
    """End to end: the file build_leap_bau.py writes must survive compare.py's bucketing intact.

    If any row fell into two buckets or none, the three views would stop adding up; the identity below
    only holds when the bucket map is exhaustive and disjoint.
    """
    _leap, rc, rows, _out = dry_builder.run_dry(tmp_path, monkeypatch)
    assert rc == 0 and rows
    names = cmp_.scenario_names(rows)
    assert names == ["A_Hang_AsFiled", "B_central", "B_high", "B_low"] or set(names) == {
        n for n, *_ in dry_builder.bau.SCENARIOS}
    checked = 0
    for year in (2025, 2030):
        for name in names:
            for case in sorted({r["case"] for r in rows if r["scenario"] == name}):
                totals = {}
                for view in cmp_.VIEWS:
                    totals[view] = cmp_.view_total(rows, view, year, name, case)
                direct = sum(cmp_._num(r["co2e_t"]) for r in rows
                             if r["scenario"] == name and r["case"] == case
                             and int(r["year"]) == year and cmp_.bucket(r["gpc_ref"]) == cmp_.DIRECT)
                assert totals["as_filed"] == pytest.approx(
                    totals["territorial"] + totals["gpc_basic_plus"] - direct, rel=1e-12)
                # no ordering between the two views: Run A 2030 has grid 25.89 > plants 21.02 (GACMO 57.07 vs 61.93)
                assert totals["territorial"] > direct > 0 and totals["gpc_basic_plus"] > direct
                checked += 1
    assert checked == 8          # four scenarios x two years
    text = cmp_.render(rows, [2025, 2030])
    for name in names:
        assert name in text


def test_cli_renders_the_sector_table(tmp_path, monkeypatch, capsys):
    """The command the licensed session will actually type, including --sectors."""
    _leap, rc, rows, _out = dry_builder.run_dry(tmp_path, monkeypatch)
    assert rc == 0
    path = tmp_path / "results.csv"
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    assert cmp_.main(["--results", str(path), "--year", "2030", "--sectors"]) == 0
    out = capsys.readouterr().out
    assert "### 2030" in out
    assert "GPC BASIC+" in out
    assert "by branch" in out
    assert "ver1 (Hang, territorial BAU)" in out


def test_validate_refuses_empty_or_nonnumeric_values(tmp_path):
    """An empty cell is summed as zero, which understates whichever view contains it."""
    rows = OCT_REVIEW_2030 + [row("Mystery branch", "I.3.1", 2030, "")]
    with pytest.raises(ValueError) as excinfo:
        cmp_.validate_rows(rows)
    assert "no numeric co2e_t" in str(excinfo.value)
    assert "Mystery branch" in str(excinfo.value)
    rows = OCT_REVIEW_2030 + [row("Odd branch", "I.3.1", 2030, "n/a")]
    with pytest.raises(ValueError):
        cmp_.validate_rows(rows)
    cmp_.validate_rows(OCT_REVIEW_2030)          # the good rows still pass


def test_growth_rate_maths():
    assert cmp_.growth_rate(100.0, 200.0, 5) == pytest.approx((2 ** 0.2 - 1) * 100)
    assert cmp_.growth_rate(100.0, 100.0, 5) == pytest.approx(0.0)
    assert cmp_.growth_rate(0.0, 100.0, 5) is None          # undefined, not infinity
    assert cmp_.growth_rate(100.0, 0.0, 5) is None
    assert cmp_.growth_rate(100.0, 200.0, 0) is None


def test_render_carries_the_growth_column(tmp_path, monkeypatch):
    """The brief asks for growth rates beside the totals."""
    _leap, rc, rows, _out = dry_builder.run_dry(tmp_path, monkeypatch)
    assert rc == 0
    text = cmp_.render(rows, [2025, 2030])
    assert "CAGR" in text
    for name, *_ in dry_builder.bau.SCENARIOS:
        assert name in text
    first = cmp_.view_total(rows, "territorial", 2025, "B_central", "central")
    last = cmp_.view_total(rows, "territorial", 2030, "B_central", "central")
    expected = cmp_.growth_rate(first, last, 5)
    assert f"{expected:+.2f}" in text


def test_gaps_over_threshold_flags_only_real_gaps():
    """The brief wants every gap > 10 % explained, so the comparison must name them rather than rely on
    a reader noticing."""
    rows = [
        {"scenario": "A_Hang_AsFiled", "case": "central", "sector": "Demand|X", "gpc_ref": "I.1.1",
         "year": "2025", "co2e_t": "44000000", "territory": "merged", "source": "s"},
    ]
    gaps = cmp_.gaps_over_threshold(rows, [2025])
    series = {g[8] for g in gaps}
    assert any("GACMO runA-hang" in s for s in series), series
    assert all(abs(g[7]) > 10.0 for g in gaps), gaps
    # 44.0 vs the repo engine's 8.3 is a gap; vs ver1 as-filed 42.8 it is not
    assert not any("as filed" in s for s in series), series


def test_render_gaps_says_so_when_there_are_none():
    rows = [{"scenario": "A", "case": "central", "sector": "Demand|X", "gpc_ref": "I.1.1",
             "year": "2025", "co2e_t": "42816934", "territory": "merged", "source": "s"}]
    text = cmp_.render_gaps(rows, [2025])
    assert "Gaps over 10 %" in text


def test_ver1_2025_column_is_labelled_not_counted():
    """Steering: the gap against her out-of-date 2025 summary column is her internal inconsistency, not
    a tool effect, so it must not appear in the tool-gap list."""
    rows = [row("Non Energy|AFOLU", "V.3", 2025, 1425133.0, scenario="A_Hang_AsFiled")]
    # A_Hang_AsFiled's as-filed total is her C8; make the row small so the total is far off
    gaps = cmp_.gaps_over_threshold(rows, [2025])
    assert not any("as filed" in g[8] for g in gaps), gaps
    text = cmp_.render_gaps(rows, [2025])
    assert "ver1 internal inconsistency" in text, text


def test_reference_verifier_flags_drift(tmp_path):
    """A rebase on GACMO's side must not silently leave our reference rows stale."""
    csv_path = tmp_path / "gacmo.csv"
    csv_path.write_text(
        "scenario,case,year,sector,co2e_t\n"
        "runA-hang,central,2025,TOTAL excl LULUCF,19900000\n"
        "runA-hang,central,2025,Fossil power plants,20000000\n"
        "runA-hang,central,2025,Grid electricity,11500000\n", encoding="utf-8")
    assert cmp_.verify_gacmo_references(str(csv_path)) == 1     # 39.9 vs the listed 39.931
    csv_path.write_text(
        "scenario,case,year,sector,co2e_t\n"
        "runA-hang,central,2025,TOTAL excl LULUCF,19931432\n"
        "runA-hang,central,2025,Fossil power plants,20000000\n"
        "runA-hang,central,2025,Grid electricity,11506000\n", encoding="utf-8")
    assert cmp_.verify_gacmo_references(str(csv_path)) == 0


def test_reference_verifier_skips_a_missing_file(tmp_path):
    assert cmp_.verify_gacmo_references(str(tmp_path / "absent.csv")) == 0


def test_reader_fails_closed_on_a_missing_scenario(tmp_path):
    """A short results.csv must not render a short table: the reader-side twin of the unticked-scenario
    failure the build detects."""
    path = tmp_path / "results.csv"
    with path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["tool", "scenario", "case", "sector", "gpc_ref", "year",
                                           "co2e_t", "territory", "source"])
        w.writeheader()
        for scenario in ("A_Hang_AsFiled", "B_low", "B_central"):
            w.writerow(row("Demand|X", "I.1.1", 2025, 1000.0, scenario=scenario))
    with pytest.raises(ValueError) as excinfo:
        cmp_.load_results(str(path))
    assert "B_high" in str(excinfo.value)


def test_reader_fails_closed_on_a_missing_year():
    """A missing year renders as zeros, which looks like a real answer - the quietest silent failure."""
    rows = [row("Demand|X", "I.1.1", 2025, 1000.0, scenario=s)
            for s in cmp_.EXPECTED_SCENARIOS]
    cmp_.check_years(rows, [2025])                 # fine
    with pytest.raises(ValueError) as excinfo:
        cmp_.check_years(rows, [2025, 2030])
    assert "2030" in str(excinfo.value)


def test_reader_fails_closed_on_a_missing_band():
    """Each corrected scenario carries its own band, so a missing one is a missing sensitivity."""
    rows = []
    for scenario, case in (("A_Hang_AsFiled", "central"), ("B_low", "low"), ("B_central", "central")):
        rows.append(row("Demand|X", "I.1.1", 2025, 1000.0, scenario=scenario, case=case))
    with pytest.raises(ValueError) as excinfo:
        cmp_.check_cases(rows)
    assert "high" in str(excinfo.value)


def test_base_check_prints_the_targets_and_flags_a_miss():
    """Run-day step 7 as a comparison rather than a memory test."""
    rows = [row("Demand|X", "I.1.1", 2025, 40700000.0, scenario="A_Hang_AsFiled")]
    text = cmp_.render_base_check(rows)
    assert "2025 base check" in text
    assert "31,500,000" in text          # the target (Run A, 1A2 empty)
    assert "A_Hang_AsFiled" in text
    # the same rows give B_central zero, which must be flagged, not silently accepted
    assert "over tolerance" in text


def test_the_two_modules_agree_on_which_refs_are_which():
    """compare.py buckets rows by GPC reference, and build_leap_bau.py decides those references. If the
    two ever disagree, the Scope2 rows or the coal fleet would land in the wrong view - and both views
    would still look plausible."""
    import importlib.util
    import sys

    sys.modules.setdefault("win32com.client", None)
    spec = importlib.util.spec_from_file_location("bau_for_refs", pathlib.Path(HERE, "build_leap_bau.py"))
    bau = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bau)
    bs = chr(92)
    elec = {bau.gpc_ref("Non Energy" + bs + "Scope2" + bs + nm)
            for _c, nm, *_r in bau.NONENERGY_EFFECTS if nm.startswith("Elec_")}
    plants = {bau.gpc_ref("Demand" + bs + "Plants1A1" + bs + p) for p in bau.PLANT_SHARE}
    assert elec == set(cmp_.SCOPE2_REFS), (sorted(elec), cmp_.SCOPE2_REFS)
    assert plants == set(cmp_.PLANT_REFS), (sorted(plants), cmp_.PLANT_REFS)
    # and the same for the names, the horizon and the file they meet at: compare.py's guards catch a
    # renamed scenario or a moved file at run time, but pinning the coupling here says why they must agree
    assert {n for n, _a, _r, _c in bau.SCENARIOS} == set(cmp_.EXPECTED_SCENARIOS)
    assert (bau.BASE_YEAR, bau.END_YEAR) == (cmp_.BASE_YEAR, cmp_.END_YEAR)
    assert pathlib.Path(bau.RESULTS_CSV).name == pathlib.Path(cmp_.RESULTS_CSV).name
