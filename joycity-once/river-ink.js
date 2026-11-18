import * as THREE from 'three';
import { galleryHeadAim } from './gallery-lighting.js?v=20261118-trial21';

// A satin overprint uses the English glyphs' existing alpha, under one modelled wall washer.
export function installRiverInk(exhibition, space, trackWash) {
  const poem = exhibition.poemGroups.get('river');
  const study = poem?.userData.layout.rasterOverride?.satinInk;
  const ink = poem?.children.find(object => object.isMesh && object.userData.source);
  if (!study || !ink || !trackWash) return null;

  const { lighting } = space;
  const uv = new THREE.Vector4(...study.uvBounds);
  const [width, height] = ink.userData.slotDimensions;
  const center = new THREE.Vector3(((uv.x + uv.z) / 2 - .5) * width, ((uv.y + uv.w) / 2 - .5) * height, 0);
  ink.localToWorld(center);
  const rows = lighting.rowPositions;
  const row = rows.reduce((best,z,i) => Math.abs(z+center.z)<Math.abs(rows[best]+center.z)?i:best,0);
  const head = lighting.headXs.length - 2;
  const source = new THREE.Vector3(lighting.headXs[head], lighting.railHeight - .15, -rows[row]);
  const aim = galleryHeadAim(space,row,head);
  aim.z *= -1;
  const enabled = { value: 1 };
  const material = ink.material;
  const previous = material.onBeforeCompile;
  const priorKey = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this,shader,renderer);
    Object.assign(shader.uniforms,{
      satinEnabled:enabled, satinTrack:trackWash.enabled, satinBounds:{value:uv},
      satinSource:{value:source}, satinAim:{value:aim}
    });
    const varyings = 'varying vec3 inkWorld; varying vec3 inkNormal;\n';
    shader.vertexShader = varyings + shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      inkWorld=(modelMatrix*vec4(transformed,1.)).xyz;
      inkNormal=normalize(mat3(modelMatrix)*normal);`);
    shader.fragmentShader = varyings + `uniform float satinEnabled,satinTrack;
      uniform vec3 satinSource,satinAim; uniform vec4 satinBounds;\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      if (satinEnabled*satinTrack>0. && all(greaterThanEqual(vMapUv,satinBounds.xy)) && all(lessThanEqual(vMapUv,satinBounds.zw))) {
        vec3 L=normalize(satinSource-inkWorld);
        vec3 V=isOrthographic?normalize(vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2])):normalize(cameraPosition-inkWorld);
        vec3 N=faceforward(normalize(inkNormal),-V,normalize(inkNormal));
        float beam=smoothstep(.70,.95,dot(-L,satinAim));
        vec3 halfway=normalize(L+V);
        float acrossGrain=dot(halfway,normalize(cross(vec3(0.,1.,0.),N)));
        float sheen=pow(max(dot(N,halfway),0.),3.)*exp(-11.*acrossGrain*acrossGrain);
        outgoingLight+=vec3(.46)*beam*sheen*max(dot(N,L),0.);
      }
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => priorKey+'/satin-english';
  material.needsUpdate = true;
  return enabled;
}
