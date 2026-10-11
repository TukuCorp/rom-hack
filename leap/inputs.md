# LEAP input map — PHASE 2 (2026-10-09, Asia/Saigon)

Agent `leap`. Base year 2025 (DEC-001). Units: emissions t CO2e, energy TJ. GWP: AR5 (Decree 06; r3 sources line). Territory tag `merged` unless a row says otherwise - the only exceptions today are the two Run B
`Non-energy|IPPU` rows tagged `hd_legacy`, whose figures come from the Hai Duong side. (`TERRITORY_TAGS`
allows `hp_legacy` too; no row needs it, because a Hai Phong value inside the merged city is merged.)/hd_legacy. Full value table: inputs.csv in this folder (one row per LEAP branch x parameter, Run A and Run B side by side, every value with file+sheet+cell or brief section).

## 1. LEAP tree (build exactly this)

```
Key Assumptions
  Population | GRDP (15.2 %/yr) | ElasticityOtherInd (A:1.0 B:0.7) | GridEF (A:0.6592 flat+1.15x B:0.6592->0.55)
  SteelCap (B 2.5 Mt) | ClinkerCap (B 10.18 Mt) | ElecGrowth (B 10 %/yr)
  That is the whole list - `KEY_ASSUMPTIONS` in the builder is the source of truth, and an earlier
  version of this line also named RiceArea, Livestock and WastePerCap, which the builder never
  creates: the AFOLU and waste rows carry flat 2025 literals, so they need no key assumption.
Demand
  Industry-Steel (1A2a) | Industry-Cement fuels (1A2f) | Industry-Other (1A2b-m)   [fuels: anthracite, sub-bit, DO, FO, gas, biomass; activity x intensity, TJ]
  Transport-Road (1A3b) | Transport-Waterborne (1A3dii)   [fuel litres -> TJ via densities+NCV: 1A3 sheet N9:P10]
  Plants1A1-Coal-HP/HD/PhaLai   [three fuels each, tonnes/litres; ver1's single 5 % step in Run A]
Scope2 (non-energy effects, not demand branches)
  Elec_Households | Elec_Commercial | Elec_Agriculture | Elec_IndustryElec | Elec_OtherElec
  [activity MWh; factor = Key Assumptions\GridEF, so the falling series and the band are real; see §4]
Notes on the tree as built
  The three coal plants sit under `Demand\Plants1A1\...`, one branch per plant with a fuel child each
  (anthracite / sub-bituminous / DO). LEAP's Transformation module is deliberately unused: it would
  want generation, capacity factors and plant fuel splits the survey never collected (`inputs.md` §5),
  and fuel-input combustion is what the inventory counts anyway. The "territorial view" therefore
  means "count the plants' fuel", which `compare.py` does by their GPC reference.
Non-energy effects  (tCO2e per activity unit)
  IPPU: 2A1 cement | 2A2 lime | 2A3 glass | 2C1 steel | Livestock 3A1/3A2 | Rice 3C7 | Urea 3C3 | Lime 3C2 | Waste 4A1/4B/4C1/4D1/4D2
```

## 2. Two runs (Steering 2026-10-09 (2))

- Run A `Hang inputs` is **ver1-native** (settled 2026-10-09 23:35, `FINDINGS.md`): her per-row rates where she states them (IPPU 15.2 %/yr, transport 10.9 %/yr), her literals where she is flat (AFOLU, waste, landfill on her own series), the plants on her single 5 % step, and her own factors on every non-energy row — so that `A − Hang` is a tool effect. Scope 2 keeps her flat 0.6592 with the unsourced x1.15 from 2026, the steel factor stays her EAF 0.06 (2C1!M3), and her scope 1 + scope 2 sum (42.8 Mt 2026) is visible rather than hidden. Note: her base column is 2026 (Summary C2), not 2025; her 1A2 rows are empty.
- **This Run A is the one GACMO used, deliberately.** The brief requires it: "GACMO's Run A already
  meets this (every non-energy sector 0.0 % vs ver1 in 2025 and 2030), so the two tools share one Run A
  definition". So the A scenarios are comparable across tools by construction - an A-versus-A difference
  is a tool difference, not a definition difference - and the same is *not* yet true of Run B, where the
  Scope2 growth rates still differ (see the grid note below).
