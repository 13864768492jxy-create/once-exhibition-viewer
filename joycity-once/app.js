import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { installCatalog } from './catalog.js?v=20261103-r08';

const $ = (s) => document.querySelector(s);
const host = $('#canvas-host');
let data, renderer, scene, camera, controls, groups, walls, view = 'overview';
let yaw = 0, pitch = 0, walkPosition, pointerStart, pressed = new Set();
let previousTime = performance.now(), raf = 0;
const eyeHeight = 1.6;
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
      const head=new THREE.Group();head.name='可倾斜白圆筒射灯_照片示意';head.position.set(x,d.railHeight-.15,z);head.rotation.z=(x<data.room.width/2?-1:1)*(.38+(row+i)%3*.07);groups.lighting.add(head);
      head.add(new THREE.Mesh(cylinder,white));const disk=new THREE.Mesh(lens,face);disk.position.y=-d.headBodyLength/2-.001;disk.rotation.x=Math.PI/2;head.add(disk);
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
function makeTileTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d6d5ce'; ctx.fillRect(0,0,256,256);
  // Fine photographic-substrate texture, fixed seeded sequence for stable renders.
  let seed = 6041;
  for(let i=0;i<5500;i++) {seed=(Math.imul(seed,1664525)+1013904223)>>>0; const x=(seed>>>8)%256; seed=(Math.imul(seed,1664525)+1013904223)>>>0; const y=(seed>>>8)%256; ctx.fillStyle=i%3?'#e5e3dc':'#b9bab2';ctx.globalAlpha=.25;ctx.fillRect(x,y,1,1);}
  ctx.globalAlpha=1;
  const texture = new THREE.CanvasTexture(c); texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping; texture.repeat.set(1/data.tile.size,1/data.tile.size);
  texture.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8); return texture;
}
function build() {
  const {width:W,length:L,modelWallHeight:H,wallThickness:T}=data.room;
  const white = new THREE.MeshBasicMaterial({color:0xf9faf7,toneMapped:false});
  const floorMat = new THREE.MeshStandardMaterial({color:0xffffff,map:makeTileTexture(),roughness:.74});
  const metal = new THREE.MeshStandardMaterial({color:0x707870,metalness:.48,roughness:.38});
  const green = new THREE.MeshStandardMaterial({color:0x466148,roughness:.67});
  const grout = new THREE.MeshBasicMaterial({color:0x9c9f96});
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
  scene.userData={source:data.revision,measuredRoom:data.room,coordinates:'canonical depth maps to negative world Z, matching the native GLB',physicalSpotlightHeight:'above 2.95m; rail3.30m illustrative, not surveyed',note:'render lights are preview illumination, not physical fixtures'};
  walkPosition=new THREE.Vector3(W/2,eyeHeight,-.9);
  $('#position').max=(L-.3).toFixed(1);
  $('#length-value').textContent=`${L} m`;
  $('#width-value').textContent=`约${W} m`;
}
function createControls() {
  controls?.dispose();controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.1;controls.minDistance=.5;controls.maxDistance=100;controls.maxPolarAngle=Math.PI*.49;controls.enableRotate=view!=='plan';
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
  view=next;pressed.clear();pointerStart=null;
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
  const walking=view==='entry'||view==='reverse';$('#walk-controls').hidden=!walking;
  if(next==='overview'){fitOverview();$('#hint').textContent='拖动旋转 · 滚轮缩放 · 右键平移';}
  else if(next==='plan'){
    const aspect=host.clientWidth/host.clientHeight,L=data.room.length,W=data.room.width;
    const nearEnd=Math.min(aZ(0),aZ(W)),mid=(L+nearEnd)/2,halfW=Math.max((L-nearEnd+4)/2,(W+3)*aspect/2),halfH=halfW/aspect;
    camera=new THREE.OrthographicCamera(-halfW,halfW,halfH,-halfH,.01,100);camera.position.set(W/2,30,-mid);camera.up.set(-1,0,0);camera.lookAt(W/2,0,-mid);
    createControls();controls.target.set(W/2,0,-mid);controls.update();$('#hint').textContent='60 cm砖格 · 滚轮缩放 · 右键平移';
  }else if(next==='portal'){
    camera=new THREE.PerspectiveCamera(58,host.clientWidth/host.clientHeight,.025,120);camera.up.copy(worldUp);
    const x=data.ends.A.mainOpening.x,theta=THREE.MathUtils.degToRad(data.ends.A.slope?.angleDegrees||0),normal=new THREE.Vector3(-Math.sin(theta),0,-Math.cos(theta)),center=new THREE.Vector3(x,eyeHeight,-aZ(x));
    camera.position.copy(center).addScaledVector(normal,-2.7);const target=center.clone().addScaledVector(normal,4);camera.lookAt(target);
    createControls();controls.target.copy(target);controls.update();$('#hint').textContent='A口外看入 · 主入口净宽 1.70 m';
  }else{
    camera=new THREE.PerspectiveCamera(62,host.clientWidth/host.clientHeight,.025,120);camera.up.copy(worldUp);createControls();controls.enabled=false;
    walkPosition.set(data.room.width/2,eyeHeight,next==='entry'?-.9:-data.room.length+.9);yaw=next==='entry'?Math.PI:0;pitch=0;updateWalk();
    $('#hint').textContent='拖动转头 · W A S D 或方向键行走';
  }
  $('#cutaway').disabled=!['overview','plan'].includes(next);
  $('#status').textContent=walking?'人眼高度 1.60 m · 拖动转头':next==='plan'?'右墙31.2 m · 左墙更长，差值待测':next==='portal'?'A口斜墙 · 门套进深与斜角待校准':'现有展墙内净空 · A口斜角待测';
  updateCutaway();updateLabels();
  if(walking)host.focus({preventScroll:true});
}
function updateWalk(){camera.position.copy(walkPosition);camera.lookAt(walkPosition.x+Math.sin(yaw)*Math.cos(pitch),eyeHeight+Math.sin(pitch),walkPosition.z+Math.cos(yaw)*Math.cos(pitch));$('#position').value=(-walkPosition.z).toFixed(1);$('#position-value').textContent=`${(-walkPosition.z).toFixed(1)} m`;updateLabels();}
function updateCutaway(){if(!walls)return;const cut=$('#cutaway').checked&&(view==='overview'||view==='plan');walls.left.visible=!cut||camera.position.x>=0;walls.right.visible=!cut||camera.position.x<=data.room.width;}
function updateLabels(){
  if(!camera||!data)return;
  const enabled=$('#dimensions').checked,W=data.room.width,L=data.room.length;
  const positions=[['#label-a',[W/2,.1,-aZ(W/2)+.85]],['#label-b',[W/2,.1,-L-.85]],['#label-short',[W+.95,.01,-L/2]],['#label-long',[-.65,.01,-(L+aZ(0))/2]]];
  camera.updateMatrixWorld();
  for(const [selector,p]of positions){
    const el=$(selector),v=new THREE.Vector3(...p).project(camera);let x=(v.x*.5+.5)*host.clientWidth,y=(-v.y*.5+.5)*host.clientHeight;
    const wallLabel=selector==='#label-short'||selector==='#label-long';
    if(view==='plan'&&!wallLabel){x=THREE.MathUtils.clamp(x,90,host.clientWidth-100);y=host.clientHeight/2+host.clientWidth/L*4.6;}
    el.hidden=!enabled||(wallLabel&&view!=='plan')||v.z< -1||v.z>1||x<65||x>host.clientWidth-65||y<118||y>host.clientHeight-38;
    el.style.left=`${x}px`;el.style.top=`${y}px`;
  }
}
function resize(){if(!renderer)return;const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);if(view==='overview')fitOverview();else if(view==='plan')setView('plan');else{camera.aspect=w/h;camera.updateProjectionMatrix();updateLabels();}}
function animate(now){raf=requestAnimationFrame(animate);const dt=Math.min((now-previousTime)/1000,.05);previousTime=now;if(view==='entry'||view==='reverse'){let forward=0,side=0;if(pressed.has('w')||pressed.has('arrowup'))forward++;if(pressed.has('s')||pressed.has('arrowdown'))forward--;if(pressed.has('d')||pressed.has('arrowright'))side++;if(pressed.has('a')||pressed.has('arrowleft'))side--;if(forward||side){const speed=(pressed.has('shift')?3:1.6)*dt/Math.max(1,Math.hypot(forward,side));walkPosition.x=THREE.MathUtils.clamp(walkPosition.x+(Math.sin(yaw)*forward-Math.cos(yaw)*side)*speed,Math.max(.25,leftBoundaryX(-walkPosition.z)+.25),data.room.width-.25);walkPosition.z=THREE.MathUtils.clamp(walkPosition.z+(Math.cos(yaw)*forward+Math.sin(yaw)*side)*speed,-data.room.length+.3,-floorStartZ(walkPosition.x)-.3);updateWalk();}}else controls.update();renderer.render(scene,camera);}

