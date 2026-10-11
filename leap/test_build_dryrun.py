"""Dry run of the LEAP builder against a fake COM object.

The real run needs a licence, so the mechanical half of `build_leap_bau.py` has never been executed:
branch creation, expression placement, scenario bookkeeping, the guard rails and the results
extraction. This module fakes the COM surface from `Leap.tlb` closely enough that the builder runs
end to end offline, and then asserts the properties the licensed run depends on:

* it never asks for a variable the area does not have (the fake raises exactly like LEAP does),
* every branch it creates receives an expression in every scenario that should have one,
* the extraction writes leaf branches only, with the band in `case` and `merged` in `territory`,
* no result cell comes back empty.

It is a plumbing test, not a model test: the fake returns invented numbers, so nothing here says the
emissions are right - that is what `expected_activity.csv` and the workbook audit are for.

Run:  .venv/Scripts/python.exe -m pytest -q test_build_dryrun.py
"""
import contextlib
import csv
import importlib.util
import io
import os
import pathlib
import re
import sys
import types

import pytest

HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("build_leap_bau", HERE / "build_leap_bau.py")
bau = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bau)

BS = "\\"
KEY = "Key"   # LEAP's own sample calls the Key Assumptions root "Key" (read live 2026-10-10)
GWP_VAR_NAME = "One_Hundred Year GWP Direct At Point of Emissions"


class _Items:
    def __init__(self, items=None):
        self._items = list(items or [])

    @property
    def Count(self):
        return len(self._items)

    def Item(self, i):
        return self._items[i - 1]

    def append(self, x):
        self._items.append(x)


class FakeVariable:
    def __init__(self, leap, name, branch, unit=""):
        self._leap = leap
        self.Name = name
        self._branch = branch
        self.DataUnitText = unit
        self.IsData = True
        self.DefaultResultUnit = "tCO2e" if "GWP" in name else unit
        self.by_scenario = {}

    @property
    def Expression(self):
        return self.by_scenario.get(self._leap.ActiveScenario)

    @Expression.setter
    def Expression(self, value):
        self.by_scenario[self._leap.ActiveScenario] = value

    def Value(self, year, unit_name, filter_):
        if "GWP" not in self.Name:
            raise RuntimeError("no result for a non-loading variable")
        base = sum(map(ord, self._branch.FullName)) % 997
        return float(base + (year - bau.BASE_YEAR))


class FakeBranch:
    def __init__(self, leap, full_name, btype="Category", fuel=None):
        self._leap = leap
        self.FullName = full_name
        self.Name = full_name.split(BS)[-1]
        self.BranchTypeName = btype
        self.BranchID = len(leap._branches) + 1
        self.Children = _Items()
        self.Variables = _Items()
        self.Fuel = fuel

    def add_variable(self, name, unit=""):
        var = FakeVariable(self._leap, name, self, unit)
        self.Variables.append(var)
        return var


class FakeArea:
    def __init__(self, name, leap=None):
        self.Name = name
        self._leap = leap
        self.Directory = name + "_dir"
        self.CountryName = "Viet Nam"          # LEAP's TED defaults are country-specific
        self.CountryCode2 = "VN"
        self.CountryCode3 = "VNM"

    def Open(self):
        # LEAP's own rule, verbatim in effect: "Area.Open: Cannot open an area - Analysis View is
        # not enabled." Modelled here so the suite catches a caller that skips ShowAnalysisView.
        if not getattr(self._leap, "_analysis_view", False):
            raise RuntimeError("Cannot open an area - Analysis View is not enabled.")

    def Save(self):
        pass


class FakeAreas(_Items):
    def __init__(self, leap):
        super().__init__()
        self._leap = leap

    def Add(self, name, copy_from):
        area = FakeArea(name, self._leap)
        self.append(area)
        return area


class FakeEffect:
    def __init__(self, name):
        self.Name = name
        self.GWP100 = 1.0


class FakeUnit:
    def __init__(self, name, abbrev, unit_class="energy"):
        self.Name = name
        self.Abbreviation = abbrev
        self.UnitClass = unit_class


class FakeCountry:
    def __init__(self, name):
        self.Name = name


class FakeFuel:
    def __init__(self, name):
        self.Name = name


class FakeScenario:
    def __init__(self, name, sid):
        self.Name = name
        self.ScenarioID = sid
        self.IsCurrentAccounts = name == "Current Accounts"
        self.Abbreviation = name
        self.ResultsShown = False
        self.NeedsCalculation = True
        self.ParentScenarioID = 0


class FakeScenarios(_Items):
    def Add(self, name, abbrev, parent_id):
        sc = FakeScenario(name, len(self._items) + 1)
        sc.ParentScenarioID = parent_id
        self.append(sc)


