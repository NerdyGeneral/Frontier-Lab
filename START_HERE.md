# Frontier Lab 0.37.0 — source checkout

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
is in [the AI Systems release notes](docs/AI_SYSTEMS_0.37.0.md).

## Bring an existing game with you

On the hosted site, open Save and download your game. In the local copy,
open Save and choose Load save to import the downloaded JSON. A campaign
lives in the browser that played it and is exported separately. Large campaigns
are compressed automatically inside the JSON save file; load these with
Frontier Lab 0.36.1 or newer.

Published game: https://frontier-lab.nerdygeneral.chatgpt.site/

Build/content 0.37.0 adds three AI operating designs, twelve discoveries,
four systems challenges and renewable customer briefs. Open Projects → Develop
a model to choose an objective and keep it through research and delegation.
Schema remains 5. Existing paid models and active work retain their original
results and licenses; new systems require new paid foundations.
