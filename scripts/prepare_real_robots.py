"""Build browser GLBs and physics MJCF from pinned, licensed upstream robot descriptions.

Requires simulation/requirements-assets.txt. Sources live in ignored .robot-sources/.
Only conversion/preparation runs this script; the application serves local immutable assets.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import copy
import hashlib
import json
import re
import shutil
import subprocess
import urllib.request
import xml.etree.ElementTree as ET

import mujoco
import numpy as np
import trimesh
import xacro
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "robots"
MENAGERIE = "370c43965323c0944b433b202aac5058b5f907a9"
REVISIONS = {"husky": "41e15d283a8d955938204e79554a875264417bb9", "jackal": "4ddf9b578bb7abce1115c8dc59d8b7f86aa9268c"}


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def matrix(pos, quat):
    result = trimesh.transformations.quaternion_matrix(quat)
    result[:3, 3] = pos
    return result


def export_glb(model, data, path, wheel_bodies=None):
    """Keep link hierarchy and native mesh detail; glTF outer root converts Z-up to standard Y-up."""
    scene = trimesh.Scene()
    scene.graph.update(frame_to="robot", frame_from="world", matrix=trimesh.transformations.rotation_matrix(-np.pi/2,[1,0,0]))
    names = {0:"robot"}
    for bid in range(1, model.nbody):
        name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY, bid) or f"body_{bid}"
        if wheel_bodies and name in wheel_bodies: name = f"wheel_{wheel_bodies.index(name)}"
        names[bid] = name
        parent = int(model.body_parentid[bid])
        world = matrix(data.xpos[bid],data.xquat[bid])
        parent_world = matrix(data.xpos[parent],data.xquat[parent])
        scene.graph.update(frame_to=name,frame_from=names[parent],matrix=np.linalg.inv(parent_world)@world)
    count = 0
    for gid in range(model.ngeom):
        # Compiled URDF uses group 1 for visual geometry; Menagerie uses group 2.
        if int(model.geom_group[gid]) not in [1,2]: continue
        kind = model.geom_type[gid]
        if kind == mujoco.mjtGeom.mjGEOM_MESH:
            mid = model.geom_dataid[gid]
            va, vn, fa, fn = model.mesh_vertadr[mid],model.mesh_vertnum[mid],model.mesh_faceadr[mid],model.mesh_facenum[mid]
            mesh = trimesh.Trimesh(vertices=model.mesh_vert[va:va+vn].copy(),faces=model.mesh_face[fa:fa+fn].copy(),process=False)
        elif kind == mujoco.mjtGeom.mjGEOM_CYLINDER:
            mesh = trimesh.creation.cylinder(radius=model.geom_size[gid,0],height=2*model.geom_size[gid,1],sections=24)
        elif kind == mujoco.mjtGeom.mjGEOM_BOX:
            mesh = trimesh.creation.box(extents=2*model.geom_size[gid])
        elif kind == mujoco.mjtGeom.mjGEOM_SPHERE:
            mesh = trimesh.creation.icosphere(subdivisions=2,radius=model.geom_size[gid,0])
        else: continue
        rgba = model.geom_rgba[gid].copy()
        mid = int(model.geom_matid[gid])
        if mid >= 0: rgba = model.mat_rgba[mid].copy()
        # MuJoCo's displayed RGB is display-referred; glTF material factors are linear-light.
        linear = rgba.copy()
        linear[:3] = np.where(rgba[:3] <= .04045, rgba[:3]/12.92, ((rgba[:3]+.055)/1.055)**2.4)
        mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
            baseColorFactor=np.clip(linear*255,0,255).astype(np.uint8),metallicFactor=.12,roughnessFactor=.58))
        bid = int(model.geom_bodyid[gid])
        world = np.eye(4);world[:3,:3]=data.geom_xmat[gid].reshape(3,3);world[:3,3]=data.geom_xpos[gid]
        local = np.linalg.inv(matrix(data.xpos[bid],data.xquat[bid]))@world
        scene.add_geometry(mesh,node_name=f"visual_{gid}",geom_name=f"mesh_{gid}",parent_node_name=names[bid],transform=local)
        count += len(mesh.faces)
    path.write_bytes(scene.export(file_type="glb"))
    bounds = scene.bounds
    center_yup = bounds.mean(axis=0)
    camera = mujoco.MjvCamera()
    camera.lookat[:] = [center_yup[0], -center_yup[2], center_yup[1]]
    camera.distance = float(np.max(bounds[1]-bounds[0])) * 1.8
    camera.azimuth = 140
    camera.elevation = -23
    model.vis.headlight.ambient[:] = .45
    model.vis.headlight.diffuse[:] = .85
    options = mujoco.MjvOption()
    options.geomgroup[:] = [0,1,1,0,0,0]
    with mujoco.Renderer(model, height=480, width=640) as renderer:
        renderer.update_scene(data, camera=camera, scene_option=options)
        rgb = renderer.render().copy()
        renderer.enable_segmentation_rendering()
        mask = renderer.render()[:,:,0] >= 0
    rgba = np.dstack([rgb, mask.astype(np.uint8)*255])
    Image.fromarray(rgba).save(path.with_name('preview.webp'), quality=90)
    return count


def clearpath(name):
    repo = ROOT / ".robot-sources" / name
    revision = subprocess.check_output(["git","-C",str(repo),"rev-parse","HEAD"],text=True).strip()
    if revision != REVISIONS[name]: raise ValueError(f"Unexpected {name} revision")
    source = repo / f"{name}_description"
    prepared = ROOT / ".robot-sources" / f"prepared-{name}"
    shutil.copytree(source,prepared,dirs_exist_ok=True)
    for path in prepared.rglob("*"):
        if path.suffix in [".xacro",".urdf",".gazebo"]:
            text=path.read_text().replace(f"$(find {name}_description)",prepared.as_posix())
            # Optional external sensor packages are absent in this base-platform configuration.
            text=re.sub(r'<xacro:include\b[^>]*\$\(find\s+[^)]*\)[^>]*/>', '', text)
            path.write_text(text,encoding="utf-8")
    document = xacro.process_file(str(prepared/"urdf"/f"{name}.urdf.xacro")).toxml()
    urdf = ET.fromstring(document)
    out = PUBLIC / name
    meshes = out / "meshes";meshes.mkdir(parents=True,exist_ok=True)
    (out/"source.urdf").write_text(document.replace(prepared.as_posix(),f"{name}_description").replace(str(prepared),f"{name}_description"),encoding="utf-8")
    shutil.copyfile(repo/"LICENSE",out/"LICENSE")
    source_materials={m.attrib["name"]:m.find("color").attrib["rgba"] for m in urdf.findall("material") if m.find("color") is not None}
    mesh_index=0
    for link in urdf.findall("link"):
        for visual in list(link.findall("visual")):
            node=visual.find("geometry/mesh")
            if node is None: continue
            filename=node.attrib["filename"].replace(f"package://{name}_description/","")
            path=source/filename
            imported=trimesh.load(path,force="scene")
            material=visual.find("material")
            override=source_materials.get(material.attrib.get("name","")) if material is not None else None
            if material is not None and material.find("color") is not None:override=material.find("color").attrib["rgba"]
            link.remove(visual)
            for n in imported.graph.nodes_geometry:
                transform,geometry_name=imported.graph[n]
                mesh=imported.geometry[geometry_name].copy();mesh.apply_transform(transform)
                if "scale" in node.attrib:mesh.apply_scale([float(v) for v in node.attrib["scale"].split()])
                file=meshes/f"visual_{mesh_index}.obj";mesh_index+=1
                file.write_text(trimesh.exchange.obj.export_obj(mesh,include_color=False,include_texture=False),encoding="utf-8")
                new=copy.deepcopy(visual);new.find("geometry/mesh").attrib={"filename":file.as_posix()}
                old=new.find("material")
                if old is not None:new.remove(old)
                if override:rgba=override
                else:
                    mat=getattr(mesh.visual,"material",None)
                    color=getattr(mat,"baseColorFactor",None)
                    if color is None:color=getattr(mat,"diffuse",getattr(mesh.visual,"main_color",[150,150,150,255]))
                    rgba=" ".join(str(float(x)/255) for x in color)
                ET.SubElement(ET.SubElement(new,"material",name=f"material_{mesh_index}"),"color",rgba=rgba)
                link.append(new)
        # Collision meshes need only geometry; convert DAE/STL to a supported local OBJ.
        for node in link.findall("collision/geometry/mesh"):
            path=source/node.attrib["filename"].replace(f"package://{name}_description/","")
            mesh=trimesh.load(path,force="mesh")
            file=meshes/f"collision_{mesh_index}.obj";mesh_index+=1
            file.write_text(trimesh.exchange.obj.export_obj(mesh,include_color=False,include_texture=False),encoding="utf-8")
            node.attrib={"filename":file.as_posix()}
    extension=ET.SubElement(urdf,"mujoco");ET.SubElement(extension,"compiler",discardvisual="false",fusestatic="false",strippath="false",inertiafromgeom="false")
    ET.SubElement(urdf,"link",name="world")
    joint=ET.SubElement(urdf,"joint",name="root_joint",type="floating");ET.SubElement(joint,"parent",link="world");ET.SubElement(joint,"child",link="base_link")
    model=mujoco.MjModel.from_xml_string(ET.tostring(urdf,encoding="unicode"))
    data=mujoco.MjData(model);mujoco.mj_forward(model,data)
    wheel_order=["rear_right_wheel_link","front_right_wheel_link","rear_left_wheel_link","front_left_wheel_link"]
    triangles=export_glb(model,data,out/"robot.glb",wheel_order)
    mujoco.mj_saveLastXML(str(out/"model.xml"),model)
    xml=ET.parse(out/"model.xml");root=xml.getroot();root.find("compiler").set("meshdir","meshes")
    root.find("compiler").set("inertiafromgeom","false")
    # Explicit source inertias must survive insertion into worlds that also infer generic robot inertias.
    for geom in root.findall(".//geom"):geom.set("density","0")
    for mesh in root.findall("asset/mesh"):mesh.set("file",Path(mesh.attrib["file"]).name)
    xml.write(out/"model.xml",encoding="unicode")
    reloaded=mujoco.MjModel.from_xml_path(str(out/"model.xml"))
    if not np.isclose(reloaded.body_mass.sum(),model.body_mass.sum()):raise ValueError("Mass changed during MJCF roundtrip")
    wheels=[model.body(name) for name in wheel_order]
    radius=.1651 if name=="husky" else .098
    config=dict(id=name,label=f"Clearpath {name.title()}",manufacturer="Clearpath Robotics",wheels=4,massKg=float(model.body_mass.sum()),
        wheelRadiusM=radius,widthM=float(abs(wheels[0].pos[1])*2),lengthM=.9874 if name=="husky" else .420,
        wheelCenterZ=float(wheels[0].pos[2]),wheelbaseM=float(abs(wheels[0].pos[0])*2),
        rootToGroundM=radius-float(wheels[0].pos[2]),wheelJointNames=[w.replace("_link","") for w in wheel_order],
        rootBody="base_link",sourceRevision=revision,license="BSD-3-Clause",sourceUrl=f"https://github.com/{name}/{name}/tree/{revision}",
        glbSha256=sha(out/"robot.glb"),mjcfSha256=sha(out/"model.xml"),triangles=triangles,
        meshSha256={p.name:sha(p) for p in sorted(meshes.glob('*.obj'))})
    (out/"manifest.json").write_text(json.dumps(config,indent=2),encoding="utf-8")
    print(name,triangles,(out/"robot.glb").stat().st_size,flush=True)


def go2():
    source=ROOT/".robot-sources"/"menagerie"/"unitree_go2"
    source.mkdir(parents=True, exist_ok=True)
    for filename in ['go2.xml', 'LICENSE']:
        if not (source/filename).exists():
            with urllib.request.urlopen(f'https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/{MENAGERIE}/unitree_go2/{filename}', timeout=90) as response:
                (source/filename).write_bytes(response.read())
    model_file=source/"go2.xml"
    filenames=[mesh.attrib["file"] for mesh in ET.parse(model_file).findall("asset/mesh")]
    (source/"assets").mkdir(exist_ok=True)
    def fetch(filename):
        path=source/"assets"/filename
        if not path.exists():
            url=f"https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/{MENAGERIE}/unitree_go2/assets/{filename}"
            with urllib.request.urlopen(url,timeout=90) as response:path.write_bytes(response.read())
    with ThreadPoolExecutor(max_workers=6) as executor:list(executor.map(fetch,filenames))
    model=mujoco.MjModel.from_xml_path(str(model_file));data=mujoco.MjData(model)
    if model.nkey:mujoco.mj_resetDataKeyframe(model,data,0)
    mujoco.mj_forward(model,data)
    out=PUBLIC/"unitree-go2";out.mkdir(parents=True,exist_ok=True)
    triangles=export_glb(model,data,out/"robot.glb")
    shutil.copyfile(source/"LICENSE",out/"LICENSE")
    manifest=dict(id="unitree-go2",label="Unitree Go2",manufacturer="Unitree Robotics",sourceRevision=MENAGERIE,license="BSD-3-Clause",
        sourceUrl=f"https://github.com/google-deepmind/mujoco_menagerie/tree/{MENAGERIE}/unitree_go2",glbSha256=sha(out/"robot.glb"),triangles=triangles,
        massKg=float(model.body_mass.sum()),joints=12,simulationStatus="inspection-only",sourceFiles={path.name:sha(path) for path in [model_file,*sorted((source/"assets").glob("*.obj"))]})
    (out/"manifest.json").write_text(json.dumps(manifest,indent=2),encoding="utf-8")
    print("unitree-go2",triangles,(out/"robot.glb").stat().st_size,flush=True)


if __name__=="__main__":
    import sys
    for name in sys.argv[1:] or ["husky","jackal","unitree-go2"]:
        go2() if name=="unitree-go2" else clearpath(name)