- Run B `corrected`: r3 + 2026-10-08 evidence drivers — per-sector drivers (steel 2.5 Mt rated-cap central, low 2.0; clinker output = 10.18 Mt/yr GEM capacity x kiln utilisation: central 72.5 % = 7.38 Mt, low 65 % = 6.62 Mt, high 80 % = 8.14 Mt, capped at capacity thereafter; other industry GRDP x0.7; electricity PDP8 ~10 %/yr; waste per-cap +1 %; rice/livestock flat), official grid factor 0.6592->0.55 with NO x1.15, coal counted once, BF-BOF 1.46 t/t in 2C1 with BF coke moved out of 1A2a, 1A2 filled at 9.4 Mt by industry. Gap B-A = assumption effect. One deliberate simplification: the elasticity stays **0.7 in all three bands**
(Steering (2): "sectors grow at GRDP x elasticity (other industry x0.7 central)"), so the band moves the
sector drivers, not the elasticity - the parameter sheet's 0.6/0.7/0.8 elasticity band is therefore not
used, and the spread reported is narrower than a full Approach-1 propagation would be.
- TBD drivers (transport, lime/glass, plant fuel split): GRDP x0.7, labelled `judgement-placeholder` in results.csv source. Never stall on them.
- Open inventory questions (Hang value kept in BOTH runs; for COMPARISON.md, not tool findings), and
  **two inventory gaps to carry there too**: 1A4 households/commercial/agriculture combustion, absent
  from ver1's file and therefore from both tools (GACMO Review #15), and 3B forest and land, zero in
  her PV1 R96-R114 (fill from QD 588 when available). Gaps are not questions about her value: they are
  parts of the inventory nobody measured, and COMPARISON.md must say so rather than let them read as
  tool differences. Questions: 5.0M population (PV1!D150:E150, r3 unconfirmed); road gasoline 39-vs-66 ML (PV1!D30); rice 0.62-vs-1.21 Mt on 117,808 ha (PV1!E125:F125); clinker rows; empty 3B land (fill from QD 588 when available).

## 3. Two views, never added together

The views are **sums over branch sets of the same LEAP numbers**, applied by `compare.py` when it
reads `results.csv` (bucketed per row by GPC reference), not by duplicating scenarios with identical
data (the earlier design had five scenarios, three of them byte-identical; see the change note in
`FINDINGS.md`). `test_compare.py` pins the rule against the October review's 40.7 / 31.5 Mt
checkpoints.

- **Territorial** (IPCC / Decree 06): coal plants IN (~20.7 Mt 1A1), demand fuel combustion with 1A2
  at 9.4 Mt, purchased electricity reported memo-only (not added to the total).
- **GPC BASIC+**: coal plants OUT, demand fuel combustion + purchased electricity IN (the five
  Scope2 rows: MWh × the grid factor; Run A flat at 0.6592 with ver1's ×1.15 from 2026, Run B the
  falling series without it). 2025 check (B_central): territorial
  A ~31.5 Mt (1A2 empty), B_central ~39.7 Mt, BASIC+ ~30.5 Mt (README step 7). The Oct review's 40.7 / 31.5 predate moving the 4.10 Mt
  BF coke out of 1A2a and are not a reconciliation target.
- Run A additionally carries the scope 1 + scope 2 sum as filed (42.8 Mt) so the double count is
  visible in the same file rather than hidden: in `results.csv` that is the A scenario read as
  demand + plants + purchased electricity without the "never add the views" rule.

## 4. Entering it in LEAP (no licence yet — type or import once licensed)

