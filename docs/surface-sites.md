# Measured surface sites

Implemented locally on November 14, 2026. The application now offers three bounded surface sites alongside the Earth, Moon and Mars imagery globes. This extends the experimental MuJoCo workflow; it does not establish planetary qualification or policy training.

| World / site | Elevation | Appearance | Local package |
| --- | --- | --- | --- |
| Mars / Dingo Gap | Pinned NASA Landform rover/orbital reconstruction | Original colorized tiles | Streamed upstream; existing native frame unchanged |
| Moon / Apollo 17 | LROC `NAC_DTM_APOLLO17_1`, 2 m posts | Matching `M134991788` 2 m orthophoto | 512 × 512 m, 257 × 257 elevation samples |
| Earth / Amboy Crater | USGS `USGS_1M_11_x61y383_CA_FEMALevee_D23`, 1 m lidar-derived DEM | USDA NAIP 2022 imagery, source catalog resolution 0.6 m, exported at 0.5 m sampling | 512 × 512 m, 513 × 513 elevation samples |

## Use the sites

1. In **Explore worlds**, choose **Apollo 17** or **Amboy Crater**. A parked Husky and an example goal appear at a measured starter location (lunar crop centre; Amboy crater-floor offset +60 m east, +40 m south). The preview is kinematic; **Find rover** brings it into view.
2. Drag to pan, scroll toward the cursor to zoom, or switch to orbit. Double-click recentres and approaches a point. The north control aligns projected grid north at the new sites; Dingo Gap retains its native map bearing.
3. Select **Use patch in robot lab**. A complete 16 × 16 m patch is frozen around the rover, with 0.25 m output sampling. Missing terrain or an out-of-bounds crop stops capture.
4. Select Husky/Jackal independently, set duration, speed and seed, then **Generate & save episode**. The worker records both robots, sampled actions/states, contacts, RGB and depth, and saves the MCAP in Atlas/GridFS.
5. **Scenario studio** can now compile new Moon, Earth and Mars versions. The selected body pins its corresponding site. Older immutable design-only versions stay design-only; create a new version to use the new adapter.

The globe has a clickable context pin for its surface site and a persistent **Explore surface site** link. Each local site links back to its globe. Pins hide behind the globe and remain keyboard-accessible when visible.

## Source registration and reproducibility

`public/terrain/{site}/heightfield.json` holds centre-relative elevations, snapped geographic and projected origin, source affine transform, WKT projection and vertical reference. `provenance.json` records product URLs, the exact source window, hashes, image processing and limitations. `src/domain/measuredSites.json` is the generated runtime metadata. Its frame information and image hash are included in new mission and episode source records.

The new local frame is right-handed **projected east / projected south / down**. Display coordinates are `(x, -z, y)`. Physical patch coordinates are east / projected north / up, with the exact basis retained. Lunar heights reference a 1,737,400 m sphere; Earth heights reference NAVD88, with NAD83 / UTM zone 11N horizontal coordinates. Neither is silently treated as a generic WGS84 altitude.

The browser validates each heightfield SHA-256 before rendering. Patch sampling follows the same two triangles per cell as the displayed mesh. The server independently reloads the pinned package and checks the captured origin and every submitted sample before execution. No interpolation through source voids is allowed.

The Moon image has a recorded linear display stretch for readability. The original DN crop is retained as `orthophoto-native.png`. This changes display brightness, not elevation. Earth imagery is an identified NAIP service export; its catalog response is retained. Higher export sampling does not establish higher source resolution. Source photos can contain baked shadows and do not supply material calibration.

Rebuild the crops with:

```powershell
.venv-sim/Scripts/python.exe -m pip install -r simulation/terrain-requirements.txt
.venv-sim/Scripts/python.exe scripts/prepare_surface_sites.py
```

The preparer reads bounded GeoTIFF windows with HTTP ranges. Published service imagery can change; compare generated hashes and catalog metadata before adopting a new package. Python raster tooling is needed only for source preparation, not the browser or runtime simulator.

## Dingo Gap on the Mars sphere

The pin uses NASA's MSL waypoint **Sol 528, RMC 26_184**, latitude **−4.62655059°**, east longitude **137.4072626°**, corresponding to the scene's `0528_0260184` identifier. The retained location extract names its source and retrieval date. The globe displays rounded coordinates for context.

This does **not** establish an exact transform from Dingo Gap's native XYZ mesh into Mars body-fixed coordinates. The existing native frame and `geodeticRegistration: not-established` remain unchanged. Mars texture longitude registration also remains unverified; the marker uses the application's declared spherical longitude frame, so it is a context locator rather than a surveyed overlay on that texture.

## Physics scope

Gravity is fixed by the canonical source body: Moon **1.62 m/s²**, Mars **3.711 m/s²**, Earth **9.80665 m/s²**. These are declared constant experimental profiles, not location-dependent gravity models. Robot masses remain unchanged. The actual gravity and profile ID are recorded with each execution.

The 0.25 m export grid interpolates 1–2 m DEMs; it does not invent wheel-scale rocks, resolve soil, or establish high-resolution contact truth. Contacts use a rigid heightfield and assumed uniform friction. Robots and virtual sensors are experimental. RGB uses simple materials, not the browser's orthophotos. No atmosphere, regolith deformation, thermal model, lunar/Mars hardware qualification, learned policy, or training improvement is claimed. Native Dingo and prior kinematic/physics records keep their original evidence and limitations.

## Primary sources

- [LROC Apollo 17 DTM collection](https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_APOLLO17), [component DTM](https://data.lroc.im-ldi.com/lroc/view_rdr_product/NAC_DTM_APOLLO17_1), [matching orthophoto](https://data.lroc.im-ldi.com/lroc/view_rdr_product/NAC_DTM_APOLLO17_1_M134991788_2M).
- [LROC feature coordinates](https://lroc.im-ldi.com/data/support/downloads/2016_LROC_Coordinates_of_Human_Features.pdf).
- [USGS 1 m DEM product](https://www.sciencebase.gov/catalog/item/67590577d34edfeb87103a69), [NAIP service metadata](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer).
- [ASU Amboy Mars analog archive](https://rgcps.asu.edu/fieldimgs_amboy_crater/).
- [NASA MSL waypoint feed](https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json), [NASA Dingo Gap scene](https://science.nasa.gov/resource/curiositys-view-past-dune-at-dingo-gap/).
