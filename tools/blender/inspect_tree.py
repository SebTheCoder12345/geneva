import bpy, sys
mid = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=rf"C:\Users\sebas\Projects\geneva\data\raw\polyhaven\{mid}\{mid}.gltf")
for o in bpy.data.objects:
    if o.type == 'MESH':
        me = o.data
        print("OBJ", mid, o.name, len(me.polygons), [m.name for m in me.materials], tuple(round(v, 2) for v in o.dimensions))
