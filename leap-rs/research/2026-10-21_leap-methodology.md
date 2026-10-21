# LEAP calculation methodology, from the public documentation

- **Date:** 2026-10-21
- **Mode:** Domain research (external official documentation)
- **Query:** Collect LEAP's (Low Emissions Analysis Platform, SEI) calculation methodology from its public documentation, with formulas, LEAP's variable names and a URL for each section, precisely enough to reproduce results numerically. The scope covers demand, stock turnover and transport, transformation, resources, environmental loadings, costs, expression-function semantics, and NEMO optimization.
- **DeepWiki sources:** None. LEAP is closed-source and not on GitHub, so DeepWiki has nothing on it. NEMO (`sei-international/NemoMod.jl`) is public, but only its official docs were used, because the optimization question is high level.

## Sources and how they were read

- **Primary source: the current LEAP online help.** `https://leap.sei.org/help/` redirects to `https://leap.sei.org/help24/Concepts/Introduction.htm`. It is a RoboHelp 2022 build (`<meta name="version" content="2022.4.0">`). The full table of contents was crawled from `https://leap.sei.org/Help24/whxdata/toc.new.js` (64 TOC files, 638 topics), plus 10 linked pages that are not in the TOC. Pages were converted to text locally, with the glossary pop-ups stripped out. Equations that appear only as images (`.gif`/`.jpg`/`.png`) were downloaded and read visually. Those equations are transcribed below and marked **[image]**.
- **Secondary official source: the LEAP 2011 User Guide (PDF).** Fetched from `https://leap.sei.org/documents/LEAP2011UserGuideEnglish.pdf` (5.1 MB, SEI-hosted). It is older but adds a few statements the current help leaves out. Those statements are marked **[UG2011]**.
- URL base for the help topics: `https://leap.sei.org/help24/` (the server is case-insensitive, so `Help24` also works). Each section below gives the topic paths it draws on.
- Pages that could not be fetched: `Views/Energy_Balance.htm`, `Views/Results_View.htm` and `Wizards_and_Properties/Demand_Branch_Properties.htm` return 404 at that path (they are linked as text but not under those names). The riverbp.net mirror of the 2005 User Guide served HTML, not a PDF, and was skipped. No public "LEAP Training Exercises" PDF was found at the guessed URLs. The only exercise PDF found is the 2001 wood-energy `RWEDP_Exercises_2001.pdf`, which is old and narrow and was not used.

Notation: quotes are verbatim and use "...". Anything marked **[inferred]** is my derivation and is not stated in the documentation.

---

## 1. Demand

### 1.1 Activity analysis: final energy
URL: `help24/Demand/Activity_Analysis_Calculations.htm`, `Demand/Total_Activity.htm`, `Demand/Final_Energy_Intensity.htm`, `Demand/Activity_Level.htm`

- "D_b,s,t = TA_b,s,t x EI_b,s,t. Where D is energy demand, TA is total activity, EI is energy intensity, b is the branch, s is scenario and t is year (ranging from the base year [0] to the end year)." When t=0: `D_b,0 = TA_b,0 x EI_b,0`.
- "TA_b,s,t = A_b',s,t x A_b'',s,t x A_b''',s,t x ... Where A_b is the activity level in a particular branch b, b' is the parent of branch b, b'' is the grandparent, etc."
  - The quoted formula starts at the parent b' and does not include the technology branch's own activity level A_b. The Total Activity example below does include the leaf's own level. Treat the chain as the leaf plus all of its ancestors.
- The edge rules are stated verbatim: "those branches marked as having "No data" as well as the top level "Demand" branch are treated as having an activity level of 1. The activity level values of other branches with percentage units (e.g. percent shares or percent saturation) are always divided by 100 to yield a fractional value from zero to one in the calculations."
- Total Activity example (`Demand/Total_Activity.htm`): Households 8 million × Rural 50% share = 4 million households, × Refrigeration 20% saturation = 800 thousand households. Total Activity is "calculate[d] and cannot be edited by the user. However, its value can be referenced in expressions."
- Each technology branch has exactly one fuel: "The energy demand calculated for each technology branch is uniquely identified with a particular fuel. Thus, in calculating all technology branches, LEAP also calculates the total final energy demand from each fuel."
- Units: "LEAP does not explicitly distinguish between [per-year and per-unit] situations. The onus is on the user to ensure that the result of multiplying the activity level and energy intensity variable is the annual energy consumption in that branch." Intensities can be entered in energy, mass or volume units and are converted to energy using the fuel's net energy content. All energy contents are LHV: "Energy contents are always net (lower heating values) in LEAP." (`Supporting_Screens/Fuels.htm`)
- Share checks: by default LEAP checks that neighbouring share branches sum to 100% (setting "Do not check that share values sum to 100%", default off; `Supporting_Screens/Basic_Parameters_Screen.htm`).

### 1.2 Useful energy analysis
URL: `Demand/Activity_Analysis_Calculations.htm`, `Demand/Useful_Energy_Analysis.htm`, `Demand/Fuel_Share.htm`, `Demand/Efficiencies.htm`, `Demand/Average_Useful_Energy_Intensity.htm`

The intensity sits on a "Category with Energy Intensity" branch (green tab), and technologies sit directly below it.

Current Accounts, default method (final intensity at the category, plus fuel shares and efficiencies at each technology):
- "UE_b,0 = EI_AG,0 x FS_b,0 x EFF_b,0, Where b = 1..B", where EI_AG,0 is the category's final energy intensity, FS is the fuel share and EFF is the efficiency.
- "UE_AGG,0 = Sum_b=1..B(UE_b,0)"
- "AS_b,0 = UE_b,0 / UE_AGG,0 Where AS is activity share."
- Worked example: EI_AG = 100 GJ, two technologies at 50% fuel share each, electricity at 100% and gas at 70% efficiency. UE = 50 and 35, so AS = 50/85 = 59% and 35/85 = 41%.
- Alternative Current Accounts method: enter the useful intensity directly. Fuel shares are then not needed.

Scenarios: you project the aggregate useful intensity, the activity shares and the efficiencies. Then:
- "EI_b,s,t = UI_AGG,s,t x AS_b,s,t / EFF_b,s,t", and then `D = TA x EI` as above.
- "Note: when specifying aggregate energy intensities, but not conducting useful energy analysis, the above equations still hold and all efficiencies are set equal to 100%."
- Efficiency is defined as "100 * useful energy delivered / final energy consumed". Values above 100% need the setting "Allow efficiencies greater than 100%" (default off).
- Co-products (useful-energy branches only, `Demand/Coproduct_Efficiency.htm`): "the sum of the efficiency and co-product efficiency terms should be less than or equal to 100%". Results are split into Gross Final Fuel Demand (consumption only), Net Final Fuel Demand ("consumption minus co-production") and Demand Co-production ("a negative demand") (`Results_Categories/Demand_Coproduction.htm`).
  - **[inferred]** Co-product output = final energy consumed × co-product efficiency. The help does not give this formula explicitly.

