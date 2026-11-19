import * as THREE from './vendor/three.module.js';

const smooth = (low, high, x) => THREE.MathUtils.smoothstep(x, low, high);

// Intersect the remaining wall washers with each wall face. The angled light
// from a head already assigned a shuttered photograph is excluded from the wash.
function wallWashers(wall, rows, fixtures) {
  const strikes = [];
  rows.forEach((heads, r) => heads.forEach((head, i) => {
    if (fixtures.has(r+':'+i) || !head.aim) return;
    const aim = head.aim;
    const incidence = -(aim.x*wall.normal[0] + aim.z*wall.normal[1]);
    if (incidence < .22) return;
    const distance = ((head.x-wall.a[0])*wall.normal[0] + (head.z-wall.a[1])*wall.normal[1])/incidence;
    if (distance <= 0 || distance > 4.2) return;
    const along = (head.x+aim.x*distance-wall.a[0])*wall.tangent.x
      + (head.z+aim.z*distance-wall.a[1])*wall.tangent.y;
    const y = wall.sourceY + aim.y*distance;
    if (along < -2 || along > wall.length+2 || y < .35 || y > wall.height+.5) return;
    strikes.push({along, y, power:head.power*Math.sqrt(incidence)});
  }));
  return strikes;
}

export function preparePrintLighting(space, layout, walls, rows) {
  const study = layout.lightingStudy.photoFraming;
  const fixtures = new Map(), settings = new Map();
  const surfaces = new Map(walls.map(w => [w.id,w]));
  const works = new Map(layout.works.map(w => [w.id,w]));
  for (const light of study.lights) {
    const wall = surfaces.get(light.surfaceId), work = works.get(light.id);
    const address = (light.rowFromA-1)+':'+(light.headFromLeft-1);
    fixtures.set(address, {id:light.id, aim:new THREE.Vector3(...light.aim)});
    settings.set(light.id,light);
    wall.prints.push({...light, center:work.along, y:work.centerY, w:work.outerWidth/2, h:work.outerHeight/2});
  }
  for (const wall of walls) {
    wall.sourceY = space.lighting.railHeight-.15;
    wall.washers = wallWashers(wall,rows,fixtures);
  }
  return {fixtures, settings};
}

// The photograph support covers the shutter opening. Only weak, broad spill
// can be seen outside the moulding. Several neighbouring heads share one wall
// field rather than drawing one luminous outline around each black frame.
export function photographColumn(wall, along, height, parameters, neighbors) {
  const distance = Math.min(...wall.prints.map(p => Math.abs(along-p.center)-p.w));
  const toNeighbor = Math.min(...neighbors.map(w => Math.abs(along-w.along)-w.outerWidth/2));
  const mask = (wall.kind === 'partition' ? 1 : 1-smooth(...parameters.boundaryM,distance))
    * (Number.isFinite(toNeighbor) ? smooth(...parameters.neighborM,toNeighbor) : 1);
  const washers = wall.washers.filter(w => Math.abs(w.along-along)<3.2)
    .map(w => ({y:w.y, power:w.power*Math.exp(-1.8*((along-w.along)/1.42)**2)}));
  const lit = wall.prints.filter(p => Math.abs(p.center-along) < 3*p.spillRadiiM[0])
    .map(p => ({p, dx:Math.abs(along-p.center)-p.apertureM[0]/2,
      profile:Math.exp(-.8*((along-p.center-p.spillOffsetM[0])/p.spillRadiiM[0])**2)}));
  const values = new Uint8Array(height);
  for (let v=0;v<height;v++) {
    const y = v*wall.height/(height-1);
    let indirect = 0;
    for(const w of washers)indirect += w.power*Math.exp(-1.5*((y-w.y)/1.02)**2);
    const base = (wall.kind === 'partition' ? parameters.panelBase : parameters.longBase)
      + parameters.upperLift*smooth(1.6,wall.height,y)
      + parameters.washLift*(1-Math.exp(-1.8*indirect)) - parameters.nearFloorLoss*Math.exp(-y/.20);
    let stray=0, shutter=0;
    for(const {p,dx,profile} of lit) {
      stray += profile*Math.exp(-.8*((y-p.y-p.spillOffsetM[1])/p.spillRadiiM[1])**2);
      const dy = Math.abs(y-p.y)-p.apertureM[1]/2;
      const signedDistance = Math.hypot(Math.max(0,dx),Math.max(0,dy)) + Math.min(Math.max(dx,dy),0);
      shutter = Math.max(shutter,1-smooth(-p.penumbraM,p.penumbraM,signedDistance));
    }
    const background = base + parameters.spillLift*(1-Math.exp(-stray));
    values[v]=Math.round(255*THREE.MathUtils.lerp(background,parameters.shutterGain,shutter));
  }
  return {mask:Math.round(255*mask), values};
}
