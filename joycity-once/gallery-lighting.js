import * as THREE from 'three';
import { makeFramingStudy } from './gallery-framing.js?v=20261119-trial22';

// All coordinates used to aim and bake heads are in the measured-room convention (+Z toward B).
// This is a relative lighting study. Beam spreads and intensities are design values.
export function galleryHeadAim(space, rowIndex, headIndex) {
  const { lighting, room } = space;
  const x = lighting.headXs[headIndex], side = x < room.width / 2 ? -1 : 1;
  const edge = Math.min(headIndex, lighting.headXs.length - 1 - headIndex);
  const forward = (rowIndex % 2 ? 1 : -1) * side;
  const sourceY = lighting.railHeight - .15;
  const targetX = edge < 2 ? (side < 0 ? 0 : room.width) : x - side * .22;
  const targetY = edge === 0 ? 2.08 : edge === 1 ? 1.55 : 0;
  return new THREE.Vector3(targetX - x, targetY - sourceY, forward * (edge < 2 ? .34 : .18)).normalize();
}

// Bake diffuse light arriving along the three surface axes. Linear filtering interpolates
// adjacent samples; the runtime cost is one texture fetch regardless of the number of heads.
function bakeIrradiance(space, partitions, rows) {
  const { room, lighting } = space;
  const startZ = Math.min(0, space.ends.A.slope?.leftZ || 0);
  const spanZ = room.length - startZ, height = lighting.railHeight;
  const nx = 28, ny = 24, nz = 208;
  const pixels = new Uint8Array(nx * ny * nz * 4);
  const sourceY = height - .15;
  const encode = gain => Math.round(255 * THREE.MathUtils.clamp((gain - .6) / .6, 0, 1));
  for (let iz = 0; iz < nz; iz++) {
    const z = startZ + iz * spanZ / (nz - 1);
    const nearby = rows.filter(heads => Math.abs(heads[0].z - z) < 5).flat();
    for (let ix = 0; ix < nx; ix++) {
      const x = ix * room.width / (nx - 1);
      // Soft contact where an opaque movable panel meets the floor.
      let edgeDistance = Math.min(x, room.width - x);
      for (const panel of partitions) {
        const [ax, az] = panel.a, [bx, bz] = panel.b, dx = bx - ax, dz = bz - az;
        const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
        edgeDistance = Math.min(edgeDistance, Math.hypot(x - ax - t * dx, z - az - t * dz));
      }
      const contact = Math.exp(-edgeDistance / .21);
      for (let iy = 0; iy < ny; iy++) {
        const y = iy * height / (ny - 1), dy = y - sourceY;
        let sideLight = 0, floorLight = 0, endLight = 0;
        for (const head of nearby) {
          const dx = x - head.x, dz = z - head.z, r2 = dx * dx + dy * dy + dz * dz;
          const inv = 1 / Math.sqrt(Math.max(.01, r2));
          const cosine = (dx * head.aim.x + dy * head.aim.y + dz * head.aim.z) * inv;
          if (cosine <= 0) continue;
          const cone2 = cosine * cosine;
          const beam = head.power * cone2 * cone2 * inv / (1.0 + r2);
          sideLight += beam * Math.abs(dx);
          floorLight += beam * Math.max(0, -dy);
          endLight += beam * Math.abs(dz);
        }
        // RGB store gains for a wall along the corridor, walking surface and transverse panel.
        // Reserve float-like precision for the small range of useful gains [0.6, 1.2].
        const offset = 4 * (ix + nx * (iy + ny * iz));
        const sideGain = .82 + .395 * (1 - Math.exp(-2.55 * sideLight)) - .032 * Math.exp(-y / .19);
        // Roll off the brightest overlaps before the warm finish clips to display white.
        pixels[offset] = encode(sideGain <= 1.045 ? sideGain : 1.045 + .033 * (1 - Math.exp(-(sideGain - 1.045) / .033)));
        pixels[offset + 1] = encode(.94 + .11 * (1 - Math.exp(-1.8 * floorLight)) - .075 * contact);
        pixels[offset + 2] = encode(.87 + .18 * (1 - Math.exp(-3 * endLight)) - .028 * Math.exp(-y / .19));
        pixels[offset + 3] = 255;
      }
    }
  }
  const texture = new THREE.Data3DTexture(pixels, nx, ny, nz);
  texture.format = THREE.RGBAFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  // Endpoints of the grid sit at voxel centres.
  const scale = new THREE.Vector3((1 - 1/nx)/room.width, (1 - 1/ny)/height, (1 - 1/nz)/spanZ);
  const bias = new THREE.Vector3(.5/nx, .5/ny, .5/nz - startZ * scale.z);
  return { texture, scale, bias };
}