### 1.3 Total Energy method
URL: `Demand/Total_Energy.htm`

"Total Energy is the total final energy consumption at a specific branch/variable... energy data is entered directly: that is it is not specified as the product of an activity level and an energy intensity." It is defined at the lowest-level technologies (red icons).

Time-sliced option: "Time Sliced (Power Per Slice)... LEAP will automatically multiply this data by the duration (in hours) of each time slice in order to calculate the energy consumption in each time slice."

### 1.4 Demand costs
URL: `Demand/Demand_Cost_Analysis.htm`, `Expressions/AnnualizedCost.htm`

These are the four methods (non-fuel costs only):
- **Costs Per Activity** (default): `Cost_s,t = Cost per Activity_s,t x Activity Level_s,t`
- **Costs Per Device Sold** (stock and transport branches only): `Cost_s,t = Cost per Device Sold_s,t x Devices Sold_s,t`
- **Total Costs:** the expression is the total annual cost.
- **Cost of Saved Energy (CSE):**
  - Relative to a baseline scenario BL: `Cost_s,t = CSE_s,t * Activity Level_s,t * (Energy Intensity_BL,t - Energy Intensity_s,t)`
  - Relative to Current Accounts: `Cost_s,t = CSE_t * Activity Level_s,t * (Energy Intensity_0 - Energy Intensity_s,t)`
  - "CSE costs will be zero in the base year by definition."

Demand Capital Cost, Fixed and Variable O&M and Lifetime per device exist only for optimized technology branches (NEMO). Capital costs there "are annualized based on the lifetime of each device".

---

## 2. Stock turnover (Stock Analysis) and transport (Transport Analysis)
URL: `Demand/Stock_Analysis_Calculations.htm`, `Demand/Vintaging_Calculations.htm` (titled "Transport Analysis Calculations"), `Demand/Stock_Analysis.htm`, `Demand/Stocks.htm`, `Demand/Sales.htm`, `Demand/First_Sales_Year.htm`, `Demand/Scrappage.htm`, `Demand/Max_Scrappage_Fraction.htm`, `Demand/Fraction_of_Scrapped_Replaced.htm`, `Demand/Fuel_Economy.htm`, `Demand/Fuel_Economy_Correction_Factor.htm`, `Demand/Mileage.htm`, `Demand/Mileage_Correction_Factor.htm`, `Demand/Usage_Factor.htm`, `Demand/Energy_Intensity.htm`, `Supporting_Screens/LifeCycle_Profiles.htm`, and the results pages for Stocks, Sales, Vehicle Mileage, Stock Average On-Road Fuel Economy and New Vehicle Rated Fuel Economy.

### 2.1 Equations [image]
Subscripts: t = technology or vehicle type (branch), v = vintage (year added, or model year), y = calendar year.

| Equation | Formula |
|---|---|
| Stock by vintage (eqbasicstock / eqStock1) | `Stock_t,y,v = Sales_t,v · Survival_t,y−v` |
| Total stock (eqStock3) | `Stock_t,y = Σ_{v=0..V} Stock_y,v,t` |
| Stock analysis intensity (eqEnIn) | `EnergyIntensity_t,y,v = EnergyIntensity_t,v · Degradation_t,y−v` |
| Stock analysis energy (eqEcon) | `EnergyConsumption_t,y,v = Stock_t,y,v · EnergyIntensity_t,y,v` |
| Fuel economy (eqFuelEconomy) | `FuelEconomy_t,y,v = FuelEconomy_t,v · FeDegradation_t,y−v` |
| Mileage (eqMileage) | `Mileage_t,y,v = Mileage_t,v · MlDegradation_t,y−v` |
| Transport energy (eqFuelUse) | `EnergyConsumption_t,y,v = Stock_t,y,v · Mileage_t,y,v · FuelEconomy_t,y,v` |
| Distance-based emissions (eqEmiss1) | `Emission_t,y,v,p = Stock_t,y,v · Mileage_t,y,v · EmissionFactor_t,v,p · EmDegradation_t,y−v,p` |
| Energy-based emissions (eqEmiss2) | `Emission_t,y,v,p = EnergyConsumption_t,y,v · EmissionFactor_t,v,p · EmDegradation_t,y−v,p` |

Notes on reading the images:
- In the images, the subscript on the new-device term (for example `EnergyIntensity_t,?`) is hard to read; it could be y or v. The variable text settles it: "EnergyIntensity is energy use per device for new devices purchased in year y". Read it as the value at vintage v, applied to vintage v.
- Degradation factors: each "equals 1 when y=v. Entered as a lifecycle profile."

Variable definitions, verbatim:
- "Survival is the fraction of devices surviving after a number of years: entered as a lifecycle profile."
- "V is the maximum number of vintage years: determined automatically from the survival lifecycle profile, with a maximum of 30 years."
  - Conflict: [UG2011] says "Number of Vintage Years (default=25): ... All lifecycle profiles are specified for the number of years entered in this screen."
- Worked example: "the remaining stock of government cars built in 1990 in the calendar year 2000 will be the sales of those cars in 1990 times the fraction that survive 10 years (2000-1990)."

### 2.2 Stock initialisation, First Sales Year, vintage distribution
- The Stock variable is "used in conjunction with a lifecycle profile called the Stock Vintage Profile, which describes how the total stock of devices is distributed among devices of each different vintage (i.e. new devices, one year-old devices, two-year-old devices, etc.)."
- On First Sales Year (default = base year):
  - "Before this year, LEAP only uses the Stock variable to specify the total stock of devices. After the First Sales Year, the stock of devices is calculated according to LEAP's stock turnover calculations".
  - Data entry rules, verbatim:
    - "For years before the First Sales Year, enter the total stock of devices at the end of each year including the devices added (i.e. sales) in that year."
    - "For the First Sales Year, enter the stock at the start of the year - i.e. NOT including the sales in the first sales year."
    - "Values entered for the Stock variable are ignored after the First Sales Year."
    - "For years before the First Sales Year, any sales data is ignored."
