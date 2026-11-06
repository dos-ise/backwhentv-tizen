# BackWhenTV for Samsung Tizen

This repository contains the Samsung Tizen TV app (`.wgt`) for [BackWhenTV](https://backwhen.stream), free 90s-style cable TV. BackWhenTV is also available for Android TV, Google TV, Fire TV and Windows.

## Samsung Tizen TV (.wgt)

Full-screen player without on-screen controls or start screen; it tunes in to the last channel right away.

Remote: CH+/CH-/Up/Down channel, 0-9 go to, OK guide, Left/Right volume, Info banner, Return closes the guide or exits.

### Install (recommended: Apps2Samsung)

1. On the TV: open Apps, enter `12345`, turn Developer Mode on and enter your PC's IP address, then restart the TV.
2. Start Apps2Samsung on your PC, enter the TV's IP address and connect.
3. Select `BackWhenTV.wgt` (your own build from `dist/` or one from the releases) and install it.

Alternative with the Tizen CLI: `sdb connect <TV-IP>`, then `tizen install -n dist/BackWhenTV.wgt -t <TV-name>`.

### Build

With Docker (`./build.ps1` or `./build.sh`) -> `dist/BackWhenTV.wgt`.
Browser test: `python -m http.server --directory src`.

Source is in `src/` (`app.js` adapted from the Windows app, `remote.js` holds the Tizen key codes). Pluto channels need an Android user agent in the Windows app, which Tizen cannot set, so they may not play on every TV.
