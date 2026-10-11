<#
  Starts the GhidraMCP headless server for the LEAP reverse-engineering workspace.

  Runs Ghidra's analysis engine without the GUI and exposes the GhidraMCP HTTP API
  (default http://127.0.0.1:8089) so an MCP client can drive it.

  Examples
    .\start-ghidra-mcp-headless.ps1 -Project 'C:\Users\tukum\Downloads\rom-hack\ghidra-projects\LeapRE'
    .\start-ghidra-mcp-headless.ps1 -Port 8089 -Heap 6g
#>
[CmdletBinding()]
param(
    [int]$Port = 8089,
    [string]$Bind = '127.0.0.1',
    [string]$GhidraHome = 'C:\Users\tukum\Downloads\rom-hack\ghidra_12.1.4_PUBLIC',
    [string]$Jar = 'C:\Users\tukum\Downloads\rom-hack\ghidra-mcp\build\libs\GhidraMCP-7.0.0.jar',
    [string]$Project,
    [string]$ProgramFile,
    [string]$Heap = '4g'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Jar)) { throw "GhidraMCP jar not found: $Jar  (build it with: .\gradlew.bat buildExtension)" }
if (-not (Test-Path $GhidraHome)) { throw "Ghidra install not found: $GhidraHome" }

$java = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\java.exe' } else { 'java' }

# Classpath mirror of docker/entrypoint.sh: the plugin jar plus Ghidra's own jars.
$jars = [System.Collections.Generic.List[string]]::new()
$jars.Add($Jar)
foreach ($glob in 'Ghidra\Framework\*\lib\*.jar', 'Ghidra\Features\*\lib\*.jar', 'Ghidra\Processors\*\lib\*.jar') {
    foreach ($f in (Get-ChildItem (Join-Path $GhidraHome $glob) -ErrorAction SilentlyContinue)) { $jars.Add($f.FullName) }
}
$classpath = $jars -join ';'

$javaArgs = @(
    "-Xmx$Heap",
    "-Dghidra.home=$GhidraHome",
    '-Dapplication.name=GhidraMCP',
    "-Duser.name=$env:USERNAME",
    '-classpath', $classpath,
    'com.xebyte.headless.GhidraMCPHeadlessServer',
    '--port', "$Port",
    '--bind', $Bind
)
if ($Project)     { $javaArgs += @('--project', $Project) }
if ($ProgramFile) { $javaArgs += @('--file', $ProgramFile) }

Write-Host "Starting GhidraMCP headless server on http://${Bind}:${Port} ($($jars.Count) jars)"
& $java @javaArgs
