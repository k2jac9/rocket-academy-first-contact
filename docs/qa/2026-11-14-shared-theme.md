# Shared interface and catalog QA — November 14, 2026

final result: passed

## Findings and comparison history

No actionable P0/P1/P2 findings remain in the shared-theme and catalog-curation scope.

| Finding | Impact and fix | Post-fix evidence |
| --- | --- | --- |
| P1, resolved: explorer, lab and dialogs used a different dark visual system from the catalog. | Moved fonts, colors and motion into shared tokens; applied the catalog's light surfaces, blue actions, square panels and pastel image backgrounds across workspaces. | `playwright-report/theme-desktop-paired.png`, `theme-mobile-paired.png`, `theme-help-desktop.png`, `theme-settings-mobile-final.png` |
| P1, resolved: the first mobile theme pass exposed the mounted map below the lab. | Responsive layout rules overrode route visibility. Final route selectors now have sufficient specificity and remain after responsive rules. | Before: `theme-lab-mobile-iteration1.png`. After: `theme-lab-mobile-iteration2.png`, final lab captures at 320/390/768/1600px. |
| P2, resolved: navigation and hero wrapping crowded the narrow viewport. | A shared two-row mobile header, concise labels, icon removal below 360px, a responsive title size and removal of body minimum width keep controls visible. | `theme-map-320-final.png`, `theme-catalog-320-final.png`, `theme-mobile-paired.png`; all tested routes have no document-wide overflow. |
| P2, resolved: dialog dismissal did not reliably return focus to the opener. | Capture the opener, handle Escape through React and restore focus on close. | Help Escape returns focus to Open help; desktop/mobile help captures show the final modal treatment. |
| P2, resolved: duplicate map controls could crowd narrow loading content. | Hide the legacy compass and hide navigation controls while the scene message is visible. | Loading-state inspection and connected-terrain captures; final mobile map has a single navigation stack. |
| Requested content revision, resolved: Household and Arms were still available. | Removed both classifications from the import selection and regenerated the active snapshot; counts now follow data. Existing shortlists and comparison URLs discard excluded IDs. | Six category routes show five entries each; all-robots loads 30; removed profiles show Robot not found; picker/search and stored-selection checks pass. |

## Visual target and comparison evidence

The source visual language is the existing Omblet-based catalog, previously compared against the user's humanoid and quadruped references. The original catalog fidelity report is retained at `docs/qa/2026-11-14-robot-catalog.md`. This review extends that established design to operational screens; it does not require their content or layout to become a catalog grid.

Source visual truth for this pass: `playwright-report/theme-catalog-1600-final.png` and `theme-catalog-390-final.png`. Implementation: the matching `theme-map-{width}-final.png` and `theme-lab-{width}-final.png` browser captures at `http://127.0.0.1:5173/`.

- Desktop: each capture is 1600 × 1000 CSS and image pixels at device scale 1. The combined source/map/lab input is `theme-desktop-paired.png`, 4800 × 1000 pixels.
- Mobile: each capture is 390 × 844 CSS and image pixels at device scale 1. The combined source/map/lab input is `theme-mobile-paired.png`, 1170 × 844 pixels.
- The full-view combined images were opened and compared. There is no density resampling. Desktop and mobile show catalog discovery, Dingo Gap exploration and the Husky inspector respectively. Different page content and functional region proportions are intentional.
- Focused comparison: `theme-header-comparison.png` stacks three 1600 × 52 header crops into one 1600 × 156 image. Logo, nav baseline, tools, colors and active indicator align across routes.
- Additional states: `theme-mission-moon-final.png`, `theme-replay-desktop.png`, `theme-help-desktop.png`, `theme-help-mobile-final.png`, `theme-settings-mobile-final.png`, `theme-sources-final.png`.
- Additional responsive captures cover 320 and 768px widths. Browser page scale was normalized to 1 before judging; hidden-tab WebGL capture artifacts were excluded from findings.

## Required fidelity surfaces

- **Fonts and typography:** shared local Inter body/control text, Workbench display headings and IBM Plex Mono metadata. Computed body font is CatalogInter on all workspaces. Heading hierarchy, line height and narrow wrapping inspected; the map title remains a two-line composition. Compact operational typography intentionally differs from catalog card titles.
- **Spacing and layout:** common desktop gutters, neutral borders, square panels and restrained overlay shadows. Header height is 52px desktop and 104px tablet/mobile. The map retains its viewport/tools arrangement and the lab its inspector. Category strips and comparison tables scroll within their containers.
- **Colors and tokens:** white/pale surfaces, dark readable text, shared blue actions, consistent selected states and sand/mint/lilac previews. Success, warning and error colors use semantic tokens. Planetary space intentionally stays dark; local terrain/replay backgrounds use the light surface.
- **Image quality and assets:** original editorial portraits, manufacturer marks, NASA textures and source robot geometry remain intact. No substitute artwork was generated. The latest lab uses the shared pastel colors. Terrain detail depends on streamed source tiles; portrait appearance does not imply simulation support.
- **Copy and content:** navigation labels, page introductions, source notes and simulation-support distinctions remain coherent. Catalog counts are 30 robots, six classifications and 531 sourced technical fields. Household and standalone arms are excluded. Missing specifications remain unknown.
- **Interaction/accessibility:** labeled controls, visible selected states, native dialogs, Escape/focus return, workspace skip links and reduced-motion behavior checked. No automated WCAG conformance claim is made.

## Functional verification

- Shared navigation preserves selected Moon/mission text and loaded episode frame across workspace changes. Existing saved replay advanced from frame 0 to 40, paused and retained that frame after navigation. No new training episode was required for this styling change.
- Help, sources and connection settings open and close; the connection token input remains a password field. No credentials were exposed.
- At 320/390/768/1600px, catalog document widths equal client widths (305/375/753/1585px). Map/lab responsive checks also found no page-wide overflow. Only the active workspace is visible.
- All six catalog categories render five models. Load more reaches 30. The comparison picker contains 30 choices. Searches for Roomba and Franka return zero. Excluded detail URLs show Robot not found.
- Saved selections and direct comparison URLs containing Roomba, Franka and G1 retain only G1. Existing four-model selection, measurement semantics, provenance and CSV safeguards remain covered by tests.
- `scripts/import_robot_catalog.py --verify`: 30 robots, 531 specifications and 147 active assets present. The integrity manifest preserves all 196 original captures, including unused images, to retain attribution.
- `npm test`: 151 tests passed across 11 files. `npm run build`: TypeScript and production build passed. `git diff --check`: passed, with Windows line-ending notices only. Browser console: zero errors; category navigation page-error listener: zero errors.

## Limits and follow-up

The existing main JavaScript bundle remains about 1.09MB (296KB gzip), with Vite's size warning. Bundle splitting is a performance follow-up, not a regression introduced by this theme. The active catalog chunk is now 159KB (29KB gzip). This pass does not add physical models, Moon/Earth contact simulation or validate training performance. Existing physics limitations remain documented separately.

## Implementation checklist

- [x] Centralize theme tokens and apply them across explorer, catalog, lab, replay and dialogs.
- [x] Verify responsive navigation, workspace visibility, focus and reduced motion.
- [x] Remove Household and Arms from active catalog data and sanitize old selections.
- [x] Update counts, import behavior, documentation and source attribution.
- [x] Recompare desktop/mobile captures and pass build, tests and browser checks.