- **[inferred]** Stock_t,FSY,v = Stock_t,FSY(entered) × VintageProfile(FSY − v) for the pre-existing vintages, plus Sales_t,FSY as the new vintage. Those vintages then age through the Survival profile in later years. The help does not say whether the surviving fraction of the initial vintages is computed relative to the age they had at FSY (that is, `Survival(a+k)/Survival(a)`) or with absolute survival. **Gap.**
- Lifecycle profile types (`Supporting_Screens/LifeCycle_Profiles.htm`):
  - "Aging Profiles ... are defined as a percentage value relative to the value of the variable for a brand new device. Thus, the first year value for this type of profile is always 100%."
  - "Distribution Profiles describe the distribution of vintages within a given overall stock of devices. They are only used when specifying stocks of devices in Current Accounts."
  - The exponential curve option: "V[t] = V[t-1] x Exp(t * Constant)".
  - Excel import "assumes the range represents a contiguous set of values from year zero onwards."
- Top-down option (Settings, Calculations tab): total Stocks and Sales are entered at the top-level branches and allocated down with the Stock Share and Sales Share variables (percent). The alternative is bottom-up.

### 2.3 Scrappage (`Demand/Scrappage.htm` and related)
- "LEAP scraps the oldest vintages of devices first, subject to the Max Scrappage Fraction, and progresses to scrap succeeding newer vehicles until the scrappage target has been reached or until there are no devices left to scrap."
- "If the number specified in the scrappage variable is larger than the stock of devices then all devices will be scrapped (subject to the constraints of the Max Scrappage Fraction)".
- "Any values for scrappage before the First Sales Year will be ignored."
- Max Scrappage Fraction (default 100%) is the "fraction of vehicles in any one vintage that can be scrapped".
- Fraction of Scrapped Replaced (default 100%): replacement sales are added to the new vintage, and "these extra replacement sales will be in addition to the sales number specified under the "sales" variable."
- Gaps: no formula is given for Device Retirements as a result variable, or for the order in the year (whether scrappage applies before or after survival). The **[inferred]** natural form is `Retirements_t,y = Σ_v (Stock_t,y−1,v − Stock_t,y,v)` excluding scrappage.

### 2.4 Correction factors, usage factor, stock averages
- Fuel Economy Correction Factor (default 1.0; "about 0.8 is generally used to convert from "rated" to "on-road""). The fuel economy is "combined with the fuel economy degradation profile data and processed in LEAP's stock turnover calculations to yield the stock average rated fuel economy. This value is then multiplied by the fuel economy correction factor to yield the stock average on-road fuel economy result."
- Mileage Correction Factor "adjust[s] the mileage value calculated for the total vehicle stock" (it applies to all vintages).
- Usage Factor (non-transport stock only, default 1): "a simple multiplicative factor ... applied to the average intensity of all devices of any vintage in each year".
- Marginal Final Energy Intensity (stock analysis): "the annual final energy consumption per device for a new device introduced in a given year"; "LEAP will internally calculate the average energy intensity of all devices across all vintages."
- Fuel Economy units: energy per unit distance, "(or its inverse in the case of MPG)". Unit conversion happens internally. The degradation profile for MPG data "should be a constant or decreasing profile, while ... Liters per KM, the profile should be constant or increasing."
- Historical new-vehicle values: "If you simply specify a single value for the fuel economy of vehicles sold in the base year, then the software will assume that same value also applies to all vehicles sold in previous years." The Mileage page says the same.
- Device Share: "the percentage of the devices using each given fuel in a Transport or Stock analysis."
- **[inferred, not documented]** Weighting of the stock averages, consistent with the equations above:
  - stock-average mileage = Σ_v Stock·Mileage / Σ_v Stock
  - stock-average fuel economy (energy per distance) = Σ_v Stock·Mileage·FE / Σ_v Stock·Mileage
  - Whether the correction factors multiply energy consumption directly is not stated; the help says only that they adjust the stock-average results.
- Environmental factors in stock and transport analysis "will instead be interpreted as values for newly added technologies. In these cases, LEAP will internally calculate the stock-average environmental loading factors" (`Demand/Environmental_Analysis.htm`).

---

## 3. Transformation
URLs: `Transformation/Transformation.htm`, `Transformation_Calculations.htm`, `Schematic_of_Standard_Module.htm`, `Process_Dispatch_Rules.htm`, `Process_Dispatch_Calculations.htm`, `Dispatching_Processes_on_a_Load_Curve.htm`, `Shortall_and_Surplus_Calculations.htm` (sic), `Shortfall_Rule.htm`, `Surplus_Rule.htm`, `Usage_Rule.htm`, `Priority_Output.htm`, `Imports.htm`, `Exports.htm`, `Endogenous_Capacityu_Expansion_Calculations.htm` (sic), `Endogenous_Capacity.htm`, `Capacties.htm` (sic), `Capacity_Value.htm`, `Maxiumum_Capacity_Factor.htm` (sic), `Planning_Reserve_Margin.htm`, `Peak_Load_Ratio.htm`, `Efficiency_Data.htm`, `Feedstock_Fuel_Shares.htm`, `Auxiliary_Fuel_Use.htm`, `Output_Shares.htm`, `Co-product.htm`, `Base_Year_Output.htm`, `First_Simulation_Year.htm`, `Calculation_of_Transformation_Systems_with_Feedback_Flows.htm`, `Specifying_Capacty_Data_in_LEAP.htm` (sic). All are under `help24/Transformation/`.

### 3.1 Module sequencing and requirements
- "Transformation calculations are demand-driven... For the first calculated module (the one closest to demands), domestic requirements are set equal to final demands... After each module is calculated, domestic requirements are decremented by the outputs produced from the module, but incremented by the input fuels required by the module. Ultimately the calculation yields the requirements for primary resources".
- Modules are calculated in tree order, from the top (closest to Demand, for example T&D) down to extraction: "the ordering of modules will affect your calculated results".
- The dispatch target for a module (`Priority_Output.htm`): "Processes will then be dispatched to meet the sum of domestic requirements + export targets - minimum imports". In other words: **Module requirement = domestic requirements + Export Target − Import Target.**
- Import Target (`Imports.htm`): imports applied "before a module is operated... calculated imports will not necessarily be as large as the minimum imports you enter. The actual level produced will be limited to no more than the sum of the domestic requirements plus the export target for the module."
- Statistical Differences "will be added to the final demand values calculated in your Demand analysis" (`Screen_Layout/Stock_Changes_and_Statistical_Differerences.htm`). They therefore enter the requirements of the first module.
- Transmission & distribution is modelled as an ordinary module, normally the first one, whose process efficiency is entered as losses. "Efficiency can also be specified as the percentage of energy lost in a process. This approach can be useful for specifying transmission and distribution systems." (`Efficiency_Data.htm`)
  - **[inferred]** efficiency = 100% − loss%, and input = output / efficiency.
  - The `help24/Transmission/*` pages describe inter-regional transmission lines for NEMO optimization only.