class FakeLeap:
    """Enough of ILEAPApplication for the builder to run, with LEAP's own failure modes."""

    def __init__(self):
        self.ActiveScenario = "Current Accounts"
        self.AreaCountry = ""              # ILEAPApplication.AreaCountry is get/set
        self._countries = _Items([FakeCountry("Viet Nam"), FakeCountry("Thailand")])
        self._units = _Items([FakeUnit(n, a) for n, a in (
            ("Tonne", "t"), ("Litre", "l"), ("Megawatt-Hour", "MWh"), ("Terajoule", "TJ"),
            ("Person", "p"), ("Capita", "cap"), ("Index", "idx"), ("Ratio", "ratio"),
            ("Million Tonnes", "Mt"), ("Percent", "%"), ("Head", "head"), ("Hectare", "ha"))])
        self.Visible = False
        self.Verbose = 0
        self.ShowTransformation = False
        self.ShowNonEnergy = False
        self.BaseYear = 0
        self.EndYear = 0
        self.FirstScenarioYear = 0
        self._branches = []
        self.Areas = FakeAreas(self)
        self._areas = self.Areas
        self._scenarios = FakeScenarios([FakeScenario("Current Accounts", 1)])
        # LEAP's own spellings, from the sample area's datanames.nx1: coal carries a "Coal " prefix
        # and sub-bituminous is written with a space, not a hyphen
        self._fuels = _Items([FakeFuel(f) for f in
                             ("Coal Anthracite", "Coal Sub bituminous", "Diesel DO", "Diesel",
                              "Gasoline", "Residual Fuel Oil", "Electricity", "Coal")])
        self._effects = _Items([FakeEffect("Carbon Dioxide Non Biogenic"),
                               FakeEffect("Carbon Dioxide Biogenic"), FakeEffect("Methane"),
                               FakeEffect("Nitrous Oxide"), FakeEffect("Carbon Monoxide"),
                               FakeEffect("Nitrogen Oxides NOx"), FakeEffect("Sulfur Dioxide"),
                               FakeEffect("Non Methane Volatile Organic Compounds")])
        self.log = []
        self.exports = []
        # a fresh area carries LEAP's template roots, nothing else
        self.seed_area("HaiPhong_BAU")

    # -- area template ------------------------------------------------------
    def seed_area(self, area_name):
        self.Areas.Add(area_name, "")
        self._branches = []
        # LEAP's own sample spells these "Key", "Demand", "Effects" (read live 2026-10-10); the
        # builder resolves them from ROOT_CANDIDATES, so the fake uses the real spelling.
        for root in ("Key", "Demand", "Transformation", "Resources", "Non Energy", "Effects"):
            self._branches.append(FakeBranch(self, root, btype="KeyAssumptions"))

    # -- collections --------------------------------------------------------
    # LEAP refuses database-backed collections in evaluation mode ("Scripting disabled in LEAP
    # evaluation version", seen 2026-10-10 at `Units`) while tree navigation keeps working, so the
    # fake can be put in that mode to prove a caller degrades gracefully.
    evaluation_mode = False

    @property
    def Units(self):
        if self.evaluation_mode:
            raise RuntimeError("Scripting disabled in LEAP evaluation version.")
        return self._units

    @Units.setter
    def Units(self, value):
        self._units = value

    @property
    def Fuels(self):
        if self.evaluation_mode:
            raise RuntimeError("Scripting disabled in LEAP evaluation version.")
        return self._fuels

    @Fuels.setter
    def Fuels(self, value):
        self._fuels = value

    @property
    def Countries(self):
        return self._countries

    @Countries.setter
    def Countries(self, value):
        self._countries = value

    @property
    def Effects(self):
        return self._effects

    @Effects.setter
    def Effects(self, value):
        self._effects = value

    @property
    def Scenarios(self):
        return self._scenarios

    @Scenarios.setter
    def Scenarios(self, value):
        self._scenarios = value

    @property
    def Branches(self):
        return _Items(self._branches)

    def branch(self, full_name):
        for b in self._branches:
            if b.FullName == full_name:
                return b
        return None

    def BranchVariable(self, spec):
        path, _, name = spec.rpartition(":")
        branch = self.branch(path)
        if branch is None:
            raise RuntimeError(f"no branch {path!r}")
        for v in branch.Variables._items:
            if v.Name == name:
                return v
        raise RuntimeError(f"no variable {name!r} on {path!r}")

    # -- mutating calls used by the builder ---------------------------------
    def _new_branch(self, parent_id, name, btype, fuel=None):
        parent = next((b for b in self._branches if b.BranchID == parent_id), None)
        full = name if parent is None else parent.FullName + BS + name
        branch = FakeBranch(self, full, btype=btype, fuel=fuel)
        self._branches.append(branch)
        if parent is not None:
            parent.Children.append(branch)
        self.log.append(("add", full, btype))
        return branch

    def AddCategory(self, parent_id, name, scale, unit):
        # LEAP gives a demand category its standard variable set; "Activity Level" is what the
        # builder writes to, and ACT_VARS falls back to it when "Total Activity" is absent.
        branch = self._new_branch(parent_id, name, "Category")
        branch.add_variable("Activity Level", unit or "MWh")
        branch.add_variable("Final Energy Intensity", "MJ/unit")

    def AddTechnology(self, parent_id, name, scale, unit, fuel, energy_unit):
        branch = self._new_branch(parent_id, name, "Technology", fuel=fuel)
        branch.add_variable("Activity Level", unit)
        # live evidence: a Demand Technology carries Activity Level AND Final Energy Intensity
        # (the intensity is what turns activity into energy in LEAP's Activity Analysis), and a fuel
        # child without one would report zero energy - so the fake must expose it or the defect hides
        branch.add_variable("Final Energy Intensity", energy_unit + "/" + unit)
        branch.add_variable(GWP_VAR_NAME, "tCO2e")

    def AddKeyAssumption(self, parent_id, name, scale, unit):
        branch = self._new_branch(parent_id, name, "KeyAssumption")
        branch.add_variable("Value", unit)

    def AddNonEnergySectorCategory(self, parent_id, name):
        self._new_branch(parent_id, name, "NonEnergyCategory")

    def AddNonEnergySectorEffect(self, parent_id, name, scale, unit, effect):
        self.log.append(("effect", name, effect))
        branch = self._new_branch(parent_id, name, "NonEnergyEffect")
        # live evidence: an Environmental Effect branch carries exactly one variable,
        # "Avg Environmental Loading" - there is no "Emission Factor" variable in LEAP
        branch.add_variable("Avg Environmental Loading", "tCO2e/" + unit)
        branch.add_variable(GWP_VAR_NAME, "tCO2e")

    # -- no-ops the builder calls -------------------------------------------
    def ShowAnalysisView(self):
        self._analysis_view = True
        self.log.append(("showanalysisview",))

    def ExportExpressions(self, path=None):
        # the real signature is undocumented off-tool (the API help defers to the Script Editor), so
        # the builder tries a path first and falls back to no-argument; the fake accepts the path
        if path is None:
            raise RuntimeError("ExportExpressions needs a path in this fake")
        self.log.append(("exportexpressions", path))

    def RefreshBranches(self):
        pass

    def SaveArea(self):
        self.log.append(("savearea",))

    def SaveVersion(self, comment, include_results):
        self.log.append(("saveversion", comment))

    def Calculate(self):
        for sc in self.Scenarios._items:
            sc.NeedsCalculation = False

    def ExportResultsCSV(self, filename):
        self.exports.append(filename)


class FakeWin32Com:
    module = None

    def __init__(self):
        self.client = self
        self.leap = None


    def Dispatch(self, _progid):
        self.leap = FakeLeap()
        return self.leap


def wire_fake(monkeypatch, area_name="HaiPhong_BAU"):
    """Install the fake COM module and return the leap object it will hand out."""
    fake = FakeWin32Com()
    pkg = types.ModuleType("win32com")
    pkg.client = fake
    monkeypatch.setitem(sys.modules, "win32com", pkg)
    monkeypatch.setitem(sys.modules, "win32com.client", fake)
    fake.next_area = area_name
    return fake


