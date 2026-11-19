import * as THREE from 'three';
import {addVisitorInstallation} from './visitor-installation.js?v=20261119-trial22-light-r6';
import { createTrackWash } from './gallery-lighting.js?v=20261119-trial22-light-r6';
import { installRiverInk } from './river-ink.js?v=20261119-trial22';
import { installPoetryEditor } from './poetry-editor.js?v=20261119-trial22-light-r6';
import { OrbitControls } from './vendor/OrbitControls.js';
import { installCatalog, catalogWorkTitle } from './catalog.js?v=20261119-trial22-series';
import { buildExhibition } from './exhibition.js?v=20261119-trial22-light-r6';

const $ = (s) => document.querySelector(s);
const host = $('#canvas-host');
let stripMaterial, architectureMaterials, selectedFinishId;
let data, renderer, scene, camera, controls, groups, walls, view = 'overview';
let exhibition, trialLayout, library, trialVisible=true, inspectionFrame=null, poetryEditor;
let yaw = 0, pitch = 0, walkPosition, pointerStart, pressed = new Set();
let previousTime = performance.now(), raf = 0;
const viewerVersion='20261119-trial22';
const filmDiagonalMm = Math.hypot(36, 24);
let lensMode = 'natural';

function applyVisitorLens(cam, aspect) {
  const { detailMm, focalMm, wideFov, paneTangents } = cam.userData.visitorLens;
  cam.aspect = aspect;
  if (lensMode !== 'wide') {
    const mm=lensMode==='detail'?detailMm:focalMm;
    // Use the same diagonal when the viewport rotates or changes shape.
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(filmDiagonalMm / (2 * mm * Math.hypot(1, aspect))));
  } else if (paneTangents) {
    const tangent = Math.max(paneTangents.vertical, paneTangents.horizontal / aspect);
    cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(tangent * 1.18)), wideFov, 105);
  } else {
    cam.fov = wideFov;
  }
  const wallFit = cam.userData.visitorLens.wallFit;
  if (wallFit && lensMode !== 'detail') {
    const tangent = Math.max(wallFit.vertical, wallFit.horizontal / aspect);
    cam.fov = Math.max(cam.fov, THREE.MathUtils.radToDeg(2 * Math.atan(tangent)));
  }
  cam.updateProjectionMatrix();
}

function visitorCamera(focalMm, wideFov, detailMm) {
  const aspect = host.clientWidth / host.clientHeight;
  const cam = new THREE.PerspectiveCamera(wideFov, aspect, .025, 120);
  cam.userData.visitorLens = { focalMm, wideFov, detailMm };
  cam.up.copy(worldUp);
  applyVisitorLens(cam, aspect);
  return cam;
}
let framedInspection=null, responsiveGroup=null;
let updateComparisonLink=()=>{};
let trackWash, roomLights;
let photoCutRequested = new URLSearchParams(location.search).get('lighting') !== 'wash';
let trackWashRequested = new URLSearchParams(location.search).get('lighting') !== 'flat';
const lightStudyUniform={value:0};
function lightStudyMaterial(material,trafficSurface=false){
  const study=trialLayout?.lightingStudy;
  if(study?.controlledZone?.side!=='both')return material;
  const minimum=(trackWash && trafficSurface) ? .82 : study.minimumDiffuse;
  material.onBeforeCompile=shader=>{
    shader.uniforms.galleryDimming=lightStudyUniform;
    shader.vertexShader='varying float galleryDepth;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\n galleryDepth=-(modelMatrix*vec4(transformed,1.0)).z;');
    shader.fragmentShader='varying float galleryDepth;\nuniform float galleryDimming;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`outgoingLight *= mix(1.0,${minimum.toFixed(3)},smoothstep(${study.transitionStartZ.toFixed(3)},${study.controlledZone.fromZ.toFixed(3)},galleryDepth)*galleryDimming);\n#include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=>'projection-study-'+minimum;
  return material;
}
function updateLightStudy(){
  if(trackWash&&roomLights){
    const on=trialVisible&&trackWashRequested;
    const cut=Number(on && photoCutRequested);
    const changed=trackWash.enabled.value!==Number(on) || (trackWash.cutEnabled && trackWash.cutEnabled.value!==cut);
    if(trackWash.cutEnabled)trackWash.cutEnabled.value=cut;
    trackWash.enabled.value=Number(on);
    roomLights.ambient.intensity=on?1.9:2.1;
    roomLights.sunlight.intensity=on?2.0:2.5;
    roomLights.fill.intensity=on ? .96 : 1.1;
    if(changed){
      groups?.lighting?.traverse(head=>{
        const indices=head.userData.trackIndices;
        if(indices)head.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0),trackWash.headAim(...indices));
      });
      exhibition?.refreshGlassReflections();
    }
  }
  lightStudyUniform.value=trialVisible&&$('#projection-light-study')?.checked?1:0;
  groups?.lighting?.traverse(object=>{if(object.userData.controlledLens)object.material.color.set(lightStudyUniform.value?'#7e817c':'#fff8df');});
}
const trialName = () => trialLayout?.typographyStudy ? '字体试读' : '试排' + (trialLayout?.revision.match(/trial(\d+)/)?.[1] || '');
let eyeHeight=1.6, walkLensMm=35, stopLensMm=40;
const worldUp = new THREE.Vector3(0, 1, 0);
const state = { loaded: false, error: null };
const fitPoint = new THREE.Vector3();
const aZ = (x) => {
  const slope=data.ends.A.slope;
  return slope ? slope.leftZ+(slope.rightZ-slope.leftZ)*x/data.room.width : 0;
};
const leftPoints=()=>data.leftWallTurn?.points||[[0,aZ(0)],[0,data.room.length]];
function floorStartZ(x){const p=leftPoints();if(p.length<3||x>=p[0][0])return aZ(x);return Math.max(aZ(x),p[1][1]-(x/p[0][0])*(p[1][1]-p[0][1]));}
function leftBoundaryX(z){const p=leftPoints();return p.length<3||z>=p[1][1]?0:p[0][0]*(p[1][1]-z)/(p[1][1]-p[0][1]);}
function prism(name,poly,height,material,parent){const shape=new THREE.Shape();poly.forEach((p,i)=>i?shape.lineTo(...p):shape.moveTo(...p));shape.closePath();const geom=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,steps:1});geom.rotateX(Math.PI/2);const mesh=new THREE.Mesh(geom,material);mesh.position.y=height;mesh.name=name;parent.add(mesh);return mesh;}
function buildLighting(){
  if(!data.lighting)return;
  const d=data.lighting,white=new THREE.MeshStandardMaterial({color:0xf6f5f0,roughness:.6}),slot=new THREE.MeshBasicMaterial({color:0x62645f}),face=new THREE.MeshBasicMaterial({color:0xfff8df,toneMapped:false});
  const cylinder=new THREE.CylinderGeometry(d.headBodyRadius,d.headBodyRadius,d.headBodyLength,12),lens=new THREE.CircleGeometry(d.headBodyRadius*.88,12);
  d.rowPositions.forEach((z,row)=>{
    box('横轨_标高点位待测',d.railWidth,d.railThickness,d.railDepth,data.room.width/2,d.railHeight,z,white,groups.lighting);
    box('横轨黑槽',d.railWidth,.004,.014,data.room.width/2,d.railHeight-d.railThickness/2-.003,z,slot,groups.lighting);
    d.headXs.forEach((x,i)=>{
      box('长方适配器',.11,.045,.075,x,d.railHeight-.045,z,white,groups.lighting);
      box('短转轴与支架',.023,.065,.025,x,d.railHeight-.093,z,white,groups.lighting);
      const head=new THREE.Group();head.name='可倾斜白圆筒射灯_照片示意';head.position.set(x,d.railHeight-.15,z);if(trackWash){head.userData.trackIndices=[row,i];head.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0),trackWash.headAim(row,i));}
      else head.rotation.z=(x<data.room.width/2?-1:1)*(.38+(row+i)%3*.07);
      groups.lighting.add(head);
      head.add(new THREE.Mesh(cylinder,white));const controlled=trialLayout.lightingStudy?.controlledZone?.side==='both'&&z>=trialLayout.lightingStudy.controlledZone.fromZ;
      const disk=new THREE.Mesh(lens,controlled?face.clone():face);disk.userData.controlledLens=controlled&&(!trackWash||Math.min(i,d.headXs.length-1-i)<2);disk.position.y=-d.headBodyLength/2-.001;disk.rotation.x=Math.PI/2;head.add(disk);
    });
  });
}