- Current Accounts 2025: Key Assumptions from inputs.csv (written through `KEY_VARS`); Demand activity levels = 2025 bases (undo one GRDP step where ver1 bases compound from 2025, e.g. coal D7/E7 x1.05, steel D55, cement D45); Transformation feedstocks in TJ (tonnes x NCV: anthracite 26.7, sub-bit 18.9 TJ/Gg); Non-energy rows entered as **emissions**: LEAP gives an `Environmental Effect` branch one writable variable
  (`Avg Environmental Loading`, its own dictionary's annual effect loading), so each row is written as
  `activity x factor` - the split for every row is in the `factor` column of `expected_activity.csv` and in
  the tables above, and the tool sees only the product.
- Coal-plant base-year feedstock (2025), all thermal plants in PV1 row 7 `1A1ai Sản xuất điện`: D7 = 5 070 185 t anthracite, E7 = 4 036 716 t sub-bituminous, G7 = 1 155 thousand litres diesel DO — the literals inside the formulas (`=5070185*1.05`, `=4036716*1.05`, `=1155*1.05`), so the un-stepped value is the base year, exactly as for steel D55 and cement D45. Split across the three plants by capacity share (judgement placeholder). Units differ per fuel: tonne for the coals, litre for DO. Run A holds the fleet at ver1's own projection — 2030 = literal × 1.05, a single step, not 5 %/yr (`plant_expr()`); Run B holds it flat (the corrections' "no new coal").
- The CSV's own columns, since two of them are provenance rather than input: `run`, `branch`, `parameter`,
  `value`, `unit` are what gets written; `territory` and `status` are validated against `TERRITORY_TAGS`
  and `STATUS_VALUES` by `--check` (`status` is whose value it is - `hang`, `corrected`,
  `judgement-placeholder`, and the rest); `source` is the citation; and `basis_year` records the year a
  value applies to. `basis_year` is provenance only - the builder carries the column and does not read
  it - so a blank there is not a defect, and it must not be mistaken for the area's base year.
- Raw tool output: `--build` also asks LEAP for its own `ExportResultsCSV` per scenario into `raw/` (best effort, failure logged, gitignored). The brief wants the tool's export beside the tidy file, and it is the evidence that `results.csv` was read out of LEAP rather than assembled by hand.
- Scenarios: **four** — `A_Hang_AsFiled` (ver1's own rates and factors) then `B_low`, `B_central`, `B_high` (the corrected drivers, one per band). `case` in `results.csv` carries the band and `territory` carries the territory tag (`merged`), per the brief's column spec; the view is derived at comparison time per §3. WEM = B (adopted: PDP8 fleet, KH 4729 pipeline excluded). **WAM is deliberately deferred**: it needs
an action/measure layer, and the repo's own action set is still placeholder (`activeContext.md`:
"the entire action set" is placeholder), so a LEAP WAM today would be placeholder data driving
placeholder measures — a number nobody could defend. When the measures land, they enter as LEAP
measures under B (the same cost-ranked list the MAC curve uses) with the supply additions named
in the evidence pack: LNG 4800 MW, offshore wind 7200 MW, solar 3817 MW, WtE 90 MW (S04/C4).
- Bands: populated from the driver table — grid 2030 0.50/0.55/0.60, electricity 8/10/11 %/yr, steel cap 2.0/2.5/2.5 Mt, clinker output 6.62/7.38/8.14 Mt, waste flat/+1/+2 %/yr, rice −1/flat/+0.5 %/yr, population 0.5/0.8/1.0 %/yr — as `BANDS` in the builder and reported as a range per scenario (low / central / high) by
`compare.py`. IPCC Approach 1 error propagation is *not* applied: it needs a per-parameter
uncertainty, and the evidence pack gives bands rather than standard deviations - so the spread is
reported as a range and labelled as such, never as a confidence interval.

## 5. Gaps — what we supply, and what LEAP would do instead

The Phase 2 brief asks for the gaps *and* the default the tool would use in their place, so each item
gives both. "What LEAP would do" is stated from SEI's own published help
(`leap.sei.org/Help24/...`, cited per item) wherever it says so, and marked as unverified where only a
licensed run can tell. An earlier version of this paragraph cited the install's files and type library;
both are withdrawn as methods (see `FINDINGS.md` 5), and every item that rested on them now
cites the published equivalent.

