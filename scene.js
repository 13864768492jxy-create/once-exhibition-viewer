import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { bounds, walls, wallPosition, workBounds, contains, canWalk, eyeStart, clamp, sampleImage } from './model.js?v=20261017-preface-20';

export class ExhibitionScene {
  constructor(element,{select,beginDrag,drag,endDrag,imageSource}) {
    this.element=element;this.callbacks={select,beginDrag,drag,endDrag,imageSource};
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#e8e7e0');
    this.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.2;
    element.appendChild(this.renderer.domElement);
    this.perspective=new THREE.PerspectiveCamera(42,1,.01,500);
    this.orthographic=new THREE.OrthographicCamera(-10,10,10,-10,.01,500);
    this.camera=this.perspective;
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=true;this.controls.dampingFactor=.09;
    this.controls.maxPolarAngle=Math.PI*.495;this.controls.minDistance=.5;this.controls.maxDistance=100;
    this.roomGroup=new THREE.Group();this.worksGroup=new THREE.Group();this.scene.add(this.roomGroup,this.worksGroup);
    this.scene.add(new THREE.HemisphereLight('#f7f9ff','#949c99',2.1));
    const sun=new THREE.DirectionalLight('#ffffff',2.2);sun.position.set(-5,12,5);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-20;sun.shadow.camera.right=20;sun.shadow.camera.top=20;sun.shadow.camera.bottom=-20;sun.shadow.normalBias=.04;sun.shadow.bias=-.0001;sun.shadow.camera.far=50;sun.shadow.radius=3;
    this.scene.add(sun,new THREE.AmbientLight('#ffffff',.35));
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.workGroups=new Map();this.textures=new Map();this.loadingTextures=new Set();this.selected=null;this.mode='overview';this.gridVisible=false;this.editable=true;
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(element);
    this.bindPointers();
    this.navigation=new Set();this.lastFrame=performance.now();
    this.animate=()=>{this.frame=requestAnimationFrame(this.animate);const now=performance.now(),dt=Math.min(.05,(now-this.lastFrame)/1000);this.lastFrame=now;this.stepWalking(dt);this.controls.update();this.updateCutaway();this.roomGroup.traverse(o=>{if(o.userData.wallCap&&!this.mode.startsWith('wall:')){const d=o.userData.wallCap;o.visible=d.normal[0]*(this.camera.position.x-o.position.x)+d.normal[1]*(this.camera.position.z-o.position.z)>=0||this.mode==='plan';}});this.renderer.render(this.scene,this.camera);};this.animate();
  }