### 3.2 Processes: efficiency, feedstocks, auxiliary fuels, co-product, outputs
- Efficiency: "the efficiency of a process is defined as the ratio of the total energy content of all output fuels produced by the process divided by the total energy content of all feedstock fuels consumed."
- The efficiency excludes the co-product: "percentage ratio of energy outputs (not including any co-product energy recovered) to feedstock energy inputs". "All efficiencies must be greater than zero."
- Efficiency can be entered as a percentage efficiency, as a heat rate ("all processes must be specified with the same units"), or as a percentage loss.
- Feedstock Fuel Share: "the percentage share of energy input it provides to its parent process."
  - **[inferred]** `FeedstockInput_f = Output / Efficiency × FeedstockShare_f`
- Auxiliary fuels: "specified as energy consumed per unit of energy consumed or produced in a process... NOT converted in a process, and hence their energy content is not included in... efficiency".
  - Option "Meet auxiliary fuel use from this module's outputs (where possible)": with it, outputs are net of own use. Otherwise outputs are gross and the auxiliary need passes to lower modules or imports.
  - "Any emission factors applied to auxiliary fuel use will be applied to all of the auxiliary fuel use".
- Co-product (one per module): "Enter the percentage of the total feedstock energy recovered from each process. Values for co-product efficiency must be less than 100% minus the process efficiency".
  - **[inferred]** Co-product output = feedstock input × co-product efficiency.
  - The co-product cannot meet export targets or use gap-filling imports. "Surplus production of co-product fuels versus the requirements for those fuels are assumed to be wasted."
- Output Shares, used only when there is more than one output fuel and the module property is checked: "If this box is not checked, all outputs will be assumed to be in proportion to the requirements on the module."
  - "all processes in a module produce the same set of output fuels, and each process produces those fuels in the same proportions." (`Output_Fuel_Wizard.htm`)
  - A Simple Non-Dispatched Module has independent processes, each with its own output fuel.
- Priority Output (Yes/No per output fuel): non-priority fuels "are produced according to the Output Shares you enter, but processes are not dispatched specifically to meet their requirements."
  - Worked example (refinery, outputs.gif, read from the image):

    | Fuel | Requirement | Output share | Priority | Produced | Outcome |
    |---|---|---|---|---|---|
    | Kerosene | 400 | 55% | Yes | 660 | Surplus |
    | Gasoline | 300 | 25% | Yes | 300 | Exact |
    | Fuel oil | 300 | 20% | No | 240 | Shortfall |

    Total output is 1200.
  - **[inferred from example]** Total output = max over the priority fuels of (Requirement_f / OutputShare_f) = max(727.3, 1200) = 1200.

### 3.3 Historical vs simulated dispatch
- "Historical Dispatch is used in each year before the first simulation year. In these years, LEAP runs each process up to the amount specified in the Historical Production variable."
- Historical Production exceeding available capacity gives a diagnostic error.
- First Simulation Year defaults to `FirstScenarioYear`; it can differ by process.

### 3.4 Dispatch rules
`Process_Dispatch_Rules.htm` lists these constants: `PercentShare`, `ProportionalToCapacity`, `FullCapacity`, `MeritOrderDispatch` (formerly `MeritOrder`), `RunningCost`.

- **PercentShare:** "a process will run to meet a certain percentage fraction of the requirements on the module (so long as there is sufficient available capacity)".
  - Process Shares "do not need to sum to 100%, although they should sum to less than or equal to 100%", because rules can be mixed within a module (`Process_Shares.htm`).
- **ProportionalToCapacity:** "each process will be dispatched in proportion to its available capacity (Capacity * Maximum Availability)".
- **FullCapacity:** "processes are run to produce their full available capacity regardless of the requirements on the module."
- **MeritOrderDispatch:** "Each process will be run (if necessary) up to the limit of its maximum capacity factor in each dispatch period."
- **RunningCost:** "dispatched in ascending order of their overall running costs (defined as variable cost + fuel cost)."
- Share equations [image] (`Process_Dispatch_Calculations.htm`), where MCF is the maximum capacity factor, now called Maximum Availability:
  - In proportion to base-year output: `ProcessShare_i = BaseYearOutput_i / Σ_{i=1..n} BaseYearOutput`
  - In proportion to available capacity, or run to full capacity: `ProcessShare_i = Capacity_i × MCF_i / Σ_{i=1..n} Capacity_i × MCF_i`
- Capacity constraint: "LEAP will compare the proportions of output shares and available capacities (capacity x availability) in order to identify the process in each module that constrains overall output from the module. This information is in turn used to calculate the total capacity constrained outputs from each process."
  - **[inferred]** Module output = min(Requirement, min_i AvailCap_i·8760/ProcessShare_i) under fixed shares. The help gives no explicit formula.
- Maximum Availability (time-sliced): "the ratio of the maximum energy produced to what would have been produced if the process ran at full capacity... the product of the two is the maximum available capacity in any time slice."
- Merit Order (time-sliced, positive integers): "lowest value merit order are dispatched first (base load)... Processes with equal merit order are dispatched together in proportion to their available capacity". Merit order is not used for storage processes.

### 3.5 Load curve, peak, time slices
URL: `Transformation/Dispatching_Processes_on_a_Load_Curve.htm`, `Supporting_Screens/Time_Slices.htm`, `Load_Shapes/System_Load_Shape.htm`, `Supporting_Screens/Load_Shapes.htm`, `Transformation/Peak_Load_Ratio.htm`, `Results_Categories/Load_Factor.htm`

