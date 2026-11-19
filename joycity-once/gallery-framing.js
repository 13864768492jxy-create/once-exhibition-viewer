import * as THREE from './vendor/three.module.js';
import { preparePrintLighting, photographColumn } from './gallery-print-light.js?v=20261119-trial22-light-r6';

// A framing-projector study in metres. Shutter positions and penumbrae are design
// assumptions; the rail inventory and optics still need an on-site check.
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

function visibleFrom(head, work, partitions) {
  // The mounting panel itself is the destination. Reject any other panel between
  // the chosen head and the centre of the photograph.
  for (const panel of partitions) {
    const dx = work.x-head.x, dz = work.z-head.z;
    const sx = panel.b[0]-panel.a[0], sz = panel.b[1]-panel.a[1];
    const det = dx*sz-dz*sx;
    if (Math.abs(det) < .0001) continue;
    const ax = panel.a[0]-head.x, az = panel.a[1]-head.z;
    const t = (ax*sz-az*sx)/det, u = (ax*dz-az*dx)/det;
    if (t > 0 && t < .98 && u >= 0 && u <= 1 &&
        head.y + (work.y-head.y)*t <= panel.height + .03) return false;
  }
  return true;
}

function assignProjectors(space, layout, walls, rows) {
  const photos = [];
  const heads = [];
  // Keep the existing right-hand washer that models the satin on the river's
  // lettering available even where a photo shares its rail.
  const river = layout.poems?.find(p => p.id === 'river');
  const raster = river?.rasterOverride, uv = raster?.satinInk?.uvBounds;
  let riverWasher = -1;
  if (uv) {
    const offset = (raster.localCenterX || 0) + raster.physicalWidth*((uv[0]+uv[2])*.5-.5);
    const z = river.position[2] + offset*Math.sin(THREE.MathUtils.degToRad(river.rotationY));
    riverWasher = rows.reduce((best,row,i) => Math.abs(row[0].z-z)<Math.abs(rows[best][0].z-z)?i:best,0);
  }
  for (const [rowIndex, row] of rows.entries()) {
    row.forEach((head, i) => {
      if (rowIndex === riverWasher && i === row.length-2) return;
      if (Math.min(i, row.length - 1 - i) < 2)
        heads.push({...head, y:space.lighting.railHeight - .15, index:i, row:rowIndex});
    });
  }
  const surfaceById = new Map(walls.map(w => [w.id, w]));
  for (const work of layout.works) {
    const wall = surfaceById.get(work.surfaceId);
    if (!wall || work.type !== 'photo' || !work.id.startsWith('once_')) continue;
    const x = wall.a[0] + work.along * wall.tangent.x;
    const z = wall.a[1] + work.along * wall.tangent.y;
    const target = {x, z, y:work.centerY};
    const choices = [];
    for (const head of heads) {
      const direction = new THREE.Vector3(x-head.x, work.centerY-head.y, z-head.z);
      const distance = direction.length();
      const incidence = -(direction.x*wall.normal[0] + direction.z*wall.normal[1]) / distance;
      if (incidence < .17 || distance > 3.85 || !visibleFrom(head,target,layout.partitions || [])) continue;
      choices.push({head, direction:direction.normalize(), distance, incidence,
        cost:distance + .36 / incidence});
    }
    choices.sort((a,b) => a.cost-b.cost);
    photos.push({wall,work,choices});
  }
  // Handle the most constrained photos first. An augmenting path prevents a
  // convenient early match from taking the sole usable lamp of a later print.
  const assignments = new Map();
  function place(photo, seen) {
    const free = photo.choices.find(c => !assignments.has(c.head));
    if (free) {
      assignments.set(free.head,{choice:free,photo});
      return true;
    }
    for (const choice of photo.choices) {
      if (seen.has(choice.head)) continue;
      seen.add(choice.head);
      const prior = assignments.get(choice.head);
      if (!prior || place(prior.photo, seen)) {
        assignments.set(choice.head,{choice,photo});
        return true;
      }
    }
    return false;
  }
  photos.sort((a,b) => a.choices.length - b.choices.length);
  for (const photo of photos) place(photo,new Set());
  const fixtures = new Map();
  for (const {photo:{wall,work},choice} of assignments.values()) {
    const {head,direction,distance,incidence} = choice;
    fixtures.set(head.row+':'+head.index, {aim:direction, id:work.id});
    const softness = .018 + .007 * distance / Math.sqrt(incidence);
    wall.prints.push({center:work.along, y:work.centerY, w:work.outerWidth/2, h:work.outerHeight/2, softness});
  }
  return fixtures;
}