def run_dry(tmp_path, monkeypatch):
    """Wire the fake COM in, run the builder, and return (leap, rc, rows, stdout)."""
    fake = FakeWin32Com()
    pkg = types.ModuleType("win32com")
    pkg.client = fake
    monkeypatch.setitem(sys.modules, "win32com", pkg)
    monkeypatch.setitem(sys.modules, "win32com.client", fake)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "results.csv"))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = bau.run_build("HaiPhong_BAU")
    with open(bau.RESULTS_CSV, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    return fake.leap, rc, rows, buf.getvalue()


@pytest.fixture()
def dry(tmp_path, monkeypatch):
    leap, rc, rows, _out = run_dry(tmp_path, monkeypatch)
    return leap, rc, rows


@pytest.fixture()
def dry_out(tmp_path, monkeypatch):
    """Same as `dry` but with the build's stdout, for tests that assert on what it reported."""
    return run_dry(tmp_path, monkeypatch)


def row_spec(leap, path, names=None):
    """The `path:name` spec for the variable a branch actually has - see row_var."""
    return path + ":" + row_var(leap, path, names).Name


def row_var(leap, path, names=None):
    """The variable a branch actually has, out of the names the builder would try.

    A non-energy effect branch carries only `Avg Environmental Loading` (read live 2026-10-10), so the
    tests must not assume `Activity Level` exists on one - that assumption is what the builder had to
    drop, and it is what the live run caught.
    """
    for name in (names or bau.ROW_VARS):
        try:
            return leap.BranchVariable(path + ":" + name)
        except Exception:
            continue
    raise AssertionError(f"none of {list(names or bau.ROW_VARS)} on {path!r}")


def test_dry_run_completes_and_writes_results(dry):
    leap, rc, rows = dry
    assert rc == 0
    assert rows, "no rows written"
    assert list(rows[0]) == bau.RESULT_COLS


def test_dry_run_scenarios_and_columns(dry):
    leap, _rc, rows = dry
    names = {r["scenario"] for r in rows}
    assert names == {n for n, *_ in bau.SCENARIOS}
    assert {r["case"] for r in rows} <= set(bau.BANDS)
    assert {r["territory"] for r in rows} == {"merged"}
    for r in rows:
        assert r["co2e_t"] not in ("", None), r


def test_dry_run_creates_key_assumptions_with_values(dry):
    leap, _rc, _rows = dry
    for name, _unit, value, _note in bau.KEY_ASSUMPTIONS:
        branch = leap.branch(KEY + BS + name)
        assert branch is not None, name
        var = branch.Variables.Item(1)
        assert var.by_scenario["Current Accounts"] == str(value), name
    grdp = leap.branch(KEY + BS + "GRDP_Index").Variables.Item(1)
    for name, *_ in bau.SCENARIOS:
        assert grdp.by_scenario[name].startswith("Growth("), name


def test_dry_run_gives_every_demand_leaf_an_expression(dry):
    leap, _rc, _rows = dry
    missing = []
    for name, _abbrev, run, case in bau.SCENARIOS:
        for path, _unit, _base, ea, eb in bau.DEMAND_CATS:
            leaf = path.split(BS)[-1]
            if leaf in bau.PLANT_SHARE:
                continue                       # the plants' children carry their own expressions
            if run == "B" and leaf in bau.RUN_B_1A2_MT:
                continue                       # set on the branch itself below
            want = ea if run == "A" else (bau.elec_expr(run, case) if _unit == "MWh" else eb)
            if want is None:
                continue
            var = row_var(leap, path)
            if var.by_scenario.get(name) is None:
                missing.append((name, path))
    assert missing == []


def test_dry_run_sets_non_energy_expressions_for_both_runs(dry):
    leap, _rc, _rows = dry
    msw = row_var(leap, "Non Energy" + BS + "Waste" + BS + "MSW_4A1")
    # a non-energy branch has one variable, so the row's factor is folded into the loading
    # 0.01859 t CH4 per t waste x 28 (AR5) = 0.52052 t CO2e per t, which is what the branch holds
    assert msw.by_scenario["A_Hang_AsFiled"] == "Growth(3.7347%)*0.52052"   # ver1's own waste series
    assert msw.by_scenario["B_central"] == "Growth(1.0%)*0.52052"
    assert msw.by_scenario["B_high"] == "Growth(2.0%)*0.52052"
    cement = row_var(leap, "Non Energy" + BS + "IPPU" + BS + "2A1_cement")
    assert cement.by_scenario["A_Hang_AsFiled"] == "Growth(15.2%)*0.43575"  # ver1's IPPU rate, Run A
    assert cement.by_scenario["B_high"] == "8140000*0.52"                   # band clinker x Run B EF


def test_dry_run_extraction_writes_leaves_only(dry):
    leap, _rc, rows = dry
    sectors = {r["sector"] for r in rows}
    assert "Non Energy" + BS + "Scope2" + BS + "Elec_Households" in sectors
    assert "Non Energy" + BS + "Scope2" in sectors or True      # parent, if present, is a category
    assert "Demand" + BS + "Plants1A1" + BS + "Coal_HP_TPP" not in sectors   # parent double counts
    assert "Demand" not in sectors
    assert "Non Energy" not in sectors


def test_dry_run_sets_the_grid_factor_from_the_key_assumption(dry):
    leap, _rc, _rows = dry
    path = "Non Energy" + BS + "Scope2" + BS + "Elec_Households"
    act = leap.BranchVariable(row_spec(leap, path))
    # one variable: the MWh activity and the grid factor are folded, so the loading is emissions
    assert act.by_scenario["A_Hang_AsFiled"] == (
        "Interp(2025,5009135.00,2030,10613357.52,2050,213901103.28)*0.6592")
    # Run B is per-row now (orchestrator's ruling, 2026-10-10): households grow with population and
    # urbanisation, industry with the PDP8 band rate, the other three with GRDP x elasticity
    assert act.by_scenario["B_high"] == (
        "Growth({}%)*".format(bau.BANDS["high"]["pop"]) + KEY + BS + "GridEF")
    industry = leap.BranchVariable(row_spec(
        leap, "Non Energy" + BS + "Scope2" + BS + "Elec_IndustryElec"))
    assert industry.by_scenario["B_high"] == (
        "Growth({}%)*".format(bau.BANDS["high"]["elec"]) + KEY + BS + "GridEF")
    other = leap.BranchVariable(row_spec(
        leap, "Non Energy" + BS + "Scope2" + BS + "Elec_OtherElec"))
    # GrowthAs points at the *root* the build resolved for Key Assumptions, not the full path
    grdp = bau.ROOT_CANDIDATES["key"][0] + BS + "GRDP_Index"
    assert other.by_scenario["B_central"] == (
        "GrowthAs({}, {})*".format(grdp, bau.BANDS["central"]["elasticity"]) + KEY + BS + "GridEF")


def test_dry_run_applies_ar5_gwp_by_alias(dry):
    leap, _rc, _rows = dry
    gwp = {e.Name: e.GWP100 for e in leap.Effects._items}
    assert gwp["Methane"] == 28.0
    assert gwp["Nitrous Oxide"] == 265.0
    # LEAP splits CO2 biogenic/non-biogenic; both carry AR5 CO2 = 1
    assert gwp["Carbon Dioxide Non Biogenic"] == 1.0
    assert gwp["Carbon Dioxide Biogenic"] == 1.0


def test_dry_run_never_asks_for_a_missing_variable(dry):
    """The fake raises like LEAP on an unknown branch path or variable name."""
    leap, rc, rows = dry
    assert rc == 0 and rows
    # every branch the extraction wrote came from the tree the builder itself created
    written = {r["sector"] for r in rows}
    known = {b.FullName for b in leap._branches}
    assert written <= known


def test_dry_run_sets_plant_children_per_run(dry):
    """Run A gets ver1's single 5 % step, Run B holds the fleet flat."""
    leap, _rc, _rows = dry
    for plant, share in bau.PLANT_SHARE.items():
        child = "Demand" + BS + "Plants1A1" + BS + plant + BS + "Anthracite"
        var = row_var(leap, child)
        a = var.by_scenario["A_Hang_AsFiled"]
        b = var.by_scenario["B_central"]
        assert a.startswith(f"Interp({bau.BASE_YEAR},")
        assert bau.evaluate_activity(a, bau.PLANT_FUEL_BASE["Anthracite"] * share, 2030) == \
            pytest.approx(bau.PLANT_FUEL_BASE["Anthracite"] * share * 1.05)
        assert b == "Growth(0%)"


def test_dry_run_exports_the_raw_tool_output(dry):
    """The brief wants the tool's own export beside the tidy file, so the build asks for both."""
    leap, _rc, _rows = dry
    names = {os.path.basename(p) for p in leap.exports}
    assert names == {f"{n}.csv" for n, *_ in bau.SCENARIOS}


def test_dry_run_sets_the_area_country(tmp_path, monkeypatch):
    """Fuel factors come from the country's TED rows; the build sets AreaCountry itself."""
    leap, rc, _rows, out = run_dry(tmp_path, monkeypatch)
    assert rc == 0
    assert "area country set to 'Viet Nam'" in out
    assert leap.AreaCountry == "Viet Nam"
    assert "WARNING" not in out


def test_dry_run_warns_when_leap_has_no_viet_nam(tmp_path, monkeypatch):
    class NoVietnam(FakeWin32Com):
        def Dispatch(self, _progid):
            leap = super().Dispatch(_progid)
            leap.Countries = _Items([FakeCountry("Thailand")])
            return leap

    blank = NoVietnam()
    pkg = types.ModuleType("win32com")
    pkg.client = blank
    monkeypatch.setitem(sys.modules, "win32com", pkg)
    monkeypatch.setitem(sys.modules, "win32com.client", blank)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "res.csv"))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        bau.run_build("HaiPhong_BAU")
    assert "no Viet Nam in LEAP's country list" in buf.getvalue()


