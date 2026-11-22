# Frontier Lab 0.33.1 — navigation and workflow

## What changed

- Added a searchable **All menus** workspace covering all 25 registered panels, 27 named tasks, and Studio home, Work queue, and Research pathways. Search includes familiar workstation names. Workspace and menu/task filters narrow the list. Locked entries explain their requirements and open the appropriate availability page.
- Made Studio, Projects, Research, Products, Operations, and Company directly available on phones. All menus, Results, Save, and Settings stay reachable while tasks are open. Research has direct Pathways, Architecture, Catalog, Applications, Synthetic data, and Compare tabs.
- Replaced routine editor → review → confirm → receipt navigation with one explicit action at the quoted cost. The editor remains in place and shows an inline scheduled/save status. Optional work queue and advance links are available.
- Kept one concise review for permanent staff specialties, dismissal, discarding release preparation, and ending batch jobs, agent jobs, or assurance contracts. Existing campaign reset/import protections remain.
- Exposed **My datasets** and the complete 14-source **Data catalog** in the Data workspace. Sources can be searched by skill; selected cards show price, preparation work, and a single purchase action beside the choice. Training opens the catalog directly and retains its draft and return path after a purchase.
- Made additional training datasets and experiment comparison discoverable in the guided workflow; moved the evaluation suite selector ahead of history charts. Locked deduplication explains how to unlock it.
- Fixed navigation out of Results, locked task shortcuts, stale editor events after closing, and duplicate-submission protection. Existing engine admission rules and exact quoted-state checks remain authoritative.

## Responsive and keyboard behavior

The header and navigation stay accessible around task pages. Compact layouts use measured header/navigation dimensions, a single task scrollbar, and a sticky action area. Phone action bars use Back and Reset on one row with the main action below. Small phones use compact metrics and clock controls. Keyboard focus returns after closing tasks; covered workspace controls are inert while the main navigation remains usable. All menus supports Ctrl/Cmd+K.

Browser checks covered desktop, 390×844 and 320×740 phones, 768×1024 and 1024×768 tablets, and a 1360×650 short desktop viewport. The observed layouts had no horizontal overflow. Evaluation and data purchase each queued once without a second review or mandatory receipt; queued actions could not be duplicated. Training name edits survived the catalog purchase detour. Locked forecast task guidance, Results → Research, Results → Save, and keyboard menu access were verified.

## Verification

- UI suite: **165/165 passed**.
- Additional direct-submission and menu-catalog checks: **10/10 passed**.
- TypeScript: passed.
- Production build and clean source packaging are required gates in the Sites publication workflow.
- The full legacy engine suite was not rerun for this UI change; the previously documented legacy failures are outside this change.

Build version is 0.33.1. Content version, game balance, and save schema are unchanged from 0.33.0.

## Visual evidence

- [Previous desktop task](docs/evidence/ui-0331/before-desktop-task.jpg)
- [Updated desktop menus](docs/evidence/ui-0331/after-desktop-menus.jpg)
- [Updated phone task](docs/evidence/ui-0331/after-phone-task.jpg)