- Running cost [image]: `RunningCost_i = VariableOMCost_i + FuelCost_i / Efficiency_i`
- Peak [image]: `PeakSystemPowerRequirement[MW] = EnergyRequirement[MWhr] / (LoadFactor × 8760)`. The module load factor is "the mean height of the load curve", or it is entered as data.
- Strips: "The height of each strip is equal to the overall system peak load requirement multiplied by the average percentage of peak load of two adjacent points on the specified load curve. The width of the strip is the difference in hours of those same two adjacent data points."
- Fill order: "each group of processes is dispatched in vertical "strips"... Base load plants are dispatched first... the maximum height of each strip is the available capacity for each group (i.e. the sum of Capacity x Maximum Availability)... In cases where the available capacity of the group exceeds the amount required... each process is dispatched in proportion to its available capacity."
- Time slices: "LEAP assumes that every year has 8760 hours and there are no leap years (ironically!). Every year begins on a Monday."
- Yearly shapes come in four kinds: % of peak, % of annual energy, availability (0..100%) and merit order (integers). Optimization requires % of energy.
- The system shape is set in the Current Accounts variable System Peak Load Shape or System Energy Load Shape. Alternatively, ShapeFromDemand sums the device Load Shapes.
- `YearlyShape(A, B)` or `YearlyShape(A, LHY, B)` "will linearly interpolate between years ... for each time slice value".
- Peak Load Ratio: "the ratio of the peak implied by the simplified time-sliced load shape ... versus the actual peak load"; values are between 0 and 100%.
  - **[inferred]** Actual peak = time-slice peak / Peak Load Ratio. The exact formula is not given.
- Load Factor result: `Load Factor = Total Output (MWh/yr) / (Total Capacity (MW) x 8760 (hr/year))`
- Actual Availability (result) = actual energy / (rated capacity × full year); it is constrained to be ≤ Maximum Availability.

### 3.6 Capacity: exogenous, endogenous, reserve margin
URL: `Endogenous_Capacityu_Expansion_Calculations.htm`, `Endogenous_Capacity.htm`, `Capacties.htm`, `Capacity_Value.htm`, `Planning_Reserve_Margin.htm`, `Results_Categories/Reserve_Margin.htm`, `Lifetime.htm`, `Maximum_Built_Capacity.htm`

- Exogenous Capacity is total capacity in each year, not additions. "exogenously specified capacity is not automatically retired".
- The endogenous algorithm, verbatim:
  1. "Capacity Before Additions = (Exogenous Capacity + Endogenous Capacity Added Previously) * Capacity Value", where previously added endogenous capacity "is summed over the previous Lifetime years, so as not to include endogenously added capacity that is now retired."
  2. "Peak Requirement [MW] = Energy Requirement [MW-hr] / (Module Load Factor * 8760 [ hrs/year])"
  3. "Reserve Margin Before Additions = (Capacity Before Additions - Peak Requirement) / Peak Requirement"
  4. "Endogenous Capacity Additions Required = (Planning Reserve Margin - Reserve Margin Before Additions) * Peak Requirement"
  5. "endogenous capacity additions are calculated for each process by cycling through the processes listed on the Endogenous Capacity screen in the order listed on the screen. In each year, capacity continues to be added in the amounts specified on the screen in the Addition Size column, until the amount added is greater than or equal to the Endogenous Capacity Additions Required."
- Example: coal 500 MW (order 1), oil CT 300 MW (order 2), giving coal, oil, coal, oil and so on.
- "When each endogenously added process reaches its specified lifetime, it will be automatically retired (and additional processes added if necessary)."
- If the starting margin is below the planning margin, "LEAP will start adding capacity in the year after the base year."
- Supply curve: the Maximum Built Capacity of an earlier-generation process caps it before a "next generation" process with a later Build Order is used.
- Ambiguity in step 5:
  - The formula in step 1 multiplies by Capacity Value (capacity credit). It is unclear whether "amount added" compares rated MW or credited MW (Addition Size × Capacity Value).
  - **[inferred]** Credited MW is consistent with the reserve-margin definition below.
- Reserve margin (result and planning definition): "Reserve Margin (%) = 100 * (Module Capacity - Peak Load) / Peak Load", with "Module Capacity = Sum(Capacity * Capacity Value) for all processes in the module."
- Capacity credit: "the fraction of the rated capacity considered firm for the purposes of calculating the module reserve margin."
- The module option "Planning Reserve Margin calculated endogenously" exists for simulation; its method is not documented. **Gap.**

### 3.7 Shortfall, surplus, usage rules; unmet requirements; module balance
- Shortfall Rule per output fuel: `ImportToMeetShortfall` or `RequirementsRemainUnmet`. A shortfall in one module "does not necessarily indicate that overall supply does not meet demand" because a lower module may produce the same fuel.
- Surplus Rule: `SurplusExported`, `SurplusWasted`, `SurplusAvailable` ("made available to earlier modules in the tree").
- Usage Rule: `DomesticPriority`, `ExportPriority`, `EqualPriority`.
  - The semantics beyond the names are not documented. **Gap.**
- Module Balance result: "Requirements and exports are shown as negative values while outputs, imports, co-production and unmet requirements are shown as positive values."
  - **[inferred]** The balance identity is Outputs + Imports + Co-production + Unmet = Requirements + Exports (+ surplus wasted).
- Results definitions:
  - Requirements: "the amount of energy the module "sees" or is asked to produce".
  - Inputs: feedstock plus auxiliary fuel, which can be split by input type.
  - Outputs: by output fuel or by feedstock fuel, as primary, co-product or all.

### 3.8 Feedback flows (iteration)
`Calculation_of_Transformation_Systems_with_Feedback_Flows.htm`, `Supporting_Screens/Basic_Parameters_Screen.htm`

- "These systems are solved by repeating (iterating) the basic Transformation calculation, but with adjustments made to total demands after each iteration to reflect any unmet requirements for upstream energy flows."
- Convergence (Settings, Calculations tab): iterate "until the change in all residuals is less than the specified fraction of the total residuals for all fuels (by default 0.1%), or until the residuals are less than the specified absolute amount (by default 10 GJ), or until the maximum number of iterations is reached (in which case the calculation is deemed to have failed."
- The feedback page says: "If convergence is not reach within 20 iterations... LEAP will report an error".
- Iteration applies only to fuels whose Resource property is set to "Iterate Calculations: Use upstream modules to meet any remaining requirements."
- Example: 100 electricity at 33% needs 300 diesel; the refinery at 94% needs ~320 crude and uses 5 electricity. Iteration 2 gives 105 electricity, 315 diesel and 5.25 electricity.
  - The help text says iteration 2 needs "320 units of crude", but the diagram shows 336 (315/0.94 = 335.1). The text appears to be a typo.

---

## 4. Resources, stock changes, statistical differences
URL: `Resources/Resource_Data.htm`, `Base_Year_Reserves.htm`, `Additions_to_Reserves.htm`, `Resource_Costs.htm`, `Results_Categories/{Indigenous_Production, Imports, Exports, Reserves, Resource_Primary_Requirements, Self-Sufficiency, Unmet_Requirements, Stock_Changes, Statistical_Differences}.htm`

