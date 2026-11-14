# Robot catalog design and functional QA

Date: 2026-11-14

final result: passed

Scope: local Omblet-style catalog and technical comparison integrated into First Contact. This result covers the catalog implementation, not physical accuracy or new simulation controllers.

## Source and implementation evidence

Source pages inspected in the browser before implementation: `https://omblet.com/c/humanoid`, `https://omblet.com/c/quadruped`, all eight classification pages, the 40 selected robot profiles, the filter panel, shortlist tray, Unitree G1 detail page, and ANYmal D / Spot comparison. Public profile fields and actual image URLs were captured; no account data was imported.

Local entry points: `http://127.0.0.1:5173/#/catalog/humanoid`, `#/catalog/quadruped`, `#/catalog/robots/unitree-g1`, and `#/catalog/compare?robots=anybotics-anymal-d,boston-dynamics-spot`.

Paired images below were generated from source and implementation screenshots and inspected together, source left / implementation right. Both sides use the same browser, viewport and pixel density. Screenshots and raw public capture inputs remain in the ignored `playwright-report/` directory.

| Surface | Viewport per side | Final paired evidence |
| --- | --- | --- |
| Humanoid discovery, no selection | 1600 × 1000 | `catalog-desktop-paired-final.png` |
| Humanoid discovery, no selection | 390 × 844 | `catalog-mobile-paired-final.png` |
| G1 details, no selection | 1600 × 1000 | `catalog-detail-paired-final.png` |
| ANYmal D / Spot comparison | 1600 × 1000 | `catalog-comparison-paired-final.png` |

Additional implementation screenshots: `catalog-320-final.png`, `catalog-768-final.png`, `catalog-quadruped-final.png`, `catalog-comparison-mobile.png`. Earlier iterations are retained for the findings below.

## Findings and corrections

| Severity | Finding and evidence | Correction and verification |
| --- | --- | --- |
| P0, resolved | Some source cards have a null image style; the initial portrait renderer assumed a string and crashed on quadrupeds. | Nullable source type, full-image fallback; all eight categories render five cards and every card image decodes. |
| P1, resolved | First desktop comparison showed missing portraits while hidden terrain and lab views initialized. | Gate first mounting of terrain/lab by the visited workspace; await actual asset decoding for captures. Fresh catalog/comparison loads contain zero WebGL canvases; final cards show the source images. |
| P1, resolved | Initial detail crops did not match the source's head and lower-leg gallery images. | Captured all 120 original gallery assets and their alt text from the 40 public profiles. Replaced generated CSS crops; final G1 paired gallery matches the source subjects and framing. |
| P2, resolved | First mobile pass had extra hero wrapping, excess space before the grid, and undersized search text. | Match Workbench display and Inter body sizing, use three-line mobile copy, tighten category spacing, and restore 14px search text. Final 390px paired capture retains source hierarchy and card density. |
| P2, resolved | A filled search input could consume Escape in the comparison picker; focus restoration was not explicit. | Handle Escape at the dialog, close it, and restore the opener. Verified focus returns to Add a robot after typing and Escape. |
| P2, resolved | The app's existing skip link targeted hidden mission controls in catalog mode. | Catalog-specific skip target and programmatic main focus. Verified Enter focuses `robot-catalog` without changing the route. |

No unresolved P0/P1/P2 findings remain within this scope. Minor antialiasing, icon-family and a few-pixel spacing differences are accepted. The app header uses First Contact's identity and navigation rather than presenting itself as Omblet.

## Visual and accessibility review

- Fonts: local Inter, Workbench and IBM Plex Mono; no substitute display font. Display wrapping, body hierarchy and monospace specifications inspected in paired captures.
- Layout: square pastel cards, original source crop styles, three/two/one columns, source-sized search/hero regions, flat bordered controls and compact technical tables. No decorative replacement robot artwork.
- Color: source card palettes retained, dark body text, blue links and selected actions, visible keyboard focus. Disabled comparison controls distinguish a full shortlist. No automated WCAG conformance claim is made.
- Images: 160 original editorial robot images and 33 manufacturer marks; unaltered local bytes and integrity hashes. Descriptive alt text retained; decorative brand marks do not repeat adjacent names. Images are explicitly labeled not to scale.
- Responsive checks: 320, 390, 768 and 1600px. No page-wide horizontal overflow. Navigation/category strips and comparison tables scroll within their containers. At 390px the comparison table is 760px wide inside the page, with sticky labels and headers. All four detail gallery images remain available on mobile.
- Controls: native buttons, labels, inputs and dialog; search submit, clear, active category, expanded filters, empty results, selected and disabled shortlist buttons, close controls and source links inspected. The catalog adds no decorative motion. Keyboard Escape and skip navigation verified.

## Functional and data verification

- Exactly 40 unique robots, five in each of eight categories; 705 technical fields with source URLs and check dates. Configuration distinctions and unknown prices are preserved. No unit conversions or inferred missing values.
- All eight category routes exercised; five cards each. All-robots Load more reaches 40. Search for Unitree returns G1 and Go2; an unmatched query shows a useful empty state.
- Maker filter returns Go2 for Unitree within quadrupeds. Episode-model filter returns Jackal; 3D-inspection filter returns Jackal and Go2. A $1,000 price cap excludes unknown prices and returns EMO in this snapshot.
- Four-robot picker limit exercised; 36 other choices disable at capacity. Removal, clearing, local persistence and comparison URL reload verified. Empty picker search has an explicit message.
- Differences-only comparison exercised with Husky A300 / Jackal: table rows decrease from 37 to 32, including removal of an empty section heading. General identity/purchase metadata remains visible. Unit tests cover different measurement conditions, missing values, selection sanitization and CSV formula escaping.
- Downloaded ANYmal D / Spot CSV parses as 42 rows with eight consistent columns, including source URLs and dates. Copy link reports success; direct comparison URLs restore the selected models.
- Jackal's Use in robot lab action selects Jackal for Robot 1. Go2 displays its real 3D model without an episode button. A300 has no simulation action and explicitly distinguishes the older Husky model.
- Catalog-only fresh loads have zero terrain/lab canvases. Final G1, quadruped and filter navigation recorded no page errors. Existing map/lab navigation remains available.
- Asset verification: all 196 manifest entries present and hash checked; the 120 additional gallery images also decoded with Pillow. Font OFL license files are included separately.
- `npm test`: 150 tests passed in 11 files. `npm run build`: TypeScript and production build passed. `git diff --check`: passed (Windows LF/CRLF notices only).

## Intentional adaptations and limits

The requested curation has five entries per category, so counts and some visible robots differ from the full source registry. First Contact branding, app navigation, simulation-support fields, manufacturer/support filters, CSV export, source attribution and original introductory copy are intentional. Source account features, ownership records, community evidence metrics and membership actions are outside this catalog request. Technical sections have a consistent local comparison order; original field labels/values remain intact.

Specifications and prices are an Omblet snapshot, not a live feed or independently validated benchmarks. Editorial portraits do not create physical models. Only existing compatible simulation/inspection assets are linked. The production build still reports the existing roughly 1.09MB main JavaScript chunk warning; catalog-only visits avoid starting hidden terrain rendering, but full application bundle splitting remains future performance work.

The data selection is in `scripts/catalog-selection.json`; normalization is in `scripts/import_robot_catalog.py`; source/asset attribution is in `NOTICE.md` and `public/catalog/asset-manifest.json`. No deployment, external publication or Git push was performed.