async function init(){try{
  const response=await fetch('space.json?v=20261103-r08',{cache:'no-store'});if(!response.ok)throw new Error(`空间参数读取失败 (${response.status})`);data=await response.json();
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(host.clientWidth,host.clientHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;host.appendChild(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color(0xeeede9);build();setView('overview');
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  const panel=(open)=>{$('#details-panel').hidden=!open;$('#details-button').setAttribute('aria-expanded',String(open));};
  $('#details-button').addEventListener('click',()=>panel($('#details-panel').hidden));$('#close-panel').addEventListener('click',()=>panel(false));
  for(const [id,key]of [['strips','strips'],['bars','bars'],['lighting','lighting'],['dimensions','dimensions']])$('#'+id).addEventListener('change',e=>{groups[key].visible=e.target.checked;updateLabels();});
  $('#cutaway').addEventListener('change',updateCutaway);
  $('#position').addEventListener('input',e=>{walkPosition.z=-Number(e.target.value);updateWalk();});
  const canvas=renderer.domElement;
  canvas.addEventListener('pointerdown',e=>{if(view==='entry'||view==='reverse'){pointerStart={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);host.focus({preventScroll:true});}});
  canvas.addEventListener('pointermove',e=>{if(pointerStart?.id===e.pointerId){yaw-=(e.clientX-pointerStart.x)*.004;pitch=THREE.MathUtils.clamp(pitch-(e.clientY-pointerStart.y)*.004,-1.1,1.1);pointerStart.x=e.clientX;pointerStart.y=e.clientY;updateWalk();}});
  const stopPointer=()=>pointerStart=null;canvas.addEventListener('pointerup',stopPointer);canvas.addEventListener('pointercancel',stopPointer);
  window.addEventListener('keydown',e=>{if(e.target.matches('input,button,a,select,textarea'))return;const key=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowleft','arrowdown','arrowright','shift'].includes(key)&&(view==='entry'||view==='reverse')){pressed.add(key);e.preventDefault();}if(key==='escape')panel(false);});window.addEventListener('keyup',e=>pressed.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>pressed.clear());
  new ResizeObserver(resize).observe(host);document.addEventListener('visibilitychange',()=>{pressed.clear();previousTime=performance.now();});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();$('#error').hidden=false;$('#error').textContent='三维画面连接中断，请刷新页面重新载入。';cancelAnimationFrame(raf);});
  installCatalog();state.loaded=true;requestAnimationFrame(animate);
  window.spaceModel={getState:()=>({loaded:state.loaded,error:state.error,view,room:data.room,tile:data.tile,camera:{position:camera.position.toArray(),target:controls.target.toArray()},visible:{strips:groups.strips.visible,bars:groups.bars.visible,lighting:groups.lighting.visible,leftWall:walls.left.visible,rightWall:walls.right.visible},counts:{strips:groups.strips.children.length,bars:groups.bars.children.length,lightingRows:data.lighting?.rowPositions.length||0},endBStatus:data.ends.B.openingStatus,renderCalls:renderer.info.render.calls}),setView,scene,data};
}catch(error){state.error=error.message;$('#error').hidden=false;$('#error').textContent=`空间未能载入：${error.message}。请通过“打开空间模型.command”启动后访问本机地址，勿直接双击HTML文件。`;$('#status').hidden=true;console.error(error);}}
init();
