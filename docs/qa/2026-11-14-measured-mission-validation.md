# Measured-site mission validation — 2026-11-14

Amboy Crater and Apollo 17 missions were valid in browser memory but rejected after JSON transport to the API. The exact-provenance validator compared the `source.georeference.originProjectedM` array by object identity rather than its coordinate values. This affected saving missions, Gemini planning, and saving kinematic runs regardless of the displayed robot model.

The validator now compares array type, length, keys, order and element values. Source georeferences are copied into exports so editing an exported mission cannot change the catalog used to validate it. Coordinate bounds, source hashes and physics-validation flags retain their existing checks.

## Verification

- Before the fix, both measured-site JSON round trips and all six mission/plan/run endpoint regression cases failed with invalid mission provenance.
- After the fix, all 225 tests passed. New cases cover valid JSON round trips, changed/reordered/missing/extra/string coordinates, objects substituted for arrays, and edits isolated from the source catalog.
- TypeScript validation and the production build passed; the existing large-bundle warning remains.
- The active Amboy Crater browser setup displayed Husky. Save mission returned HTTP 201, Gemini planning returned HTTP 200 with four commands, and Run & save to Atlas returned HTTP 201 with 52 recorded frames and no UI error.
- Saved mission: `ea9b1063-4d99-4314-8c0c-d3f9d17de7c8`. Saved run: `b4a15ffc-950d-4fa4-9d7e-aa180b5a0dac`.

The live run exercised the existing kinematic mission workflow. This validation fix does not change its physics or terrain-contact guarantees.
