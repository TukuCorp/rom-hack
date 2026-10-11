<#
  Waits for the running Ghidra headless analysis of leap.exe to finish, then runs the
  DecompileAll export over the analysed program.

  Launched hidden by the agent. Status goes to leap-export-watch.log; the export log
  goes to leap-export.log; the export writes chunk-*.c plus progress.txt in OutDir.
#>
param(
    [string]$GhidraHome = 'C:\Users\tukum\Downloads\rom-hack\ghidra_12.1.4_PUBLIC',
    [string]$ProjectDir = 'C:\Users\tukum\Downloads\rom-hack\ghidra-projects',
    [string]$ProjectName = 'LeapRE',
    [string]$Program = 'leap.exe',
    [string]$ScriptDir = 'C:\Users\tukum\Downloads\rom-hack\ghidra-scripts',
    [string]$OutDir = 'C:\Users\tukum\Downloads\rom-hack\leap-decompiled',
    [int]$ChunkSize = 500,
    [int]$PerFunctionTimeoutSec = 45,
    [string]$WatchLog = 'C:\Users\tukum\Downloads\rom-hack\leap-export-watch.log'
)

function Log($m) {
    $line = '{0}  {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $m
    Add-Content -LiteralPath $WatchLog -Value $line
}

Log 'watcher started; waiting for the leap.exe analysis to finish'

while ($true) {
    $running = Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'AnalyzeHeadless' }
    if (-not $running) { break }
    Start-Sleep -Seconds 60
}

Log 'no AnalyzeHeadless JVM left; checking the analysis outcome'

$appLog = Join-Path $env:APPDATA 'ghidra\ghidra_12.1.4_PUBLIC\application.log'
$tail = Get-Content -LiteralPath $appLog -Tail 500 -ErrorAction SilentlyContinue
$ok = $tail | Select-String -Pattern 'Analysis succeeded for file: \S*/leap[.]exe|Save succeeded for processed file: /leap[.]exe'
if ($ok) { Log 'analysis reported success' } else { Log 'WARNING: no success line for /leap.exe found in the recent log' }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Log ('starting export into ' + $OutDir)

$exe = Join-Path $GhidraHome 'support\analyzeHeadless.bat'
$exportLog = Join-Path (Split-Path $OutDir -Parent) 'leap-export.log'
$argList = @(
    $ProjectDir, $ProjectName,
    '-process', $Program,
    '-noanalysis',
    '-scriptPath', $ScriptDir,
    '-postScript', 'DecompileAll.java', $OutDir, "$ChunkSize", "$PerFunctionTimeoutSec"
)
& $exe @argList *>&1 | Out-File -LiteralPath $exportLog -Encoding utf8

Log ('export finished, exit=' + $LASTEXITCODE)

# Verify the export and build a navigable index: address -> name -> chunk.
$verifyLog = Join-Path (Split-Path $OutDir -Parent) 'leap-verify.log'
$verifyScript = Join-Path $ScriptDir 'verify_decompilation.py'
python $verifyScript $OutDir --index (Join-Path $OutDir 'index.tsv') *>&1 |
    Out-File -LiteralPath $verifyLog -Encoding utf8
Log ('verification finished, exit=' + $LASTEXITCODE + ' -> ' + $verifyLog)
