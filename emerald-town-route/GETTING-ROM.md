# Getting baserom.gba (your own US Emerald cart only)

The build needs a byte-exact dump: sha1 must equal `rom.sha1`
(`f3ae088181bf583e55daf962a92bb46f4f1d07b7`). Name it `baserom.gba`
and place it at `emerald-decomp/baserom.gba`.

## Reader options

- **GB Operator** (Epilogue) + Playback app: easiest all-in-one slot,
  Backup ROM from the app. Works for GB/GBC/GBA on PC.
- **GBxCart RW** + **FlashGBX**: open-source route; FlashGBX reads the cart
  in blocks (a 32MB GBA title takes noticeably longer than small carts).
- **Joey Jr** (BennVenn) + FlashGBX: also supported.
- **Analogue Pocket** + openfpga-carttools: dumps GBA ROMs over the
  Pocket's own connector, files land as `.gba`.

## Verify before handing it over

1. Load the dump in mGBA (`emerald-town-route/tools/mgba/`) and confirm
   it boots to the Emerald title.
2. `sha1sum baserom.gba` (WSL) or `Get-FileHash -Algorithm SHA1`
   (PowerShell) must print `F3AE088181BF583E55DAF962A92BB46F4F1D07B7`.
3. Only a US v1.0 Emerald dump matches; other revisions/regions fail
   `make check` and can't be used.

Do not download ROMs from the internet: only a dump of a cart you own
produces the exact bytes the decomp build requires.