// Approximate the short, soft contact shadow behind a projecting frame. The picture plane
// keeps its original colours. Directions are averaged from the heads that illuminate its face.
function addFrameContact(group, width, height, depth, center, normal, rows, sourceY, material) {
  let incident=0, along=0, down=0;
  for(const heads of rows)for(const head of heads){
    const dx=center[0]-head.x, dy=center[1]-sourceY, dz=center[2]-head.z;
    const perpendicular=-(dx*normal[0]+dz*normal[1]);
    if(perpendicular<=.05)continue;
    const r2=dx*dx+dy*dy+dz*dz;
    const cosine=(dx*head.aim.x+dy*head.aim.y+dz*head.aim.z)/Math.sqrt(r2);
    if(cosine<=0)continue;
    const weight=head.power*Math.pow(cosine,4)*perpendicular/(Math.sqrt(r2)*(1+r2));
    incident+=weight;
    along+=weight*(-normal[1]*dx+normal[0]*dz)/perpendicular;
    down+=weight*dy/perpendicular;
  }
  if(incident<=0)return;
  const blur=Math.max(.008,depth*.53);
  const geo=new THREE.PlaneGeometry(width+2*blur,height+2*blur);
  const values=new Float32Array(12);
  for(let i=0;i<4;i++)values.set([width/2,height/2,blur],3*i);
  geo.setAttribute('frameContact',new THREE.BufferAttribute(values,3));
  const shadow=new THREE.Mesh(geo,material);
  const clamp=THREE.MathUtils.clamp;
  shadow.position.set(depth*clamp(along/incident,-.65,.65),depth*clamp(down/incident,-.94,.94),-.017);
  shadow.name='画框与墙面之间的柔影';
  shadow.raycast=()=>{};
  group.add(shadow);
}

export function createTrackWash(space, layout) {
  const revision = Number(layout.revision.match(/trial(\d+)$/)?.[1]);
  if (!(revision >= 21) || !space.lighting?.rowPositions?.length || !space.lighting.headXs?.length) return null;
  const {lighting}=space;
  const rows = lighting.rowPositions.map((z, row) => lighting.headXs.map((x, head) => {
    const edge = Math.min(head, lighting.headXs.length - 1 - head);
    return { x, z, aim: galleryHeadAim(space, row, head), power: edge === 0 ? .52 : edge === 1 ? 1.35 : .72 };
  }));
  const { texture, scale, bias } = bakeIrradiance(space, layout.partitions || [], rows);
  const framing = revision >= 22 ? makeFramingStudy(space,layout,rows) : null;
  const enabled = { value: 1 };
  const cutEnabled = framing ? {value:1} : null;
  const contactMaterial=new THREE.ShaderMaterial({
    uniforms:{trackMix:enabled}, transparent:true,depthWrite:false,toneMapped:false,
    vertexShader:`attribute vec3 frameContact; varying vec2 localPos; varying vec3 edge;
      void main(){localPos=position.xy;edge=frameContact;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform float trackMix; varying vec2 localPos; varying vec3 edge;
      void main(){vec2 d=abs(localPos)-edge.xy;float dist=length(max(d,0.))+min(max(d.x,d.y),0.);
        gl_FragColor=vec4(0.,0.,0.,.13*trackMix*(1.-smoothstep(-edge.z,edge.z,dist)));}`,
  });
  return {
    enabled, cutEnabled,
    headAim(row, i) {
      const spot = framing?.fixtures.get(row+':'+i);
      return cutEnabled?.value && spot ? spot.aim : rows[row][i].aim;
    },
    frameContact(group,width,height,depth,center,normal) {
      addFrameContact(group,width,height,depth,center,normal,rows,lighting.railHeight-.15,contactMaterial);
    },
    apply(material) {
      const earlier = material.onBeforeCompile, earlierKey = material.customProgramCacheKey();
      material.onBeforeCompile = function(shader, renderer) {
        earlier.call(this, shader, renderer);
        shader.uniforms.trackField = { value: texture };
        shader.uniforms.trackScale = { value: scale };
        shader.uniforms.trackBias = { value: bias };
        shader.uniforms.trackMix = enabled;
        if (framing) {
          shader.uniforms.cutField = {value:framing.texture};
          shader.uniforms.cutMix = cutEnabled;
        }
        const varyings = 'varying vec3 trackUVW;\nvarying vec3 trackAxis;\n' + (framing ? 'varying vec3 cutPosition;\n' : '');
        shader.vertexShader = varyings + 'uniform vec3 trackScale; uniform vec3 trackBias;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vec3 trackWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          ${framing ? 'cutPosition = trackWorld * vec3(1.,1.,-1.);' : ''}
          trackUVW = trackWorld * vec3(1., 1., -1.) * trackScale + trackBias;
          trackAxis = normalize(mat3(modelMatrix) * normal);
        `);
        shader.fragmentShader = varyings + 'uniform highp sampler3D trackField; uniform float trackMix;\n' + (framing?.fragment || '') + '\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
          vec3 gains = .6 + .6 * texture(trackField, trackUVW).rgb;
          vec3 axis = normalize(trackAxis);
          outgoingLight *= mix(1., dot(gains, axis * axis), trackMix);
          ${framing ? 'outgoingLight *= mix(1.,framingGain(cutPosition,axis),trackMix*cutMix);' : ''}
          #include <opaque_fragment>
        `);
      };
      material.customProgramCacheKey = () => earlierKey + (framing ? '/track-framing-' + layout.revision : '/track-wash');
    },
  };
}
