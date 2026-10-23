# Lessons

## Runnable slice before visual research
When a playable demo has a named reference, obtain one usable reference and then build the smallest end-to-end browser interaction before further research or visual polish. Verify selection, attack, fainting and restart first. Do not let reference gathering delay a runnable app.

## Driving LEAP over COM
Before any COM area call, make sure no LEAP supporting screen is open: the startup Tips window
(`ShowTipsOnStartUp`) blocks the area API, and every refused call raises a modal dialog that stalls
the client until someone clicks OK. Wait for the instance to finish starting before touching `Areas`.
Pick the area through `LastArea` before launch rather than retrying `Open()`, which raises a dialog per try.