1. **Builder coverage.** We supply every 2025 activity ver1 holds: five purchased-electricity rows
   (17,494,720 MWh total, each with ver1's ×1.15 in Run A), six transport fuel volumes, three
   coal-plant fuels split by capacity, and the IPPU/AFOLU/waste rows. *What LEAP would do instead:*
   nothing — a branch with no Current Accounts value resolves to zero, which is how three missing groups
   (residential 5,009,135 MWh, other 391,391 MWh, all transport) would have reported a BAU short by
   roughly 16 Mt with nothing raising.
2. **Plant-level fuel split and capacity factors.** Supplied as a capacity-share split, labelled
   judgement-placeholder (the plant TOE figures in the plant brief line 196 are partial survey values,
   never plant totals). *What LEAP would do instead:* with no per-plant fuel child there is no fuel on
   the branch and therefore no emission; capacity factors are not used at all, because the plants are
   demand branches here and not a Transformation module.
3. **Coal-plant electrical output (GWh).** Not in hand. *What LEAP would do instead:* the Transformation
   module would want capacity × capacity factor to compute output; we deliberately do not use that
   module and count the fuel input, which is what the inventory does (see the tree note in §1).
4. **Coal-plant growth beyond ver1's step.** Run A holds 2030 at ver1's single `×1.05` and continues
   flat; Run B holds the fleet flat. *What LEAP would do instead:* it would compound whatever growth it
   is given — `Growth(5%)` would reach ×1.276 by 2030 and inflate 1A1 by ~4.7 Mt, which is why the
   expression is an `Interp` with explicit endpoints.
5. **1A2 fuel mix for Run B's 9.4 Mt.** ver1's 1A2 sheet is all zeros and the 1,959-firm survey carries
   no fuel column, so the 9.4 Mt enters as anthracite tonnes converted with ver1's own pair (98.3
   tCO2/TJ × 26.7 TJ/Gg = 2.62461 tCO2/t): steel 1,802,173 t and non-metallic 971,573 t flat, other
   industry 796,309 t at GRDP × 0.7 (10.64 %/yr), as `Interp(2025, …, 2030, …, 2050, …)` in the B
   scenarios only. All-coal is a labelled placeholder. *What LEAP would do instead:* it applies its own
   fuel properties and emission factors to whichever fuel the branch carries, so the mix we attach is
   the lever — and the tool effect on those factors is a run-time measurement.
6. **City 2025 purchased-MWh check.** Hang's 17,494,720 MWh is the entry, cross-checked against the Sở
   Công Thương power extract and KH 4729 city demand in Phase 3. *What LEAP would do instead:* nothing —
   the Scope2 rows carry an explicit grid factor expression rather than LEAP's own electricity default,
   because that default is static and not ours.
