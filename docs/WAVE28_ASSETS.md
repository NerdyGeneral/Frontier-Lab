# Wave 28 campus artwork

## Delivered asset

- File: `public/studio/campus-room.webp`
- Dimensions: 1536 × 1024 pixels.
- Encoded size: 163,428 bytes; RGB WebP, quality 86.
- Created with the built-in OpenAI image-generation tool on 9 November 2026.
- This original campus variant uses the project's existing `public/studio/studio-room.webp` and supplied art-direction page as visual references. No third-party game imagery or commercial logos are used in the asset.
- The scene contains no people, essential text, numeric state or interactive UI. HTML supplies accurate labels, counts and controls.
- The campus tier is earned by an owned facility with `status === 'active'`. Artwork is decorative; its cabinets and furniture are not a numerical representation of current racks or headcount. The asset is lazy-loaded when that earned scene is rendered.
- One focused refinement replaced chemical/biological bench props with computing and chip-testing equipment. The final PNG was format-converted to WebP; no manual artwork editing was performed.

## Initial generation prompt

```text
Use case: precise-object-edit
Asset type: Frontier Lab management-game campus room background, the next earned tier after the supplied studio scene.
Input images: Image 1 is the existing studio-room asset: preserve its distinctive clean rounded illustration style, fixed isometric camera, warm wood, mint tiled floor, cream walls, dark teal machinery, soft daylight, compact readable silhouettes and similar 3:2 framing. Image 2 is art-direction reference only; do not reproduce its page, typography, mockups or text.
Primary request: Expand this small studio into an original cohesive mature research campus cutaway. Show an intimate two-wing lab linked to a modest owned server hall and small compute courtyard, all as one clearly readable isometric architectural diorama on a warm cream background. This is the game scene itself, not a screenshot or UI mockup.
Composition: entire campus fully contained with generous clean edges, no cropping. Lower-left/front laboratory with a data desk; back-left training workbench with a simple diagram board without words; central evaluation bench; lower-center small team lounge with warm wood and plants; right wing has a tidy enclosed dark-teal server room with glass partition, a few visible server cabinets and simple cooling equipment; a front-right release/operations desk. A small connecting courtyard has a tree, a walkway and practical equipment, so the scene reads as rooms linked to owned infrastructure rather than merely more desks. Keep walkways airy and distinct for later HTML interactive station markers.
Style: original polished indie management-game illustration, smooth softly shaded vector-like forms, warm pleasant 3D depth matching Image 1, no photorealism, no painterly noise. Palette #176A61 teal, #122F2D dark ink, #F7F3E9 warm paper, muted mint and pale natural wood; tiny warm ochre accents.
Constraints: no people or characters, no logos, no written text, no letters, no numerals, no fake UI, no stats, no floating labels, no arrows, no border, no watermark. Screens are simple unmarked mint glass. The rooms and machinery are decorative; numerical state is shown separately in HTML. Match existing art rather than copying any commercial game's assets.
```

## Refinement prompt

```text
Use case: precise-object-edit. This is the original Frontier Lab campus game scene. Preserve the entire architecture, isometric camera, courtyard tree and cooling equipment, glass server hall, server cabinets, floor, furniture positions, warm cream/mint/teal palette, lighting, outer background, crop and image dimensions exactly. Change ONLY the small bench equipment: remove the lower-left microscope, glass bottles, flasks and test-tube racks, and the test-tube rack on the center bench. Replace them with small dark-teal electronic chip-testing instruments, unmarked circuit boards, a compact electronics inspection device and closed component storage boxes. This is a computing/AI and semiconductor research lab, not a chemistry or biology laboratory. Keep the number and footprint of the small props restrained. No people, no text, no letters, no numbers, no UI or stats. All other elements stay as they are.
```