- Fossil resources (including uranium) take reserves: Base Year Reserves plus Additions to Reserves. "As resources are utilized in future years these initial reserves will gradually be drawn down."
  - Depletion starts at the First Depletion Year (Settings, Years tab).
  - **[inferred]** `Reserves_y = BaseYearReserves + Σ Additions − Σ_{FirstDepletionYear..y} IndigenousProduction`
- Renewable resources take "the annual energy available from the resource."
- Self-Sufficiency (%) = "percentage ratio of indigenous production to total resource requirements."
- Stock Changes: "supply of primary energy from stocks. Negative values indicate an increase in stocks. The values you specify will be added to the total primary supply of the fuel".
- Statistical Differences: added to final demand ("Enter a positive value to increase the energy demand").
- Unmet requirements at a module may "ultimately [be met by] imports (specified at the Resource branches)".
- Gap: the help does not give the simulation rule that splits primary requirements into indigenous production and imports (or what happens when a renewable or fossil limit binds). Maximum Production, Minimum and Maximum Imports are optimization-only constraints.
- In-Area Import Fraction and In-Area Export Fraction govern trade between regions in multi-region simulation.

---

## 5. Environmental loadings
URL: `Demand/Environmental_Analysis.htm`, `TED/TED_Expression_Builder.htm`, `TED/Environmental_Loadings_Screen.htm`, `Supporting_Screens/Effects_Screen.htm`, `Supporting_Screens/Fuels.htm`, `Supporting_Screens/Constants.htm`, `Results_Categories/Environmental_Results.htm`, `Results_Categories/Primary_Requirements.htm`, `Effects/IPCC_GWP_Values.htm`, `Effects/Extraction-Based_Environmental_Loadings.htm`, `Expressions/{CarbonContent, FractionOxidized, SulfurContent, SulfurRetention}.htm`, [UG2011] §Environmental Results

- General rule: "Each loading is specified as an effect (e.g. a pollutant emission) per unit of energy consumed or energy produced or per unit of vehicle distance... LEAP multiplies the loadings you specify ... by the total amount of energy consumed in each year of each scenario. In the case of distance-based loadings, LEAP multiplies the loadings by the total mileage of all vehicles."
  - Sources are demand devices and transformation feedstock, auxiliary and output fuels. TED energy-supply loadings can be per unit "consumed, produced, or lost".
- Fuel-based factors (TED expressions):
  - "Loading (kg CO2 / kg of fuel consumed) = CarbonContent * FractionOxidized * (CO2/ C)"
  - SO2: "SulfurContent*(1-SulfurRetention)*(SO2/S)"
  - `CarbonContent`, `SulfurContent` and `SulfurRetention` return decimal fractions (0..1).
  - Inconsistency: `FractionOxidized` is documented as "returned as a percentage from zero to 100%". For numerical work, check whether LEAP divides it by 100 in the TED formula. **Gap.**
  - CO2, C, SO2 and S are locked molecular-weight constants (General: Constants).
  - The factors are per kg of fuel, so they are converted to an energy basis through the fuel's net energy content and density in the Fuels screen. **[inferred]** The conversion path is not spelled out.
- Non-energy carbon: "Carbon Stored When Fuel Consumed for Non Energy Purposes (%)... used in conjunction with the non-energy fraction variable".
  - Gap: the formula is not given.
- Stock and transport new-device factors and degradation: see §2.1. "Avg Environmental Loading" and "New Device Environmental Loading" are not named as such in the current help. The concept is "values for newly added technologies" versus "stock-average environmental loading factors".
- GWP:
  - "GWP results can be shown measured in terms of the equivalent amount of Carbon (C) or Carbon Dioxide (CO2). Reports measured in terms of CO2 are a factor of 44/12 larger".
  - 20, 100 and 500-year values are in "tonnes of CO2 equivalent per tonne of pollutant", and "the GWP of CO2 is set to 1".
  - AR1–AR6 sets are selectable, and the area-level variable IPCC GWP Values overrides per scenario (0 = use the Effects screen).
  - The help contradicts itself on the default: "default to ... IPCC ... Second Assessment Report (ARII)" (Environmental Results) versus the Effects screen listing AR1–AR6.
- Allocation to demands:
  - [UG2011]: "Transformation emissions are allocated to demands based on the fraction of the total final fuel consumption that occurs at each demand branch." This requires "Allocate primary energy and Transformation emissions back to demands".
  - The current help names the results "Direct (Demand) plus Indirect (Transformation) GHG Emissions Allocated to Demand Branches" and "Indirect ... Allocated to Demand Branches". They are 100-year GWP only and exclude non-energy sectors.
- Primary Energy Requirements Allocated to Demands, verbatim heuristic: "LEAP assumes that each final fuel gets a proportion of the average mix of supply side processes in each year... The calculation works by tracing a unit of energy consumption back through the various modules that produce it... it does not account for secondary fuels that are imported or exported."
- Accounting is territorial (IPCC/UNFCCC). Extraction-based loadings are an optional alternative, with factors entered under Resources\Primary.
- Externality: "LEAP will multiply this unit cost by the total emissions of that effect in each year" (`Effects/Externality_Costs.htm`).
  - [UG2011] adds that there is a base-year externality cost with an optional real growth rate.

---

## 6. Costs
URL: `Concepts/Transformation_Cost_Calculations.htm` (titled "Cost Calculations"), `Concepts/Social_Cost-Benefit_Analysis.htm`, `Results_Categories/{Costs, Investment_Costs, Module_Cost_Balance, Levelized_Cost_of_Energy_Production}.htm`, `Transformation/{Capital_Costs, Interest_Rate, Lifetime, Salvage_Value, Stranded_Costs, Module_Costs, Operating_and_Maintenance_Costs, Fuel_Costs, Output_Price}.htm`, `Resources/Resource_Costs.htm`, `Supporting_Screens/Basic_Parameters_Screen.htm` (Costs tab), `Expressions/{AnnualizedCost, LoanPayment, NPV}.htm`

- Elements of Social Costs:
  - demand costs
  - transformation capital, fixed and variable O&M, and module costs ("excluding the fuel costs specified for your Transformation Feedstock fuel branches")
  - fuel costs at the costing boundary (indigenous production and imports, minus export benefits)
  - environmental externalities
  - costs of unmet requirements (Resource variable Cost of Unmet Requirements)
  - Stranded Costs "are not included in the Social Costs result type" (sunk); they appear only in the Module Cost Balance.
- Costing boundary:
  - Full system (default): fuel costs only for indigenous extraction, imports and exports. "This approach does NOT include the costs of domestically produced secondary fuels".
  - Restricted boundary at a nominated module: the Delivered Costs of fuels into that module are used. Capital and O&M below it are ignored, and imports and exports count only downstream of the boundary.