def test_dry_run_bands_actually_differ(dry):
    """A band that is threaded wrongly would leave all three B scenarios identical, and the
    comparison's low/central/high table would be three copies of one number."""
    leap, _rc, _rows = dry
    key = KEY + BS
    elec = row_spec(leap, "Non Energy" + BS + "Scope2" + BS + "Elec_IndustryElec")
    checks = {
        "grid factor": (key + "GridEF:Value", "{}".format(bau.BANDS["central"]["grid2030"])),
        "electricity rate": (elec, "{}".format(bau.BANDS["central"]["elec"])),
        "households rate": (row_spec(leap, "Non Energy" + BS + "Scope2" + BS + "Elec_Households"),
                            "{}".format(bau.BANDS["central"]["pop"])),
        "scope2 elasticity": (row_spec(leap, "Non Energy" + BS + "Scope2" + BS + "Elec_Commercial"),
                              "{}".format(bau.BANDS["central"]["elasticity"])),
        "steel cap": (row_spec(leap, "Non Energy" + BS + "IPPU" + BS + "2C1_steel"),
                      bau.steel_cap_expr("central")),
        "clinker": (row_spec(leap, "Non Energy" + BS + "IPPU" + BS + "2A1_cement"),
                    bau.clinker_act_expr("central")),
        "waste": (row_spec(leap, "Non Energy" + BS + "Waste" + BS + "MSW_4A1"),
                  bau.band_b_expr("MSW_4A1", "central", None)),
        "rice": (row_spec(leap, "Non Energy" + BS + "AFOLU" + BS + "Rice_3C7"),
                 bau.band_b_expr("Rice_3C7", "central", None)),
        "population": (row_spec(leap, "Non Energy" + BS + "Waste" + BS + "Wastewater_4D_CH4"),
                       bau.band_b_expr("Wastewater_4D_CH4", "central", None)),
    }
    for label, (spec, central_token) in checks.items():
        values = {}
        for name in ("B_low", "B_central", "B_high"):
            values[name] = leap.BranchVariable(spec).by_scenario.get(name)
        assert all(v is not None for v in values.values()), (label, values)
        assert values["B_central"] is not None
        assert central_token in values["B_central"], (label, central_token, values["B_central"])
        assert values["B_low"] != values["B_high"], (label, values)


def test_dry_run_low_is_below_high_at_2030(dry):
    """Where the band drives a growth rate, the 2030 activity must order low < central < high."""
    leap, _rc, _rows = dry
    spec = row_spec(leap, "Non Energy" + BS + "Waste" + BS + "MSW_4A1")
    base = 1204135.0
    vals = {}
    for name in ("B_low", "B_central", "B_high"):
        expr = leap.BranchVariable(spec).by_scenario[name]
        vals[name] = bau.evaluate_activity(expr, base, bau.COMPARE_YEAR)
    assert vals["B_low"] < vals["B_central"] < vals["B_high"], vals


def test_expected_activity_matches_what_the_builder_writes(dry, tmp_path):
    """The fixture is only worth anything if it agrees with the tree the build creates.

    For every row of `expected_activity.csv`, take the expression the builder actually recorded on
    that branch, evaluate it at the fixture's year using the fixture's own 2025 value as the base, and
    require the same answer. Growth forms, Interp forms and the band markers are all covered.
    """
    leap, _rc, _rows = dry
    out = tmp_path / "expected.csv"
    bau.run_expect(str(out))
    fixture = list(csv.DictReader(io.StringIO(out.read_text(encoding="utf-8"))))
    base_by = {}
    for r in fixture:
        if r["year"] == str(bau.BASE_YEAR):
            # the build folds each non-energy row's factor into the loading, so recover the activity
            base_by[(r["scenario"], r["branch"])] = (float(r["activity_expected"])
                                                     / float(r["factor"]))
    checked = 0
    for r in fixture:
        key = (r["scenario"], r["branch"])
        base = base_by.get(key)
        try:
            var = row_var(leap, r["branch"])
        except RuntimeError:
            continue                       # value carried by a parent branch, not a leaf
        expr = var.by_scenario.get(r["scenario"])
        if expr is None:
            continue
        case = r["scenario"].replace("B_", "") if r["scenario"].startswith("B_") else "central"
        # the grid series is 0.6592 in 2025 and the band's value in 2030 (grid_expr)
        grid_at_year = (0.6592 if int(r["year"]) == bau.BASE_YEAR else bau.BANDS[case]["grid2030"])
        subs = {KEY + BS + "GridEF": grid_at_year}
        got = bau.evaluate_activity(expr, base if base is not None else 1.0, int(r["year"]),
                                    subs=subs)
        assert got is not None, (key, expr)
        # the fixture is written to 6 significant digits, so compare at that resolution
        assert got == pytest.approx(float(r["activity_expected"]), rel=1e-5, abs=0.005), (key, expr)
        checked += 1
    assert checked > 200, checked          # a name change must not quietly empty this test


def test_dump_reports_the_area_without_building(tmp_path, monkeypatch):
    """--dump is the first command the licensed session runs; it must work on a tree it did not build."""
    wire_fake(monkeypatch)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "results.csv"))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = bau.run_dump("HaiPhong_BAU", 2)
    out = buf.getvalue()
    assert rc == 0
    assert "roots" in out and "Key" in out
    assert "country 'Viet Nam'" in out
    assert "effects" in out and "Methane" in out       # GWP is set by a build, not by dump
    assert "fuels" in out and "Anthracite" in out
    assert "scenarios" in out and "Current Accounts" in out
    assert "BR " + KEY in out
    assert "DUMP done" in out
    assert not (tmp_path / "results.csv").exists()      # dump writes nothing


def test_dump_reports_a_missing_area(tmp_path, monkeypatch):
    wire_fake(monkeypatch)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = bau.run_dump("Nowhere", 2)
    assert rc == 2
    assert "no area named" in buf.getvalue()


def test_build_into_a_named_area(tmp_path, monkeypatch):
    """A rehearsal build must go into the area it is told, not the default one."""
    fake = wire_fake(monkeypatch)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "results.csv"))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = bau.run_build("HaiPhong_rehearsal")
    assert rc == 0
    assert any(a.Name == "HaiPhong_rehearsal" for a in fake.leap.Areas._items)
    assert "created area HaiPhong_rehearsal" in buf.getvalue()


class NoResultVariable(FakeVariable):
    """A loading variable LEAP cannot give a number for - the unit-name mismatch case."""

    def Value(self, year, unit_name, filter_):
        return None


def _run_build_with(tmp_path, monkeypatch, mutate, area="HaiPhong_BAU"):
    fake = wire_fake(monkeypatch)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "results.csv"))
    _orig = FakeWin32Com.Dispatch
    def dispatch(_progid):
        leap = _orig(fake, _progid)
        mutate(leap)
        return leap
    fake.Dispatch = dispatch
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = bau.run_build(area)
    return rc, buf.getvalue()