7. **GWP set.** We pin each effect's `GWP100` to AR5 (1 / 28 / 265, Decree 06). *What LEAP would do
   instead:* use the IPCC Assessment Report selected in the Effects screen, inherited through Current
   Accounts - and **that setting overrides our pinned values rather than deferring to them**, so the AR
   choice must be AR5 excluding climate-carbon feedbacks or the run's CO2e is computed on another set
   (README run-day step 2). It has no
   property in the published API help (`Help24/API/Application.htm`, which defers to LEAP's Script Editor for per-member detail) — hence the UI check in the README, and `--dump` prints the effects' GWPs so
   agreement is visible after a build. Flag it per ground rules if the tool forces another set.
8. **The activity variable on a fuel technology.** `ACT_VARS` tries `Total Activity` then
   `Activity Level` — the two activity names LEAP's help describes for these branch types (`Help24/Screen_Layout/Types_of_Tree_Branches.htm`). *What LEAP would
   do instead:* nothing; whichever name it carries is what we read, and a mismatch fails loudly with the
   branch's real variable list. Which of the two a *technology* carries, and whether energy comes from
   the branch or the technology, is the one item only `--dump` on a licensed session can settle.
9. **Verification fixture.** `expected_activity.csv` (regenerate with `--expect`) lists the activity LEAP
   should report at 2025 and 2030 for every entered branch, per scenario — 296 rows from the builder's
   own expressions, byte-pinned by a test. Use it as the row-by-row checklist for the first licensed run
   (`--dump`, then `--build`, then diff). Run A's electricity and transport rows already match ver1's PV2
   and PV1-row-30 cells exactly.
10. **Column 8 of inputs.csv** is the Phase-2 shorthand for a branch spanning several GPC categories
    (`II.1.x`); `results.csv` carries the exact refno from `build_leap_bau.gpc_ref()` (`II.1.1`), which is
    the one to quote.

### Energy intensities are part of the model now (2026-10-10)

LEAP computes demand energy as activity x intensity, and the intensity belongs on the fuel technology
branch. The builder wrote only activity until this pass, which would have zeroed the whole demand side;
`FUEL_NCV_TJ_PER_UNIT` now carries the NCVs from ver1's own sheets (1A1's "Nhiet tri (TJ/Gg)" row and the
transport sheets' "Nang luong quy doi (TJ)" rows), `write_intensity()` writes them per fuel child, and
`expected_activity.csv` gained an `intensity_tj_per_unit` column. Related, from the same help page: LEAP
multiplies activity levels down a branch, so a parent of fuel children now holds **1** and the children
hold the quantities - otherwise the quantity would be squared. See `FINDINGS.md`.

### Run B grid electricity: one rate here, sector rates in GACMO (2026-10-10)

The orchestrator flagged this from its own review and it belongs in the folder, not only in a commit note:
in the corrected run our five Scope2 rows grow at the **single band rate** (8 / 10 / 11 %/yr, PDP8-driven,
Steering (2): "PDP8's ~10 %/yr is electricity demand"), whereas GACMO grows each sector's electricity at
**that sector's** rate. The gap is about **1.6 Mt on the BASIC+ view**.

**Its ruling, and it is not neutral: align LEAP to the sector rates rather than list the difference.**
PDP8's 10 % is mostly *industrial* demand growth, so applying it to households overstates their growth;
GACMO's sector-by-sector rates are the better-grounded choice. My first version of this note called it a
method difference "rather than an error on either side", which understated it.

**The change, made 2026-10-10** (it was an input change, not a tool one, so it was prepared offline
before the licence): each Scope2 row now carries its own Run B driver instead of the shared marker. The
five rows are the CSV's `Non-energy|Scope2|Elec_*` rows (Households, Commercial, Agriculture,
IndustryElec, OtherElec), and the driver each one uses lives in the builder's `BANDED_B_GROWTH`, keyed
to a band parameter in `BANDS` - so the model, the fixture and the tests all moved together and the
marker is gone. GACMO names drivers for two of the five, and the rest are judgement to be labelled:

| row | driver | source |
|---|---|---|
| `Elec_Households` | population + urbanisation, ~0.8 %/yr and a rising urban share | GACMO `inputs.md` r42-44, evidence s1; its own label is "judgement" |
| `Elec_IndustryElec` | PDP8 electricity demand, ~10 %/yr | GACMO r33, PDP8 500.4-557.8 TWh 2030 (forecast S01) |
| `Elec_Commercial`, `Elec_Agriculture`, `Elec_OtherElec` | our judgement - GACMO's equivalent rows (r38, r39) are fuel gaps, not rates | label `judgement` in `inputs.csv` `status` |

Our `BANDS` already carries both rates (`pop` and `elec`), so the mechanical part is per-row `eb` values in
`NONENERGY_EFFECTS` plus matching `inputs.csv` rows - and the three judgement rows must be labelled rather
than presented as sourced.

### Why Run A and Run B do not list the same branches (2026-10-10)

A reader comparing the two runs' rows will find 8 branches in A that are absent from B and 7 the other
way. Checked row by row: none of them is missing coverage.