function box(name, w, h, d, x, y, z, material, parent) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.name = name; mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
function segment(name, a, b, elevation, width, height, material, parent) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const mesh = box(name, Math.hypot(dx, dz), height, width, (a[0]+b[0])/2, elevation, (a[1]+b[1])/2, material, parent);
  mesh.rotation.y = -Math.atan2(dz, dx); return mesh;
}
function line(points, color, parent, dashed = false) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
  const material = dashed ? new THREE.LineDashedMaterial({color, dashSize:.13, gapSize:.1}) : new THREE.LineBasicMaterial({color});
  const mesh = new THREE.Line(geometry, material); if(dashed) mesh.computeLineDistances(); parent.add(mesh); return mesh;
}
function makeTileTexture(neutral = false) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = neutral ? '#ffffff' : '#d6d5ce'; ctx.fillRect(0,0,256,256);
  // Fine photographic-substrate texture, fixed seeded sequence for stable renders.
  let seed = 6041;
  for(let i=0;i<5500;i++) {seed=(Math.imul(seed,1664525)+1013904223)>>>0; const x=(seed>>>8)%256; seed=(Math.imul(seed,1664525)+1013904223)>>>0; const y=(seed>>>8)%256; ctx.fillStyle=neutral ? '#888888' : i%3?'#e5e3dc':'#b9bab2';ctx.globalAlpha=neutral ? .045 : .25;ctx.fillRect(x,y,1,1);}
  ctx.globalAlpha=1;
  const texture = new THREE.CanvasTexture(c); texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping; texture.repeat.set(1/data.tile.size,1/data.tile.size);
  texture.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8); return texture;
}
function build() {
  const {width:W,length:L,modelWallHeight:H,wallThickness:T}=data.room;
  const white = new THREE.MeshBasicMaterial({color:0xf9faf7,toneMapped:false});
  const floorMat = new THREE.MeshStandardMaterial({color:0xffffff,map:makeTileTexture(),roughness:.74});
  const metal = new THREE.MeshStandardMaterial({color:trialLayout.environment?.metalFinish?.color||0x707870,metalness:.32,roughness:.58});stripMaterial=metal;
  const green = new THREE.MeshStandardMaterial({color:0x466148,roughness:.67});
  const grout = new THREE.MeshBasicMaterial({color:0x9c9f96});
  trackWash=createTrackWash(data,trialLayout);
  for(const material of [white,floorMat,metal,green,grout]){
    const trafficSurface=[floorMat,grout,metal].includes(material);
    lightStudyMaterial(material,trafficSurface);
    if(material===white||trafficSurface)trackWash?.apply(material);
  }
  architectureMaterials={wall:white,floor:floorMat,grout,originalTileMap:floorMat.map,studyTileMap:makeTileTexture(true)};
  groups={shell:new THREE.Group(),tiles:new THREE.Group(),strips:new THREE.Group(),bars:new THREE.Group(),lighting:new THREE.Group(),dimensions:new THREE.Group(),endB:new THREE.Group()};
  Object.entries(groups).forEach(([name,group])=>{group.name=name;group.scale.z=-1;scene.add(group);});
  const lp=leftPoints(),startX=lp[0][0];
  const floorShape=new THREE.Shape();floorShape.moveTo(...lp[0]);floorShape.lineTo(W,aZ(W));floorShape.lineTo(W,L);floorShape.lineTo(0,L);if(lp.length>2)floorShape.lineTo(...lp[1]);floorShape.closePath();
  const floorGeometry=new THREE.ExtrudeGeometry(floorShape,{depth:.08,bevelEnabled:false,steps:1});floorGeometry.rotateX(Math.PI/2);
  const floor=new THREE.Mesh(floorGeometry,floorMat);floor.name='地面_斜端头_现有净宽暂估';groups.shell.add(floor);
  const normals=lp.slice(1).map((p,i)=>{const dx=p[0]-lp[i][0],dz=p[1]-lp[i][1],len=Math.hypot(dx,dz);return[-dz/len,dx/len];});
  const outer=lp.map((p,i)=>{let n=normals[Math.min(i,normals.length-1)];if(i>0&&i<lp.length-1){const prev=normals[i-1],den=1+prev[0]*n[0]+prev[1]*n[1];n=[(prev[0]+n[0])/den,(prev[1]+n[1])/den];}return[p[0]+T*n[0],p[1]+T*n[1]];});
  walls={left:prism('左墙_近A内收折段及主墙',lp.concat(outer.reverse()),H,white,groups.shell),right:box('右长墙',T,H,L-aZ(W),W+T/2,H/2,(L+aZ(W))/2,white,groups.shell)};
  for(let x=data.tile.originX;x<=W+1e-7;x+=data.tile.size) box('60cm砖缝_X',data.tile.grout,.0005,L-floorStartZ(x),x,.0003,(L+floorStartZ(x))/2,grout,groups.tiles);
  const slopeK=(aZ(W)-aZ(0))/W;
  const firstZ=Math.floor(Math.min(lp[0][1],aZ(W))/data.tile.size)*data.tile.size;
  for(let z=firstZ;z<=L+1e-7;z+=data.tile.size){let x1=Math.max(0,leftBoundaryX(z)),x2=W;if(slopeK>1e-8)x2=Math.min(W,(z-aZ(0))/slopeK);else if(slopeK< -1e-8)x1=Math.max(x1,(z-aZ(0))/slopeK);if(x2>x1)box('60cm砖缝_Z',x2-x1,.0005,data.tile.grout,(x1+x2)/2,.0003,z,grout,groups.tiles);}
  data.metalStrips.segments.forEach((s,i)=>segment(`金属条_${i+1}_待校准`,s.from,s.to,.0018,data.metalStrips.width,data.metalStrips.height,metal,groups.strips));
  data.crossbars.segments.forEach((s,i)=>segment(`横杆_${i+1}_待校准`,s.from,s.to,data.crossbars.height,data.crossbars.width,data.crossbars.depth,green,groups.bars));
  // Front opening plus adjacent door use independent photo-estimated geometry.
  const a=data.ends.A, opening=a.mainOpening, door=a.sideDoor;
  const theta=Math.atan2(aZ(W)-aZ(0),W),cosTheta=Math.cos(theta),span=(W-startX)/cosTheta,centerX=(W+startX)/2;
  const along=x=>(x-centerX)/cosTheta;
  const mainS=along(opening.x),sideS=along(door.x);
  const intervals=[[mainS-opening.width/2,mainS+opening.width/2],[sideS-door.width/2,sideS+door.width/2]].sort((a,b)=>a[0]-b[0]);
  let last=-span/2; const entrance=new THREE.Group(); entrance.name='A口斜端墙_斜角待测';entrance.position.set(centerX,0,aZ(centerX));entrance.rotation.y=-theta;groups.shell.add(entrance);
  intervals.forEach(([x1,x2])=>{if(x1>last)box('入口端墙垛',x1-last,H,T,(last+x1)/2,H/2,-T/2,white,entrance);last=x2;});
  if(last<span/2)box('入口端墙垛',span/2-last,H,T,(last+span/2)/2,H/2,-T/2,white,entrance);
  if(door.height<H)box('侧门上过梁',door.width,H-door.height,T,sideS,(H+door.height)/2,-T/2,white,entrance);
  const doorMat=new THREE.MeshStandardMaterial({color:0xe0e0d8,roughness:.85});
  box('侧门_照片示意',door.width-.02,door.height-.01,.025,sideS,door.height/2,.005,doorMat,entrance);
  line([[sideS-door.width/2,.01,.024],[sideS-door.width/2,door.height,.024],[sideS+door.width/2,door.height,.024],[sideS+door.width/2,.01,.024]],0x8c948a,entrance);
  // End B stays a contour: no opaque rear wall, and no invented opening action.
  line([[0,0,L],[0,H,L],[W,H,L],[W,0,L],[0,0,L]],0x98a18f,groups.endB,true);
  data.ends.B.panelDivisions.forEach(x=>line([[x,0,L],[x,H,L]],0x98a18f,groups.endB,true));
  groups.endB.name='B口_421SPACE_开合未知_仅轮廓';
  const dc=0x637460;
  line([[W+.55,0,0],[W+.55,0,L]],dc,groups.dimensions);
  for(let z=0;z<=L+.001;z+=data.tile.size*5)line([[W+.45,0,z],[W+.65,0,z]],dc,groups.dimensions);
  const widthDimZ=Math.min(aZ(0),aZ(W))-.65;
  line([[0,0,widthDimZ],[W,0,widthDimZ]],dc,groups.dimensions);
  [0,W].forEach(x=>line([[x,0,widthDimZ-.12],[x,0,widthDimZ+.12]],dc,groups.dimensions));
  line([[W+.45,0,0],[W+.45,H,0]],dc,groups.dimensions);
  [0,H].forEach(y=>line([[W+.34,y,0],[W+.56,y,0]],dc,groups.dimensions));
  buildLighting();
  const ambient=new THREE.HemisphereLight(0xffffff,0xb1b3a5,2.1);scene.add(ambient);
  const sunlight=new THREE.DirectionalLight(0xffffff,2.5);sunlight.position.set(-8,19,7);scene.add(sunlight);
  const fill=new THREE.DirectionalLight(0xffffff,1.1);fill.position.set(12,9,-25);scene.add(fill);
  roomLights={ambient,sunlight,fill};
  scene.userData={source:data.revision,measuredRoom:data.room,coordinates:'canonical depth maps to negative world Z, matching the native GLB',physicalSpotlightHeight:'above 2.95m; rail3.30m illustrative, not surveyed',note:'render lights are preview illumination, not physical fixtures'};
  walkPosition=new THREE.Vector3(W/2,eyeHeight,-.9);
  $('#position').max=(L-.3).toFixed(1);
  $('#length-value').textContent=`${L} m`;
  $('#width-value').textContent=`约${W} m`;
}
function createControls() {
  framedInspection=null;responsiveGroup=null;
  controls?.dispose();controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.1;controls.minDistance=.5;controls.maxDistance=100;controls.maxPolarAngle=Math.PI*.49;controls.enableRotate=view!=='plan';
  controls.addEventListener('start',()=>{framedInspection=null;responsiveGroup=null;});
  controls.addEventListener('change',()=>{updateCutaway();updateLabels();});
}
function fitOverview() {
  const W=data.room.width,L=data.room.length,H=Math.max(data.room.modelWallHeight,data.lighting?.railHeight||0), aspect=host.clientWidth/host.clientHeight;
  camera=new THREE.PerspectiveCamera(42,aspect,.025,250);camera.up.copy(worldUp);
  const nearEnd=Math.min(aZ(0),aZ(W)),target=new THREE.Vector3(W/2,.8,-(L+nearEnd)/2);
  const direction=new THREE.Vector3(...(aspect<1.2?[.27,.57,.78]:[.8,.62,.12])).normalize();
  camera.position.copy(target).addScaledVector(direction,45);camera.lookAt(target);camera.updateMatrixWorld();
  const inverse=camera.quaternion.clone().invert(), tV=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),tH=tV*aspect;
  let distance=1;
  for(const x of [-.8,W+.8])for(const y of [0,H])for(const z of [-L-1,-nearEnd+1]){fitPoint.set(x,y,z).sub(target).applyQuaternion(inverse);distance=Math.max(distance,Math.abs(fitPoint.x)/tH+fitPoint.z,Math.abs(fitPoint.y)/tV+fitPoint.z);}
  camera.position.copy(target).addScaledVector(direction,distance*1.19);camera.lookAt(target);
  createControls();controls.target.copy(target);controls.update();
}
function setView(next) {
  $('#focus-group').value='';
  updateComparisonLink();
  view=next;inspectionFrame=null;pressed.clear();pointerStart=null;
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
  const walking=view==='entry'||view==='reverse';$('#walk-controls').hidden=!walking;
  if(next==='overview'){fitOverview();$('#hint').textContent='拖动旋转 · 滚轮缩放 · 右键平移';}
  else if(next==='plan'){
    const aspect=host.clientWidth/host.clientHeight,L=data.room.length,W=data.room.width;
    const nearEnd=Math.min(aZ(0),aZ(W)),mid=(L+nearEnd)/2,halfW=Math.max((L-nearEnd+4)/2,(W+3)*aspect/2),halfH=halfW/aspect;
    camera=new THREE.OrthographicCamera(-halfW,halfW,halfH,-halfH,.01,100);camera.position.set(W/2,30,-mid);camera.up.set(-1,0,0);camera.lookAt(W/2,0,-mid);
    createControls();controls.target.set(W/2,0,-mid);controls.update();$('#hint').textContent='60 cm砖格 · 滚轮缩放 · 右键平移';
  }else if(next==='portal'){
    camera=visitorCamera(walkLensMm,58,35);
    const x=data.ends.A.mainOpening.x,theta=THREE.MathUtils.degToRad(data.ends.A.slope?.angleDegrees||0),normal=new THREE.Vector3(-Math.sin(theta),0,-Math.cos(theta)),center=new THREE.Vector3(x,eyeHeight,-aZ(x));
    camera.position.copy(center).addScaledVector(normal,-2.7);const target=center.clone().addScaledVector(normal,4);camera.lookAt(target);
    createControls();controls.target.copy(target);controls.update();$('#hint').textContent='A口外看入 · 主入口净宽 1.70 m';
  }else{
    camera=visitorCamera(walkLensMm,62,35);createControls();controls.enabled=false;
    walkPosition.set(data.room.width/2,eyeHeight,next==='entry'?-.9:-data.room.length+.9);yaw=next==='entry'?Math.PI:0;pitch=0;updateWalk();
    $('#hint').textContent='拖动转头 · W A S D 或方向键行走';
  }
  $('#cutaway').disabled=!['overview','plan'].includes(next);
  $('#status').textContent=walking?('眼高 '+eyeHeight.toFixed(2)+' m · 拖动转头'):next==='plan'?'右墙31.2 m · 左墙更长，差值待测':next==='portal'?'A口斜墙 · 门套进深与斜角待校准':'现有展墙内净空 · A口斜角待测';
  updateCutaway();updateLabels();
  if(walking)host.focus({preventScroll:true});
}
function updateWalk(){camera.position.copy(walkPosition);camera.lookAt(walkPosition.x+Math.sin(yaw)*Math.cos(pitch),eyeHeight+Math.sin(pitch),walkPosition.z+Math.cos(yaw)*Math.cos(pitch));$('#position').value=(-walkPosition.z).toFixed(1);$('#position-value').textContent=`${(-walkPosition.z).toFixed(1)} m`;updateLabels();}
function updateCutaway(){
  if(!walls||!camera)return;
  const cut=$('#cutaway').checked&&(view==='overview'||view==='plan');
  walls.left.visible=!cut||camera.position.x>=0;walls.right.visible=!cut||camera.position.x<=data.room.width;
  if(exhibition)for(const object of exhibition.works.values()){
    const sid=object.userData.layout?.surfaceId;
    const surface=exhibition.surfaces.get(sid);
    object.visible=surface?.kind==='existing'?(surface.normal[0]>0?walls.left.visible:walls.right.visible):true;
  }
  if(exhibition?.environmentFields)for(const object of exhibition.environmentFields.values()){if(object.userData.kind==='wallField'){const n=object.userData.canonicalNormal;object.visible=n?.[0]>0?walls.left.visible:walls.right.visible;}}
  if(exhibition?.poemGroups)for(const object of exhibition.poemGroups.values()){const n=object.userData.canonicalNormal;if(!object.userData.layout?.textScreenId&&!object.userData.layout?.glassPanelId&&object.userData.kind==='wallPoem'&&Math.abs(n?.[0]||0)>.9)object.visible=n[0]>0?walls.left.visible:walls.right.visible;}
}

