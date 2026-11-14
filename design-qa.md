# Surface sites and globe navigation QA — November 14, 2026

final result: passed

No actionable P0/P1/P2 findings remain in the Moon/Earth site and globe-locator scope. This does not certify planetary physics, calibrated sensors, learning or live Google Genie access. The previous report is archived at `docs/qa/2026-11-14-genie-studio.md`.

## Findings and fixes

| Finding | Fix and evidence |
| --- | --- |
| P1: a huge rover proxy overwhelmed the 512 m terrain overview. | Cap raster-site map enlargement at 3× and retain Find rover. Actual physics size is unchanged. Before: `sites-moon-first.png`. After: `sites-moon-1600-final.png`, `sites-earth-1600-final.png`. |
| P2: unstyled coordinate strip and a normal ready message shown as a warning. | Apply shared type, spacing, border and action tokens; reserve warning treatment for degraded states. Same before/after desktop captures. |
| P2: six mobile destinations occupied four columns while the fourth nav action wrapped. | Keep four primary nav columns and three destination columns, grouping each globe above its surface site. Final captures at 320/390 px and measured grids verify the fix. |
| P2: original lunar DN values were too dark for the overview. | Record a linear display stretch and retain the native DN crop. Geometry is unchanged; final Moon capture and package provenance show the result. |
| Functional: Earth crop-centre slope caused a rollover. | Retain the failure; use a measured crater-floor starter at +60 m east / +40 m south. Both robots then complete a five-second traverse. |
| Functional: saved episodes showed only timestamps. | Add site and actual termination; clear stale replay when selecting a new patch. Verify Atlas reload, timeline and download. |

## Source and comparison evidence

The approved Omblet-based catalog supplies the visual language: Inter/Workbench/mono fonts, light surfaces, blue actions, pastel cards and square panels. Source captures are `playwright-report/theme-catalog-1600-final.png` and `theme-catalog-390-final.png`; implementation captures are `sites-moon-1600-final.png` and `sites-moon-390-final.png`.

The combined inputs `sites-paired-1600.png` (3200 × 1000) and `sites-paired-390.png` (780 × 844) were opened and visually compared. Each constituent is an exact viewport screenshot at device scale 1, including the native scrollbar; no density resampling. Earlier full-page captures omitted scrollbar width and were replaced before comparison. Content and region proportions intentionally differ between catalog discovery and terrain authoring. Studio navigation and the Sources icon are accepted changes since the older catalog capture.

Focused inputs `sites-header-paired-1600.png` and `sites-header-paired-390.png` were opened to inspect typography, logo, icon alignment and active underline. Additional readable evidence: `sites-mars-pin-final.png`, `sites-mars-pin-mobile-final.png`, `sites-earth-globe-mobile-final.png`, `sites-earth-1600-final.png`, `sites-earth-replay-final.png`.

Required fidelity surfaces:

- Fonts/typography: existing local families, weights and hierarchy retained; coordinates use the established compact mono treatment. No clipping at tested widths.
- Spacing/layout: shared margins, square cards and toolbar spacing; all four nav actions stay on one row, and six mobile destinations fit a three-column grid. Controls remain reachable when scrolling.
- Colors/tokens: existing blue actions, white/stone surfaces and pastel destinations. Lunar grayscale and Earth aerial colors correspond to source imagery.
- Image quality/assets: measured NASA LROC / USGS / USDA data, actual Husky/Jackal meshes, no invented terrain detail. The 2 m lunar source limit remains visible. Display stretch and original image are documented.
- Copy/content: explicit site/body/resolution/context coordinates and actual outcome. No claim of calibrated soil, mission success, sim-to-real transfer or trained policies. Affected Mars-only descriptions were updated.

## Browser and execution checks

- At 1600, 768, 390 and 320 CSS-pixel widths: no document-wide horizontal overflow, six selectable destinations, visible controls and preserved shared styling.
- Mars opens facing the Dingo Gap context pin. Rotate behind the globe: pin hides. Home restores it. Keyboard Enter opens Dingo Gap. Moon/Earth pins and persistent site links open the correct local site; local links return to the matching globe.
- Bundled sites load without a Cesium token, display measured relief/imagery and a starter rover. Existing pan/zoom/orbit/recenter/capture controls work.
- Opening a Moon scenario selects Apollo 17 and locks frozen settings. New scenarios pin terrain revision/geometry. Historical design-only versions stay gated. Live requests reject altered elevations (422) and wrong scenario worlds (409).
- UI-generated Moon/Earth episodes save to Atlas, reload and scrub correctly. Downloaded MCAP bytes match stored hashes and local originals.

| Episode | Site / outcome | State frames / RGB+depth pairs | Gravity |
| --- | --- | --- | --- |
| `e2e940a9-11f5-431b-b823-e74e822d94f7` | Apollo 17, 5 s duration reached | 51 / 22 | 1.62 m/s² |
| `c33e6cd2-fcca-4c3e-9507-5ba26768f7a1` | Amboy floor, 5 s duration reached | 51 / 22 | 9.80665 m/s² |
| `c6d6c875-8f25-4921-ac91-30de67fb3396` | Amboy slope, 0.63 s rollover retained | 8 / 4 | 9.80665 m/s² |
| `944b1a43-1bb8-4861-818f-9cc4304b20eb` | Apollo 17, pinned scenario, 5 s | 51 / 22 | 1.62 m/s² |

Both starter runs move each robot about 1.3 m. Duration reached is termination, not proof of a mission goal. Pinned scenario IDs: Moon `18e27c9e-63af-4aea-99a8-e876b4a94d1e`; Earth `b119128c-fe8c-4b96-966c-9d8475a24533`. The exploration is an existing brief; no actual Genie generation is claimed.

Independent Python MCAP verification passes for indexes, CRCs, schemas, timing, terrain/model hashes, PNG decoding and finite positive metric depth. Automated checks cover package/image hashes, triangle/patch orientation, crop bounds and body gravity/contact behavior.

## Validation and limits

Production build succeeds; 174 TypeScript tests and 10 Python physics/model tests pass. Vite's existing large Three.js application-bundle warning remains non-blocking; no universal throughput/frame-rate claim is made. New packages total approximately 2.6 MB and cover bounded 512 m sites, not whole-world measured coverage.

Dingo's NASA waypoint pin is a context locator; its native XYZ transform and Mars texture longitude registration remain unverified. Rigid contact, assumed materials, simple sensor rendering, source resolution and absent domain calibration remain explicit. See [source provenance and workflow](docs/surface-sites.md).

Checklist: attribution ✓; measured packages ✓; coordinate/hash checks ✓; globe navigation ✓; responsive comparison ✓; record/replay/download ✓; failure retained ✓; limitations visible ✓.
