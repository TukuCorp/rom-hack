# Probe the installed LEAP automation interface.
#
# LEAP registers a COM class, LEAP.LEAPApplication, which is the vendor's sanctioned
# automation surface: the same one SEI's own scripts under _Scripts use. This script
# starts an instance, reports what it can read, and quits. It is a research tool rather
# than part of the test suite, because it launches the installed application.
#
# Measured on this machine against version 2026.7.0.3: the class is registered, an
# instance is created without a licence prompt, Visible can be set false, Quit releases
# it, and the process exits when the client does. What read empty were the per-area
# collections, which is the open question this script exists to re-check: it is not yet
# known how an area gets loaded for an externally created instance.
#
# The surface worth knowing about, from Get-Member on a live instance: Calculate,
# ForceCalculation, ExportResults, ExportResultsCSV, ExportResultsXLS, ExportData,
# ExportExpressions, ExportEnergyBalanceCSV, ImportExpressions, SaveArea, Area, Areas,
# Branch, BranchVariable, ResultValue, CompileVarRef, Scenario, Region, BaseYear.

$ErrorActionPreference = 'Continue'

$leap = New-Object -ComObject LEAP.LEAPApplication
'version   : ' + $leap.SoftwareVersion
try { $leap.Visible = $false } catch { }
'visible   : ' + $leap.Visible
'program   : ' + $leap.ProgramDirectory
'dictionary: ' + $leap.DictionaryDirectory

$area = $null
try { $area = $leap.ActiveArea } catch { }
if ($area) {
    'area      : ' + $area.Name
    'area dir  : ' + $area.Directory
} else {
    'area      : <none>'
}
'base year : ' + $leap.BaseYear
'end year  : ' + $leap.EndYear

foreach ($name in 'Regions', 'Scenarios', 'Branches', 'Areas') {
    $count = -1
    try { $count = @($leap.$name).Count } catch { }
    '  {0,-10}: {1}' -f $name, $count
}

try { $leap.Quit(); 'quit      : sent' } catch { 'quit      : ' + $_.Exception.Message }