# Scenario Studio / Google Genie QA — November 14, 2026

final result: passed

## Findings

No actionable P0/P1/P2 visual findings remain in the manual Genie exploration/import and linked physical-scenario workflow. This is not a pass for live Genie control or the complete training-platform roadmap.

A functional import check found that a valid container signature alone could admit an undecodable video. The UI now checks media decoding before upload and shows a useful error. The rejected-video browser test observed zero upload requests. Server signatures and hashes remain storage-integrity checks, not semantic video validation. The final screenshot comparisons required no visual changes.

## Source and rendered evidence

Source visual truth is the existing Omblet-based catalog and shared theme. Historical reports remain in `docs/qa/2026-11-14-robot-catalog.md` and `docs/qa/2026-11-14-shared-theme.md`.

- Source captures: `playwright-report/genie-catalog-source-1600.png`, `genie-catalog-source-390.png`.
- Implementation captures: `genie-studio-1600-final.png`, `genie-studio-390-final.png`, rendered at `http://127.0.0.1:5173/#/studio`.
- Desktop: both captures 1600 × 1000 pixels and CSS viewport, device scale 1. Combined source/Studio image `genie-paired-1600.png` is 3200 × 1000.
- Mobile: both captures 390 × 844 pixels and CSS viewport, device scale 1. Combined image `genie-paired-390.png` is 780 × 844.
- Both combined images were opened and visually compared in the same input. No density resampling was used. States are catalog discovery versus Studio authoring, so their content/region proportions intentionally differ.
- Focused evidence: `genie-header-paired.png`, two 1600 × 52 header crops stacked at 1600 × 104, opened and compared. Navigation, brand, actions and active indicators align.
- Evidence/form state: `genie-evidence-1600-final.png`, `genie-evidence-390-final.png`; uploaded NASA imagery, hash wrapping, source details and scenario form inspected.
- Additional viewport captures: `genie-studio-320.png`, `genie-studio-768.png`. Document widths equal client widths at 320/390/768/1600px; header height remains 104px mobile/tablet and 52px desktop.

## Required fidelity surfaces

**Fonts/typography:** local Inter controls/body, Workbench two-line display heading and IBM Plex Mono metadata. Heading wrapping, readable form text and full-width hash wrapping inspected. Studio's title scale and catalog's editorial hierarchy share the same font system.

**Spacing/layout:** common gutters, square surfaces, thin dividers and aligned header. Two-column desktop form/evidence layout becomes one column; paired fields stack on narrow screens. No page-wide horizontal overflow. Data sources moves to a labeled header icon so the four primary workspace destinations remain visible.

**Colors/tokens:** existing white/neutral surfaces, blue actions, semantic errors and pastel sky callout. Selected library entries and locked/disabled controls are distinct. No new visual framework or external fonts.

**Images/assets:** original NASA reference bytes remain unchanged; uploaded images are contained without stretching. Catalog portraits remain original assets. Lucide supplies consistent interface icons. No substitute robot artwork or generated planetary geometry was introduced.

**Copy/content:** manual import, API access unverified, unknown model revision, design-only environments, visual conditioning and training ineligibility are explicit. Frozen settings describe the actual bounded reference traverse; no copy claims that natural-language intent executes as a cooperative policy.

## Interactions and runtime checks

- Prompt editing/copy, model/world selectors, original file upload, image preview, library selection, provenance export and scenario freeze work.
- Studio skip link focuses `scenario-studio`; drafts/selected evidence survive workspace changes. Existing shared reduced-motion rules apply.
- A corrupt WebM is rejected before upload. A valid synthetic transport clip decoded at 320 × 180 and round-tripped through GridFS with its hash intact; it was explicitly not Genie output and temporary test artifacts were removed.
- Atlas round-tripped the 457,942-byte NASA reference exactly. Byte range 0–15 returned HTTP 206 and 16 bytes. Same-ID retry is stable; changed content returns 409.
- A lunar scenario is design-only and its Robot lab action is disabled. Explicit Mars adaptation is recorded; Robot lab locks the frozen models, duration, speed and seed. The server rejects altered settings.
- A linked 5-second physical episode saved 51 state frames, 22 RGB/depth pairs and 125 MCAP messages. Independent Python checks verified CRCs/indexes, schemas, timestamps, model/terrain hashes, image/depth data, and identical exploration/scenario lineage in local JSON and MCAP. Atlas retained the same lineage.
- Fresh final browser load: status HTTP 200, Atlas connected, zero page/console errors. One earlier status 502 occurred during the development server's automatic restart; the final fresh load was clean.
- 171 tests pass across 12 files. TypeScript and production build pass. Existing main JavaScript chunk warning remains (~1.09MB / 297KB gzip); Studio itself is lazy-loaded (~19KB / 6KB gzip).

## Access limits and remaining work

The existing Gemini credential listed models successfully; no Genie model was exposed. Signed-in Project Genie access could not be checked because the desktop-browser connection was unavailable. Automatic control remains gated. No real Genie output was available to validate a provider-specific export contract.

The local RTX 2060/6GB is below the current published Isaac Sim minimum. Isaac/Cosmos workers, advanced semantic retrieval, governed dataset freezing, policy training and a measured lunar physics package remain unimplemented. Their gates are tracked in `docs/rocket-academy-planetary-training-platform-design.md`. No deployment or Git push occurred.

## Implementation checklist

- [x] Reuse and visually compare the shared catalog theme at desktop/mobile sizes.
- [x] Persist versioned manual Genie provenance and original hash-identified artifacts.
- [x] Keep account/API capabilities and training eligibility unverified/restricted.
- [x] Freeze bounded scenario settings and preserve explicit world adaptations.
- [x] Verify the physical execution link through Atlas, local recovery output and MCAP.
- [x] Record access/hardware constraints and the remaining architecture milestones.
