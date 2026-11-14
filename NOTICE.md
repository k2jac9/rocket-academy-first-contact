# Third-party notices and data attribution

Rocket Academy: First Contact is an independent mission-planning prototype. This notice records the sources used by the application; it does not grant additional rights, replace upstream licenses, or imply endorsement by the organizations named below.

The application package declares Apache-2.0 for its own code. Software licenses, scientific dataset terms, and hosted-service terms are separate. A public download URL or an open-source renderer does not by itself establish redistribution rights for the terrain it displays.

## NASA/JPL Curiosity Dingo Gap terrain

The public terrain mode streams the colorized ground tileset from the [NASA JPL 3D Tiles Sample Data repository](https://github.com/NASA-AMMOS/3DTilesSampleData). It is pinned to repository revision `76444abbb4faff1b05f46a09b81ca2c24602b333`.

The [pinned Dingo Gap dataset description](https://github.com/NASA-AMMOS/3DTilesSampleData/blob/76444abbb4faff1b05f46a09b81ca2c24602b333/msl-dingo-gap/README.md) identifies the following provenance:

- Curiosity Rover Dingo Gap terrain generated from rover and orbital instrument imagery using the Landform terrain processing pipeline.
- Generated July 9, 2020; released March 3, 2021.
- Release ID: `URS297920`.

Source instrument and product credits listed upstream:

| Instrument or product | Credit |
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

The application retains these credits and the pinned source identity. The repository does not bundle the upstream terrain payloads. This project makes no blanket claim that its code license covers all source imagery, reconstruction products, or redistribution of the dataset. Consult the upstream dataset and component-product terms before copying, repackaging, or redistributing those assets.

## Cesium Moon

- Provider: Cesium ion.
- Asset ID: `2684829`.
- Source, resolution, attribution, and usage references: [Cesium Moon](https://cesium.com/platform/cesium-ion/content/cesium-moon/).
- Catalog credits: Cesium, NASA, and the USGS Astrogeology Science Center.

Cesium Moon combines lunar source datasets, including products from NASA’s Lunar Reconnaissance Orbiter and the LOLA/SELENE Kaguya terrain merge described by the provider. The provider page identifies individual source products and links to its content usage and attribution requirements. Provider-supplied attribution text returned during access is displayed in the terrain view in addition to the catalog credits.

The hosted asset is provider-managed; this project does not pin an immutable content revision. Access requires an appropriately scoped Cesium ion token and remains subject to applicable account, content, and service terms.

## Cesium Mars

- Provider: Cesium ion.
- Asset ID: `3644333`.
- Source, resolution, attribution, and usage references: [Cesium Mars](https://cesium.com/platform/cesium-ion/content/cesium-mars/).
- Catalog credits: Cesium, NASA, ESA, and the USGS Astrogeology Science Center.

The provider describes terrain derived from NASA’s Mars Global Surveyor MOLA and ESA’s Mars Express HRSC, Viking global imagery, and higher-resolution Jezero and Gale crater products. Consult the provider’s source list and its linked content usage and attribution requirements for the particular products used. Provider-supplied attribution text returned during access is displayed in the terrain view in addition to the catalog credits.

The hosted asset is provider-managed; this project does not pin an immutable content revision. Access requires an appropriately scoped Cesium ion token and remains subject to applicable account, content, and service terms.

## Principal runtime software

The following are the license identifiers declared by the installed runtime packages. Retain their license texts and any additional notices required by the exact dependency versions being distributed; this table is an index, not a replacement for those documents.

| Dependency | Upstream project | Declared license |
| --- | --- | --- |
| `3d-tiles-renderer` | [NASA-AMMOS/3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) | Apache-2.0 |
| `three` | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT |
| `react` and `react-dom` | [React](https://github.com/facebook/react) | MIT |
| `lucide-react` | [Lucide](https://github.com/lucide-icons/lucide) | ISC |

The npm lockfile records the installed dependency graph. Dependencies and their transitive components retain their respective upstream licenses. The NASA renderer’s software license must not be interpreted as a license for every terrain dataset it can load.