- Capital costs:
  - "total (i.e., non-annualized) capital costs per unit of capacity", annualized over Lifetime at the process Interest Rate.
  - The methods are Capital Recovery Factor (default), No Annualization, Straight Line, Sinking Fund, Declining Balance and Double Declining Balance.
  - Optimization requires CRF.
    - Conflict: [UG2011] says optimization requires "No Annualization". Current help supersedes it.
  - "Using the default CRF method, capital costs are spread forward into equal real payments every year for each year of the lifetime of a process. If any costs occurring in years after the end year are ignored."
  - Endogenous additions are replaced after each lifetime, so their capital cost recurs. Exogenous capacity is not replaced.
- CRF [image] (`Expressions/AnnualizedCost.htm`): `AnnualizedCost = (CRF · Capital Cost) + O&M Cost`, with `CRF = Rate / (1 − (1 + Rate)^(−Life))`.
  - Edge cases: "when Life=0: AnnualizedCost = CapitalCost + O&MCost"; "When Rate=0: AnnualizedCost = (CapitalCost/Life) + O&MCost".
  - Checks: `AnnualizedCost(100,5,0.05,0)=23.10`; `LoanPayment(1000000,2005,15,5%)=96,342.29`. Both match the CRF formula, as I recomputed.
- Investment Costs (result): "the product of the capacity added in that year and the unit capital cost", non-annualized. It can be reported real, nominal or discounted.
- Salvage value: "incorporated into the overall capital cost stream ... using the above annualization methods".
  - Gap: how the sign and timing are applied is not given.
- O&M: "Fixed O&M costs ... are entered per unit of capacity (e.g. per MW). Variable O&M costs are entered per unit of energy outputs, inputs or losses."
- Module Cost Balance: revenue (Output Price × outputs) is positive. The negative terms are "feedstock and auxiliary fuel costs, capital costs, fixed and variable operating and maintenance (O&M) costs, module costs, externality costs (where applicable) and any stranded costs".
  - Costs of Production is the same set without revenue, shown as positive values.
  - Sales Revenue is the revenue split by output fuel.
  - Transformation Fuel Cost defaults to the indigenous production cost under Resources and "is not directly used in calculating the social cost result type."
- Levelized Cost of Energy Production: total module cost (capital, O&M, fuel, optional externality) per unit of total energy produced. The formula is not given.
- Discounting:
  - "all of the cost calculations in LEAP are performed in real (constant) currency units... Costs are discounted back to the base year".
  - "The NPV is the sum of all discounted costs and benefits in one scenario minus another (summing across all years of the study)".
  - Last Year to Count Costs truncates the sum.
  - Nominal results apply the Inflation Rate.
  - "Results Every" must be 1 for cost and stock-turnover calculations.
  - **[inferred, conventional]** `DF_y = (1 + r)^−(y − BaseYear)`. The exact discounting convention (end of year or mid-year) is not documented. The NPV() expression function discounts "back to the base year" by default.

---

## 7. Expression semantics
URL: `help24/Expressions/<Name>.htm` for each function; `Concepts/Expressions.htm`; `Concepts/Understanding_Expression_Inheritance.htm`; `Expressions/Using_Time_Series_Functions.htm`

- **Inheritance search** (explicit expression found, stop):
  1. the current scenario
  2. each scenario in its "First Inherits From" list, in order
  3. recursively, those scenarios' own lists
  4. up the main scenario tree to Current Accounts

  For multi-region areas, at each step the current region is searched first, then the parent region. If nothing is found, the variable default is used (usually 0).
- **Years:** Current Accounts expressions cover Base Year to FSY−1. Scenario expressions cover FSY to End Year. `LastHistoricalYear` = FSY−1. Time-series years must be in 1900–2200, in chronological order, with no duplicates.
- **Growth(r)** / **Growth(r1, Y2, r2, ..., Y5, r5)**:
  - "applied to make values grow exponentially from their values in the year before the First Scenario Year" (Settings). Example: base 100 in 2000 gives 2001 = 105.00, 2002 = 110.25.
  - **[inferred]** `V(t) = V(FSY−1) × Π (1 + r_k)` over each year, using the rate in force in that year.
  - Period boundary ambiguity: the current help says "from Year2 onwards the growth rate will be Expression2"; [UG2011] says "in years after Year2". **Gap**: test both.
  - Inside Step or Interp, Growth applies a single rate to "the last explicitly entered yearly parameter".
  - The `%` suffix means /100: `Growth(5%)` = `Growth(0.05)`.
  - "Allow growth rates on percent shares" is off by default.
- **GrowthAs(B:V[, e]):** "Current Value(t) = Current Value(t-1) * NamedBranchValue(t) / NamedBranchValue(t-1)". With elasticity, "the change in the current (dependent) branch is related to the change in the named branch raised to the power of the elasticity", which reads as `V(t) = V(t−1) × (N(t)/N(t−1))^e` **[formula form inferred from that sentence]**.
- **GrowthFromYear(Y, r, ...):** growth applied after Y. Earlier years come from the parent scenario's expression.
- **GrowthFromValue(V0, r, ...):** growth from a stated base-year starting value.
- **Interp(Y1,V1,...,Yn,Vn[,g]):**
  - Formula [image]: `Value_iy = Value_fy + (Value_ey − Value_fy) · (Year_iy − Year_fy)/(Year_ey − Year_fy)`.
  - "If no growth rate is specified zero growth is assumed (i.e. values are not extrapolated)" after Yn. The value is held flat, or grown at g per year (example: 2020 = 30 gives 2021 = 30.6 at 2%).
  - "the base year value is always implicit... and will override any value explicitly entered for that year". Example: base 1998 = 6.0 and the first point 2000 = 10 give 1999 = 8.0.
  - InterpFSY uses FSY−1 as the implicit point instead of the base year. InterpNIV has no implicit point.
  - Behaviour before Y1 when there is no implicit anchor (NIV) is not documented. **Gap.**
- **ExpInterp:**
  - The documented images give `Value = a + b·Year^α` and `Value_iy = Exp(k + α·ln(Year_iy))`, `α = ln[(V_ey−V_fy)/(Year_ey−Year_fy)]`, `k = ln(V_ey)/(α·ln(Year_ey))`. These do not reproduce the page's own example.
  - The example (2000 = 100, 2030 = 200 gives 2005 = 112.33, 2010 = 126.14, 2020 = 158.92, 2025 = 178.31) is reproduced exactly by a power law in calendar year: `V = V_fy·(Year/Year_fy)^α`, `α = ln(V_ey/V_fy)/ln(Year_ey/Year_fy)` (α = 46.5555). I verified this numerically. Plain exponential-in-time would give 112.25 and 125.99, which does not match.
  - Treat the page images as misprinted and the example as authoritative. The base year is implicit.
