# Real robot library and source-model episode verification

Implemented locally on 2026-11-14. Omblet was used as a product-library reference; no Omblet assets or code were copied.

## Delivered

- Licensed Clearpath Husky and Jackal source meshes, collision shapes, inertias and four wheel joints. Exact upstream revisions, hashes and licenses accompany `public/robots/`.
- Unitree Go2 standing model from the pinned MuJoCo Menagerie revision, with twelve articulated joints retained in its hierarchy. Inspection only; no walking controller or Go2 episode option.
- Search, category filters, model cards, keyboard/pointer orbit and zoom, reset view, manufacturer/source/license links and independent fleet assignment.
- Source Husky model in the map and robot preview; source models with recorded pose and wheel motion in physics replay. Legacy episodes retain generic geometry.
- Fleet/robot/terrain camera shortcuts, source-geometry shadows, explicit recorded fleet labels and mobile layout.

## Evidence

`npm test`: 142 tests across 10 files passed. `npm run build`: passed, with the existing large main-bundle warning (approximately 1.09 MB before gzip).

`python -m unittest discover -s simulation -p 'test_*.py' -v`: 9 passed. These include native/browser wheel-frame alignment, preservation of source inertias, two identical source robots in one world, flat-ground contact, repeatable forward motion, shared-world collisions, terrain axes/scale and independently checked metric camera depth.

Saved and downloaded Husky/Jackal episode `0ab1a566-5be4-415c-b3ad-bc366c03f0b4`:

- Five seconds, 51 state frames, 22 RGB/depth pairs, 125 MCAP messages.
- Both robots traversed approximately 1.35 m along X and retained terrain contacts.
- Browser download: 1,045,294 bytes; SHA-256 `12fdbeb5dc4fca276d4b01f1fdb30e5f0253000c0da675f9f9142068c3c74fc5`.
- Independent MCAP reader passed index/CRC/schema/shared-clock checks, model/terrain hashes, PNG decoding and depth arrays.
- Reopened from Atlas after the development API restarted.

The full UI flow then captured a fresh Dingo Gap patch, selected the real fleet, generated and saved episode `b7a7b385-e0c9-46d0-a73b-80fb73dda68d`, and played/paused its replay. Both episodes reached the requested duration.

Browser checks verified search and category filtering, assignment updating the corresponding fleet menu, Go2 having no deploy action, keyboard navigation visibly changing the 3D view, model reset, loaded product images and zero horizontal overflow at 390 px. Desktop and mobile screenshots are in the ignored `playwright-report/` directory. The removed Three.js `PCFSoftShadowMap` setting was replaced with supported `PCFShadowMap` after checking current upstream documentation.

## Practical limits

Source geometry is not hardware calibration. Controllers, uniform friction and virtual cameras remain app assumptions; there is no suspension, deformable soil, sensor noise or validated physical transfer. Source collision proxies differ from tire tread meshes; the original Husky nominal wheel cylinder is approximately 12.7 mm inside the visual tread extent. This discrepancy is retained and documented rather than silently changing source collision geometry.

MCAP records source revisions and asset hashes; source mesh bytes remain bundled with the app and must accompany exports for independent reconstruction. Dingo Gap is the only integrated physics terrain. Go2 is inspection-only. All implementation remains local and uncommitted.
