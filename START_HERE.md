# Frontier Lab 0.36.1 — source checkout

This repository contains the complete source, game artwork, dependency lockfile,
test fixtures, and verification notes for the published Frontier Lab game.
Generated builds and installed dependencies are created locally.

## Run locally

1. Clone this repository and open a terminal in its root folder.
2. Install Node.js 22.13 or later.
3. Run `npm run install:ci` to install the pinned dependencies.
4. Run `npm run dev`, then open the local address printed in the terminal.
   Press Ctrl+C to stop it.

For a production preview, run `npm run build` followed by `npm start`.
Build again after changing the source. The repository README covers testing
and the game architecture. The latest regression and compatibility evidence
is in [the 0.36.1 fix notes](docs/BUGFIX_0.36.1.md).

## Bring an existing game with you

On the hosted site, open Save and download your game. In the local copy,
open Save and choose Load save to import the downloaded JSON. A campaign
lives in the browser that played it and is exported separately. Large campaigns
are compressed automatically inside the JSON save file; load these with
Frontier Lab 0.36.1 or newer.

Published game: https://frontier-lab.nerdygeneral.chatgpt.site/

Build 0.36.1 fixes the reviewed saving and gameplay issues while preserving
content version 0.36.0 and schema 5. Existing paid foundations keep their saved
licenses; newly trained foundations start an independent license lineage.