function setTrialVisible(value){
  trialVisible=value;exhibition?.setVisible(value);
  applyFinish();
  $('#trial-on').setAttribute('aria-pressed',String(value));$('#trial-off').setAttribute('aria-pressed',String(!value));
  $('#focus-group').disabled=!value;
  $('#trial-description').hidden=!value;
  $('#finish-study').disabled=!value;
  updateCutaway();
}
function applyFinish(id=selectedFinishId){
  if(!architectureMaterials)return;
  const palette=trialLayout.environment?.finishStudies?.find(p=>p.id===id);
  if(palette)selectedFinishId=palette.id;
  const active=trialVisible&&palette;
  architectureMaterials.wall.color.set(active?palette.wall:0xf9faf7);
  architectureMaterials.floor.color.set(active?palette.floor:0xffffff);
  architectureMaterials.floor.map=active?architectureMaterials.studyTileMap:architectureMaterials.originalTileMap;
  architectureMaterials.floor.needsUpdate=true;
  architectureMaterials.grout.color.set(active?palette.grout:0x9c9f96);
  stripMaterial?.color.set(active?palette.metal:0x707870);
  if(active)exhibition?.setFinish?.(palette);
  const select=$('#finish-study');if(select&&palette)select.value=palette.id;
  $('#finish-note').textContent=active?`${palette.label} · 环境试色，作品原图与白卡保持原色`:'空场 · 原有地砖与金属示意色';
  const swatches=$('#finish-swatches');swatches.replaceChildren();
  if(active)for(const [key,label]of [['wall','摄影墙'],['glassWall','玻璃区'],['floor','地面'],['metal','金属线']]){
    const item=document.createElement('span');const chip=document.createElement('i');chip.style.backgroundColor=palette[key];item.append(chip,document.createTextNode(label));swatches.append(item);
  }
  scene.userData.activeFinish=active?palette.id:'empty-baseline';
  updateLightStudy();
}
// The single-work shortcut selects a reachable viewing distance for the frame.
function frameSelectedWork(focus, work) {
  const {outerWidth,outerHeight,depth=0}=work;
  const [x,y,z]=focus.target, [nx,nz]=focus.normal;
  const target=new THREE.Vector3(x,y,-z);
  const corners=[];
  for(const u of [-outerWidth/2,outerWidth/2])for(const v of [-outerHeight/2,outerHeight/2]){
    corners.push(new THREE.Vector3(x+nz*u+nx*depth,y+v,-z+nx*u-nz*depth));
  }
  const aspect=camera.aspect;
  const tangent=filmDiagonalMm/(2*camera.userData.visitorLens.detailMm*Math.hypot(1,aspect));
  const probe=new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2*Math.atan(tangent)),aspect,.025,120);
  // Choose the same station for either lens so a toggle only changes the field of view.
  let distance=focus.distance;
  for(;;){
    probe.position.set(x+nx*distance,eyeHeight,-(z+nz*distance));
    probe.lookAt(target);probe.updateMatrixWorld();
    const fits=corners.every(corner=>{
      const point=corner.clone().project(probe);
      return point.z>0&&Math.abs(point.x)<=.84&&Math.abs(point.y)<=.84;
    });
    if(fits)break;
    const next=distance+.04, px=x+nx*next, pz=z+nz*next;
    if(next>data.room.length||px<leftBoundaryX(pz)+walkBodyRadius||px>data.room.width-walkBodyRadius||
       pz<floorStartZ(px)+walkBodyRadius||pz>data.room.length-walkBodyRadius||hitsDisplay(px,pz))break;
    distance=next;
  }
  camera.position.copy(probe.position);
  controls.target.copy(target);
  controls.update();
}

