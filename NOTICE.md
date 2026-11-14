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