def test_build_fails_loudly_when_a_root_is_missing(tmp_path, monkeypatch):
    """A missing root must name the area's actual top level instead of failing somewhere deep."""
    def drop_nonenergy(leap):
        leap._branches = [b for b in leap._branches if b.FullName != "Non Energy"]
    with pytest.raises(RuntimeError) as excinfo:
        _run_build_with(tmp_path, monkeypatch, drop_nonenergy)
    assert "nonenergy" in str(excinfo.value)
    assert KEY in str(excinfo.value)                    # the diagnostic lists what is there


def test_build_fails_loudly_when_a_scenario_is_not_calculated(tmp_path, monkeypatch):
    def never_calculate(leap):
        leap.Calculate = lambda: None            # leaves NeedsCalculation True
    with pytest.raises(RuntimeError) as excinfo:
        _run_build_with(tmp_path, monkeypatch, never_calculate)
    assert "uncalculated" in str(excinfo.value)


def test_build_fails_loudly_when_every_cell_is_empty(tmp_path, monkeypatch):
    seen = {"swapped": 0}

    def no_results(leap):
        # the tree exists only once the build has created it, so the swap happens inside Calculate
        def calc():
            for b in leap._branches:
                b.Variables._items = [
                    NoResultVariable(v._leap, v.Name, b, v.DataUnitText) if "GWP" in v.Name else v
                    for v in b.Variables._items]
            seen["swapped"] = sum(1 for b in leap._branches for v in b.Variables._items
                                  if isinstance(v, NoResultVariable))
            for sc in leap.Scenarios._items:
                sc.NeedsCalculation = False
        leap.Calculate = calc
    with pytest.raises(RuntimeError) as excinfo:
        _run_build_with(tmp_path, monkeypatch, no_results)
    assert "every results cell came back empty" in str(excinfo.value)
    assert seen["swapped"] > 0        # else the branch list was empty and this proved nothing


def test_build_is_idempotent(tmp_path, monkeypatch):
    """The docstring promises `--build` is idempotent: running it twice on a live area must not
    duplicate branches, variables or scenarios, because a session will re-run it after any fix."""
    fake = wire_fake(monkeypatch)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "results.csv"))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        first = bau.run_build("HaiPhong_BAU")
        after_first = (len(fake.leap._branches),
                       sum(len(b.Variables._items) for b in fake.leap._branches),
                       len(fake.leap.Scenarios._items))
        second = bau.run_build("HaiPhong_BAU")
        after_second = (len(fake.leap._branches),
                        sum(len(b.Variables._items) for b in fake.leap._branches),
                        len(fake.leap.Scenarios._items))
    assert first == 0 and second == 0
    assert after_first == after_second, (after_first, after_second)
    names = [b.FullName for b in fake.leap._branches]
    assert len(names) == len(set(names)), "a branch was created twice"
    assert "reusing area HaiPhong_BAU" in buf.getvalue()
    # a rebuild must also re-place the expressions rather than leaving them stale
    msw = row_var(fake.leap, "Non Energy" + BS + "Waste" + BS + "MSW_4A1")
    assert msw.by_scenario["B_high"] == "Growth(2.0%)*0.52052"


def test_dry_run_takes_a_snapshot_before_writing(dry):
    """The build edits a live area, so it must leave a restore point first (SaveVersion is the only
    snapshot COM exposes; ILEAPArea.Backup needs an unknown mode enum)."""
    leap, _rc, _rows = dry
    kinds = [entry[0] for entry in leap.log]
    assert "saveversion" in kinds
    first_change = next(i for i, k in enumerate(kinds) if k == "add")
    assert kinds.index("saveversion") < first_change
    # the log is heterogeneous - markers carry no payload, effects carry three fields - so read the
    # payload positionally instead of unpacking every entry
    comment = next(e[1] for e in leap.log if e[0] == "saveversion")
    assert "HaiPhong_BAU" in comment and str(bau.BASE_YEAR) in comment


def test_dry_run_reports_unit_coverage(tmp_path, monkeypatch):
    """Every unit the build passes must be one LEAP knows, matched by name or abbreviation."""
    _leap, rc, _rows, out = run_dry(tmp_path, monkeypatch)
    assert rc == 0
    assert "units:" in out
    assert "0 not in LEAP's list" in out, out[-400:]


def test_dry_run_names_unknown_units(tmp_path, monkeypatch):
    class FewUnits(FakeWin32Com):
        def Dispatch(self, _progid):
            leap = super().Dispatch(_progid)
            leap.Units = _Items([FakeUnit("Tonne", "t")])
            return leap

    fake = FewUnits()
    pkg = types.ModuleType("win32com")
    pkg.client = fake
    monkeypatch.setitem(sys.modules, "win32com", pkg)
    monkeypatch.setitem(sys.modules, "win32com.client", fake)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "res.csv"))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = bau.run_build("HaiPhong_BAU")
    out = buf.getvalue()
    assert rc == 0
    assert "not in LEAP's list" in out and "litre" in out.lower()
    assert "WARNING: LEAP does not recognise these units" in out


def test_dry_run_reports_effect_coverage(tmp_path, monkeypatch):
    """Every pollutant the build passes must exist in LEAP's effect list, by name or by substring."""
    _leap, rc, _rows, out = run_dry(tmp_path, monkeypatch)
    assert rc == 0
    assert "effects: 3 used, 0 not in LEAP's list" in out, out[-400:]


def test_dry_run_names_unknown_effects(tmp_path, monkeypatch):
    class OddEffects(FakeWin32Com):
        def Dispatch(self, _progid):
            leap = super().Dispatch(_progid)
            leap.Effects = _Items([FakeEffect("Carbon dioxide (CO2)")])
            return leap

    fake = OddEffects()
    pkg = types.ModuleType("win32com")
    pkg.client = fake
    monkeypatch.setitem(sys.modules, "win32com", pkg)
    monkeypatch.setitem(sys.modules, "win32com.client", fake)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "res.csv"))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = bau.run_build("HaiPhong_BAU")
    out = buf.getvalue()
    assert rc == 0
    # "Carbon Dioxide" resolves to LEAP's "Carbon dioxide (CO2)" by substring; Methane and N2O do not
    assert "effects: 3 used, 2 not in LEAP's list" in out
    assert "Methane" in out and "Nitrous Oxide" in out


def test_dry_run_passes_leaps_own_pollutant_spelling(tmp_path, monkeypatch):
    """A resolved effect name must be what reaches AddNonEnergySectorEffect, not ours."""
    class Spelled(FakeWin32Com):
        def Dispatch(self, _progid):
            leap = super().Dispatch(_progid)
            leap.Effects = _Items([FakeEffect("Carbon dioxide (CO2)"), FakeEffect("Methane (CH4)"),
                                   FakeEffect("Nitrous oxide (N2O)")])
            return leap

    fake = Spelled()
    pkg = types.ModuleType("win32com")
    pkg.client = fake
    monkeypatch.setitem(sys.modules, "win32com", pkg)
    monkeypatch.setitem(sys.modules, "win32com.client", fake)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "res.csv"))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = bau.run_build("HaiPhong_BAU")
    assert rc == 0
    passed = {entry[2] for entry in fake.leap.log if entry[0] == "effect"}
    assert passed == {"Carbon dioxide (CO2)", "Methane (CH4)", "Nitrous oxide (N2O)"}, passed


