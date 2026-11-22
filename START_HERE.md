# Frontier Lab 0.36 — source checkout

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
is in [the 0.36 QA notes](docs/GAMEPLAY_POLISH_QA.md).

## Bring an existing game with you

On the hosted site, open Save and download your game. In the local copy,
open Save and choose Load save to import the downloaded JSON. A campaign
lives in the browser that played it and is exported separately.

Published game: https://frontier-lab.nerdygeneral.chatgpt.site/

Imported from Sites version 47, build/content 0.36.0.
Published source commit: c86f32cac61b0c0f31efeffcbd950ebc94f680e4.
This import updates this getting-started document for a clean GitHub clone;
the game code, assets, and tests match that published source.