export function makeFramingStudy(space,layout,rows) {
  const surfaces = layout.surfaces.filter(s => layout.works.some(w =>
    w.surfaceId === s.id && w.type === 'photo' && w.id.startsWith('once_')));
  const walls = surfaces.map(s => {
    const tangent = new THREE.Vector2(s.b[0]-s.a[0],s.b[1]-s.a[1]);
    return {...s, length:tangent.length(), tangent:tangent.normalize(), prints:[]};
  });
  const printLighting = layout.lightingStudy?.onceLightingRevision === '20261119-r6'
    ? preparePrintLighting(space,layout,walls,rows) : null;
  const fixtures = printLighting?.fixtures || assignProjectors(space, layout, walls, rows);
  if (!fixtures.size) return null;

  // A separate strip per actual wall face gives centimetre-scale edge detail
  // without a full-resolution volume or a loop over all artworks per fragment.
  const width = 2048, height = 160, strips = walls.length;
  const channels = printLighting ? 2 : 1;
  const pixels = new Uint8Array(width*height*strips*channels).fill(255);
  const swatches = [], stripInfo = [];
  walls.forEach((wall, i) => {
    if (!wall.prints.length) return;
    const columns = Math.min(width, Math.ceil(wall.length/.016) + 1);
    stripInfo.push({id:wall.id,row:i,columns,height,length:wall.length});
    const neighbors = layout.works.filter(w => w.surfaceId === wall.id && ['large','video'].includes(w.type));
    for (let u=0;u<columns;u++) {
      const along = u*wall.length/(columns-1);
      if(printLighting) {
        const column=photographColumn(wall,along,height,layout.lightingStudy.photoFraming.wall,neighbors);
        for(let v=0;v<height;v++) {
          const index=((i*height+v)*width+u)*channels;
          pixels[index]=column.values[v]; pixels[index+1]=column.mask;
        }
        continue;
      }
      let distanceToHang = Infinity;
      for (const p of wall.prints)
        distanceToHang = Math.min(distanceToHang, Math.abs(along-p.center)-p.w);
      const distanceToNeighbor = neighbors.reduce((distance,w) =>
        Math.min(distance, Math.abs(along-w.along)-w.outerWidth/2),Infinity);
      const weight = (wall.kind === 'partition' ? 1 : 1-smooth(.55,1.65,distanceToHang)) *
        (distanceToNeighbor === Infinity ? 1 : smooth(.22,.85,distanceToNeighbor));
      const nearby = wall.prints.filter(p => Math.abs(along-p.center) < p.w + .5);
      for (let v=0;v<height;v++) {
        const y = v*wall.height/(height-1);
        // Spill from circulation lighting slightly lifts the top of a darkened
        // exhibition wall. All non-photographic walls and floor normals retain the wash.
        const background = .665 + .042 * smooth(1.65,wall.height,y);
        let gain = background;
        for (const p of nearby) {
          const dx = Math.abs(along - p.center) - p.w;
          const dy = Math.abs(y-p.y)-p.h;
          const d = Math.hypot(Math.max(0,dx),Math.max(0,dy)) + Math.min(Math.max(dx,dy),0);
          // Set shutters just inside the moulding. The optical shoulder survives
          // as a narrow, feathered trace; wider spill is much weaker than the cut.
          const edge = 1-smooth(-p.softness,p.softness,d+.009);
          const bounce = .035 * (1-smooth(0,.28,Math.max(0,d)));
          gain = Math.max(gain,background + bounce + (.98-background-.035)*edge);
        }
        pixels[(i*height+v)*width+u] = Math.round(255*(1-weight*(1-gain)));
      }
    }
    const n = value => Number(value).toFixed(7);
    const vec2 = a => 'vec2('+a.map(n).join(',')+')';
    const tolerance = wall.id === 'once-main' ? .28 : .034;
    const margin = wall.kind === 'partition' ? .002 : .65;
    const origin = vec2(wall.a), tangent = vec2(wall.tangent.toArray()), normal = vec2(wall.normal);
    swatches.push(`{
      vec2 off = wp.xz-${origin};
      float u = dot(off,${tangent});
      if (abs(dot(off,${normal})) < ${n(tolerance)} && abs(dot(axis.xz*vec2(1.,-1.),${normal})) > .97 &&
          u >= ${n(-margin)} && u <= ${n(wall.length+margin)} && wp.y <= ${n(wall.height+.002)}) {
        vec2 uv = vec2((.5 + clamp(u,0.,${n(wall.length)})*${n((columns-1)/wall.length)})/${n(width)},
          (${n(i*height+.5)} + clamp(wp.y/${n(wall.height)},0.,1.)*${n(height-1)})/${n(height*strips)});
        float fade = smoothstep(${n(-margin)},0.,u) * (1.-smoothstep(${n(wall.length)},${n(wall.length+margin)},u));
        ${printLighting ? 'vec2 field=texture(cutField,uv).rg; return mix(1.,field.r/baseGain,fade*field.g);' : 'return mix(1.,texture(cutField,uv).r,fade);'}
      }
    }`);
  });
  const texture = new THREE.DataTexture(pixels,width,height*strips,printLighting ? THREE.RGFormat : THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return {texture, fixtures, strips:stripInfo, settings:printLighting?.settings, fragment:`uniform sampler2D cutField; uniform float cutMix;
    float framingGain(vec3 wp, vec3 axis, float baseGain) { if (abs(axis.y)>.25) return 1.; ${swatches.join('\n')} return 1.; }`};
}
