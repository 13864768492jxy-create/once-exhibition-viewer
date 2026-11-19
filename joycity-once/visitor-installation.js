import * as THREE from 'three';

// Canonical X / height / A→B. Parent exhibition mirrors Z into scene space.
export function addVisitorInstallation(group, layout, collisionRects) {
  const spec = layout.visitorInstallation;
  if (!spec) return;
  const materials = Object.fromEntries(Object.entries(spec.finishes).map(([name, color]) =>
    [name, new THREE.MeshStandardMaterial({color, roughness: .79, metalness: name === 'cord' ? 0 : .16})]));
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 16);
  const toe = new THREE.BoxGeometry(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const left = new THREE.Vector3(), right = new THREE.Vector3(), delta = new THREE.Vector3();
  const transform = new THREE.Object3D();
  for (const item of spec.components) {
    const assembly = new THREE.Group();
    assembly.name = item.id;
    assembly.userData = {role: 'visitorFitting', fittingId: item.id, notArtwork: true};
    group.add(assembly);
    for (const [finish, material] of Object.entries(materials)) {
      const tubes = item.tubes.filter(t => t[0] === finish);
      if (!tubes.length) continue;
      const mesh = new THREE.InstancedMesh(cylinder, material, tubes.length);
      mesh.name = item.id + '_' + finish;
      tubes.forEach(([, radius, from, to], i) => {
        left.fromArray(from); right.fromArray(to); delta.subVectors(right, left);
        transform.position.copy(left).lerp(right, .5);
        transform.scale.set(radius, delta.length(), radius);
        transform.quaternion.setFromUnitVectors(up, delta.normalize()); transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
      });
      assembly.add(mesh);
    }
    for (const [x,z,u,v,h,depth] of item.plates) {
      const mesh = new THREE.Mesh(toe, materials.edge);
      mesh.position.set((x+u)/2, h/2, (z+v)/2);
      mesh.scale.set(Math.hypot(u-x,v-z), h, depth);
      mesh.rotation.y = -Math.atan2(v-z,u-x);
      assembly.add(mesh);
    }
  }
  for (const zone of spec.zones) {
    const xs = zone.path.map(p => p[0]), zs = zone.path.map(p => p[1]);
    const lower = Math.min(...zs) - zone.baseRadius, upper = Math.max(...zs) + zone.baseRadius;
    // Short longitudinal slices protect the entire inside of the line without
    // treating the deepest forward bank as an obstacle along the whole run.
    for (let a = lower; a < upper; a += .10) {
      const b = Math.min(upper, a + .10), edges = [];
      zone.path.slice(1).forEach(([x1,z1], i) => {
        const [x0,z0]=zone.path[i];
        if (Math.min(z0,z1)-zone.baseRadius>b || Math.max(z0,z1)+zone.baseRadius<a) return;
        if (z0===z1) { edges.push(x0,x1); return; }
        for (const d of [a-zone.baseRadius,b+zone.baseRadius]) {
          const t=THREE.MathUtils.clamp((d-z0)/(z1-z0),0,1);
          edges.push(x0+t*(x1-x0));
        }
      });
      if (!edges.length) continue;
      collisionRects.push({id:zone.id, type:'visitor-boundary',
        minX:zone.side==='left'?Math.min(...xs)-zone.baseRadius:Math.min(...edges)-zone.baseRadius,
        maxX:zone.side==='right'?Math.max(...xs)+zone.baseRadius:Math.max(...edges)+zone.baseRadius,
        minZ:a,maxZ:b});
    }
  }
  const s = spec.directionSign, extent = s.profile.map(p=>[s.x+s.axis[0]*p[0],s.z+s.axis[1]*p[0]]);
  collisionRects.push({id:s.id,type:'visitor-sign',minX:Math.min(s.x-s.baseRadius,...extent.map(p=>p[0]))-s.rodRadius,
    maxX:Math.max(s.x+s.baseRadius,...extent.map(p=>p[0]))+s.rodRadius,
    minZ:Math.min(s.z-s.baseRadius,...extent.map(p=>p[1]))-s.rodRadius,
    maxZ:Math.max(s.z+s.baseRadius,...extent.map(p=>p[1]))+s.rodRadius});
}
