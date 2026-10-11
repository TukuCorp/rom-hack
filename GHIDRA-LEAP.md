# Ghidra reverse-engineering workspace for LEAP

Studying **SEI LEAP 26.7.3** (`C:\Program Files\LEAP\leap.exe`) with **Ghidra 12.1.4**
and **ghidra-mcp** (github.com/bethington/ghidra-mcp, v7.0.0).

## What is installed

| piece | location |
|---|---|
| Ghidra 12.1.4 PUBLIC | `ghidra_12.1.4_PUBLIC\` (0.84 GB, from `ghidra_12.1.4_PUBLIC_20260921.zip`) |
| ghidra-mcp | `ghidra-mcp\` (git clone; build output in `build\libs\GhidraMCP-7.0.0.jar` and `build\distributions\GhidraMCP-7.0.0.zip`) |
| Ghidra extension | installed to `ghidra_12.1.4_PUBLIC\Extensions\Ghidra\GhidraMCP-7.0.0.zip` and unpacked under `%APPDATA%\ghidra\ghidra_12.1.4_PUBLIC\Extensions\GhidraMCP\` |
| Ghidra project | `ghidra-projects\LeapRE.gpr` — holds `/leap.exe` |
| server launcher | `start-ghidra-mcp-headless.ps1` |

Everything above is listed in `.gitignore` so this repo never swallows the ~1 GB of tooling.

## Running it

```powershell
# 1. Start the headless GhidraMCP server (HTTP API on 127.0.0.1:8089)
.\start-ghidra-mcp-headless.ps1 -Project 'C:\Users\tukum\Downloads\rom-hack\ghidra-projects'

# 2. Check it
(Invoke-WebRequest http://127.0.0.1:8089/mcp/health).Content
```

Codex already has the matching client entry, added to `C:\Users\tukum\.codex\config.toml`:

```toml
[mcp_servers.ghidra_mcp]
command = 'C:\Users\tukum\AppData\Local\hermes\bin\uv.EXE'
args = ["run", "--directory", 'C:\Users\tukum\Downloads\rom-hack\ghidra-mcp', "bridge-mcp-ghidra", "--transport", "stdio"]

[mcp_servers.ghidra_mcp.env]
GHIDRA_MCP_URL = "http://127.0.0.1:8089"
PYTHONIOENCODING = "utf-8"
```

Restart Codex for the entry to be picked up. The bridge tolerates the server being down (it
exposes only its static tools), so a stopped server does not break other sessions.

## GUI instead of headless

Only one Ghidra process can hold a project at a time, so stop the headless server first, then:

```
.\ghidra_12.1.4_PUBLIC\ghidraRun.bat      # then File > Open Project > ghidra-projects\LeapRE.gpr
```

Both servers expose the same analysis API, but not the same endpoint set. The repo's own catalog
(`ghidra-mcp\tests\endpoints.json`, 209 endpoints) splits as 186 shared + 4 headless-only
(`/create_project`, `/list_projects`, `/close_project`, `/delete_project`) + 19 GUI-only
(every `/debugger/*` plus `/prompt_policy`, `/tool/*`). Measured live: headless answers 190, the
GUI answered 205 — exactly those sums. The GUI is the one to use for live debugging.

## What the binary looks like

Measured through the MCP API on the imported program:

- `leap.exe` 176,701,048 bytes, PE, `x86:LE:64:default`, compiler `windows`, image base `0x00400000`,
  13 memory blocks / 177,869,521 bytes mapped, 169,538 symbols.
- 166,343 functions exist straight out of the loader, before auto-analysis runs.
- Entry: `entry` @ `03294a20`; the CRT delay-load wrapper pair `__dbk_fcall_wrapper` @ `00420e40`
  and `dbkFCallWrapperAddr` @ `037f12b0` — a compiler-runtime fingerprint worth following up.
- Not .NET: imports are plain Win32 (KERNEL32, USER32, OLE32, GDI32, …). The install also ships
  `Python64\` (embedded interpreter) and `ibc.exe`, so the analysis surface extends past the EXE.
- Installer provenance (from `leap\ACQUIRE.md`): SHA-256
  `59595210D829A24C871D388984944F44A24F4FECD80C52CCDEEA8AA07FD3BF68`, signed by
  Stockholm Environment Institute US.

## Constraints

- This machine has 7.8 GB RAM. Full auto-analysis of a 169 MB binary with 166 k functions is slow
  and the server runs with a 4 GB heap; expect it to take a long while and to be the main consumer
  of memory while it runs.
- Headless and GUI are mutually exclusive on the same project.

## Scope

This is a study setup. Defeating LEAP's registration check or its saving lock is not part of it —
the shipped terms forbid reverse engineering and the licence route is written up in
`leap\LICENCE-ACTIONS.md`.