- A's two transport rows (`Road (1A3b)`, `Waterborne (1A3dii)`) are covered by B's single
  `Demand|Transport|All 1A3` rule row, which carries the GRDP x 0.7 driver for the family.
- A's five Scope2 rows are covered by B's two rule rows (`Demand growth to 2030 (Scope2 band rate)` and
  the `Key Assumptions GridEF` series), so the band drives the activity and the grid factor falls.
- A's `AFOLU|Forest and land (3B)` row is **zero** and labelled `hang-gap`: ver1's PV1 R96-R114 are zeros
  and the open question list already says "fill from QD 588 when available". B omitting it is correct.
- B's extra rows are the corrected drivers for 1A2 subsectors (chemicals, textiles, non-metallic
  minerals, the 796,309 t "other 1A2" row) which A leaves empty because ver1 does.

So the two runs describe the same branches in different vocabularies - A in ver1's own cells, B in
corrected drivers - and the only genuine absence is a recorded inventory gap.

### Inventory gap: 1A4 households, commercial and agriculture combustion (2026-10-10)

Not modelled, and not modelled by the reference either: ver1's 1A4 sheet is zero, so the fuel combustion
of households, commerce and agriculture is absent from her file and therefore from both tools (GACMO's
`inputs.md` records it as Review #15, "gap"). It is an inventory gap to carry into COMPARISON.md, not a
coverage claim.

### AFOLU checked against her sheets: no gap, her C column is the outlier (2026-10-10)

Summed from her own detail rather than assumed. 3A1 + 3A2 + 3C7 + 3C2 + 3C3 = **1,425,146.889 tCO2e =
PV1 W68 = her E5 (2030)**, and our model totals 1,425,160: the blended 3A row is 192,851.1 (hers:
192,851.1), rice 1,213,564 (hers 1,213,558), urea and liming to the tonne. Her **C5 (2025) =
1,756,384.43** is 331,238 tCO2e above the sum of her own sheets - the inconsistency is in her 2025
column, and `Livestock_3A`'s note about a blended gas split does not change CO2e. GACMO scaled to C
instead; that is a parity question recorded in FINDINGS.md.

## 6. Sources opened for this map

- Ver1 workbook (all cells read via openpyxl, values+formulas): reports/VIE_HPH_BAU 2026-2030_Emissions_Assessment_Calculation_ver1_TAH review 2026-09-28.xlsx — Summary C2:C8/E2:E10/F9:F10; PV1 D7/E7/G7/D30/D33:E33:D45/D47/D49/D55/D73:D74/D80/D92:D93/D117/D120/E125:F125/D143/D146:G146/D150:E150/R154/T44:T54:W124:W128:W149; PV2 B3:B8/C3:C8/H3/I3; 1A1 O3:P6; 1A2 T3:AB8; 1A3 N3:P10; 2C1 M3.
- reports/2026-10-08-hp-bau-evidence.html (driver table, grid series, plant table, 2025 totals, WOM/WEM/WAM) + research/2026-10-08_hp-bau-forecast-calc.md (parameter sheet S01-S18) + research/2026-10-08_hp-bau-reference-cases.md (benchmarks, elasticity 0.87, GRDP provenance).
- reports/2026-10-05-hp-1-2-bau-feedback-hang-r3.html (9.4 Mt 1A2 split, 40.7/31.5 totals, BF-BOF +3.3 Mt, F9/F10 and x1.15 flags) + 2026-09-28 ver1 feedback.
- research/2026-10-06_hp-1A2-plant-level-sources.md (clinker 10.18 Mt/yr, Hoa Phat 2.525 Mt cap / 1.53 Mt 2024 output, DAP 330 kt) + data/processed/inventory_2024.csv + rollup_2024.csv + bau_2024_2050.csv (repo engine baselines; flat-rate BAU superseded by this map).
- context/decisions/2026-08-11-output1-decisions.md (DEC-001 base year 2025; DEC-003/008 target basis; DEC-006 method stack). Working notes: .work/ in this folder.
