"""Crop public measured terrain into small, reproducible browser packages.

Run with simulation/terrain-requirements.txt installed. Reads GeoTIFF windows
over HTTP ranges; never downloads the full regional DEM. No invented relief.
"""
from pathlib import Path
import hashlib
import io
import json
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image
import rasterio
from rasterio.windows import Window
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
LROC = 'https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/'
SITES = {
    'apollo-17': dict(body='moon', label='Apollo 17', latitude=20.1911, longitude=30.7723, size=257,
        dem=LROC+'DATA/SDP/NAC_DTM/APOLLO17_1/NAC_DTM_APOLLO17_1.TIF',
        image=LROC+'EXTRAS/BROWSE/NAC_DTM/APOLLO17_1/NAC_DTM_APOLLO17_1_M134991788_2M.TIF',
        sourcePage='https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_DTM_APOLLO17',
        product='NAC_DTM_APOLLO17_1', verticalReference='Elevation relative to the 1,737,400 m lunar reference sphere',
        credit='NASA / GSFC / Arizona State University · LROC NAC'),
    'amboy-crater': dict(body='earth', label='Amboy Crater', latitude=34.545, longitude=-115.791, size=513,
        dem='https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/CA_FEMALevee_D23/TIFF/USGS_1M_11_x61y383_CA_FEMALevee_D23.tif',
        sourcePage='https://www.sciencebase.gov/catalog/item/67590577d34edfeb87103a69',
        product='USGS_1M_11_x61y383_CA_FEMALevee_D23', verticalReference='NAVD88 elevation in metres',
        credit='USGS 3DEP · USDA NAIP / The National Map'),
}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def prepare(site_id, spec):
    folder = ROOT / 'public' / 'terrain' / site_id
    folder.mkdir(parents=True, exist_ok=True)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.TIF,.tif', GDAL_HTTP_TIMEOUT='90'):
        with rasterio.open('/vsicurl/'+spec['dem']) as src:
            from pyproj import CRS
            crs = CRS.from_wkt(src.crs.to_wkt())
            to_xy = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)
            cx, cy = to_xy.transform(spec['longitude'], spec['latitude'])
            row, col = src.index(cx, cy)
            n = spec['size']
            window = Window(col-n//2, row-n//2, n, n)
            if window.col_off < 0 or window.row_off < 0 or window.col_off+n > src.width or window.row_off+n > src.height:
                raise ValueError('Crop exceeds source footprint')
            heights = src.read(1, window=window, masked=True)
            if np.ma.getmaskarray(heights).any() or not np.isfinite(heights).all():
                raise ValueError('Source contains voids; do not fill or invent terrain')
            heights = np.array(heights, dtype='<f4')
            transform = src.window_transform(window)
            source_crs = src.crs
            center_xy = list(src.xy(row,col))
            center_lonlat = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True).transform(*center_xy)
            spacing = float(src.res[0])
            source_profile = dict(crsWkt=src.crs.to_wkt(), pixelSize=list(src.res),
                window=[int(window.col_off),int(window.row_off),n,n], transform=list(transform)[:6],
                centerProjectedM=center_xy, sourceWindowFloat32Sha256=sha(heights.tobytes()))
        if spec.get('image'):
            with rasterio.open('/vsicurl/'+spec['image']) as src:
                # Matching LROC DTM/orthophoto products share a grid. Reject drift.
                if src.crs != source_crs or src.window_transform(window) != transform:
                    raise ValueError('Orthophoto grid does not match the elevation product')
                pixels = src.read(1, window=window)
                native = Image.fromarray(pixels)
                native.save(folder/'orthophoto-native.png')
                black, white = (float(v) for v in np.percentile(pixels,[.5,99.5]))
                im = Image.fromarray(np.clip((pixels.astype(float)-black)/(white-black)*230,0,255).astype('uint8')).convert('RGB')
            image_source = dict(url=spec['image'], pixelSizeM=2,
                processing='Linear display stretch of NAC orthophoto; original DN crop retained; no generated detail',
                displayStretch=dict(blackPoint=black,whitePoint=white,outputWhite=230),
                nativeCropSha256=sha((folder/'orthophoto-native.png').read_bytes()))
        else:
            bounds = rasterio.windows.bounds(Window(0,0,n,n), transform)
            service='https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer'
            params=dict(f='image', bbox=','.join(str(v) for v in bounds), bboxSR=source_crs.to_epsg(),
                imageSR=source_crs.to_epsg(), size=f'{n*2},{n*2}', format='jpg',
                interpolation='RSP_BilinearInterpolation', renderingRule=json.dumps({'rasterFunction':'NaturalColor'}))
            url=service+'/exportImage?'+urllib.parse.urlencode(params)
            raw=urllib.request.urlopen(url,timeout=90).read()
            if raw.lstrip().startswith(b'{'):
                raise RuntimeError(raw.decode()[:1000])
            im=Image.open(io.BytesIO(raw)).convert('RGB')
            image_source=dict(url=url,service=service,exportPixelSizeM=spacing/2,
                processing='Natural-color NAIP service export; export sampling is not source resolution')
            point={'geometry':json.dumps({'x':spec['longitude'],'y':spec['latitude'],'spatialReference':{'wkid':4326}}),
                'geometryType':'esriGeometryPoint','returnGeometry':'false','returnCatalogItems':'true','f':'json'}
            metadata=urllib.request.urlopen(service+'/identify?'+urllib.parse.urlencode(point),timeout=90).read()
            (folder/'imagery-catalog.json').write_bytes(metadata)
        im.save(folder/'orthophoto.webp',quality=92)
        origin_height=float(heights[n//2,n//2])
        package=dict(schemaVersion='1.0.0',siteId=site_id,rows=n,cols=n,spacingM=round(spacing,6),
            originHeightM=origin_height,heights=np.round(heights.astype(float)-origin_height,3).ravel().tolist(),
            axes={'x':'projected east','y':'projected south','z':'down'},
            originLongitudeDeg=center_lonlat[0],originLatitudeDeg=center_lonlat[1],
            verticalReference=spec['verticalReference'],projection=source_profile)
        data=json.dumps(package,separators=(',',':'),allow_nan=False).encode()
        (folder/'heightfield.json').write_bytes(data)
        provenance=dict(schemaVersion='1.0.0',siteId=site_id,body=spec['body'],label=spec['label'],
            sourceProduct=spec['product'],sourceUrl=spec['dem'],sourcePage=spec['sourcePage'],credit=spec['credit'],
            sourceSpacingM=round(spacing,6),preparedAt='2026-11-14',heightfieldSha256=sha(data),
            imagerySha256=sha((folder/'orthophoto.webp').read_bytes()),imagery=image_source,
            sourceWindow=source_profile,verticalReference=spec['verticalReference'],
            boundsM=[-(n-1)*spacing/2,-(n-1)*spacing/2,(n-1)*spacing/2,(n-1)*spacing/2],
            knownLimits=['DEM interpolation does not recover wheel-scale obstacles.',
                'Contact materials, lighting and robot sensors are experimental assumptions.',
                'Local axes are projected grid directions, not a full inertial/body frame graph.'])
        (folder/'provenance.json').write_text(json.dumps(provenance,indent=2),encoding='utf-8')
        print(site_id, 'ready', n, 'spacing',round(spacing,6),'relief',float(heights.max()-heights.min()),'sha256',sha(data),flush=True)

if __name__=='__main__':
    import sys
    for key in sys.argv[1:] or SITES:
        prepare(key,SITES[key])
    # Small runtime metadata, separate from the large height arrays. This exact
    # frame and imagery provenance travels inside every new episode/mission.
    metadata={}
    for key in SITES:
        folder=ROOT/'public'/'terrain'/key
        if not (folder/'provenance.json').exists(): continue
        p=json.loads((folder/'provenance.json').read_text(encoding='utf-8'))
        h=json.loads((folder/'heightfield.json').read_text(encoding='utf-8'))
        metadata[key]=dict(heightfieldSha256=p['heightfieldSha256'],imagerySha256=p['imagerySha256'],
            georeference=dict(transformVersion='crop-pixel-centre-esd-v1',
                projectionWkt=p['sourceWindow']['crsWkt'],originProjectedM=p['sourceWindow']['centerProjectedM'],
                originElevationM=h['originHeightM'],originLatitudeDeg=h['originLatitudeDeg'],originLongitudeDeg=h['originLongitudeDeg'],
                verticalReference=p['verticalReference'],longitudeConvention='east-positive',
                latitudeConvention='planetocentric-sphere' if key=='apollo-17' else 'NAD83-geodetic',
                sourceSpacingM=p['sourceSpacingM']))
    (ROOT/'src'/'domain'/'measuredSites.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