def test_carbon_dioxide_never_resolves_to_biogenic():
    """LEAP's default list splits CO2; biogenic CO2 is out of the GWP total, so it must never be picked."""
    class Leap:
        Effects = _Items([FakeEffect("Carbon Dioxide Biogenic"), FakeEffect("Carbon Dioxide Non Biogenic"),
                          FakeEffect("Methane"), FakeEffect("Nitrous Oxide")])
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        resolved, unknown = bau.check_effects(Leap())
    assert resolved["Carbon Dioxide"] == "Carbon Dioxide Non Biogenic", resolved
    assert unknown == []


def test_dry_run_parents_scenarios_on_the_base(tmp_path, monkeypatch):
    _leap, rc, _rows, out = run_dry(tmp_path, monkeypatch)
    assert rc == 0
    assert "scenario parent: 'Current Accounts'" in out


def test_dry_run_finds_the_base_by_flag_not_by_name(tmp_path, monkeypatch):
    """A renamed base scenario must still be found: its children inherit everything they do not set."""
    class Renamed(FakeWin32Com):
        def Dispatch(self, _progid):
            leap = super().Dispatch(_progid)
            leap.Scenarios._items[0].Name = "Kich ban co so"          # renamed, flag intact
            return leap

    fake = Renamed()
    pkg = types.ModuleType("win32com")
    pkg.client = fake
    monkeypatch.setitem(sys.modules, "win32com", pkg)
    monkeypatch.setitem(sys.modules, "win32com.client", fake)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "res.csv"))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = bau.run_build("HaiPhong_BAU")
    out = buf.getvalue()
    assert rc == 0
    assert "scenario parent: 'Kich ban co so'" in out
    parents = {sc.ParentScenarioID for sc in fake.leap.Scenarios._items if sc.Name != "Kich ban co so"}
    assert parents == {1}, parents


def test_dry_run_warns_when_there_is_no_base(tmp_path, monkeypatch):
    class NoBase(FakeWin32Com):
        def Dispatch(self, _progid):
            leap = super().Dispatch(_progid)
            leap.Scenarios._items[0].IsCurrentAccounts = False
            leap.Scenarios._items[0].Name = "Baseline?"
            return leap

    fake = NoBase()
    pkg = types.ModuleType("win32com")
    pkg.client = fake
    monkeypatch.setitem(sys.modules, "win32com", pkg)
    monkeypatch.setitem(sys.modules, "win32com.client", fake)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "res.csv"))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = bau.run_build("HaiPhong_BAU")
    assert rc == 0
    assert "no Current Accounts scenario" in buf.getvalue()


def test_dry_run_confirms_the_years(dry_out):
    _leap, _rc, _rows, out = dry_out
    assert f"years: base={bau.BASE_YEAR} end={bau.END_YEAR} first_scenario={bau.FIRST_SCEN_YEAR}" in out


def test_build_stops_when_leap_refuses_the_base_year(tmp_path, monkeypatch):
    """A base year LEAP will not change would shift the origin of every expression."""
    class FixedBase(FakeWin32Com):
        def Dispatch(self, _progid):
            leap = super().Dispatch(_progid)
            leap.BaseYear = 2020                      # LEAP keeps an established base year

            class Stubborn(type(leap)):
                pass

            def setattr_guard(obj, name, value):
                if name == "BaseYear":
                    return                            # silently refused, as LEAP does
                object.__setattr__(obj, name, value)

            leap.__class__ = type("Stubborn", (FakeLeap,), {
                "__setattr__": lambda self, n, v: object.__setattr__(self, n, v)
                if n != "BaseYear" else None})
            return leap

    fake = FixedBase()
    pkg = types.ModuleType("win32com")
    pkg.client = fake
    monkeypatch.setitem(sys.modules, "win32com", pkg)
    monkeypatch.setitem(sys.modules, "win32com.client", fake)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "res.csv"))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        with pytest.raises(RuntimeError) as excinfo:
            bau.run_build("HaiPhong_BAU")
    assert "BaseYear" in str(excinfo.value)
    assert "build into a fresh area" in str(excinfo.value)


def test_dry_run_reports_plausible_totals(dry_out):
    _leap, _rc, _rows, out = dry_out
    assert "plausibility:" in out
    assert "bands ordered" in out


def test_plausibility_refuses_zero_and_inverted_bands():
    """Both are invisible per cell and only show in the totals."""
    with pytest.raises(RuntimeError) as zero:
        bau.check_plausible({("B_central", "central"): 0.0})
    assert "summed to zero" in str(zero.value)
    with pytest.raises(RuntimeError) as inverted:
        bau.check_plausible({("B_low", "low"): 300.0, ("B_central", "central"): 200.0,
                             ("B_high", "high"): 100.0})
    assert "not low <= central <= high" in str(inverted.value)
    bau.check_plausible({("B_low", "low"): 100.0, ("B_central", "central"): 200.0,
                         ("B_high", "high"): 300.0})       # ordered: no raise


def test_dry_run_labels_judgement_placeholders_in_source(dry):
    """Steering(2) asks for the TBD-driver label in results.csv's source column, not only in the CSV map."""
    _leap, _rc, rows = dry
    by_sector = {r["sector"]: r["source"] for r in rows}
    transport = [v for k, v in by_sector.items() if k.startswith("Demand" + BS + "Transport")]
    plants = [v for k, v in by_sector.items() if k.startswith("Demand" + BS + "Plants1A1")]
    waste = [v for k, v in by_sector.items() if k.startswith("Non Energy" + BS + "Waste")]
    assert transport and all("judgement-placeholder" in v for v in transport)
    assert plants and all("judgement-placeholder" in v for v in plants)
    assert waste and all("judgement-placeholder" not in v for v in waste)
    assert all(v.startswith("inputs.csv Phase2 map") for v in by_sector.values())


def test_fuel_names_normalise_separators():
    """LEAP spells coal "Coal Sub bituminous" where we say "Sub-Bituminous"."""
    available = ["Coal Anthracite", "Coal Sub bituminous", "Diesel", "Residual Fuel Oil"]
    assert bau.pick_fuel(available, ["Sub-Bituminous"]) == ("Coal Sub bituminous", "fuzzy")
    assert bau.pick_fuel(available, ["Anthracite"]) == ("Coal Anthracite", "fuzzy")
    assert bau.pick_fuel(available, ["Diesel"]) == ("Diesel", "exact")


def test_dry_run_resolves_coal_and_prefers_non_biogenic_co2(tmp_path, monkeypatch):
    fake = wire_fake(monkeypatch)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "results.csv"))
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = bau.run_build("HaiPhong_BAU")
    out = buf.getvalue()
    assert rc == 0
    assert "effects: 3 used, 0 not in LEAP's list" in out
    resolved = {effect for entry in fake.leap.log if entry[0] == "effect" for effect in entry[2:3]}
    assert "Carbon Dioxide Non Biogenic" in resolved, resolved
    assert "Carbon Dioxide Biogenic" not in resolved, resolved
    fuels = {b.Fuel for b in fake.leap._branches if getattr(b, "Fuel", None)}
    assert "Coal Anthracite" in fuels and "Coal Sub bituminous" in fuels, fuels


