"""Reduce a Poly Haven tree to a real-time asset (run with blender -b --python ... -- <id> <keep> <scale>).

- leaves: keep a random fraction of leaf islands, scale each kept leaf up so the crown stays full
- trunk/branches: decimate
- export GLB to web/assets/trees/<id>.glb and a preview render to data/work/<id>_preview.png
"""
import random
import sys

import bmesh
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
mid = args[0]
keep = float(args[1]) if len(args) > 1 else 0.08
grow = float(args[2]) if len(args) > 2 else 2.2
LEAF_DEC = float(args[3]) if len(args) > 3 else 0.5
ROOT = r"C:\Users\sebas\Projects\geneva"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=rf"{ROOT}\data\raw\polyhaven\{mid}\{mid}.gltf")
obj = next(o for o in bpy.data.objects if o.type == 'MESH')
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.separate(type='MATERIAL')
bpy.ops.object.mode_set(mode='OBJECT')

random.seed(4)
parts = [o for o in bpy.data.objects if o.type == 'MESH']
for o in parts:
    mat = o.data.materials[0].name
    bm = bmesh.new()
    bm.from_mesh(o.data)
    if 'leaves' in mat:
        # islands = individual leaves
        bm.faces.ensure_lookup_table()
        seen, islands = set(), []
        for f in bm.faces:
            if f.index in seen:
                continue
            stack, isl = [f], []
            seen.add(f.index)
            while stack:
                g = stack.pop()
                isl.append(g)
                for e in g.edges:
                    for h in e.link_faces:
                        if h.index not in seen:
                            seen.add(h.index)
                            stack.append(h)
            islands.append(isl)
        drop = []
        for isl in islands:
            if random.random() > keep:
                drop.extend(isl)
            else:
                verts = {v for f in isl for v in f.verts}
                c = sum((v.co for v in verts), Vector()) / len(verts)
                for v in verts:
                    v.co = c + (v.co - c) * grow
        bmesh.ops.delete(bm, geom=drop, context='FACES')
        print("leaves", len(islands), "kept", len(islands) - len(drop and islands) if False else None)
    if 'branches' in mat:
        # twigs are thousands of tiny separate pieces: keep the big limbs and a quarter of the twigs
        bm.faces.ensure_lookup_table()
        seen, drop = set(), []
        for f in bm.faces:
            if f.index in seen:
                continue
            stack, isl = [f], []
            seen.add(f.index)
            while stack:
                g = stack.pop()
                isl.append(g)
                for e in g.edges:
                    for h in e.link_faces:
                        if h.index not in seen:
                            seen.add(h.index)
                            stack.append(h)
            if len(isl) < 400 and random.random() > 0.25:
                drop.extend(isl)
        bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(o.data)
    bm.free()
    mod = o.modifiers.new('dec', 'DECIMATE')
    mod.ratio = {'leaves': LEAF_DEC, 'branches': 0.06, 'trunk': 0.02}[next(k for k in ('leaves', 'branches', 'trunk') if k in mat)]
    if True:
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='dec')
    print("PART", mat, len(o.data.polygons))

# ground the tree at the origin
minz = min((o.matrix_world @ Vector(c)).z for o in parts for c in o.bound_box)
for o in parts:
    o.location.z -= minz

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=rf"{ROOT}\web\assets\trees\{mid}.glb", export_format='GLB', use_selection=True,
                          export_image_format='JPEG', export_jpeg_quality=85, export_apply=True,
                          export_draco_mesh_compression_enable=False)

# preview render
scene = bpy.context.scene
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
cam.location = (0, -38, 9)
cam.rotation_euler = (1.45, 0, 0)
scene.camera = cam
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 4
sun.rotation_euler = (0.8, 0.2, 0.6)
scene.collection.objects.link(sun)
world = bpy.data.worlds.new('w')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.7, 0.85, 1)
scene.world = world
scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x, scene.render.resolution_y = 640, 640
scene.render.filepath = rf"{ROOT}\data\work\{mid}_preview.png"
bpy.ops.render.render(write_still=True)
print("DONE")