function focusOnWork(id){
  const focus=exhibition?.focusTarget(id);if(!focus)return;
  setTrialVisible(true);inspectionFrame=null;pressed.clear();pointerStart=null;view='inspection';
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));
  $('#walk-controls').hidden=true;$('#cutaway').disabled=true;
  camera=visitorCamera(stopLensMm,58,40);
  camera.position.set(focus.position[0],eyeHeight,-focus.position[2]);
  const target=new THREE.Vector3(focus.target[0],focus.target[1],-focus.target[2]);camera.lookAt(target);
  createControls();controls.target.copy(target);controls.maxPolarAngle=Math.PI*.65;controls.update();
  const work=exhibition.works.get(id)?.userData.layout;
  if(work?.outerWidth&&work.outerHeight){
    framedInspection={focus,work};
    frameSelectedWork(focus,work);
  }
  $('#focus-group').value='';updateComparisonLink();
  $('#hint').textContent='拖动环看 · 滚轮缩放 · 选择另一组继续看';
  $('#status').textContent=`${trialName()} · ${catalogWorkTitle(library.items.find(w=>w.id===id),trialLayout)||'前言位置'}`;
  $('#catalog-panel').hidden=true;$('#catalog-button').setAttribute('aria-expanded','false');
  updateCutaway();updateLabels();
}
function setGroupPose(pose, framing){
  const y=camera.userData.visitorLens&&/trial(?:21|22)$/.test(trialLayout.revision)?(pose.eyeOverride??eyeHeight):pose.camera[1];
  camera.position.set(pose.camera[0],y,-pose.camera[2]);
  const target=new THREE.Vector3(pose.target[0],pose.target[1],-pose.target[2]);
  camera.lookAt(target);
  if(framing?.wallExtent && camera.isPerspectiveCamera){
    // Whole-wall lettering needs headroom below the visitor controls, even on a wide screen.
    camera.updateMatrixWorld(true);
    const {center:[x,y,z],width,height}=framing.wallExtent;
    const wallFit={horizontal:0,vertical:0};
    for(const u of [-width/2,width/2])for(const v of [-height/2,height/2]){
      const corner=new THREE.Vector3(x,y+v,-z-u).applyMatrix4(camera.matrixWorldInverse);
      wallFit.horizontal=Math.max(wallFit.horizontal,Math.abs(corner.x/corner.z)/.88);
      wallFit.vertical=Math.max(wallFit.vertical,Math.abs(corner.y/corner.z)/.75);
    }
    camera.userData.visitorLens.wallFit=wallFit;
    applyVisitorLens(camera,camera.aspect);
  }
  return target;
}

function offerSecondView(id){
  const cues={
    'entry-foreword':['entry-foreword-read','入口前言','走近读正文'],
    'entry-foreword-read':['entry-foreword','前言正文','退后看整面墙'],
    'language-split-word':['language-split-lower','玻璃上的“横”与墙上的“亘”','将视线放低 15 厘米'],
    'language-split-lower':['language-split-word','两个字在此处齐平','回到 1.75 米站姿'],
    'curation-river-ink':['curation-river-ink-side','河流的英文灰墨','沿墙侧看'],
    'curation-river-ink-side':['curation-river-ink','河流的英文灰墨','回到正面']
  };
  if(!cues[id])return;
  const [next,caption,label]=cues[id];
  const url=new URL(location.href);url.searchParams.set('focus',next);
  const link=document.createElement('a');link.href=url.href;link.textContent=label;
  link.addEventListener('click',event=>{
    if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    if(id.startsWith('entry-foreword'))moveToForewordView(next);
    else focusOnGroup(next);
    $('#hint a')?.focus({preventScroll:true});
  });
  $('#hint').replaceChildren(document.createTextNode(caption+'　'),link);
}

function moveToForewordView(id){
  const from=camera.position.clone(), fromTarget=controls.target.clone(), fromFov=camera.fov;
  focusOnGroup(id);
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const cam=camera, orbit=controls, to=cam.position.clone(), toTarget=orbit.target.clone();
  const toFov=cam.fov, started=performance.now(), aspect=cam.aspect, mode=lensMode;
  let cancelled=false;
  const stop=()=>{cancelled=true;};
  orbit.addEventListener('start',stop);
  function step(now){
    if(cam!==camera||cancelled||cam.aspect!==aspect||lensMode!==mode){
      orbit.removeEventListener('start',stop);
      if(cam===camera&&cancelled)applyVisitorLens(cam,cam.aspect);
      return;
    }
    const t=Math.min(1,(now-started)/750), eased=t*t*(3-2*t);
    cam.position.lerpVectors(from,to,eased);
    orbit.target.lerpVectors(fromTarget,toTarget,eased);
    cam.fov=THREE.MathUtils.lerp(fromFov,toFov,eased);
    cam.updateProjectionMatrix();orbit.update();
    if(t<1)requestAnimationFrame(step);
    else orbit.removeEventListener('start',stop);
  }
  step(started);
}