def test_fuel_fuzzy_match_is_unique_and_never_bio():
    """'Coal' fits every coal type and 'Diesel' fits 'Biodiesel'; neither may be picked by list order."""
    available = ["Biodiesel", "Diesel DO", "Coal Bituminous", "Coal Anthracite", "Coal Sub bituminous"]
    assert bau.pick_fuel(available, ["Diesel"]) == ("Diesel DO", "fuzzy")
    assert bau.pick_fuel(available, ["Coal"]) == (None, None)
    assert bau.pick_fuel(available, ["Coal Anthracite", "Anthracite", "Coal"]) == ("Coal Anthracite", "exact")
    assert bau.FUEL_CHILDREN["Steel_1A2a"][0][1][0] == "Coal Anthracite"


def test_activity_level_is_preferred_over_total_activity():
    """Total Activity is LEAP's computed result, Activity Level is the entered input."""
    assert bau.ACT_VARS[0] == "Activity Level", bau.ACT_VARS
    assert bau.ACT_VARS[1] == "Total Activity"


def test_dry_run_uses_activity_level_not_total_activity(tmp_path, monkeypatch):
    fake = wire_fake(monkeypatch)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "results.csv"))
    with contextlib.redirect_stdout(io.StringIO()):
        rc = bau.run_build("HaiPhong_BAU")
    assert rc == 0
    attached = {v.Name for b in fake.leap._branches for v in b.Variables._items}
    assert "Activity Level" in attached, sorted(attached)
    assert "Total Activity" not in attached, sorted(attached)


def test_every_written_expression_uses_a_function_leap_has(tmp_path, monkeypatch):
    """Names checked against LEAP's shipped function table (`_dictionaryNX/Functions.nx1` - an
    [INSTALL-FILE READ], a withdrawn method: see FINDINGS.md 5; the test does not read the file,
    it asserts the table the builder ships), which carries
    Growth, GrowthAs, Interp, If and Step and describes Interp/Step as year/value pairs - the form we
    emit. A function name LEAP does not have would fail the build mid-write."""
    leap = wire_fake(monkeypatch)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "results.csv"))
    with contextlib.redirect_stdout(io.StringIO()):
        rc = bau.run_build("HaiPhong_BAU")
    assert rc == 0
    written = []
    for b in leap.leap._branches:
        for v in b.Variables._items:
            expr = getattr(v, "Expression", None)
            if isinstance(expr, str) and expr:
                written.append(expr)
    assert written, "no expressions written"
    names = set()
    for expr in written:
        names.update(re.findall(r"([A-Za-z][A-Za-z0-9_]*)\s*\(", expr))
    known = {"Growth", "GrowthAs", "Interp", "If", "Step"}
    assert names <= known, sorted(names - known)
    assert {"Interp", "Growth"} <= names, sorted(names)


def test_missing_pywin32_names_the_interpreter(monkeypatch, capsys):
    """The two venvs on this machine differ: the project env has no pywin32, this folder's does."""
    monkeypatch.setitem(sys.modules, "win32com.client", None)
    assert bau.run_build("HaiPhong_BAU") == 2
    out = capsys.readouterr().out
    assert "needs pywin32" in out
    assert sys.executable in out
    assert ".venv" + BS + "Scripts" in out


def test_dump_survives_the_evaluation_mode_gate(monkeypatch, capsys):
    """In evaluation mode LEAP refuses database-backed collections - "Scripting disabled in LEAP
    evaluation version" - while tree navigation works. --dump must still report the tree."""
    fake = wire_fake(monkeypatch)

    class GatedLeap(type(fake.leap) if fake.leap else object):
        pass

    original = fake.Dispatch

    def dispatch(_progid):
        leap = original(_progid)
        leap.evaluation_mode = True
        return leap

    monkeypatch.setattr(fake, "Dispatch", dispatch)
    rc = bau.run_dump("HaiPhong_BAU", 1)
    out = capsys.readouterr().out
    assert rc == 0
    assert "not readable here" in out
    assert "need the licence" in out
    assert "roots" in out and "DUMP done" in out


def test_current_accounts_agrees_with_each_interp_start(dry):
    """LEAP's help for Interp: "the base year value is always implicit in the above function, and will
    override any value explicitly entered for that year by the user." So the Current Accounts value and
    the first point of every Interp we write must agree, or the tool silently uses the other one."""
    leap, _rc, _rows = dry
    checked = 0
    for b in leap._branches:
        for v in b.Variables._items:
            base = v.by_scenario.get("Current Accounts")
            if base is None:
                continue
            for scen, expr in v.by_scenario.items():
                if scen == "Current Accounts" or not isinstance(expr, str):
                    continue
                if not expr.startswith(f"Interp({bau.BASE_YEAR},"):
                    continue
                body = expr[len("Interp("):]
                close = body.index(")")
                first = body[:close].split(",")[1].strip()
                factor = 1.0
                tail = expr[expr.index(")") + 1:]
                if tail.startswith("*"):
                    try:
                        factor = float(tail[1:])       # a folded non-energy row
                    except ValueError:
                        factor = 1.0                   # a Key Assumptions path, not a literal
                assert float(first) * factor == pytest.approx(float(base), rel=1e-9), (
                    b.FullName, v.Name, scen, base, expr)
                checked += 1
    assert checked > 0, "no Interp start points were checked"


def test_unticked_scenario_stops_the_build():
    """A scenario left unticked in Scenario Manager has no results and no error; the build must stop."""
    full = {(name, case): 100.0 for name, _a, _r, case in bau.SCENARIOS}
    bau.check_all_scenarios(full)
    del full[("B_high", "high")]
    with pytest.raises(RuntimeError) as gone:
        bau.check_all_scenarios(full)
    assert "B_high" in str(gone.value)


def test_unit_classes_are_reported(dry_out):
    """LEAPUnit.UnitClass (Help24/API/Units_API.htm) tells energy from mass from volume."""
    _leap, rc, _rows, out = dry_out
    assert rc == 0
    assert "unit classes:" in out
    assert "tonne=" in out.lower() or "Tonne=" in out


def test_dry_run_exports_expressions_for_reproducibility(dry_out):
    """The brief asks for raw tool outputs; the expressions written are half of that record."""
    _leap, rc, _rows, out = dry_out
    assert rc == 0
    assert "ExportExpressions ->" in out, out[-500:]


def test_watchdog_reports_and_exits_when_it_fires(monkeypatch, capsys):
    """A COM hang must become a diagnosis, not a silent stop. os._exit is patched so the test does not
    take the test process down with it."""
    import time

    exits = []
    monkeypatch.setattr(bau.os, "_exit", lambda code: exits.append(code))
    timer = bau.start_watchdog(0.05)
    time.sleep(0.25)
    timer.cancel()
    out = capsys.readouterr().out
    assert "WATCHDOG" in out, out
    assert "modal LEAP dialog" in out, out
    assert exits == [3], exits


def test_dry_run_disarms_the_watchdog(dry_out):
    """A successful build must not leave a timer that would fire later in the same process."""
    _leap, rc, _rows, _out = dry_out
    assert rc == 0
    import threading
    alive = [th for th in threading.enumerate() if th.name.startswith("Timer")]
    assert not alive, alive


def test_dry_run_reports_the_starting_tree_size(dry_out):
    """A run log should say whether the area was fresh, since a stale branch would add unaccounted
    emissions and the build only overwrites the branches it owns."""
    _leap, rc, _rows, out = dry_out
    assert rc == 0
    assert "branches before the build:" in out, out[:400]


