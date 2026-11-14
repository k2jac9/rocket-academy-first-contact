"""Pinned, local source models. Client input can select an ID, never a file or XML."""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ASSETS = Path(__file__).resolve().parents[1] / 'public' / 'robots'
SUPPORTED = ('husky', 'jackal')


def description(model_id):
    if model_id not in SUPPORTED:
        raise ValueError('Unsupported source robot')
    result = json.loads((ASSETS / model_id / 'manifest.json').read_text())
    result['color'] = '#e5b843' if model_id == 'husky' else '#e6c546'
    result['assetBaseUrl'] = f'/robots/{model_id}/'
    result['sensorMount'] = 'Virtual front camera; not a supplied hardware sensor'
    return result


def attach(robot, position, yaw):
    folder = ASSETS / robot['modelId']
    raw = (folder / 'model.xml').read_bytes()
    if hashlib.sha256(raw).hexdigest() != robot['mjcfSha256']:
        raise ValueError('Robot description hash mismatch')
    root = ET.fromstring(raw)
    rid = robot['id']
    renames = {node.attrib['name']: f"{rid}_{node.attrib['name']}"
               for node in root.iter() if 'name' in node.attrib}
    renames[robot['rootBody']] = rid
    renames['root_joint'] = f'{rid}_root'
    for index, name in enumerate(robot['wheelJointNames']):
        renames[name] = f'{rid}_wheel_{index}'
    assets = {}
    for mesh in root.findall('asset/mesh'):
        filename = Path(mesh.attrib['file']).name
        content = (folder / 'meshes' / filename).read_bytes()
        if hashlib.sha256(content).hexdigest() != robot['meshSha256'][filename]:
            raise ValueError('Robot mesh hash mismatch')
        key = f'{rid}_{filename}'
        assets[key] = content
        mesh.set('file', key)
    for node in root.iter():
        for attribute in ('name', 'mesh', 'material', 'joint', 'body'):
            if attribute in node.attrib:
                node.set(attribute, renames[node.attrib[attribute]])
    body = root.find('worldbody/body')
    body.set('pos', ' '.join(str(v) for v in position))
    body.set('euler', f'0 0 {yaw}')
    for geom in body.iter('geom'):
        # Collision proxies remain in physics but never obscure the source visual meshes.
        if geom.get('group') != '1':
            geom.set('group', '4')
        geom.set('density', '0')
    actuators = []
    for index in range(4):
        name = f'{rid}_wheel_{index}'
        joint = next(j for j in body.iter('joint') if j.get('name') == name)
        joint.set('damping', '0.1')
        joint.set('armature', '0.02')
        actuators.append(f'<velocity name="{name}" joint="{name}" kv="5" ctrllimited="true" ctrlrange="-10 10" forcelimited="true" forcerange="-12 12"/>')
    ET.SubElement(body, 'camera', name=f'{rid}_camera', pos=f"{robot['lengthM']/2+.03} 0 0.32",
                  xyaxes='0 -1 0 0.173648 0 0.984808', fovy='60')
    return (ET.tostring(body, encoding='unicode'), ''.join(actuators),
            ''.join(ET.tostring(a, encoding='unicode') for a in root.findall('asset/*')), assets)