function focusOnGroup(id){
  let group=trialLayout.focusGroups.find(g=>g.id===id);
  if(!group&&id.startsWith('blank-')){const i=Number(id.split('-')[1]),blank=trialLayout.blankWallIntervals?.[i];if(blank)group={id,label:`主墙停顿${i+1} · 约${blank.length.toFixed(1)}米`,workIds:[i?'once_26':'once_20'],surfaceId:blank.surfaceId,side:'left',emptyRange:[blank.from,blank.to]};}
  if(!group)return;
  $('#focus-group').value=id;updateComparisonLink(id);
  if(group.camera){
    setTrialVisible(true);inspectionFrame=null;pressed.clear();pointerStart=null;view='inspection';
    document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));
    $('#walk-controls').hidden=true;$('#cutaway').disabled=true;
    const aspect=host.clientWidth/host.clientHeight;
    const mobileFloorInvitation=host.clientWidth<600&&group.id==='spatial-normal-threshold';
    const perspectiveStudy=group.framing?.projection==='perspective';
    if(!mobileFloorInvitation&&!perspectiveStudy&&(group.framing?.projection==='orthographic'||(host.clientWidth<600&&!/trial(?:19|20|21|22)$/.test(trialLayout.revision)))){inspectionFrame={width:group.framing?.width||3.2,height:group.framing?.height||3.1};const h=Math.max(inspectionFrame.height/2,inspectionFrame.width/2/aspect);camera=new THREE.OrthographicCamera(-h*1.12*aspect,h*1.12*aspect,h*1.28,-h*.96,.025,120);}else camera=visitorCamera(stopLensMm,mobileFloorInvitation?90:58,40);camera.up.copy(worldUp);
    if(group.cameraUp)camera.up.set(group.cameraUp[0],group.cameraUp[1],-group.cameraUp[2]);
    const portrait=aspect<.85;
    const target=setGroupPose(portrait&&group.portrait?group.portrait:group,group.framing);
    const textScreen=trialLayout.textScreens?.find(screen=>screen.id===group.framing?.screenId||id==='spatial-'+screen.id.replace('poetry-',''));
    if(textScreen&&camera.isPerspectiveCamera){
      // The original wide-angle reference includes the pane and its base.
      camera.updateMatrixWorld(true);
      const tangents={horizontal:0,vertical:0};
      const halfWidth=Math.max(textScreen.width,textScreen.baseWidth)/2;
      for(const x of [textScreen.x-halfWidth,textScreen.x+halfWidth])for(const y of [0,textScreen.bottom+textScreen.height])for(const z of [textScreen.z-textScreen.baseDepth/2,textScreen.z+textScreen.baseDepth/2]){
        const corner=new THREE.Vector3(x,y,-z).applyMatrix4(camera.matrixWorldInverse);
        if(corner.z<0){
          tangents.horizontal=Math.max(tangents.horizontal,Math.abs(corner.x/corner.z));
          tangents.vertical=Math.max(tangents.vertical,Math.abs(corner.y/corner.z));
        }
      }
      camera.userData.visitorLens.paneTangents=tangents;
      applyVisitorLens(camera,aspect);
    }
    createControls();
    // Preserve the authored eye position when the perspective target is below eye level.
    if(perspectiveStudy||camera.userData.visitorLens&&/trial(?:21|22)$/.test(trialLayout.revision))controls.maxPolarAngle=Math.PI*.90;
    if(group.id==='spatial-ceiling-language')controls.maxPolarAngle=Math.PI-.04;
    controls.target.copy(target);controls.update();
    if(group.portrait)responsiveGroup={group,portrait};
    $('#status').textContent=(trialName()+' · ')+group.label;$('#hint').textContent=group.id==='spatial-ceiling-language'?'顶部试字 · 暂用3.6 m附着标高，实际顶高待测':perspectiveStudy&&textScreen?'横在玻璃，亘在远处白墙 · 拖动侧看，感受前后距离':'拖动环看 · 滚轮或双指缩放';
    if(/trial(?:21|22)$/.test(trialLayout.revision))offerSecondView(id);
    $('#catalog-panel').hidden=true;$('#catalog-button').setAttribute('aria-expanded','false');updateCutaway();updateLabels();return;
  }
  let members=group.workIds.map(w=>exhibition.works.get(w)?.userData).filter(Boolean);
  if(group.emptyRange)members=[{canonicalPosition:[.025,1.45,(group.emptyRange[0]+group.emptyRange[1])/2],layout:{outerWidth:group.emptyRange[1]-group.emptyRange[0],outerHeight:2.2,surfaceId:group.surfaceId}}];
  const selected=group.workIds.find(w=>exhibition.works.has(w));if(!selected)return;
  focusOnWork(selected);
  $('#focus-group').value=id;updateComparisonLink(id);
  const targets=members.map(w=>w.canonicalPosition);
  const widths=members.map(w=>w.layout.outerWidth||w.layout.width||.6),heights=members.map(w=>w.layout.outerHeight||w.layout.height||1);
  const surface=exhibition.surfaces.get(group.surfaceId||members[0]?.layout.surfaceId);
  const direction=surface?.direction||[0,1],normal=surface?.normal||(group.side==='right'?[-1,0]:[1,0]);
  const projected=targets.map(p=>p[0]*direction[0]+p[2]*direction[1]);
  const hMin=Math.min(...projected.map((v,i)=>v-widths[i]/2)),hMax=Math.max(...projected.map((v,i)=>v+widths[i]/2));
  const yMin=Math.min(...targets.map((p,i)=>p[1]-heights[i]/2)),yMax=Math.max(...targets.map((p,i)=>p[1]+heights[i]/2));
  let x=targets.reduce((sum,p)=>sum+p[0],0)/targets.length,z=targets.reduce((sum,p)=>sum+p[2],0)/targets.length;
  const mid=(hMin+hMax)/2,current=x*direction[0]+z*direction[1];x+=(mid-current)*direction[0];z+=(mid-current)*direction[1];
  const target=new THREE.Vector3(x,(yMin+yMax)/2,-z);
  inspectionFrame={width:hMax-hMin+.65,height:yMax-yMin+.65};
  const aspect=host.clientWidth/host.clientHeight,halfH=Math.max(inspectionFrame.height/2,inspectionFrame.width/2/aspect);
  camera=new THREE.OrthographicCamera(-halfH*1.12*aspect,halfH*1.12*aspect,halfH*1.28,-halfH*.96,.025,120);camera.up.copy(worldUp);
  const distance=group.viewingDistance||(surface?.kind==='partition'?2.1:3.8);
  camera.position.copy(target).add(new THREE.Vector3(normal[0]*distance,0,-normal[1]*distance));camera.lookAt(target);
  createControls();controls.target.copy(target);controls.maxPolarAngle=Math.PI*.65;controls.update();
  $('#hint').textContent='组合正视 · 滚轮缩放 · 拖动环看';
  $('#status').textContent=`${trialName()} · ${group.label}`;updateCutaway();updateLabels();
}
const walkBodyRadius=.30; // Preview body envelope; no crowd or construction claim.
function hitsDisplay(x,z){return trialVisible&&exhibition?.collisionRects.some(r=>x>r.minX-walkBodyRadius&&x<r.maxX+walkBodyRadius&&z>r.minZ-walkBodyRadius&&z<r.maxZ+walkBodyRadius);}
function updateLabels(){
  if(!camera||!data)return;
  const enabled=$('#dimensions').checked,W=data.room.width,L=data.room.length;
  const positions=[['#label-a',[W/2,.1,-aZ(W/2)+.85]],['#label-b',[W/2,.1,-L-.85]],['#label-short',[W+.95,.01,-L/2]],['#label-long',[-.65,.01,-(L+aZ(0))/2]]];
  camera.updateMatrixWorld();
  for(const [selector,p]of positions){
    const el=$(selector),v=new THREE.Vector3(...p).project(camera);let x=(v.x*.5+.5)*host.clientWidth,y=(-v.y*.5+.5)*host.clientHeight;
    const wallLabel=selector==='#label-short'||selector==='#label-long';
    if(view==='plan'&&!wallLabel){x=THREE.MathUtils.clamp(x,90,host.clientWidth-100);y=host.clientHeight/2+host.clientWidth/L*4.6;}
    el.hidden=!enabled||view==='inspection'||(wallLabel&&view!=='plan')||v.z< -1||v.z>1||x<65||x>host.clientWidth-65||y<118||y>host.clientHeight-38;
    el.style.left=`${x}px`;el.style.top=`${y}px`;
  }
}
function resize(){
  if(!renderer||!camera)return;
  const w=host.clientWidth,h=host.clientHeight;
  if(!w||!h)return;
  renderer.setSize(w,h);
  if(view==='overview'){fitOverview();return;}
  if(view==='plan'){setView('plan');return;}
  const aspect=w/h;
  if(camera.isOrthographicCamera&&inspectionFrame){
    const halfH=Math.max(inspectionFrame.height/2,inspectionFrame.width/2/aspect);
    camera.left=-halfH*1.12*aspect;camera.right=halfH*1.12*aspect;
    camera.top=halfH*1.28;camera.bottom=-halfH*.96;
    camera.updateProjectionMatrix();
  }else if(camera.userData.visitorLens){
    applyVisitorLens(camera,aspect);
    if(framedInspection)frameSelectedWork(framedInspection.focus,framedInspection.work);
    if(responsiveGroup&&responsiveGroup.portrait!==(aspect<.85)){
      responsiveGroup.portrait=aspect<.85;
      controls.target.copy(setGroupPose(responsiveGroup.portrait?responsiveGroup.group.portrait:responsiveGroup.group,responsiveGroup.group.framing));
      controls.update();
    }
  }
  updateLabels();
}
function animate(now){raf=requestAnimationFrame(animate);const dt=Math.min((now-previousTime)/1000,.05);previousTime=now;if((view==='entry'||view==='reverse')&&!poetryEditor?.active){let forward=0,side=0;if(pressed.has('w')||pressed.has('arrowup'))forward++;if(pressed.has('s')||pressed.has('arrowdown'))forward--;if(pressed.has('d')||pressed.has('arrowright'))side++;if(pressed.has('a')||pressed.has('arrowleft'))side--;if(forward||side){const speed=(pressed.has('shift')?3:1.6)*dt/Math.max(1,Math.hypot(forward,side));const oldX=walkPosition.x,oldZ=walkPosition.z;const nextX=THREE.MathUtils.clamp(oldX+(Math.sin(yaw)*forward-Math.cos(yaw)*side)*speed,Math.max(walkBodyRadius,leftBoundaryX(-oldZ)+walkBodyRadius),data.room.width-walkBodyRadius);if(!hitsDisplay(nextX,-oldZ))walkPosition.x=nextX;const nextZ=THREE.MathUtils.clamp(oldZ+(Math.cos(yaw)*forward+Math.sin(yaw)*side)*speed,-data.room.length+.3,-floorStartZ(walkPosition.x)-.3);if(!hitsDisplay(walkPosition.x,-nextZ))walkPosition.z=nextZ;updateWalk();}}else controls.update();poetryEditor?.update();renderer.render(scene,camera);}