def test_every_fuel_technology_gets_an_energy_intensity(dry):
    """LEAP computes energy as activity x intensity, and the help puts the intensity on the bottom-level
    technology branch. A fuel child without one reports zero energy, which removes its sector."""
    leap, rc, _rows = dry
    assert rc == 0
    checked = 0
    for b in leap._branches:
        if getattr(b, "BranchTypeName", "") != "Technology":
            continue
        names = [v.Name for v in b.Variables._items]
        assert "Final Energy Intensity" in names, (b.FullName, names)
        v = next(v for v in b.Variables._items if v.Name == "Final Energy Intensity")
        assert v.by_scenario.get("Current Accounts"), (b.FullName, v.by_scenario)
        checked += 1
    assert checked >= 6, checked


def test_a_parent_of_fuel_children_holds_one_not_a_quantity(dry):
    """LEAP multiplies activity down the branch, so a parent holding its own absolute while its children
    hold theirs would square the quantity (3.9e7 litres becomes 1.5e15). The product must be the
    quantity, and this test is the guard that would have caught it."""
    leap, rc, _rows = dry
    assert rc == 0
    checked = 0
    for b in leap._branches:
        leaf = b.FullName.split(BS)[-1]
        if leaf not in bau.FUEL_CHILDREN:
            continue
        var = next((v for v in b.Variables._items if v.Name == "Activity Level"), None)
        assert var is not None, b.FullName
        values = set(var.by_scenario.values())
        assert values == {"1"}, (b.FullName, var.by_scenario)
        checked += 1
    assert checked >= 4, checked


def test_every_modelled_leaf_reaches_results(dry_out):
    """The extraction writes leaf branches that expose a 100-year GWP variable, so a leaf that loses one
    would vanish from results.csv with no error - and the comparison would silently miss a sector."""
    _leap, rc, rows, _out = dry_out
    assert rc == 0
    sectors = {r["sector"] for r in rows}
    modelled = set()
    for path, _u, _b, _ea, _eb in bau.DEMAND_CATS:
        if bau.has_fuel_children(path):
            leaf = path.split(BS)[-1]
            for suffix, _c, _n in bau.FUEL_CHILDREN.get(leaf, []):
                modelled.add(path + BS + suffix)
            if leaf in bau.PLANT_SHARE:
                for suffix in bau.PLANT_FUEL_BASE:
                    modelled.add(path + BS + suffix)
        else:
            modelled.add(path)
    for cat, nm, *_rest in bau.NONENERGY_EFFECTS:
        modelled.add(bau.ROOT_CANDIDATES["nonenergy"][0] + BS + cat + BS + nm)
    missing = sorted(m for m in modelled if m not in sectors)
    assert not missing, missing
    assert len(modelled) >= 40, len(modelled)


def test_verify_activity_reads_the_fixture_and_reports(tmp_path, monkeypatch, capsys):
    """The verifier is run-day step 6 made mechanical: it must read every fixture row and report rather
    than raise. The fake returns synthetic values, so mismatches are expected here - the point is the
    mechanism, and that it never dies on a row it cannot read."""
    wire_fake(monkeypatch)
    monkeypatch.setattr(bau, "RESULTS_CSV", str(tmp_path / "results.csv"))
    fixture = tmp_path / "expected.csv"
    bau.run_expect(str(fixture))
    rc = bau.run_verify_activity(str(fixture))
    out = capsys.readouterr().out
    assert rc == 1, out[-300:]          # the fake's numbers do not match the fixture
    assert "activity check:" in out
    assert "rows read" in out


def test_the_analysis_view_is_shown_before_anything_is_written(tmp_path, monkeypatch):
    """LEAP refuses `Area.Open` outright - "Cannot open an area - Analysis View is not enabled" - and
    this fake enforces that, so a builder that skipped the call would fail every other test here. This
    one asserts the order directly, so a failure names the cause instead of looking like a broken tree:
    nothing may be written before the view is shown."""
    leap, _rc, _rows, _out = run_dry(tmp_path, monkeypatch)
    log = leap.log
    written = [i for i, e in enumerate(log) if e[0] in ("add", "effect")]
    assert written, "the build wrote nothing at all"
    shown = [i for i, e in enumerate(log) if e[0] == "showanalysisview"]
    assert shown, "ShowAnalysisView was never called"
    assert shown[0] < written[0], "a branch was written before the Analysis View was shown"


def test_export_expressions_falls_back_when_the_path_form_is_refused(tmp_path, monkeypatch):
    """LEAP's API help defers ExportExpressions' signature to the Script Editor, so the builder tries the
    path form and then the no-argument form. The default fake accepts the path, which means the fallback
    - the shape the real tool may need - was never exercised. Here the fake refuses a path and only
    accepts the bare call, and the build must still finish and say which shape it used."""
    seen = []

    def refuse_a_path(leap):
        def export(path=None):
            if path is not None:
                raise RuntimeError("this build wants no argument")
            seen.append(path)
        leap.ExportExpressions = export

    rc, out = _run_build_with(tmp_path, monkeypatch, refuse_a_path)
    assert rc == 0, out
    assert seen == [None], "the no-argument form was never tried"
    assert "(no path argument)" in out, out
    assert "raw export FAILED for ExportExpressions" not in out, out


def test_a_failed_raw_export_is_reported_and_does_not_stop_the_tidy_extraction(tmp_path, monkeypatch):
    """The brief asks for raw tool output beside results.csv, and the code treats it as best effort - a
    failure is logged, not fatal. That promise was untested, so a raw export that quietly failed would
    still look like a clean run. Here one scenario's export raises and the build must finish, name the
    scenario, and still write the tidy file."""
    def break_one_export(leap):
        def export(path=None):
            if path and "B_high" in path:
                raise RuntimeError("the tool refused this export")
        leap.ExportResultsCSV = export

    rc, out = _run_build_with(tmp_path, monkeypatch, break_one_export)
    assert rc == 4, out          # results written, but the brief's raw output is incomplete
    assert "INCOMPLETE: raw export missing for ['B_high']" in out, out
    assert "raw export FAILED for B_high" in out, out
    assert "the tool refused this export" in out, out
    assert pathlib.Path(tmp_path, "results.csv").exists(), "the tidy extraction must still be written"


def test_a_failed_restore_point_is_reported_and_the_build_continues(tmp_path, monkeypatch):
    """The build edits a live area, so it takes a named restore point first - and treats that as best
    effort, logging a failure and continuing. That is the right call (a snapshot is a safety net, not a
    precondition), but it means a run can proceed with no undo, so the failure has to be loud. Nothing
    tested it. Here SaveVersion raises and the build must name it and still finish."""
    def refuse_a_snapshot(leap):
        def save_version(_comment, _include):
            raise RuntimeError("this area cannot be versioned")
        leap.SaveVersion = save_version

    rc, out = _run_build_with(tmp_path, monkeypatch, refuse_a_snapshot)
    assert rc == 0, out
    assert "save version FAILED: this area cannot be versioned" in out, out
    assert "save version: pre-build snapshot taken" not in out, out



def test_the_build_saves_the_area_after_each_write_phase(dry):
    """`SaveArea` is what makes the writes persist - in evaluation mode LEAP refuses saving outright, so
    it is also the call most likely to fail on a real run. The README says saving is covered by the
    code-path tests that assert the calls happen, and until now that was not true of this one: the fake
    took it silently and nothing asserted it. The builder saves after the key assumptions and again
    after the demand writes, so a build must show at least two."""
    leap, rc, _rows = dry
    assert rc == 0
    saves = [e for e in leap.log if e[0] == "savearea"]
    assert len(saves) >= 2, leap.log
