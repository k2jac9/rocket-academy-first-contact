# Third-party notices and data attribution

Rocket Academy: First Contact is an independent planetary mission and kinematic-recording prototype. This notice identifies the software, images, and terrain used by version 0.2. It does not grant additional rights, replace upstream licenses, or imply endorsement by the named organizations.

The application code is licensed under Apache-2.0. Software licenses, scientific-data notices, and hosted-service terms are separate. An open-source renderer's license is not a license for every dataset it can display.

## Public globe imagery

The Mars, Moon, and Earth overview modes map existing NASA images onto explicit reference spheres. They do not load elevation from these images. Reference-sphere geometry, marker symbols, and the kinematic robot depiction are application-generated representations; they are not NASA measurements or NASA-generated robot simulations.

NASA's [Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) describe permitted uses, source acknowledgement, endorsement restrictions, and exceptions for third-party copyrighted material. They include images and texture maps, while NASA identifiers have separate protections. This notice preserves the upstream credits and makes no blanket claim that all component content is relicensed or public domain. Generated plans and synthetic episode outputs are outputs of this application and its selected planner, not statements or validated results from NASA.

### Moon — bundled LRO CGI Moon Kit color map

| Item | Recorded value |
| --- | --- |
| Local file | [`public/textures/moon-lroc-color-2k.jpg`](public/textures/moon-lroc-color-2k.jpg) |
| Source page | [NASA Scientific Visualization Studio: CGI Moon Kit, ID 4720](https://svs.gsfc.nasa.gov/4720/) |
| Canonical download | [`lroc_color_2k.jpg`](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg) |
| Source version | 2025 color map presented by the source page |
| Dimensions and format | 2048 × 1024 pixels, JPEG |
| File length | 457,942 bytes |
| Retrieved | November 14, 2026 |
| Repository changes to image | None; the JPEG bytes are unaltered |

SHA-256 of the bundled file:

```text
f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170
```

**Credit: NASA's Scientific Visualization Studio.** The source page credits visualizer Ernie Wright (STC) and scientist Noah Petro (NASA/GSFC). The underlying LROC WAC color mosaic is credited to the Lunar Reconnaissance Orbiter camera team and Arizona State University; the CGI map also uses LRO laser-altimeter albedo data for polar coverage. The application retains NASA/GSFC/Arizona State University source credit alongside this fuller notice.

The source page identifies a longitude/latitude map centered at 0° longitude. It describes color/exposure adjustments, filled image gaps, and polar albedo coverage, and directs scientific analysis to the original instrument products. The application uses the color image only, on a sphere of radius 1,737,400 m. It does not use the separate displacement maps or claim that the visualization supplies surveyed terrain elevation.

The copy is served locally to avoid dependence on the upstream image host's browser cross-origin response. Its canonical URL and content checksum remain in the source metadata. Refer to the source page's [reproduction guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) and the individual instrument-product notices for applicable usage and copyright conditions; the Apache-2.0 application license does not relicense this image.

### Mars — remote NASA 3D Resources texture

- Source description: [NASA Mars Image Texture](https://science.nasa.gov/3d-resources/mars/).
- **Upstream credit: NASA/Jet Propulsion Laboratory & Caltech.** The description identifies Viking images processed at the USGS and maps from the JPL/Caltech planetary-map database.
- Repository: [nasa/NASA-3D-Resources](https://github.com/nasa/NASA-3D-Resources).
- Pinned revision: `11ebb4ee043715aefbba6aeec8a61746fad67fa7`.
- Selected file: `Images and Textures/Mars/Mars.jpg`, 1440 × 720 pixels.
- Runtime download: [pinned Mars.jpg](https://raw.githubusercontent.com/nasa/NASA-3D-Resources/11ebb4ee043715aefbba6aeec8a61746fad67fa7/Images%20and%20Textures/Mars/Mars.jpg).

The browser loads this image from the pinned upstream repository; the repository does not bundle the JPEG. It is displayed on a declared 3,396,190 m reference sphere without elevation. The application does not establish surveyed longitude registration for this texture. Retain the NASA/JPL/Caltech and USGS provenance and follow the source's usage notices when redistributing the image separately.

### Earth — remote Blue Marble Next Generation image

- Source: [NASA Earth Observatory, Blue Marble: Next Generation base maps](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/).
- **Credit: NASA Earth Observatory / Blue Marble Next Generation.**
- Selected product: July 2004 global base image, 5400 × 2700 pixels.
- Runtime download: [`world.200407.3x5400x2700.jpg`](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x5400x2700.jpg).
- Revision status: provider-managed URL; no immutable content hash is pinned in the catalog.

The image is a static monthly composite. The browser loads it from NASA's asset host; this repository does not bundle it. It is displayed on a 6,371,000 m reference sphere, with no measured elevation or live-weather data. The selected 5400-pixel product is a reduced-resolution overview, not the full-resolution Blue Marble product. Retain the NASA Earth Observatory credit and consult the source and NASA usage guidelines for applicable conditions.

## NASA/JPL Curiosity Dingo Gap terrain

The local Mars site streams the colorized ground tileset from the [NASA JPL 3D Tiles Sample Data repository](https://github.com/NASA-AMMOS/3DTilesSampleData), pinned to revision `76444abbb4faff1b05f46a09b81ca2c24602b333`.

The [pinned dataset description](https://github.com/NASA-AMMOS/3DTilesSampleData/blob/76444abbb4faff1b05f46a09b81ca2c24602b333/msl-dingo-gap/README.md) identifies Curiosity Rover Dingo Gap terrain generated from rover and orbital imagery using the Landform processing pipeline, generated July 9, 2020 and released March 3, 2021 as `URS297920`.

| Instrument or product | Upstream credit |
| --- | --- |
| MSL MastCam | NASA/JPL-Caltech/MSSS |
| MSL NavCam | NASA/JPL-Caltech |
| MSL HazCam | NASA/JPL-Caltech |
| MRO HiRISE | NASA/JPL-Caltech/University of Arizona |
| MSL HiRISE orthophoto and elevation model mosaics | NASA/JPL-Caltech/USGS Astrogeology/F. Calef/T. Parker |

Selected geometry within that revision:

```text
msl-dingo-gap/
  0528_0260184_to_s64o256_colorize/
    0528_0260184_to_s64o256_colorize/
      0528_0260184_to_s64o256_colorize_tileset.json
```

The source identity and credits are retained in the catalog and mission manifest. The repository does not bundle the scientific tile payloads. Dingo Gap is a local reconstruction rather than a complete Mars globe; this application does not establish its geographic tie or turn its view-dependent tiles into a fixed collision model.

The project makes no blanket claim that its code license covers component imagery, reconstruction products, or redistribution of the terrain dataset. Consult the upstream dataset and component-product terms before repackaging those assets.

## Optional Cesium-hosted planetary terrain

| Layer | Ion asset | Catalog credits and source reference |
| --- | --- | --- |
| Moon terrain | `2684829` | Cesium, NASA, USGS Astrogeology Science Center; [Cesium Moon](https://cesium.com/platform/cesium-ion/content/cesium-moon/) |
| Mars terrain | `3644333` | Cesium, NASA, ESA, USGS Astrogeology Science Center; [Cesium Mars](https://cesium.com/platform/cesium-ion/content/cesium-mars/) |

The Moon provider page describes LRO and LOLA/SELENE Kaguya source products. The Mars provider page describes MOLA and HRSC terrain, Viking imagery, and regional Jezero/Gale products. Consult the provider's source lists, attribution requirements, and content/service terms for the particular assets accessed. Attribution returned by the provider during access is displayed with catalog credits in the view.

These layers require an appropriately scoped user-supplied Cesium ion token. Their content is provider-managed and is not pinned to an immutable dataset revision. This repository does not redistribute their tile payloads or grant account access. Reference imagery remains available without ion credentials.

## Principal runtime software

The following license identifiers come from the installed package metadata. Retain each dependency's license text and any additional notices required by the exact version being distributed; this table is an index, not a replacement for those documents.

| Dependency | Upstream project | Declared license |
| --- | --- | --- |
| `3d-tiles-renderer` | [NASA-AMMOS/3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) | Apache-2.0 |
| `three` | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT |
| `react` and `react-dom` | [React](https://github.com/facebook/react) | MIT |
| `lucide-react` | [Lucide](https://github.com/lucide-icons/lucide) | ISC |
| `@mcap/core` | [MCAP](https://github.com/foxglove/mcap) | MIT |
| `@foxglove/schemas` | [Foxglove schemas](https://github.com/foxglove/schemas) | MIT |
| `mongodb` | [MongoDB Node.js driver](https://github.com/mongodb/node-mongodb-native) | Apache-2.0 |

The npm lockfile records the dependency graph. Transitive packages retain their respective licenses. Official Foxglove message schemas provide interchange formats; their use does not certify a simulated robot, terrain model, or recording as physically accurate.

## Optional services and generated records

Gemini planning uses a user-configured Google API account, and MongoDB Atlas persistence uses a user-configured cluster and database user. Their account, service, and data terms apply independently of the application's code license. The repository includes neither provider credentials nor a guarantee of model/cluster access.

Generated plans record their planner identity. Kinematic run data and observations are labeled synthetic, with physics/contact/sensor/training validation flags set to false. NASA source attribution describes the displayed source materials and is not an endorsement or validation of those generated outputs.
The bundled `public/textures/mars-nasa-viking.jpg` mirrors NASA's Mars texture at NASA-3D-Resources revision `11ebb4ee043715aefbba6aeec8a61746fad67fa7`, `Images and Textures/Mars/Mars.jpg`. Credit: NASA / JPL / Caltech, Viking imagery processed at USGS. SHA-256: `12ec6bf02ebd42a246edc778cb2ce8c595b4d9f0892badf0bfff8abb2303c780`. The local mirror removes a remote request from the globe startup path; it adds no measured elevation.
The bundled `public/textures/earth-blue-marble-july2004.jpg` mirrors NASA Earth Observatory's Blue Marble Next Generation July 2004 base image, `world.200407.3x5400x2700.jpg`, from `https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x5400x2700.jpg`. Credit: NASA Earth Observatory. SHA-256 of the captured image: `f55226d46d27e05511f2118dc6aa24f5dbf9b6b2cddc87cc6e0e7dd067c00b11`. It supplies visual context, not measured elevation.
## Source robot models

The simulation models below come from their respective open-source repositories. They are separate from the Omblet catalog portraits described below; a catalog portrait does not supply simulation geometry.

| Bundled asset | Pinned source | License / copyright |
| --- | --- | --- |
| `public/robots/husky/` | [Clearpath Husky descriptions](https://github.com/husky/husky/tree/41e15d283a8d955938204e79554a875264417bb9) | BSD-3-Clause; Clearpath Robotics Inc. (2021 repository notice; source URDF retains its 2015 notice) |
| `public/robots/jackal/` | [Clearpath Jackal descriptions](https://github.com/jackal/jackal/tree/4ddf9b578bb7abce1115c8dc59d8b7f86aa9268c) | BSD-3-Clause; Clearpath Robotics Inc. (2021 repository notice; source URDF retains its 2015 notice) |
| `public/robots/unitree-go2/` | [Unitree Go2 in MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie/tree/370c43965323c0944b433b202aac5058b5f907a9/unitree_go2) | BSD-3-Clause; 2016–2022 HangZhou YuShu TECHNOLOGY CO.,LTD. (Unitree Robotics) |

Each directory includes its upstream `LICENSE` and a provenance/hash manifest. `scripts/prepare_real_robots.py` converts the source visual geometry to GLB, preserves link hierarchy, converts colors for glTF, renders the thumbnail, and prepares wheeled source collision/inertia models for MuJoCo. Optional external sensor packages are omitted; the episode cameras and wheel controllers are experimental app additions. Go2 is an inspection-only posed asset. Model names identify the original platforms and do not imply manufacturer endorsement or validated hardware behavior.

## Omblet catalog snapshot and editorial images

The local robot catalog reproduces the browsing layout requested by the user, with 30 selected robots (five in each of six classifications) from [Omblet](https://omblet.com/). Household robots and standalone arms are excluded. Public category and individual robot pages were captured on November 14, 2026. `src/catalog/robots.json` retains each active profile URL, reported specifications, configuration conditions, manufacturer source URLs and the source's check dates. These dates are Omblet's recorded checks, not independent verification by this application. Unknown prices and missing measurements remain unknown. The curated set is not Omblet's complete registry.

`public/catalog/portraits/` contains the initial capture of 40 original editorial portraits and 120 original gallery images served by Omblet, including unused captures for the two excluded categories. The active catalog uses 30 portraits and 90 gallery images. Images are unchanged; catalog cards use the source's display crop. These editorial images are not measurements, calibrated views or 3D models. `public/catalog/brands/` contains 33 manufacturer marks as served by the source. Image copyrights and trademarks remain with their respective owners; the Apache-2.0 code license and the model licenses above do not relicense these materials. This local reproduction does not imply affiliation or endorsement. No Omblet site implementation code, accounts or community records are copied.

`public/catalog/asset-manifest.json` records all 196 image/font assets with their original URLs, capture dates, byte lengths and SHA-256 hashes. The three bundled fonts (Inter, Workbench and IBM Plex Mono) retain their SIL Open Font License texts in `public/catalog/fonts/*-OFL.txt`. Source links and portrait attribution are visible in the catalog footer and robot profiles.

## Measured Moon and Earth terrain packages

`public/terrain/apollo-17/` contains a bounded derivative of LROC `NAC_DTM_APOLLO17_1` and its `M134991788` 2 m orthophoto, from the [LROC Apollo 17 collection](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_APOLLO17). Credit: NASA / GSFC / Arizona State University. Elevations are cropped and expressed relative to the recorded centre sample; they are not procedurally generated. A recorded linear display stretch is applied to the browser orthophoto; the native DN crop is also retained.

`public/terrain/amboy-crater/` contains a bounded derivative of the public-domain [USGS 3DEP 1 m DEM product](https://www.sciencebase.gov/catalog/item/67590577d34edfeb87103a69), `USGS_1M_11_x61y383_CA_FEMALevee_D23`, and a natural-color export of USDA NAIP 2022 imagery through [The National Map](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer). Credit: USGS / USDA. The captured catalog response identifies imagery `m_3411526_se_11_060_20220428` and its 0.6 m source resolution. The export is sampled at 0.5 m without claiming additional measured detail.

Each package retains original product/service URLs, source window and projection, frame origin and vertical datum, hashes and processing parameters in `provenance.json` and `heightfield.json`. Generated local metadata in `src/domain/measuredSites.json` pins the runtime files. See [surface-site documentation](docs/surface-sites.md). `public/terrain/dingo-gap/location.json` is an attributed NASA MSL Sol 528 waypoint extract for the approximate globe pin, not a verified transform for the original reconstruction.