function focusPoetryEntry(entry){
  view='inspection';pressed.clear();pointerStart=null;$('#walk-controls').hidden=true;
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));
  entry.object.updateWorldMatrix(true,false);
  const target=new THREE.Vector3(entry.offsetX,entry.offsetY,0).applyMatrix4(entry.object.matrixWorld);
  const normal=new THREE.Vector3(0,0,1).transformDirection(entry.object.matrixWorld);
  const up=new THREE.Vector3(0,1,0).transformDirection(entry.object.matrixWorld);
  const isFloor=entry.record.surface==='floor';
  if(!isFloor)target.y=1.45;
  const scale=poetryEditor?.model.get(entry.record.id).scale||1;
  inspectionFrame={width:Math.max(3.1,entry.width*scale+1.3),height:Math.max(3.1,entry.height*scale+1.2)};
  const aspect=host.clientWidth/host.clientHeight,h=Math.max(inspectionFrame.height/2,inspectionFrame.width/2/aspect);
  camera=new THREE.OrthographicCamera(-h*1.12*aspect,h*1.12*aspect,h*1.28,-h*.96,.025,120);
  camera.up.copy(up);camera.position.copy(target).addScaledVector(normal,isFloor?2.7:2.8);camera.lookAt(target);
  createControls();controls.target.copy(target);controls.maxPolarAngle=Math.PI-.02;controls.update();
  updateCutaway();updateLabels();
}

