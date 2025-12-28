# protoverse


## Dag Creation

The protoverse is dynamically constructed in the browser starting with a world.json that contains the URL to the splats for that world and a list of portals to other worlds. Portals are all bidirectional. The loading logic will load in all worlds and portals up to N hops away from the root world. As the viewer moves to another world the same traversal is applied and anything beyond the N hops is flushed. 

Because portals are assumed to be bydirection, as a world is loaded, all its portals are also created assuming the destination is within N hops of the root. This can create a somewhat confusing dynamic portal situation where portols come and go as worlds get loaded and unloaded. 