  disposeGroup(group){
    group.traverse(obj=>{obj.geometry?.dispose();obj.userData.labelTexture?.dispose();if(obj.material){const mats=Array.isArray(obj.material)?obj.material:[obj.material];for(const m of mats){if(m.map?.userData.ephemeral)m.map.dispose();m.dispose();}}});group.clear();
  }
  resize(){
    const w=this.element.clientWidth,h=this.element.clientHeight;if(!w||!h)return;
    this.renderer.setSize(w,h,false);this.perspective.aspect=w/h;this.perspective.updateProjectionMatrix();this.updateOrtho(w/h);
  }
  updateOrtho(aspect){
    const b=this.state?bounds(this.state.room):{width:12,depth:8};
    const focused=this.state?.works.find(work=>work.id===this.focusedTextPanel);
    const viewWidth=focused?focused.width+.3:this.mode.startsWith('wall:')?walls(this.state.room)[Number(this.mode.split(':')[1])].length+1.5:b.width+2.5;
    const viewHeight=focused?focused.height+(focused.ropeRise||0)+.3:this.mode.startsWith('wall:')?(this.state.room.ceiling?.enabled?this.state.room.height:walls(this.state.room)[Number(this.mode.split(':')[1])].height)+1.6:b.depth+2.5;
    const half=Math.max(viewHeight/2,viewWidth/(2*aspect));
    this.orthographic.left=-half*aspect;this.orthographic.right=half*aspect;this.orthographic.top=half;this.orthographic.bottom=-half;this.orthographic.updateProjectionMatrix();
  }
  box(w,h,d,color){
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.9}));mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
  }
  label(text,size=.45,color='#526652'){
    const c=document.createElement('canvas');c.width=256;c.height=72;const ctx=c.getContext('2d');
    ctx.font='500 28px -apple-system, sans-serif';ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,128,36);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false}));sprite.scale.set(size*3.55,size,1);sprite.renderOrder=4;sprite.userData.labelTexture=texture;return sprite;
  }
  update(state){
    this.state=state;
    this.wallData=walls(state.room);
    this.disposeGroup(this.roomGroup);this.disposeGroup(this.worksGroup);this.workGroups.clear();
    const room=state.room,b=bounds(room),shape=new THREE.Shape();
    room.points.forEach((p,i)=>i?shape.lineTo(p[0],-p[1]):shape.moveTo(p[0],-p[1]));shape.closePath();
    const floor=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshStandardMaterial({color:room.floorColor||'#dcdacf',roughness:1,side:THREE.DoubleSide}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=false;floor.position.y=-.006;this.roomGroup.add(floor);
    if(room.ceiling?.enabled){
      const ceiling=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshStandardMaterial({color:room.ceiling.color||'#f6f5f0',roughness:.95,side:THREE.BackSide}));
      ceiling.rotation.x=-Math.PI/2;ceiling.position.y=room.height;ceiling.userData.ceilingSurface=true;this.roomGroup.add(ceiling);
      this.addCeilingStructure(room,b);
    }
    const edges=new THREE.BufferGeometry().setFromPoints([...room.points,room.points[0]].map(p=>new THREE.Vector3(p[0],.018,p[1])));
    this.roomGroup.add(new THREE.Line(edges,new THREE.LineBasicMaterial({color:'#9eaa99',transparent:true,opacity:.65})));
    if(room.tileSize){
      const lines=[];
      for(let x=b.minX;x<=b.maxX+.001;x+=room.tileSize)for(let z=b.minZ;z<b.maxZ;z+=.08){if(contains(room,x+.001,z+.04))lines.push(new THREE.Vector3(x,.002,z),new THREE.Vector3(x,.002,Math.min(z+.08,b.maxZ)));}
      for(let z=b.minZ;z<=b.maxZ+.001;z+=room.tileSize)for(let x=b.minX;x<b.maxX;x+=.08){if(contains(room,x+.04,z+.001))lines.push(new THREE.Vector3(x,.002,z),new THREE.Vector3(Math.min(x+.08,b.maxX),.002,z));}
      this.roomGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines),new THREE.LineBasicMaterial({color:'#a3a59a',transparent:true,opacity:.45})));
    }
    for(const wall of walls(room)){
      if(!wall.perimeter)continue;
      const openings=(room.openings||[]).filter(o=>o.wall===wall.index);
      const stops=[0,wall.length,...openings.flatMap(o=>[o.start,o.start+o.width])].sort((a,b)=>a-b);
      for(let n=0;n<stops.length-1;n++){
        const start=stops[n],end=stops[n+1];if(end-start<.001)continue;
        let spans=[[0,room.height]];
        for(const opening of openings.filter(o=>(start+end)/2>o.start&&(start+end)/2<o.start+o.width)){
          spans=spans.flatMap(([bottom,top])=>{
            const out=[];if(opening.bottom>bottom)out.push([bottom,Math.min(top,opening.bottom)]);
            if(opening.bottom+opening.height<top)out.push([Math.max(bottom,opening.bottom+opening.height),top]);return out;
          });
        }
        for(const [bottom,top] of spans){
          if(top-bottom<.001)continue;
          const mesh=new THREE.Mesh(new THREE.PlaneGeometry(end-start,top-bottom),new THREE.MeshStandardMaterial({color:'#faf9f2',side:THREE.FrontSide,roughness:.95}));
          mesh.rotation.y=wall.rotation;mesh.position.set(wall.a[0]+wall.tangent[0]*(start+end)/2,(bottom+top)/2,wall.a[1]+wall.tangent[1]*(start+end)/2);mesh.receiveShadow=true;
          mesh.userData.wallIndex=wall.index;this.roomGroup.add(mesh);
          if(bottom===0 && room.skirting?.walls?.includes(wall.index)){
            const base=room.skirting,strip=this.box(end-start,base.height,base.depth,base.color);
            strip.rotation.y=wall.rotation;
            strip.position.set(wall.a[0]+wall.tangent[0]*(start+end)/2+wall.normal[0]*base.depth/2,base.height/2,wall.a[1]+wall.tangent[1]*(start+end)/2+wall.normal[1]*base.depth/2);
            strip.userData.wallIndex=wall.index;strip.castShadow=false;this.roomGroup.add(strip);
          }
          const cap=this.box(end-start,.035,.12,'#e5e5d8');cap.castShadow=false;cap.rotation.y=wall.rotation;cap.position.copy(mesh.position);cap.position.y=top;cap.userData.wallCap={normal:wall.normal};cap.userData.wallIndex=wall.index;this.roomGroup.add(cap);
        }
      }
      for(const o of openings){
        const frame=new THREE.Group();frame.position.set(wall.a[0]+wall.tangent[0]*(o.start+o.width/2),o.bottom+o.height/2,wall.a[1]+wall.tangent[1]*(o.start+o.width/2));frame.rotation.y=wall.rotation;frame.userData.wallIndex=wall.index;
        if(o.type==='window'){
          const recess=o.recessDepth??.18,padding=o.frameWidth??.045,color=o.frameColor||'#24282a';
          const mullion=-o.width/2+o.width*(o.sashSplit??.5),transoms=(o.transoms??[o.horizontalSplit??.28]).map(f=>-o.height/2+o.height*f);
          for(const [width,height,x,y] of [[padding,o.height,-o.width/2+padding/2,0],[padding,o.height,o.width/2-padding/2,0],[o.width,padding,0,o.height/2-padding/2],[o.width,padding,0,-o.height/2+padding/2],[padding,o.height,mullion,0],...transoms.map(y=>[o.width,padding,0,y])]){
            const strip=this.box(width,height,.065,color);strip.position.set(x,y,-recess);strip.castShadow=false;frame.add(strip);
          }
          for(const [width,height,x,y] of [[.025,o.height,-o.width/2,0],[.025,o.height,o.width/2,0],[o.width,.025,0,o.height/2]]){
            const reveal=this.box(width,height,recess,'#faf9f2');reveal.position.set(x,y,-recess/2);reveal.castShadow=false;frame.add(reveal);
          }
          if(o.style!=='clerestory'){
            const sillDepth=o.sillDepth??recess+.11,sill=this.box(o.width+.12,o.sillThickness??.045,sillDepth,o.sillColor||'#696b66');
            sill.position.set(0,-o.height/2-.018,-recess+sillDepth/2);sill.castShadow=false;frame.add(sill);
            const handle=this.box(.09,.018,.018,color);handle.position.set(mullion-.06,0,-recess+.06);handle.castShadow=false;frame.add(handle);
          }
          const glass=new THREE.Mesh(new THREE.PlaneGeometry(o.width,o.height),new THREE.MeshStandardMaterial({color:'#cedbda',transparent:true,opacity:.3,side:THREE.DoubleSide,roughness:.25}));
          glass.position.z=-recess-.035;frame.add(glass);
        }else{
          for(const [width,height,x,y] of [[.055,o.height,-o.width/2,0],[.055,o.height,o.width/2,0],[o.width+.055,.055,0,o.height/2]]){const strip=this.box(width,height,.085,'#a48b6c');strip.position.set(x,y,0);strip.castShadow=false;frame.add(strip);}
        }
        this.roomGroup.add(frame);
      }
      const label=this.label(`墙 ${wall.index+1}`,.24,'#738170');
      label.position.set((wall.a[0]+wall.b[0])/2,room.height+.3,(wall.a[1]+wall.b[1])/2);label.userData.wallLabel=true;label.visible=false;this.roomGroup.add(label);
    }
    this.grid=new THREE.GridHelper(Math.max(b.width,b.depth)*1.5,Math.ceil(Math.max(b.width,b.depth)*1.5),'#a6afa0','#b9bdae');this.grid.position.set(b.cx,.008,b.cz);this.grid.material.transparent=true;this.grid.material.opacity=.25;this.roomGroup.add(this.grid);
    for(const [i,inner] of (room.interiorWalls||[]).entries()){
      const dx=inner.b[0]-inner.a[0],dz=inner.b[1]-inner.a[1],length=Math.hypot(dx,dz);
      const wall=this.box(length,inner.height,inner.thickness,'#faf9f2');wall.position.set((inner.a[0]+inner.b[0])/2,inner.height/2,(inner.a[1]+inner.b[1])/2);wall.rotation.y=Math.atan2(-dz,dx);wall.userData.wallIndices=[room.points.length+i*2,room.points.length+i*2+1];this.roomGroup.add(wall);
    }
    for(const column of room.columns||[]){
      const mesh=new THREE.Mesh(new THREE.CylinderGeometry(column.diameter/2,column.diameter/2,column.height,48),new THREE.MeshStandardMaterial({color:'#faf9f2',roughness:.85}));mesh.position.set(column.x,column.height/2,column.z);mesh.castShadow=true;mesh.receiveShadow=true;this.roomGroup.add(mesh);
      if(room.ceiling?.enabled&&room.skirting){const base=new THREE.Mesh(new THREE.CylinderGeometry(column.diameter/2+.005,column.diameter/2+.005,room.skirting.height,48),new THREE.MeshStandardMaterial({color:room.skirting.color,roughness:.9}));base.position.set(column.x,room.skirting.height/2,column.z);this.roomGroup.add(base);}
    }
    for(const fixture of room.fixtures||[]){
      const wall=walls(room)[fixture.wall];if(!wall)continue;
      const x=wall.a[0]+wall.tangent[0]*fixture.along+wall.normal[0]*.035,z=wall.a[1]+wall.tangent[1]*fixture.along+wall.normal[1]*.035;
      if(fixture.type==='switch'){const plate=this.box(.09,.12,.014,'#dddcd3');plate.position.set(x,fixture.elevation,z);plate.rotation.y=wall.rotation;plate.userData.wallIndex=fixture.wall;this.roomGroup.add(plate);}
      else if(fixture.type==='pipe'){const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.017,.017,room.height,12),new THREE.MeshStandardMaterial({color:'#ecece4',roughness:.8}));pipe.position.set(x,room.height/2,z);pipe.userData.wallIndex=fixture.wall;this.roomGroup.add(pipe);}
      else if(fixture.type==='tv'){
        const tv=new THREE.Group();tv.position.set(x,fixture.elevation+fixture.height/2,z);tv.rotation.y=wall.rotation;tv.userData.wallIndex=fixture.wall;
        tv.add(this.box(fixture.width,fixture.height,.045,'#242727'));
        const screen=new THREE.Mesh(new THREE.PlaneGeometry(fixture.width-.018,(fixture.width-.018)*9/16),new THREE.MeshBasicMaterial({color:'#171d20',toneMapped:false}));screen.position.z=.025;tv.add(screen);
        if(fixture.image)this.loadTexture(fixture.image).then(texture=>{screen.material.map=texture;screen.material.color.set('#fff');screen.material.needsUpdate=true;}).catch(()=>{});
        const wire=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-fixture.height/2,.007),new THREE.Vector3(-.015,-fixture.height/2-.23,.01),new THREE.Vector3(-.04,-fixture.height/2-.48,.01)]),new THREE.LineBasicMaterial({color:'#616763'}));tv.add(wire);this.roomGroup.add(tv);
      }
    }
    for(const furniture of room.furniture||[]){
      const g=new THREE.Group();g.position.set(furniture.x,0,furniture.z);g.rotation.y=(furniture.rotation||0)*Math.PI/180;
      const part=(w,h,d,x,y,z,color)=>{const mesh=this.box(w,h,d,color);mesh.position.set(x,y,z);g.add(mesh);};
      if(furniture.type==='table'){
        part(.4,.04,.5,0,.59,0,'#332e28');for(const x of [-.16,.16])for(const z of [-.21,.21])part(.035,.58,.035,x,.29,z,'#4b392a');part(.37,.035,.46,0,.17,0,'#463529');
      }else{
        part(.48,.07,.46,0,.44,0,'#9b8c73');part(.48,.24,.07,0,.70,-.22,'#9b8c73');
        for(const x of [-.23,.23])for(const z of [-.20,.20])part(.035,.42,.035,x,.21,z,'#6b4e34');
        for(const x of [-.265,.265]){part(.035,.035,.50,x,.61,0,'#745637');part(.035,.17,.035,x,.535,.18,'#745637');part(.035,.40,.035,x,.62,-.21,'#745637');}
      }
      this.roomGroup.add(g);
    }
    this.addFloorPoetry(room.floorPoems||[]);
    state.works.forEach((w,i)=>{if(w.placed!==false)this.addWork(w,i);});
    this.spacePlanMarkers();
    this.setSelected(this.selected);this.applyVisibility();this.resize();
  }
  addFloorPoetry(stations){
    const pieces=stations.flatMap(p=>p.fragments?p.fragments.map(fragment=>({...p,...fragment,fragments:undefined})):p);
    for(const p of pieces){
      const scale=1200,c=document.createElement('canvas');c.width=Math.ceil(p.width*scale);c.height=Math.ceil(p.height*scale);
      const ctx=c.getContext('2d');ctx.fillStyle=p.color||'#ffffff';
      // Explicit baselines let pauses and offsets be part of the poem's composition.
      ctx.textBaseline='alphabetic';
      for(const run of p.runs||[]){
        const size=run.fontSize||p.fontSize,tracking=run.letterSpacing??p.letterSpacing??0;
        ctx.font=`${run.fontWeight||p.fontWeight||700} ${size*scale}px "Once Poetry Sans", sans-serif`;
        let x=run.x*scale;for(const char of run.text){ctx.save();ctx.translate(x,run.y*scale);ctx.scale(1,p.glyphDepthScale||1);ctx.fillText(char,0,0);ctx.restore();x+=ctx.measureText(char).width+tracking*scale;}
      }
      if(!p.runs){
        ctx.font=`${p.fontWeight||700} ${p.fontSize*scale}px "Once Poetry Sans", sans-serif`;ctx.textBaseline='top';
        p.lines.forEach((line,i)=>{let x=.035*scale;for(const char of line){ctx.save();ctx.translate(x,(.025+i*p.lineHeight)*scale);ctx.scale(p.horizontalScale||1,1);ctx.fillText(char,0,0);ctx.restore();x+=ctx.measureText(char).width*(p.horizontalScale||1)+(p.letterSpacing||0)*scale;}});
      }
      const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.userData.ephemeral=true;texture.anisotropy=Math.min(this.renderer.capabilities.getMaxAnisotropy(),8);
      const ink=new THREE.Mesh(new THREE.PlaneGeometry(p.width,p.height),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-4}));
      ink.rotation.x=-Math.PI/2;const group=new THREE.Group();group.add(ink);group.position.set(p.x,.012,p.z);group.rotation.y=p.rotation*Math.PI/180;group.userData.floorPoem=true;this.roomGroup.add(group);
    }
  }
  addCeilingStructure(room,b){
    const ceiling=room.ceiling;
    const beam=(a,end,width,depth,tags={})=>{
      const dx=end[0]-a[0],dz=end[1]-a[1],mesh=this.box(Math.hypot(dx,dz),depth,width,ceiling.color||'#f6f5f0');
      mesh.position.set((a[0]+end[0])/2,room.height-depth/2,(a[1]+end[1])/2);mesh.rotation.y=Math.atan2(-dz,dx);mesh.castShadow=false;
      Object.assign(mesh.userData,{overheadStructure:true},tags);this.roomGroup.add(mesh);
    };
    for(const item of ceiling.beams||[])beam(item.a,item.b,item.width,item.depth,{wallIndices:item.wallIndices});
    if(ceiling.perimeterBeam)for(const wall of this.wallData.filter(w=>w.perimeter)){
      const {width,depth}=ceiling.perimeterBeam,offset=p=>p.map((v,i)=>v+wall.normal[i]*width/2);
      beam(offset(wall.a),offset(wall.b),width,depth,{wallIndex:wall.index});
    }
    const lights=ceiling.suspendedLights;if(!lights)return;
    const add=(mesh,x,y,z)=>{mesh.position.set(x,y,z);mesh.castShadow=false;mesh.userData.ceilingFixture=true;this.roomGroup.add(mesh);};
    for(const z of new Set(lights.positions.map(p=>p.z))){
      add(this.box(b.width-1,.025,.025,'#525754'),b.cx,lights.supportHeight,z);
      for(const x of [b.minX+.8,b.cx,b.maxX-.8])add(this.box(.012,room.height-lights.supportHeight,.012,'#525754'),x,(room.height+lights.supportHeight)/2,z);
    }
    for(const p of lights.positions){
      add(this.box(lights.length,.045,lights.width,'#5c625f'),p.x,lights.bottom+.0225,p.z);
      const face=new THREE.Mesh(new THREE.PlaneGeometry(lights.length-.035,lights.width-.025),new THREE.MeshStandardMaterial({color:'#ffffff',emissive:'#ffffff',emissiveIntensity:.65,roughness:.35}));face.rotation.x=Math.PI/2;add(face,p.x,lights.bottom-.001,p.z);
      for(const x of [p.x-lights.length*.32,p.x+lights.length*.32])add(this.box(.012,lights.supportHeight-lights.bottom-.045,.012,'#525754'),x,(lights.supportHeight+lights.bottom+.045)/2,p.z);
    }
  }
  addWork(work,index){
    const g=new THREE.Group();g.userData.workId=work.id;g.userData.work=work;this.workGroups.set(work.id,g);
    if(work.type==='art'){
      const outer=workBounds(work),padding=work.frame==='none'?0:(work.frameWidth||.008);
      const floating=work.mounting==='floating'&&work.frame!=='none',hanging=work.mounting==='hanging-banner';
      let imageDepth=work.depth/2+.001;
      if(hanging){
        imageDepth=.001;
        const radius=(work.rodDiameter||.018)/2,rodMaterial=new THREE.MeshStandardMaterial({color:'#c2c7c4',metalness:.35,roughness:.5});
        for(const y of [-work.height/2,work.height/2]){const rod=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,work.rodLength||work.width+.06,24),rodMaterial.clone());rod.rotation.z=Math.PI/2;rod.position.set(0,y,.002);rod.castShadow=false;g.add(rod);}
        const rise=work.ropeRise||.25,hook=new THREE.Vector3(0,work.height/2+rise,-(work.wallOffset||.055)+.004);
        for(const x of [-work.width*.43,work.width*.43]){
          const end=new THREE.Vector3(x,work.height/2+.005,0),direction=hook.clone().sub(end);
          const rope=new THREE.Mesh(new THREE.CylinderGeometry(.0016,.0016,direction.length(),8),new THREE.MeshBasicMaterial({color:'#64645e'}));
          rope.position.copy(end).add(hook).multiplyScalar(.5);rope.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());g.add(rope);
        }
        const pin=new THREE.Mesh(new THREE.SphereGeometry(.006,10,8),new THREE.MeshBasicMaterial({color:'#676b66'}));pin.position.copy(hook);g.add(pin);
      }else if(floating){
        const panelDepth=work.panelDepth||.01,panelFront=work.depth/2-(work.panelRecess??.002);
        const panel=this.box(work.width,work.height,panelDepth,'#393733');panel.position.z=panelFront-panelDepth/2;g.add(panel);imageDepth=panelFront+.0005;
      }else g.add(this.box(outer.width,outer.height,work.depth,work.paperBorder?'#ffffff':'#faf9f5'));
      const imagePlane=new THREE.Mesh(new THREE.PlaneGeometry(work.width,work.height),new THREE.MeshBasicMaterial({color:hanging?(work.fabricColor||'#faf9f5'):'#eeede5',side:hanging?THREE.DoubleSide:THREE.FrontSide,transparent:hanging,opacity:hanging?(work.fabricOpacity??.92):1,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-4}));imagePlane.position.z=imageDepth;g.add(imagePlane);
      if(work.mounting==='corner-pins'){
        const inset=work.pinInset,plastic=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.52}),metal=new THREE.MeshStandardMaterial({color:'#a5aaa8',metalness:.8,roughness:.3});
        for(const x of [-outer.width/2+inset,outer.width/2-inset])for(const y of [-outer.height/2+inset,outer.height/2-inset]){
          const pin=new THREE.Group();pin.position.set(x,y,work.depth/2+.0003);pin.userData.cornerPin=true;
          for(const [diameter,length,z,material] of [[work.pinDiameter||.0096,.002,.001,plastic],[.0065,.0025,.00325,plastic],[.0065,.002,.0055,plastic],[.004,.0007,.00685,metal]]){
            const part=new THREE.Mesh(new THREE.CylinderGeometry(diameter/2,diameter/2,length,20),material.clone());part.rotation.x=Math.PI/2;part.position.z=z;part.castShadow=true;pin.add(part);
          }
          g.add(pin);
        }
        plastic.dispose();metal.dispose();
      }
      if(work.frame!=='none'){
        const color={black:'#292b28',white:'#f9f9f4',wood:'#b5a58b'}[work.frame];
        [[outer.width,padding,0,(outer.height-padding)/2],[outer.width,padding,0,-(outer.height-padding)/2],[padding,outer.height,-(outer.width-padding)/2,0],[padding,outer.height,(outer.width-padding)/2,0]].forEach(([w,h,x,y])=>{const frame=this.box(w,h,floating?work.depth:work.depth+.009,color);frame.position.set(x,y,0);g.add(frame);});
      }
      g.userData.imagePlane=imagePlane;const initialSource=work.thumbnail&&work.width<=.6?work.thumbnail:work.image;g.userData.lowResolution=initialSource!==work.image;
      if(initialSource)this.loadTexture(initialSource).then(texture=>{if(imagePlane.material&&texture&&!g.userData.highResolutionApplied)this.applyArtTexture(g,texture);}).catch(()=>{});
    }else if(work.displayKind==='book-table'){
      const tableTop=this.box(work.width,.035,work.depth,'#b1a08c');tableTop.position.y=work.height/2-.018;g.add(tableTop);
      for(const x of [-work.width/2+.035,work.width/2-.035])for(const z of [-work.depth/2+.035,work.depth/2-.035]){const leg=this.box(.026,work.height-.035,.026,'#6f6458');leg.position.set(x,-.018,z);g.add(leg);}
      const titles=work.books||[];
      titles.forEach((book,i)=>{const cover=document.createElement('canvas');cover.width=256;cover.height=360;const ctx=cover.getContext('2d');ctx.fillStyle=['#eee9df','#ddd9cd','#e2e5dd','#d9dfde','#ede8e2'][i%5];ctx.fillRect(0,0,256,360);ctx.fillStyle='#4c5048';ctx.font='22px "PingFang SC", sans-serif';ctx.textAlign='center';const text=String(book.title||'参考书');Array.from(text).forEach((char,n)=>ctx.fillText(char,128,72+n*29));const texture=new THREE.CanvasTexture(cover);texture.userData.ephemeral=true;texture.colorSpace=THREE.SRGBColorSpace;const group=new THREE.Group(),w=.112,h=.16,thick=.018;const body=this.box(w,thick,h,'#e7e1d6');group.add(body);const face=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));face.rotation.x=-Math.PI/2;face.position.y=thick/2+.001;group.add(face);group.position.set((i-2)*.125,work.height/2+.01,-.015+(i%2)*.045);group.rotation.y=(i%2?1:-1)*.08;g.add(group);});
      if(work.image){
        const paper=this.box(.297,.0015,.21,'#fff');paper.position.set(-.16,work.height/2+.040,.040);g.add(paper);
        const guide=new THREE.Mesh(new THREE.PlaneGeometry(.297,.21),new THREE.MeshBasicMaterial({color:'#fff',toneMapped:false}));guide.rotation.x=-Math.PI/2;guide.position.set(-.16,work.height/2+.041,.040);g.add(guide);g.userData.imagePlane=guide;
        this.loadTexture(work.image).then(texture=>{if(guide.material&&texture){guide.material.map=texture;guide.material.needsUpdate=true;}}).catch(()=>{});
      }
    }else{
      g.add(this.box(work.width,work.height,work.depth,work.color||(work.type==='partition'?'#f7f7f0':work.type==='plinth'?'#e5e4db':'#889683')));
      if(work.type==='block'){const line=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(work.width,work.height,work.depth)),new THREE.LineBasicMaterial({color:'#67765e',transparent:true,opacity:.3}));g.add(line);}
    }
    const number=/^once_(\d+)$/.exec(work.name)?.[1];
    const marker=this.label(number||(work.displayKind==='book-table'?'书台':work.name.startsWith('VESSEL')?'影像':'前言'),.32,'#faf9f3');marker.userData.marker=true;marker.position.set(0,work.height/2+.12,.2);g.userData.planMarker=marker;g.add(marker);
    this.worksGroup.add(g);this.positionWork(work);g.traverse(child=>{child.userData.workId=work.id;});
  }
  async setTextPanelImage(id,image){
    const g=this.workGroups.get(id),work=g?.userData.work;
    if(!g||!work||work.mounting!=='hanging-banner')return;
    work.image=work.thumbnail=image;
    g.userData.highResolutionApplied=true;
    const texture=await this.loadTexture(image);
    if(texture&&this.workGroups.get(id)===g&&work.image===image)this.applyArtTexture(g,texture);
  }
  applyArtTexture(g,texture){
    const plane=g.userData.imagePlane,work=g.userData.work;if(!plane?.material)return;
    let map=texture;
    if(work.mounting==='hanging-banner'&&!work.bannerArtwork){
      const scale=1200,canvas=document.createElement('canvas');canvas.width=Math.round(work.width*scale);canvas.height=Math.round(work.height*scale);
      const ctx=canvas.getContext('2d');ctx.fillStyle=work.fabricColor||'#faf9f5';ctx.fillRect(0,0,canvas.width,canvas.height);
      if(work.prefaceParagraphs&&work.poemLines){
        const top=work.elevation+work.height,left=.105*scale,width=(work.width-.21)*scale;
        const text=(line,height,size,family='"PingFang SC", sans-serif',color='#30322e',weight=400)=>{ctx.font=`${weight} ${size*scale}px ${family}`;ctx.fillStyle=color;ctx.fillText(line,left,(top-height)*scale);};
        text('后知后觉',2.35,.043);text('once',2.282,.03);text('姜昕宇  /  2026',2.229,.0165,'"PingFang SC", sans-serif','#696d64');
        let y=2.09;
        for(const line of work.poemLines){if(line)text(line,y,.022,'"Once Poetry Sans", sans-serif','#30322e',700);y-=.036;}
        y=1.49;ctx.font=`400 ${.019*scale}px "Songti SC", "SimSun", serif`;
        for(const paragraph of work.prefaceParagraphs){
          let line='';for(const char of paragraph){if(line&&ctx.measureText(line+char).width>width&&!/[，。；！？、”）]/.test(char)){text(line,y,.019,'"Songti SC", "SimSun", serif');y-=.032;line='';}line+=char;}
          if(line){text(line,y,.019,'"Songti SC", "SimSun", serif');y-=.032;}y-=.023;
        }
      }else{
        const contentWidth=Math.min(work.contentWidth||work.width*.88,work.width),contentHeight=contentWidth*texture.image.height/texture.image.width;
        const contentCenter=work.contentCenterHeight??work.elevation+work.height/2;
        ctx.drawImage(texture.image,(work.width-contentWidth)*scale/2,(work.elevation+work.height-contentCenter-contentHeight/2)*scale,contentWidth*scale,contentHeight*scale);
      }
      map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.userData.ephemeral=true;
      map.anisotropy=Math.min(this.renderer.capabilities.getMaxAnisotropy(),8);
    }else if(work.imageFit==='cover'){
      map=texture.clone();map.userData={...texture.userData,ephemeral:true};
      const sourceRatio=texture.image.width/texture.image.height,targetRatio=work.width/work.height;
      if(sourceRatio>targetRatio){map.repeat.x=targetRatio/sourceRatio;map.offset.x=(1-map.repeat.x)/2;}
      else{map.repeat.y=sourceRatio/targetRatio;map.offset.y=(1-map.repeat.y)/2;}
      map.needsUpdate=true;
    }
    if(plane.material.map?.userData.ephemeral)plane.material.map.dispose();
    plane.material.map=map;plane.material.color.set('#fff');plane.material.needsUpdate=true;
  }
  spacePlanMarkers(){
    for(const wall of this.wallData){
      const group=[...this.workGroups.values()].filter(g=>g.userData.work.type==='art'&&g.userData.work.wall===wall.index).sort((a,b)=>a.userData.work.along-b.userData.work.along);
      const positions=[];
      group.forEach((g,i)=>positions.push(Math.max(g.userData.work.along,i?positions[i-1]+.42:.2)));
      for(let i=positions.length-1;i>=0;i--)positions[i]=Math.min(positions[i],i===positions.length-1?wall.length-.2:positions[i+1]-.42);
      group.forEach((g,i)=>{
        const marker=g.userData.planMarker,w=g.userData.work,dx=positions[i]-w.along;marker.position.x=dx;
        const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,marker.position.y,.01),new THREE.Vector3(dx,marker.position.y,.2)]),new THREE.LineBasicMaterial({color:'#faf9f3',transparent:true,opacity:.55,depthTest:false}));line.userData.marker=true;line.renderOrder=3;g.add(line);
      });
    }
  }
  async loadTexture(source){
    if(this.textures.has(source))return this.textures.get(source);
    const promise=(async()=>{
      const url=source.startsWith('sample:')?sampleImage(source.split(':')[1]):await this.callbacks.imageSource(source);
      const texture=await new THREE.TextureLoader().loadAsync(url),limit=matchMedia('(max-width:600px)').matches?768:1536;
      if(Math.max(texture.image.width,texture.image.height)>limit){const original=texture.image,canvas=document.createElement('canvas'),scale=limit/Math.max(original.width,original.height);canvas.width=Math.round(original.width*scale);canvas.height=Math.round(original.height*scale);canvas.getContext('2d').drawImage(original,0,0,canvas.width,canvas.height);texture.image=canvas;texture.needsUpdate=true;original.src='';}
      texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(this.renderer.capabilities.getMaxAnisotropy(),8);return texture;
    })();this.textures.set(source,promise);this.loadingTextures.add(promise);promise.finally(()=>this.loadingTextures.delete(promise)).catch(()=>{if(this.textures.get(source)===promise)this.textures.delete(source);});return promise;
  }
  positionWork(work){
    if(work.type==='art')wallPosition(work,this.state.room);
    const g=this.workGroups.get(work.id);if(!g)return;g.position.set(work.x,work.elevation+workBounds(work).height/2,work.z);g.rotation.y=work.rotation*Math.PI/180;
    if(this.selected===work.id)this.setSelected(work.id);
  }
  setSelected(id){
    this.selected=id;
    if(this.selection){this.scene.remove(this.selection);this.selection.geometry.dispose();this.selection.material.dispose();this.selection=null;}
    const g=this.workGroups.get(id);if(g){const w=g.userData.work,outer=workBounds(w);this.selection=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(outer.width+.035,outer.height+.035,w.depth+.035)),new THREE.LineBasicMaterial({color:'#688b65',depthTest:false,transparent:true,opacity:.75}));this.selection.position.copy(g.position);this.selection.rotation.copy(g.rotation);this.selection.visible=g.visible;this.selection.renderOrder=5;this.scene.add(this.selection);}
  }
  applyVisibility(){
    const selectedWall=this.mode.startsWith('wall:')?Number(this.mode.split(':')[1]):null;
    this.roomGroup.children.forEach(o=>{o.visible=selectedWall===null||o.userData.wallIndex===selectedWall||!!o.userData.wallIndices?.includes(selectedWall);});
    this.roomGroup.children.forEach(o=>{
      if(o.userData.ceilingSurface||o.userData.ceilingFixture)o.visible=this.mode==='eye';
      if(o.userData.overheadStructure&&(this.mode==='overview'||this.mode==='plan'))o.visible=false;
    });
    if(this.grid)this.grid.visible=this.gridVisible&&selectedWall===null;
    this.roomGroup.traverse(o=>{if(o.userData.wallLabel)o.visible=false;});
    this.workGroups.forEach(g=>{g.visible=selectedWall===null||(g.userData.work.type==='art'&&g.userData.work.wall===selectedWall);g.traverse(o=>{if(o.userData.marker)o.visible=this.mode==='plan';});});
    if(this.selection)this.selection.visible=selectedWall===null||this.state.works.find(w=>w.id===this.selected)?.wall===selectedWall;this.updateCutaway();
  }
  updateCutaway(){
    if(!this.wallData)return;
    this.workGroups.forEach(g=>{const work=g.userData.work,wall=this.wallData[work.wall];if(this.mode==='overview'&&work.type==='art'&&wall?.perimeter)g.visible=wall.normal[0]*(this.camera.position.x-work.x)+wall.normal[1]*(this.camera.position.z-work.z)>0;
      const close=this.mode==='eye'&&this.camera.position.distanceTo(g.position)<1.8,largeOnScreen=this.camera===this.orthographic&&work.width/(this.orthographic.right-this.orthographic.left)*this.element.clientWidth*this.orthographic.zoom>260;
      if(g.visible&&(close||largeOnScreen||this.selected===work.id))this.upgradeArt(g);
    });
    if(this.mode==='overview'&&this.selection)this.selection.visible=!!this.workGroups.get(this.selected)?.visible;
  }
  upgradeArt(g){
    if(!g.userData.lowResolution||g.userData.highResolutionRequested||performance.now()<(g.userData.retryAt||0))return;
    const plane=g.userData.imagePlane,work=g.userData.work;if(!plane||!work.image)return;g.userData.highResolutionRequested=true;
    this.loadTexture(work.image).then(texture=>{this.applyArtTexture(g,texture);g.userData.highResolutionApplied=true;g.userData.lowResolution=false;}).catch(()=>{g.userData.highResolutionRequested=false;g.userData.retryAt=performance.now()+10000;});
  }
  view(mode){
    if(!this.state)return;this.navigation.clear();if(this.mode!==mode||this.focusedTextPanel)this.orthographic.zoom=1;this.focusedTextPanel=null;this.mode=mode;const b=bounds(this.state.room),max=Math.max(b.width,b.depth);
    this.camera=mode==='overview'||mode==='eye'?this.perspective:this.orthographic;this.controls.object=this.camera;
    this.perspective.fov=mode==='eye'?70:42;this.perspective.updateProjectionMatrix();
    this.controls.enableRotate=mode==='overview'||mode==='eye';this.controls.enablePan=mode!=='eye';this.controls.enableZoom=mode!=='eye';this.controls.minDistance=mode==='eye'?.03:.5;this.controls.maxDistance=mode==='eye'?.03:100;
    this.controls.mouseButtons.LEFT=mode==='plan'||mode.startsWith('wall:')?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;
    this.controls.minPolarAngle=mode==='eye'?Math.PI*.12:0;this.controls.maxPolarAngle=mode==='eye'?Math.PI*.88:Math.PI*.495;
    this.camera.up.set(0,1,0);
    if(mode==='overview'){
      this.controls.target.set(b.cx,this.state.room.height*.35,b.cz);
      const halfFov=Math.min(this.perspective.fov*Math.PI/360,Math.atan(Math.tan(this.perspective.fov*Math.PI/360)*this.perspective.aspect));
      const radius=Math.hypot(b.width,b.depth,this.state.room.height)/2,distance=radius/Math.sin(halfFov)*1.04,dir=new THREE.Vector3(.85,.75,1.1).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir,distance);
    }else if(mode==='plan'){
      this.camera.up.set(0,0,-1);this.camera.position.set(b.cx,50,b.cz);this.controls.target.set(b.cx,0,b.cz);
    }else if(mode==='eye'){
      const start=eyeStart(this.state.room),look=this.state.room.entryView?new THREE.Vector3(start.dx,start.dy||0,start.dz):new THREE.Vector3(b.cx-start.x,0,b.cz-start.z);if(look.lengthSq()<.01)look.set(start.dx,0,start.dz);look.normalize();this.camera.position.set(start.x,1.6,start.z);this.controls.target.set(start.x+look.x*.03,1.6+look.y*.03,start.z+look.z*.03);
    }else if(mode.startsWith('wall:')){
      const wall=walls(this.state.room)[Number(mode.split(':')[1])];const x=(wall.a[0]+wall.b[0])/2,z=(wall.a[1]+wall.b[1])/2;
      const height=this.state.room.ceiling?.enabled?this.state.room.height:wall.height;
      this.camera.position.set(x+wall.normal[0]*30,height/2,z+wall.normal[1]*30);this.controls.target.set(x,height/2,z);
    }
    this.camera.lookAt(this.controls.target);this.controls.update();this.applyVisibility();this.resize();
  }
  moveEye(forward,right,distance=.25){
    if(this.mode!=='eye'||!this.state)return;
    const dir=new THREE.Vector3();this.camera.getWorldDirection(dir);dir.y=0;dir.normalize();
    const side=new THREE.Vector3().crossVectors(dir,new THREE.Vector3(0,1,0));const move=dir.multiplyScalar(forward).addScaledVector(side,right);if(!move.lengthSq())return;move.normalize().multiplyScalar(distance);
    const p=this.camera.position,next=p.clone().add(move);
    if(!canWalk(this.state.room,next.x,next.z)){if(canWalk(this.state.room,next.x,p.z))move.z=0;else if(canWalk(this.state.room,p.x,next.z))move.x=0;else return;}
    this.camera.position.add(move);this.controls.target.add(move);this.controls.update();
  }
  focusFloorPoem(id){
    const p=this.state.room.floorPoems?.find(p=>p.id===id);if(!p)return;
    const angle=p.rotation*Math.PI/180,dx=-Math.sin(angle),dz=-Math.cos(angle),distance=[p.focusDistance||2.3,2.3,1.6,1].find(d=>canWalk(this.state.room,p.x-dx*d,p.z-dz*d));if(!distance)return;
    const x=p.x-dx*distance,z=p.z-dz*distance;
    this.camera.position.set(x,1.6,z);const look=new THREE.Vector3(p.x,p.focusHeight??.6,p.z).sub(this.camera.position).normalize();
    this.controls.target.copy(this.camera.position).addScaledVector(look,.03);this.camera.lookAt(this.controls.target);this.controls.update();
  }
  focusTextPanel(id){
    const w=this.state.works.find(work=>work.id===id);if(!w||!this.mode.startsWith('wall:'))return;
    const wall=walls(this.state.room)[w.wall],height=w.height+(w.ropeRise||0),center=w.elevation+height/2;
    this.controls.target.set(w.x,center,w.z);this.camera.position.set(w.x+wall.normal[0]*30,center,w.z+wall.normal[1]*30);
    this.focusedTextPanel=id;this.orthographic.zoom=1;this.resize();this.camera.lookAt(this.controls.target);this.controls.update();
  }
  stepWalking(dt){
    if(this.mode!=='eye'||document.hidden||document.querySelector('dialog[open]'))return;
    let forward=0,right=0;for(const direction of this.navigation){if(direction==='forward')forward++;if(direction==='back')forward--;if(direction==='left')right--;if(direction==='right')right++;}
    if(forward||right)this.moveEye(forward,right,dt*1.35);
  }
  pointerRay(event){
    const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);return this.raycaster;
  }
  bindPointers(){
    const canvas=this.renderer.domElement;
    canvas.addEventListener('pointerdown',e=>{
      if(this.mode==='eye')return;
      if(e.button!==0||!e.isPrimary)return;this.pointerRay(e);const hit=this.raycaster.intersectObjects([...this.workGroups.values()].filter(g=>g.visible),true).find(h=>h.object.visible&&h.object.userData.workId);
      this.down={x:e.clientX,y:e.clientY,id:hit?.object.userData.workId,moved:false};
      if(hit&&this.editable){
        const w=this.state.works.find(w=>w.id===this.down.id);if(!w)return;
        this.controls.enabled=false;this.callbacks.select(w.id);this.callbacks.beginDrag();
        const wall=w.type==='art'?walls(this.state.room)[w.wall]:null;
        const plane=wall&&this.mode!=='plan'?new THREE.Plane(new THREE.Vector3(wall.normal[0],0,wall.normal[1]),-wall.normal[0]*w.x-wall.normal[1]*w.z):new THREE.Plane(new THREE.Vector3(0,1,0),-(w.elevation+workBounds(w).height/2));
        const point=this.raycaster.ray.intersectPlane(plane,new THREE.Vector3());this.dragging={w,wall,plane,offset:point?point.clone().sub(new THREE.Vector3(w.x,w.elevation+workBounds(w).height/2,w.z)):new THREE.Vector3()};canvas.setPointerCapture(e.pointerId);
      }
    },{capture:true});
    canvas.addEventListener('pointermove',e=>{
      if(this.down&&Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y)>3)this.down.moved=true;
      if(!this.dragging)return;
      const d=this.dragging;this.pointerRay(e);const hit=this.raycaster.ray.intersectPlane(d.plane,new THREE.Vector3());if(!hit)return;hit.sub(d.offset);
      if(d.wall){d.w.along=(hit.x-d.wall.a[0])*d.wall.tangent[0]+(hit.z-d.wall.a[1])*d.wall.tangent[1];if(this.mode!=='plan')d.w.elevation=hit.y-workBounds(d.w).height/2;wallPosition(d.w,this.state.room);}
      else if(contains(this.state.room,hit.x,hit.z)){d.w.x=Math.round(hit.x*100)/100;d.w.z=Math.round(hit.z*100)/100;}
      this.positionWork(d.w);this.callbacks.drag(d.w);
    });
    const end=e=>{
      if(this.dragging){this.dragging=null;this.controls.enabled=true;this.callbacks.endDrag(this.down?.moved);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}
      else if(this.down&&!this.down.moved)this.callbacks.select(this.down.id||null);this.down=null;
    };canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.element.dispatchEvent(new CustomEvent('render-error'));});
    window.addEventListener('keydown',e=>{
      if(this.mode!=='eye'||/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)||document.querySelector('dialog[open]'))return;
      const direction={w:'forward',arrowup:'forward',s:'back',arrowdown:'back',a:'left',arrowleft:'left',d:'right',arrowright:'right'}[e.key.toLowerCase()];if(!direction)return;e.preventDefault();
      this.navigation.add(direction);if(!e.repeat)this.moveEye(direction==='forward'?1:direction==='back'?-1:0,direction==='right'?1:direction==='left'?-1:0,.15);
    });
    window.addEventListener('keyup',e=>{const direction={w:'forward',arrowup:'forward',s:'back',arrowdown:'back',a:'left',arrowleft:'left',d:'right',arrowright:'right'}[e.key.toLowerCase()];if(direction)this.navigation.delete(direction);});
    window.addEventListener('blur',()=>this.navigation.clear());document.addEventListener('visibilitychange',()=>this.navigation.clear());
  }
  async capture(width=2560){
    if(this.mode!=='plan')this.workGroups.forEach(g=>{if(g.visible)this.upgradeArt(g);});
    await Promise.allSettled([...this.loadingTextures]);
    const old=this.renderer.getSize(new THREE.Vector2()),oldRatio=this.renderer.getPixelRatio(),aspect=old.x/old.y;
    const height=this.mode==='plan'?Math.round(width*.72):Math.round(width*.625),exportAspect=width/height;
    const hidden=[];this.scene.traverse(o=>{if(o===this.selection||o===this.grid||(o.userData.marker&&this.mode!=='plan')||o.userData.wallLabel){if(o.visible){hidden.push(o);o.visible=false;}}});
    try{
      this.renderer.setPixelRatio(1);this.renderer.setSize(width,height,false);this.perspective.aspect=exportAspect;this.perspective.updateProjectionMatrix();this.updateOrtho(exportAspect);this.renderer.render(this.scene,this.camera);
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(this.renderer.domElement,0,0);return canvas;
    }finally{
      this.renderer.setPixelRatio(oldRatio);this.renderer.setSize(old.x,old.y,false);this.perspective.aspect=aspect;this.perspective.updateProjectionMatrix();this.updateOrtho(aspect);hidden.forEach(o=>o.visible=true);this.renderer.render(this.scene,this.camera);
    }
  }
}