async function init(){try{
  const requestedTrial=new URLSearchParams(location.search).get('trial');
  const typeMode=new URLSearchParams(location.search).get('type');
  const typographyStudy=typeMode==='study';
  const previousTypography=typeMode==='study1'||typeMode==='study2';
  const typographyCompare=typographyStudy||previousTypography||typeMode==='base';
  const baseline=['09','10','11','12','13','14','15','16','17','18','19','20','21'].includes(requestedTrial)?requestedTrial:null;
  const requestedLens=new URLSearchParams(location.search).get('lens');
  const comparingCurrent=!typographyCompare&&(!baseline||['19','20','21'].includes(baseline));
  lensMode=['natural','wide','detail'].includes(requestedLens)?requestedLens:comparingCurrent?'natural':'wide';
  $('#viewer-lens').value=lensMode;
  $('#viewer-lens').addEventListener('change',event=>{
    lensMode=event.target.value;
    if(camera?.userData.visitorLens)applyVisitorLens(camera,host.clientWidth/host.clientHeight);
    const url=new URL(location.href);
    url.searchParams.set('lens',lensMode);
    history.replaceState(null,'',url);
    updateComparisonLink($('#focus-group').value);
    updateLabels();
  });
  const layoutURL=typographyStudy?'layouts/typography-study.json':typeMode==='study2'?'layouts/typography-study-20261108-mixed.json':previousTypography?'layouts/typography-study-20261107.json':baseline?'layouts/trial'+baseline+'.json':'layout.json';
  const responses=await Promise.all([baseline&&['09','10'].includes(baseline)?'layouts/space-trial10.json':'space.json',layoutURL,'catalog.json'].map(path=>fetch(path+'?v='+viewerVersion,{cache:'no-store'})));
  if(responses.some(r=>!r.ok))throw new Error('空间或试排数据读取失败');
  const inputTexts=await Promise.all(responses.map(r=>r.text()));
  [data,trialLayout,library]=inputTexts.map(text=>JSON.parse(text));
  // Compare the retained and current layout from the same positions. These
  // viewing aids do not rewrite either layout or its verified source bytes.
  const visitorOptics=/trial(?:21|22)$/.test(trialLayout.revision);
  const currentRiver=visitorOptics||trialLayout.revision.endsWith('trial20');
  if(visitorOptics){eyeHeight=1.75;walkLensMm=30;stopLensMm=35;}
  if(!visitorOptics&&lensMode==='detail')lensMode='natural';
  $('#viewer-lens').querySelector('[value="detail"]').hidden=!visitorOptics;
  $('#viewer-lens').value=lensMode;
  $('#lens-note').textContent='站姿眼高 '+eyeHeight.toFixed(2)+' m。自然视角按全画幅折算，步行 '+walkLensMm+' mm，停看 '+stopLensMm+' mm。';
  if(/trial(?:18|19|20|21|22)$/.test(trialLayout.revision)){
    const sharedViews=[
      {id:'curation-opening',label:'开篇 · 摄影组合正视',camera:[3.8,1.5,2.7],target:[0,1.5,2.7],framing:{projection:'orthographic',width:5.4,height:3.2}},
      {id:'curation-opening-walk',label:'开篇 · 人眼看摄影与文字',camera:[3.6,1.6,1.4],target:[0,1.48,2.02],portrait:{camera:[4.40,1.6,1.4],target:[0,1.48,1.39]},framing:{projection:'perspective'}},
      {id:'curation-river-walk',label:'河流 · 人眼看柱廊与文字',camera:[1.6,1.6,11.6],target:[4.967,1.65,13.9],framing:{projection:'perspective'}},
      {id:'curation-between-walk',label:'之间 · 人眼看前段留白',camera:[3.6,1.6,3],target:[0,1.15,4.8],framing:{projection:'perspective'}},
      {id:'curation-moon-walk',label:'月亮 · 从玻璃区回望',camera:[2.72,1.6,21.5],target:[4.06,1.86,18.732],framing:{projection:'perspective'}},
      {id:'book-river-wall',label:'河流 · 文字与两侧图像',camera:[1.7,1.55,13.9],target:[5,1.55,13.9],framing:{projection:'orthographic',width:5.7,height:3}},
      {id:'book-between',label:'之间 · 前段留白对照',camera:[3.6,1.45,5.35],target:[0,1.45,5.35],framing:{projection:'orthographic',width:4.3,height:3.2}},
    ];
    const currentRiverIds={'book-river-wall':'curation-river-wide','curation-river-walk':'curation-river-forward'};
    if(/trial(?:19|20|21|22)$/.test(trialLayout.revision)){
      const perspective={projection:'perspective'};
      sharedViews.push(
        {id:'curation-world',label:'已经发生的世界 · 活动板前',camera:[2.55,1.6,10.78],target:[.15,1.34,12.76],framing:perspective},
        {id:'curation-river-wide',label:'河流 · 从对墙读',camera:[.84,1.6,16.5],target:[4.96,1.36,16.64],framing:perspective},
        {id:'curation-river-forward',label:'河流 · 从A口走来',camera:[2.3,1.6,14.25],target:[4.96,1.38,16.35],framing:perspective},
        {id:'curation-river-return',label:'河流 · 在板端回身',camera:[2.15,1.6,18.28],target:[4.96,1.33,16.80],framing:perspective},
        {id:'curation-far-waves-walk',label:'更远的浪 · 沿墙走近',camera:[2.1,1.6,13.05],target:[.05,1.54,14.57],framing:perspective},
        {id:'book-far-waves-print',label:'更远的浪 · 走到纸前',camera:[.86,1.6,14.48],target:[.02,1.55,14.45],framing:perspective},
        {id:'curation-ending-walk',label:'他们再也看不见我 · 图缝与末段',camera:[3.12,1.6,23.95],target:[.1,1.43,25.06],framing:perspective}
      );
      if(currentRiver){
        sharedViews.push(
          {id:'curation-mountains-walk',label:'群山 · 看两幅床照之间',camera:[2.30,1.6,9.70],target:[4.96,1.52,9.715],framing:perspective},
          {id:'curation-corridor',label:'连廊 · 从中央看两侧展墙',camera:[2.52,1.6,6.35],target:[3.00,1.64,14.7],framing:perspective},
          {id:'curation-river-ink',label:visitorOptics?'河流 · 近看英文灰墨':'河流 · 近看原挂位',camera:[3.25,1.6,17.64],target:[4.96,.89,17.75],framing:perspective}
        );
      }
      if(visitorOptics){
        sharedViews.push({id:'curation-river-ink-side',menuHidden:true,label:'河流 · 从侧面看灰墨',camera:[4.00,1.75,16.45],target:[4.96,.82,17.93],framing:perspective});
        const glass=trialLayout.focusGroups.find(g=>g.id==='language-split-word');
        if(glass)sharedViews.push({...glass,id:'language-split-lower',label:'横／亘 · 在原地稍低视线',eyeOverride:1.60});
      }
      for(const [legacy,current] of Object.entries(currentRiverIds)){
        const oldView=sharedViews.find(g=>g.id===legacy);
        // A comparison from an archived river view must keep the old camera.
        const oldId='previous-'+legacy;
        sharedViews.push({...oldView,id:oldId,menuHidden:true});
        if(currentRiver)Object.assign(oldView,sharedViews.find(g=>g.id===current),{id:legacy,menuHidden:true,compareFocus:current});
        else oldView.compareFocus=oldId;
      }
    }else{
      for(const legacy of Object.keys(currentRiverIds))sharedViews.find(g=>g.id===legacy).compareFocus='previous-'+legacy;
    }
    const sharedIds=new Set(sharedViews.map(g=>g.id));
    trialLayout.focusGroups=[...sharedViews,...trialLayout.focusGroups.filter(g=>!sharedIds.has(g.id))];
  }
  $('#projection-light-row').hidden=trialLayout.lightingStudy?.controlledZone?.side!=='both';
  $('#projection-light-study').addEventListener('change',updateLightStudy);
  const is22 = trialLayout.revision.endsWith('trial22');
  if(is22){
    const world = trialLayout.focusGroups.find(g=>g.id==='curation-world');
    Object.assign(world, {label:'已经发生的世界 · 玻璃的A口侧',camera:[2.4,1.75,3.8],target:[.03,.96,4.48]});
    const foreword=trialLayout.works.find(work=>work.id==='preface-location');
    const wall=trialLayout.surfaces.find(surface=>surface.id===foreword.surfaceId);
    const centerZ=wall.a[1]+foreword.along;
    const columnZ=centerZ-.57;
    const guide=trialLayout.wallGuides.find(g=>g.id==='opening');
    const guideWall=trialLayout.surfaces.find(s=>s.id===guide.surfaceId);
    const dx=guideWall.b[0]-guideWall.a[0], dz=guideWall.b[1]-guideWall.a[1];
    const distance=guide.along/Math.hypot(dx,dz);
    const gx=guideWall.a[0]+dx*distance, gz=guideWall.a[1]+dz*distance;
    const [nx,nz]=guideWall.normal;
    trialLayout.focusGroups.unshift(
      {id:'entry-foreword',label:'AT ONCE · 入口前言',
        camera:[.90,1.75,centerZ+.98],target:[4.98,1.58,centerZ+.53],
        portrait:{camera:[1.58,1.75,centerZ+.85],target:[4.98,1.51,centerZ+.08]},
        framing:{projection:'perspective',wallExtent:{center:[4.98,foreword.centerY,centerZ],width:foreword.outerWidth,height:foreword.outerHeight}}},
      {id:'entry-foreword-read',label:'入口前言 · 正文近读',
        camera:[3.87,1.75,columnZ+.01],target:[4.98,1.48,columnZ],
        portrait:{camera:[4.18,1.75,columnZ+.01],target:[4.98,1.47,columnZ]},framing:{projection:'perspective'}},
      {id:'opening-guide',label:'分区展签 · 开篇摄影',camera:[gx+1.25*nx,guide.centerY,gz+1.25*nz],target:[gx+.009*nx,guide.centerY,gz+.009*nz],framing:{projection:'orthographic',width:guide.width+.09,height:guide.height+.07}},

    );
  }
  function storeLightingChoice(){
    const url=new URL(location.href);
    const mode=!trackWashRequested?'flat':is22&&!photoCutRequested?'wash':null;
    if(mode)url.searchParams.set('lighting',mode);else url.searchParams.delete('lighting');
    history.replaceState(null,'',url);
  }
  const cutControl=$('#photo-cut');
  $('#photo-cut-row').hidden=!is22;
  cutControl.checked=photoCutRequested;
  cutControl.disabled=!trackWashRequested;
  cutControl.addEventListener('change',()=>{
    photoCutRequested=cutControl.checked;
    updateLightStudy();storeLightingChoice();
  });
  const washControl=$('#track-wash');
  if(washControl){
    const washRow=$('#track-wash-row')||washControl.closest('label');
    washRow.hidden=Number(trialLayout.revision.match(/trial(\d+)$/)?.[1]||0)<21;
    washControl.checked=trackWashRequested;
    washControl.addEventListener('change',()=>{
      trackWashRequested=washControl.checked;
      updateLightStudy();
      cutControl.disabled=!trackWashRequested;
      storeLightingChoice();
    });
  }
  $('#trial-on').textContent=trialName();
  $('#baseline-compare').textContent=baseline?'回到试排22':'对照试排21';
  updateComparisonLink=focus=>{
    const query=new URLSearchParams(baseline?{}:{trial:'21'});query.set('v',viewerVersion);query.set('lens',lensMode);
    if(focus)query.set('focus',focus==='language-split-lower'?'language-split-word':focus==='curation-river-ink-side'?'curation-river-ink':trialLayout.focusGroups.find(g=>g.id===focus)?.compareFocus||focus);
    $('#baseline-compare').href='?'+query;
  };
  updateComparisonLink(new URLSearchParams(location.search).get('focus'));
  if(baseline){$('.header h1').firstChild.textContent='ONCE';$('.header h1 span').textContent='保留基准 · '+trialName();$('.header p').textContent='摄影与诗句的历史布置';document.title='大悦城 ONCE · '+trialName();
    const archiveNote=baseline==='21'?'保留轨道洗墙、河流首个英文片段及玻璃连续排列。':baseline==='20'?'作者调整了河流两组的位置。站姿眼高为1.60米，保留原照明和床照间距。':baseline==='19'?'河流两组位于柱廊旁，远浪使用窄黑框，终句保留中英两种下行。':baseline==='18'?'包含20组空间文字、7组手动排版和24厘米远浪纸面。':'保留这一版的位置、作品尺寸与诗句字形。';
    $('#trial-description').innerHTML='<h3>'+trialName()+' · 历史布置</h3><p>'+archiveNote+'</p><p><a href="https://13864768492jxy-create.github.io/once-exhibition-viewer/book/" target="_blank" rel="noopener noreferrer">阅读完整诗册</a></p>'+(baseline==='20'?'<p><a href="book-study/trial20-eye.jpg">试排20视角对照</a> · <a href="?trial=19">查看试排19</a></p>':baseline==='19'?'<p><a href="book-study/trial19-overview.jpg">试排19空间总览</a> · <a href="?trial=18">查看试排18</a></p>':'');
  }
  if(typographyCompare){
    $('.header h1 span').textContent=typographyStudy?'文字与空间 · 试读':previousTypography?'两句地诗 · 上一轮':'字体对照 · 现版';$('.header p').textContent=typographyStudy?'文字、摄影与材料 · 在走动与回望中阅读':'迎着风 / 河流 · 同视角比较';document.title='大悦城 ONCE · 文字与空间';
    $('#baseline-compare').textContent=typographyStudy?'对照上一轮':'切换新版地诗';
    const currentFocus=new URLSearchParams(location.search).get('focus');
    updateComparisonLink=focus=>{$('#baseline-compare').href='?type='+(typographyStudy?'study2':'study')+'&v=type-syntax-20261108'+(focus?'&focus='+encodeURIComponent(focus):'');};
    updateComparisonLink(currentFocus);
    if(!trialLayout.focusGroups.some(g=>g.id==='spatial-floor-tomorrow'))trialLayout.focusGroups.unshift({id:'spatial-floor-tomorrow',label:'地面文字 · 迎着风谈论明天',camera:[2.35,1.6,2.75],target:[2.35,.03,4.05]});
    for(const view of [{id:'language-river-images',label:'诗与照片 · 河流的阅读',camera:[4.5,1.65,8.5],target:[1.6,.9,11.4]},{id:'language-body-images',label:'文字与身体 · 一切正常',camera:[1.2,1.65,3.3],target:[4.65,.85,7.1]}]){
      if(!trialLayout.focusGroups.some(g=>g.id===view.id))trialLayout.focusGroups.unshift(view);
    }
    $('#trial-description').innerHTML='<h3>文字、图像与观看</h3><p>两句地诗统一字形，以完整语义段安排大小与空白。新增诗与摄影同看的视角；走近、抬头与回望参与阅读。</p><p>横亘玻璃、Growing Again及低位远浪保留各自的表达。可同视角比较上一轮；主方案暂保留。这是策展试读，尚非制作定稿。</p><a href="typography/">查看六处关系与字体对照</a>';
  }
  const initialFocus=new URLSearchParams(location.search).get('focus');
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(host.clientWidth,host.clientHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;host.appendChild(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color(0xeeede9);build();
  updateLightStudy();
  await Promise.all([document.fonts.load('400 96px "ONCE Text"','我横'),document.fonts.load('700 96px "ONCE Text"','我横'),document.fonts.load('400 96px "ONCE Grotesk"','我横'),document.fonts.load('500 96px "ONCE Grotesk"','我横'),document.fonts.load('700 96px "ONCE Grotesk"','我横')]);
  for(const palette of trialLayout.environment?.finishStudies||[]){const option=document.createElement('option');option.value=palette.id;option.textContent=palette.label;$('#finish-study').append(option);}
  selectedFinishId=trialLayout.environment?.activeFinish;
  $('#finish-study').addEventListener('change',event=>applyFinish(event.target.value));
  exhibition=await buildExhibition({scene,renderer,trackWash,layout:trialLayout,catalog:library,layoutSourceText:inputTexts[1]});
  addVisitorInstallation(exhibition.group,trialLayout,exhibition.collisionRects);
  applyFinish();
  const satin=installRiverInk(exhibition,data,trackWash);
  if(satin){
    const control=$('#satin-ink');
    $('#satin-ink-row').hidden=false;
    control.checked=new URLSearchParams(location.search).get('ink')!=='matte';
    satin.value=Number(control.checked);
    control.addEventListener('change',()=>{
      satin.value=Number(control.checked);
      const url=new URL(location.href);
      if(control.checked)url.searchParams.delete('ink');else url.searchParams.set('ink','matte');
      history.replaceState(null,'',url);
    });
  }
  $('#pillow-preview').hidden=!trialLayout.works.some(w=>w.projectionVideo);
  $('#pillow-preview').addEventListener('click',async()=>{const button=$('#pillow-preview');button.disabled=true;try{focusOnGroup('pillow-margin');const playing=await exhibition.togglePillowProjection();$('#projection-light-study').checked=playing;updateLightStudy();button.textContent=playing?'暂停枕头投影':'播放枕头投影';}catch(error){$('#status').textContent='投影预览暂未载入，请重试';}finally{button.disabled=false;}});
  for(const group of trialLayout.focusGroups){const option=document.createElement('option');option.value=group.id;option.textContent=group.label;option.hidden=Boolean(group.menuHidden);$('#focus-group').append(option);}
  trialLayout.blankWallIntervals?.forEach((blank,i)=>{const option=document.createElement('option');option.value=`blank-${i}`;option.textContent=`主墙停顿${i+1} · 约${blank.length.toFixed(1)}米`;$('#focus-group').append(option);});
  $('#focus-group').addEventListener('change',event=>focusOnGroup(event.target.value));
  $('#trial-on').addEventListener('click',()=>setTrialVisible(true));$('#trial-off').addEventListener('click',()=>setTrialVisible(false));
  if(initialFocus&&trialLayout.focusGroups.some(g=>g.id===initialFocus))focusOnGroup(initialFocus);
  else if(comparingCurrent)focusOnGroup(is22?'entry-foreword':'curation-opening-walk');
  else setView('overview');
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  const panel=(open)=>{$('#details-panel').hidden=!open;$('#details-button').setAttribute('aria-expanded',String(open));};
  $('#details-button').addEventListener('click',()=>panel($('#details-panel').hidden));$('#close-panel').addEventListener('click',()=>panel(false));
  const viewMenu=$('#view-menu'),viewerControls=$('#viewer-controls');
  const setMenu=open=>{
    viewerControls.classList.toggle('menu-open',open);
    viewMenu.setAttribute('aria-expanded',String(open));
  };
  viewMenu.addEventListener('click',()=>{
    const open=viewMenu.getAttribute('aria-expanded')!=='true';
    if(open){
      panel(false);
      $('#catalog-panel').hidden=true;
      $('#catalog-button').setAttribute('aria-expanded','false');
    }
    setMenu(open);
  });
  const closeViewMenu=()=>{
    if(!viewMenu.offsetWidth)return;
    setMenu(false);
    const openPanel=[$('#catalog-panel'),$('#details-panel')].find(el=>!el.hidden);
    const fallback=view==='entry'||view==='reverse'?host:viewMenu;
    (openPanel?.querySelector('button')||fallback).focus({preventScroll:true});
  };
  viewerControls.addEventListener('click',event=>{
    if(event.target.closest('button'))closeViewMenu();
  });
  $('#focus-group').addEventListener('change',closeViewMenu);
  for(const id of ['close-panel','close-catalog'])$('#'+id).addEventListener('click',()=>{
    if(viewMenu.offsetWidth)requestAnimationFrame(()=>viewMenu.focus({preventScroll:true}));
  });
  for(const [id,key]of [['strips','strips'],['bars','bars'],['lighting','lighting'],['dimensions','dimensions']])$('#'+id).addEventListener('change',e=>{groups[key].visible=e.target.checked;updateLabels();});
  $('#cutaway').addEventListener('change',updateCutaway);
  $('#position').addEventListener('input',e=>{walkPosition.z=-Number(e.target.value);updateWalk();});
  const canvas=renderer.domElement;
  canvas.addEventListener('pointerdown',e=>{if(poetryEditor?.active)return;if(view==='entry'||view==='reverse'){pointerStart={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);host.focus({preventScroll:true});}});
  canvas.addEventListener('pointermove',e=>{if(pointerStart?.id===e.pointerId){yaw-=(e.clientX-pointerStart.x)*.004;pitch=THREE.MathUtils.clamp(pitch-(e.clientY-pointerStart.y)*.004,-1.1,1.1);pointerStart.x=e.clientX;pointerStart.y=e.clientY;updateWalk();}});
  const stopPointer=()=>pointerStart=null;canvas.addEventListener('pointerup',stopPointer);canvas.addEventListener('pointercancel',stopPointer);
  window.addEventListener('keydown',e=>{if(poetryEditor?.active)return;if(e.target.matches('input,button,a,select,textarea'))return;const key=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowleft','arrowdown','arrowright','shift'].includes(key)&&(view==='entry'||view==='reverse')){pressed.add(key);e.preventDefault();}if(key==='escape')panel(false);});window.addEventListener('keyup',e=>pressed.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>pressed.clear());
  new ResizeObserver(resize).observe(host);document.addEventListener('visibilitychange',()=>{pressed.clear();previousTime=performance.now();});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();$('#error').hidden=false;$('#error').textContent='三维画面连接中断，请刷新页面重新载入。';cancelAnimationFrame(raf);});
  installCatalog({layout:trialLayout,onInspect:focusOnWork,onFocus:focusOnGroup});
  state.loaded=true;requestAnimationFrame(animate);
  exhibition.ready.then(stats=>{const total=stats.loaded+stats.errors;canvas.setAttribute('data-image-load-stats',JSON.stringify({loaded:stats.loaded,errors:stats.errors,pending:stats.pending,failures:stats.failures}));if(stats.errors){$('#status').textContent=`${stats.errors}项预览暂未载入，请刷新重试`;}$('#image-status').textContent=stats.errors?`${stats.loaded}/${total} 项预览已载入`:`${stats.photos+stats.large+stats.glass+stats.videos-(trialLayout.works.some(w=>w.id==='traveler-1')?1:0)}件原作`+(trialLayout.works.some(w=>w.id==='traveler-1')?' + 旅人候选':'')+' · '+trialName();});
  window.spaceModel={exhibition,layout:trialLayout,getState:()=>({trialVisible,exhibitionStats:exhibition.stats,loaded:state.loaded,error:state.error,view,room:data.room,tile:data.tile,camera:{position:camera.position.toArray(),target:controls.target.toArray(),projection:camera.isPerspectiveCamera?'perspective':'orthographic',lens:camera.userData.visitorLens?lensMode:null,focalMm:camera.userData.visitorLens&&lensMode!=='wide'?(lensMode==='detail'?camera.userData.visitorLens.detailMm:camera.userData.visitorLens.focalMm):null,verticalFov:camera.fov??null,aspect:camera.aspect??null},visible:{strips:groups.strips.visible,bars:groups.bars.visible,lighting:groups.lighting.visible,leftWall:walls.left.visible,rightWall:walls.right.visible},counts:{strips:groups.strips.children.length,bars:groups.bars.children.length,lightingRows:data.lighting?.rowPositions.length||0},endBStatus:data.ends.B.openingStatus,renderCalls:renderer.info.render.calls}),setView,focusOnWork,focusOnGroup,setTrialVisible,scene,data};
  if(!baseline&&!typographyCompare){
    poetryEditor=installPoetryEditor({exhibition,layout:trialLayout,layoutSourceText:inputTexts[1],space:data,host,getCamera:()=>camera,getControls:()=>controls,focusEntry:focusPoetryEntry,onActive:active=>{pressed.clear();pointerStart=null;if(active){setTrialVisible(true);$('#walk-controls').hidden=true;}$('#hint').textContent=active?'选中文字后拖动 · 角点等比缩放 · ⌘Z 撤销':'拖动环看 · 滚轮缩放';resize();}});
    window.spaceModel.poetryEditor=poetryEditor;$('#editor-open').disabled=false;
  }else{$('#editor-open').hidden=true;}
}catch(error){state.error=error.message;$('#error').hidden=false;$('#error').textContent=`空间未能载入：${error.message}。请通过“打开空间模型.command”启动后访问本机地址，勿直接双击HTML文件。`;$('#status').hidden=true;console.error(error);}}
init();
