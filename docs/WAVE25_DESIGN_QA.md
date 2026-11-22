# Wave 25 design QA

## Scope

The second graphics wave adds the Studio room tier and the Projects staffing/compute workbench from the Frontier Lab Studio Expansion Plan. Package 0.25.0 retains content version 0.23.0 and save schema 5. Atomic planning extends command coordination; allocation and economic equations retain their existing owners.

## Visual source and rendered comparison

Compared the established [Wave 24 screenshot](images/frontier-lab-wave24-studio.png) with the [Wave 25 Studio screenshot](images/frontier-lab-wave25-studio.png) in the same visual review. The new room intentionally adds workstations, a wider window, two illustrated equipment cabinets and a meeting corner. These are visual props; actual company resources come from the HUD and compute inspector. Cream paper, mint tiles, oak desks, teal equipment, serif headings and the camera angle remain consistent.

Both seated character layers align with their chairs and desks. The six station controls point to the appropriate work areas without collisions or clipping. The first earned revenue triggers Chapter 02 for old and new companies. Independent visual review found no concrete layout issue.

The planner uses the same palette, typography and control shapes as the Studio shell. Its side-by-side People and Compute cards stack on narrow screens. The explicit preview separates editing from the current-versus-proposed comparison. Cost, workforce, workload and pool details use readable labels and semantic tables/disclosures. Baseline values, labels and notes were darkened to #5f7057 to clear 4.5:1 against their paper surfaces.

## Behavior verified in the browser

- The existing Week 10 company opens the expanded Studio with its original $32,572 cash and 4 CU. The visual milestone adds no resources.
- A cloud-shrink draft that conflicts with existing allocation is blocked, with Apply disabled and company state unchanged.
- A reviewed input change disables Apply and reports that another preview is required.
- The unsent planner draft survives Studio and Classic navigation; a campaign import resets it.
- The Work queue separates queued commands from active projects and exposes the atomic member count and reserved cost.
- The ML-shortage scenario changes training from 0 to 4 CUw while live Chat retains 0.43 CUw and 100% paid demand fulfillment. Actual Week 15 cash matches the $17,428 forecast. Browser and automated exports match checksum 5d5311e3.
- A queued plan survives reload and applies at the next boundary once. The simulation remains paused after Apply and after a single-week step.
- A memory-stranded job asks for 24 MU, while three separate pools hold 16 MU each. It receives no compute despite 48 MU aggregate. The explanation states that separate pool memory cannot combine. Enlarging one cloud pool to 24 MU produces an 8-CUw training grant.
- Signed customer-hosted support and owned-pool staff, power and cooling coverage appear in the same advanced forecast.
- Opening Company journal from Plan hides the planner and targets the visible inspector with the skip link.
- All projects and the empty-pin CTA return to project cards even after using Plan.

## Responsive and accessibility inspection

Native browser zoom produced CSS viewports of 1363×936, 779×535 and 340×234. There was no horizontal page overflow or off-screen planner input. At 340 px, the 500-px workforce table scrolls inside a 275-px container with overflow-x:auto. Inputs use 16-px text below the medium breakpoint. The existing bottom navigation remains reachable.

These are desktop-browser responsive checks, not emulated or physical touch-device tests. DevTools is blocked by browser policy, so no device emulation or browser-policy change was used. Controls retain labels, keyboard focus, status announcements and explicit disabled states. Existing reduced motion, scene-free list and Classic alternatives remain available.

## Findings resolved

1. Projected insolvency now includes the unpaid amount and a visible warning before Apply.
2. The planner hides while an inspector is open, preserving its draft without covering the journal on small screens.
3. All projects selects the work queue explicitly.
4. Comparison text now has sufficient contrast.
5. Workload and employee labels use readable names instead of raw internal identifiers.
6. The owned-capacity explanation includes parked racks.

No open P1 or P2 finding remains from this scoped review.

A final clean reload, hydration and planning preview after source freeze produced zero application errors or warnings. Fourteen browser-extension messages were excluded by their extension origin.

## Evidence

- [Release notes](WAVE25_RELEASE.md)
- [142 distinct focused checks](evidence/wave25-checks.txt)
- [Browser walkthrough](evidence/wave25-browser.json)
- [Planner preview](images/frontier-lab-wave25-planner.png)
- [Memory inspection](images/frontier-lab-wave25-memory.png)

final result: passed
