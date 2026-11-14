"""Normalize the selected public Omblet snapshots; never infer missing hardware values.

Inputs are browser-saved public page data in ignored playwright-report/. Static portraits,
maker marks and fonts are captured separately through the same browser, then hash-indexed.
Run --assets to print the small download manifest; --verify checks local captures.
"""
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
CAPTURED = '2026-11-14'
SELECTION = json.loads((ROOT/'scripts/catalog-selection.json').read_text())
CATEGORIES = {'humanoid':'Humanoids','quadruped':'Quadrupeds','mobile-manipulator':'Mobile manipulators',
              'companion':'Companions','household':'Household','arm':'Arms','drone':'Drones','field':'Field robots'}
PALETTES = dict(sand='#f5ecc7',lilac='#e8e1f3',mint='#dceee5',peach='#f6e4d8',sky='#ddebf5',stone='#e9ebed',rose='#f3e0e1')


def prepare():
    categories=json.loads((ROOT/'playwright-report/omblet-category-data.json').read_text(encoding='utf-8'))
    profiles=json.loads((ROOT/'playwright-report/omblet-profiles.json').read_text(encoding='utf-8'))
    galleries=json.loads((ROOT/'playwright-report/omblet-galleries.json').read_text(encoding='utf-8'))
    robots=[];assets={}
    for category, slugs in SELECTION.items():
        assert len(slugs)==5
        for slug in slugs:
            model=profiles[slug]['model']
            assert model['slug']==slug and model['category']==category
            card=next(c for c in categories[category]['cards'] if c['slug']==slug)
            image=f'/catalog/portraits/{slug}.webp'
            logo='/catalog/brands/'+Path(card['logo']).name
            for source,target in [(card['image'],image),(card['logo'],logo)]:
                assets[target]={'sourceUrl':'https://omblet.com'+source,'path':'public'+target,'capturedAt':CAPTURED}
            gallery=[]
            for entry in galleries[slug]:
                assert entry['sourceUrl'].startswith('https://omblet.com/portraits/robots/')
                path='/catalog/portraits/'+Path(urlparse(entry['sourceUrl']).path).name
                assets[path]={'sourceUrl':entry['sourceUrl'],'path':'public'+path,'capturedAt':CAPTURED}
                gallery.append(dict(image=path,alt=entry['alt']))
            specs=[dict(section=s['section'],label=s['label'],value=s['value'],sourceUrl=s['source_url'],checkedAt=s['checked_at'][:10]) for s in model['specifications']]
            robots.append(dict(id=slug,name=model['name'],manufacturer=model['manufacturer'],category=category,
                purpose=model['purpose'],availability=model['availability'],priceUsd=model['price_usd'],priceNote=model['price_note'],
                sourceUrl=model['source_url'],catalogUrl='https://omblet.com/robots/'+slug,checkedAt=model['checked_at'][:10],capturedAt=CAPTURED,
                image=image,gallery=gallery,logo=logo,imageStyle=card['imageStyle'],color=PALETTES[card['palette']],specifications=specs,
                assetId='jackal' if slug=='clearpath-jackal' else 'unitree-go2' if slug=='unitree-go2' else None,
                simulationModelId='jackal' if slug=='clearpath-jackal' else None))
    for remote,local in [('inter-100-900-normal-DiVDrmQJ.woff2','inter-variable.woff2'),
                         ('workbench-400-normal-DLc5lBST.ttf','workbench.ttf'),
                         ('ibm-plex-mono-400-normal-Du0PCiXT.woff2','ibm-plex-mono.woff2')]:
        target='public/catalog/fonts/'+local
        assets[target]={'sourceUrl':'https://omblet.com/build/assets/'+remote,'path':target,'capturedAt':CAPTURED}
    for asset in assets.values():
        target=ROOT/asset['path'];target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists():asset['sha256']=hashlib.sha256(target.read_bytes()).hexdigest();asset['bytes']=target.stat().st_size
    if '--assets' in sys.argv:
        print(json.dumps(list(assets.values())));return
    if '--verify' in sys.argv:
        missing=[a['path'] for a in assets.values() if not a.get('bytes')]
        assert not missing,missing
        print(json.dumps({'robots':len(robots),'specifications':sum(len(r['specifications']) for r in robots),'assets':len(assets),'allPresent':True}));return
    output=ROOT/'src/catalog';output.mkdir(parents=True,exist_ok=True)
    (output/'robots.json').write_text(json.dumps(dict(capturedAt=CAPTURED,categories=[dict(id=k,label=CATEGORIES[k]) for k in SELECTION],robots=robots),indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    # Keep attribution for earlier captures still on disk, even when removed from the catalog.
    manifest=ROOT/'public/catalog/asset-manifest.json'
    retained={a['path']:a for a in json.loads(manifest.read_text(encoding='utf-8')) if (ROOT/a['path']).exists()} if manifest.exists() else {}
    retained.update({a['path']:a for a in assets.values()})
    manifest.write_text(json.dumps(list(retained.values()),indent=2)+'\n',encoding='utf-8')
    print('Prepared',len(robots),'robots,',len(assets),'active assets and',len(retained),'total asset records')


if __name__=='__main__':prepare()
