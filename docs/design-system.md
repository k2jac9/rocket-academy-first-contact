# Shared interface theme

The explorer, robot catalog, comparison pages, Scenario Studio, robot lab, episode replay and dialogs share the Omblet-inspired visual language introduced by the catalog. No additional UI framework is required. The four primary navigation destinations are Worlds, Catalog, Studio and Robot lab; Data sources remains available as a labeled header icon.

## Files and ownership

- `src/theme/tokens.css` owns the local font faces, semantic colors, pastel palette, content width, gutters and motion durations. Import it once in `src/main.tsx`.
- `src/styles.css` contains the existing application layouts. Legacy color aliases resolve to the shared tokens.
- `src/theme/application.css` owns the shared navigation, controls, light surfaces, operational screen treatment and responsive adaptations.
- `src/catalog/catalog.css` contains catalog-specific layout and comparison-table rules. It no longer defines a separate application header or loads its own fonts.
- `src/scenarios/studio.css` uses the same tokens for the scenario forms, provenance panels and immutable-version cards. Studio is loaded on demand and stays mounted to retain drafts during navigation.

## Visual rules

| Role | Rule |
| --- | --- |
| Body and controls | Local Inter; readable dark text on white or pale neutral surfaces |
| Main page titles | Local Workbench; uppercase, two-line compositions where appropriate |
| Technical labels | Local IBM Plex Mono; compact metadata and recorded measurements |
| Primary action | Blue `--accent`, white text; bordered secondary actions |
| Selected control | Blue indicator/border or neutral selected surface |
| Content panels | Square corners, thin neutral borders, restrained shadows only for overlays |
| Image panels | Sand, mint, lilac, peach, sky and stone palette; original imagery retains its colors |
| Status | Semantic success, warning and error tokens with readable foregrounds |
| Page width | 1536px maximum with 32px desktop / 20px mobile gutters |
| Motion | Short color/border transitions and a subtle page fade; reduced-motion preference respected |

Header geometry stays consistent while switching workspaces. At tablet/mobile widths, all four navigation destinations remain visible in a second row. Very narrow screens use concise labels without icons. Route visibility rules must remain stronger than responsive layout rules so mounted inactive workspaces stay hidden.

Map and lab components stay mounted after first use, preserving camera/mission state, fleet selection and loaded recordings when navigating. Existing WebGL views skip rendering when hidden; the theme does not alter physics, model geometry or recorded sensor data. Local terrain and replay backgrounds use the light surface color; planetary globes retain a dark space background.

Dialogs restore focus to their opener and support Escape. Each main workspace has a working skip link. Avoid adding external font imports, route-specific header themes, new arbitrary UI colors or long decorative transitions.

Validation evidence and remaining limitations are recorded in the project-root `design-qa.md`.