- **Step(Y1,V1,...):**
  - The value of the most recent step year applies until the next one. Base year implicit: base 1997 = 200 with `Step(2000,300,...)` gives 200 in 1998 and 1999. The example shows 2012 = 500 and 2022 = 900.
  - **[inferred]** The last value is held after Yn.
- **Smooth(...):** a polynomial fit "Y = a + b.X + c. X2 + d. X3 + e.X4 + ... When more points are available, a higher degree polynomial is used"; it needs at least 3 pairs, and the base year is implicit.
  - The degree rule and the fitting method are not documented. **Gap.**
- **Data(Y1,V1,...):** "Values are not interpolated between data points. Any unspecified data years are assumed to have zero value."
- **Remainder(X):** "Expression - Sum of Other Neighboring Branches". It is an error if used in more than one sibling.
- **Exp(x):** e^x. `^` is power.
- Other functions:
  - `PrevYearValue[(B:V)]`: inside Step or Interp it returns the last explicit parameter.
  - `BaseYearValue`
  - `LaggedValue(n)`
  - `Cycle`
  - `Unlimited` = 1E+15
  - `Yes`/`True` = 1
  - `ChangeIn` modes 0–4, with growth = (Cur/Past)^(1/N) − 1
  - `LinForecast` (OLS y = mx + c, not forced through the base year), `ExpForecast`, `LogisticForecast` [image: `Y = A + (B − A)/(1 + e^(−a·X + b))`], `SmoothForecast`. The *CA variants return actual data for the Current Accounts years.
  - `LogisticForecast` "will be overridden by any value calculated for the base year".
  - Results can be referenced only with a one-year lag (PrevYearValue) unless the setting allows it. Indicators can use current-year results.

---

## 8. Optimization (NEMO)
URL: `help24/Optimization/{OptimizationIntroduction, Setting_Up_Optimization_in_LEAP, Solvers_Supported_by_LEAP_and_NEMO}.htm`, `Expressions/Yes.htm`, `Transformation/Energy_System_Optimization.htm`; NEMO docs `https://sei-international.github.io/NemoMod.jl/stable/` and `.../modeling_concept/`

- NEMO is "an open source framework built in the Julia programming language". LEAP writes the inputs and reads the results automatically.
  - [UG2011]-era versions used OSeMOSYS with GLPK instead.
- Objective: "the lowest total net present value of the social costs of the system over the entire period... (from the base year through to the end year)".
  - The costs are capital, salvage or decommissioning, fixed and variable O&M, fuel, and externalities.
  - NEMO: "all costs are discounted to the beginning of the simulation".
- Scope:
  - Partial optimization: one Transformation module, `Optimize = Yes`.
  - Full energy-system optimization: area variable `Energy System Optimization = Yes`. It can include useful-energy demand end uses (`Optimize Devices`), storage (Starting Charge, Minimum Charge, Full Load Hours) and transmission (multi-region).
  - Scenarios only, never Current Accounts.
  - Hidden under optimization: Endogenous Capacity, Dispatch Rule, Process Share, Merit Order.
- Constraints:
  - minimum and maximum capacity, capacity additions, production and share of production
  - renewable targets
  - resource limits, and minimum or maximum imports and exports
  - annual emission constraints (top-level Effects branch)
  - Minimum Utilization ≤ Maximum Availability
  - Use Addition Size = Yes turns the problem into a MIP with discrete blocks.
- Requirements: CRF annualization and a positive discount rate. Load shapes must be "% of energy".
- A hidden "UNSERVED" process with very high cost is created unless "Stop calculations and report an error in NEMO" is chosen.
- Solvers: GLPK, Cbc and HiGHS are bundled; MOSEK, Gurobi, CPLEX and XPress need licences.
  - `Yes(Solver, Presolve, HSD, ExtraParams, Year1..YearN)`: the years define limited-foresight groups ("up to and including 2030, ... 2031 to 2040, ... after 2040").
  - With no solver given, the order is Gurobi, CPLEX, XPress, then HiGHS.

---

## Gaps (not found in the public documentation)
1. Treatment of initial vintages after FSY (relative or absolute survival); the exact order of sales, survival and scrappage within a year; formulas for Device Retirements and stock-average weighting.
2. Whether endogenous Addition Size counts against the requirement in rated or credited MW; the method behind "Planning Reserve Margin calculated endogenously"; how Peak Load Ratio enters the peak formula.
3. The capacity-constrained output algorithm for PercentShare and ProportionalToCapacity (described in words only); the exact semantics of Usage Rule; how the strip method treats time-sliced availability and merit order per slice.
4. The resource-side split between indigenous production and imports in simulation.
5. The exact discount-factor convention; when CRF payments start; how salvage value is treated; formulas for LCOE and for the depreciation methods. The depreciation functions exist as expressions (`StraightLineDepreciation`, `DoubleDecliningBalance`, ...), but their use in Transformation costing is not formalised.
6. Whether FractionOxidized is used as a percentage or a fraction in TED formulas; the mass-to-energy conversion path for emission factors; the non-energy carbon storage formula; the exact allocation algorithm for indirect emissions (only the [UG2011] one-liner).
7. The degree and fitting rule for Smooth/SmoothForecast; the Growth period boundary (current help and 2011 guide disagree); behaviour of InterpNIV and Data outside their range (Data gives 0 by definition).
8. The ExpInterp formula images contradict the page's own example (see §7).

## Relevance to current project
`leap-rs` is a bit-exact Rust port of `leap.exe`, with oracle vectors captured from the binary (see `PORTING.md`). The documentation above gives the **intended** arithmetic: demand chain products, stock turnover, dispatch and reserve-margin logic, CRF annualization and expression edge rules. It is a map for finding the matching routines in `../leap-decompiled/` and for building golden test cases (for example, the worked examples: TA chain 8M×50%×20% = 800k; useful-energy shares 59/41; Interp 1999 = 8.0; ExpInterp 112.33; AnnualizedCost 23.10; LoanPayment 96,342.29; priority-output total 1200). It is not a substitute for the binary. Every item marked [inferred] or listed under Gaps should be settled against decompiled code or oracle captures, not taken from this document. The ExpInterp case already shows that the documentation's own formulas can be wrong where its numbers are right.
