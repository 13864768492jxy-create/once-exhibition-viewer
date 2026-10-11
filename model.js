export const FORMAT = 'exhibition-planner-v1';
export const clone = value => structuredClone(value);
export const cm = value => Math.round(value * 1000) / 10;
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const uid = () => globalThis.crypto?.randomUUID?.() || `w-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const sampleCache = new Map();

export function sampleImage(which) {
  if (sampleCache.has(which)) return sampleCache.get(which);
  const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 760;
  const ctx = canvas.getContext('2d');
  const themes = [ ['#f2eee4','#3e5c55','#b59969'], ['#ddd8ce','#424c4d','#a4aea3'], ['#efe8db','#756d5a','#b1bea8'] ];
  const colors = themes[(Number(which) - 1) % themes.length];
  ctx.fillStyle = colors[0]; ctx.fillRect(0,0,600,760);
  if (Number(which) === 2) {
    ctx.fillStyle=colors[2];ctx.fillRect(70,105,465,330);
    ctx.fillStyle=colors[1];ctx.fillRect(160,250,310,395);
    ctx.fillStyle=colors[0];ctx.fillRect(160,360,140,15);
  } else if (Number(which) === 3) {
    ctx.fillStyle=colors[2];ctx.beginPath();ctx.arc(300,365,215,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=colors[1];ctx.fillRect(130,395,360,220);
    ctx.fillStyle=colors[0];ctx.fillRect(220,395,95,220);
  } else {
    ctx.fillStyle=colors[1];ctx.fillRect(90,150,130,455);
    ctx.fillStyle=colors[2];ctx.fillRect(270,270,240,335);
    ctx.fillStyle=colors[0];ctx.beginPath();ctx.arc(365,300,96,0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle=colors[1];ctx.font='15px sans-serif';ctx.fillText('STUDY  /  '+String(which).padStart(2,'0'),70,705);
  const url=canvas.toDataURL('image/png'); sampleCache.set(which,url); return url;
}

export function walls(room) {
  const edges=room.points.map((a,i) => {
    const b=room.points[(i+1)%room.points.length], dx=b[0]-a[0], dz=b[1]-a[1], length=Math.hypot(dx,dz);
    return {index:i,a,b,length,tangent:[dx/length,dz/length],normal:[-dz/length,dx/length],rotation:Math.atan2(-dz,dx),height:room.height,perimeter:true,name:`墙 ${i+1}`};
  });
  for(const [i,inner] of (room.interiorWalls||[]).entries()){
    const dx=inner.b[0]-inner.a[0],dz=inner.b[1]-inner.a[1],length=Math.hypot(dx,dz),nx=-dz/length,nz=dx/length;
    for(const side of [1,-1]){
      const a=(side===1?inner.a:inner.b).map((v,n)=>v+(n?nz:nx)*inner.thickness/2*side),b=(side===1?inner.b:inner.a).map((v,n)=>v+(n?nz:nx)*inner.thickness/2*side);
      edges.push({index:edges.length,a,b,length,tangent:[dx/length*side,dz/length*side],normal:[nx*side,nz*side],rotation:Math.atan2(nx*side,nz*side),height:inner.height,perimeter:false,name:`${inner.name||'中间突出墙'} · ${side===1?'右侧':'左侧'}`,innerIndex:i});
    }
  }
  return edges;
}
export function bounds(room) {
  const xs=room.points.map(p=>p[0]),zs=room.points.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  return {minX,maxX,minZ,maxZ,width:maxX-minX,depth:maxZ-minZ,cx:(minX+maxX)/2,cz:(minZ+maxZ)/2};
}
export function wallPosition(work,room) {
  const wall=walls(room)[work.wall]; if(!wall)return;
  const outer=workBounds(work),edge=Math.min(outer.width/2+.03,wall.length/2);
  work.along=clamp(Number(work.along)||wall.length/2,edge,wall.length-edge);
  work.elevation=clamp(work.elevation,0,Math.max(0,wall.height-outer.height));
  const offset=work.depth/2+.002;
  work.x=wall.a[0]+wall.tangent[0]*work.along+wall.normal[0]*offset;
  work.z=wall.a[1]+wall.tangent[1]*work.along+wall.normal[1]*offset;
  work.rotation=wall.rotation*180/Math.PI;
}
export function workBounds(work){const framed=work.type==='art'&&work.frame&&work.frame!=='none',border=framed?(work.mat||0)+(work.frameWidth||.008):0;return {width:framed&&work.frameOuterWidth?work.frameOuterWidth:work.width+border*2,height:framed&&work.frameOuterHeight?work.frameOuterHeight:work.height+border*2};}
export function fitFrame(work){if(!work.frameOuterWidth||!work.frameOuterHeight||work.frame==='none')return;const border=(work.mat||0)+(work.frameWidth||.008),ratio=work.imageRatio||work.width/work.height,width=Math.max(.005,work.frameOuterWidth-border*2),height=Math.max(.005,work.frameOuterHeight-border*2);work.width=clamp(Math.min(width,height*ratio),.005,30);work.height=clamp(work.width/ratio,.005,30);}
export function resizeArtwork(work,field,value) {
  if(work.type!=='art'||!['width','height','frameOuterWidth','frameOuterHeight'].includes(field)||!Number.isFinite(value))return false;
  const framed=!!work.frame&&work.frame!=='none',outerField=field.startsWith('frameOuter');
  if(outerField&&!framed)return false;
  const outer=workBounds(work),border=framed?2*((work.mat||0)+(work.frameWidth||.008)):0;
  // Keep the existing mat, frame strip, and any additional white margin in centimetres.
  const padW=framed?Math.max(border,outer.width-work.width):0,padH=framed?Math.max(border,outer.height-work.height):0;
  const minW=framed?Math.max(.005,.1-padW):.005,minH=framed?Math.max(.005,.1-padH):.005;
  const maxW=Math.max(minW,30-padW),maxH=Math.max(minH,30-padH);
  const axis=field==='width'||field==='frameOuterWidth'?'width':'height';
  const target=value-(outerField?(axis==='width'?padW:padH):0);
  if(work.lockAspect!==false){
    const minScale=Math.max(minW/work.width,minH/work.height),maxScale=Math.min(maxW/work.width,maxH/work.height);
    if(minScale>maxScale)return false;
    const scale=clamp(target/work[axis],minScale,maxScale);
    work.width=clamp(work.width*scale,minW,maxW);work.height=clamp(work.height*scale,minH,maxH);
  }else work[axis]=clamp(target,axis==='width'?minW:minH,axis==='width'?maxW:maxH);
  if(framed){
    work.frameOuterWidth=Math.min(30,work.width+padW);work.frameOuterHeight=Math.min(30,work.height+padH);
    const ratio=work.width/work.height;
    if(ratio>=.02&&ratio<=50)work.imageRatio=ratio;else delete work.imageRatio;
  }else{
    delete work.frameOuterWidth;delete work.frameOuterHeight;delete work.imageRatio;
  }
  return true;
}
export function imageItems(state){return [...state.works,...(state.room.fixtures||[]).filter(f=>f.type==='tv')];}
export function contains(room,x,z) {
  let inside=false;
  for(let i=0,j=room.points.length-1;i<room.points.length;j=i++) {
    const a=room.points[i],b=room.points[j];
    if(((a[1]>z)!==(b[1]>z))&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function canWalk(room,x,z,radius=.12) {
  if(!contains(room,x,z))return false;
  const distance=(a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz),0,1);return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);};
  if(room.points.some((p,i)=>distance(p,room.points[(i+1)%room.points.length])<radius))return false;
  if((room.interiorWalls||[]).some(w=>distance(w.a,w.b)<radius+w.thickness/2))return false;
  return !(room.columns||[]).some(c=>Math.hypot(x-c.x,z-c.z)<radius+c.diameter/2);
}
export function eyeStart(room) {
  const candidates=[];
  if(room.entryView)candidates.push(room.entryView);
  for(const door of (room.openings||[]).filter(o=>o.type==='door')){const wall=walls(room)[door.wall];candidates.push({x:wall.a[0]+wall.tangent[0]*(door.start+door.width/2)+wall.normal[0]*.7,z:wall.a[1]+wall.tangent[1]*(door.start+door.width/2)+wall.normal[1]*.7,dx:wall.normal[0],dz:wall.normal[1]});}
  const b=bounds(room);candidates.push({x:b.cx,z:b.maxZ-.8,dx:0,dz:-1});
  for(let z=b.maxZ-.4;z>b.minZ;z-=.4)for(let x=b.cx;x<b.maxX;x+=.4)candidates.push({x,z,dx:0,dz:-1});
  return candidates.find(p=>canWalk(room,p.x,p.z))||{x:b.cx,z:b.cz,dx:0,dz:-1};
}
export function normalizeOutline(points) {
  if(!Array.isArray(points)||points.length<3||points.length>40)throw Error('轮廓需要 3 到 40 个角点。');
  let area=0;
  for(let i=0;i<points.length;i++){
    const p=points[i],q=points[(i+1)%points.length];
    if(!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>100))throw Error('角点坐标须在 -10000 到 10000 厘米之间。');
    if(Math.hypot(p[0]-q[0],p[1]-q[1])<.1)throw Error('相邻角点距离至少 10 厘米。');
    area+=p[0]*q[1]-q[0]*p[1];
  }
  if(Math.abs(area)<2)throw Error('展厅面积至少为 1 平方米。');
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const between=(a,b,c)=>Math.abs(cross(a,b,c))<1e-9&&c[0]>=Math.min(a[0],b[0])-1e-9&&c[0]<=Math.max(a[0],b[0])+1e-9&&c[1]>=Math.min(a[1],b[1])-1e-9&&c[1]<=Math.max(a[1],b[1])+1e-9;
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
    if(j===i+1||(i===0&&j===points.length-1))continue;
    const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];
    if((cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||between(a,b,c)||between(a,b,d)||between(c,d,a)||between(c,d,b))throw Error('轮廓边线不能相交，请按边界顺序填写角点。');
  }
  return area>0?points:[...points].reverse();
}
export function validateState(value) {
  const s=clone(value);
  if(s?.format!==FORMAT||typeof s.title!=='string'||s.title.length>120||!s.room||!Array.isArray(s.works)||s.works.length>200)throw Error('这不是有效的布展方案文件。');
  s.room.points=normalizeOutline(s.room.points);
  if(!Number.isFinite(s.room.height)||s.room.height<1||s.room.height>30)throw Error('层高须在 100 到 3000 厘米之间。');
  s.room.openings=s.room.openings||[];
  s.room.interiorWalls=s.room.interiorWalls||[];
  for(const inner of s.room.interiorWalls){if(![...inner.a,...inner.b,inner.height,inner.thickness].every(Number.isFinite)||inner.height<1||inner.height>30||inner.thickness<.01||inner.thickness>2||Math.hypot(inner.b[0]-inner.a[0],inner.b[1]-inner.a[1])<.1)throw Error('中间墙的尺寸无效。');}
  if(s.room.openings.length>60)throw Error('门窗数量过多。');
  if(s.room.entryView&&(!['x','z','dx','dz'].every(key=>Number.isFinite(s.room.entryView[key]))||!canWalk(s.room,s.room.entryView.x,s.room.entryView.z)||Math.hypot(s.room.entryView.dx,s.room.entryView.dz)<.001||(s.room.entryView.dy!==undefined&&!Number.isFinite(s.room.entryView.dy))))throw Error('入口观看位置无效。');
  const ws=walls(s.room),ids=new Set();
  for(const o of s.room.openings){
    if(!ws[o.wall]||![o.start,o.width,o.height,o.bottom].every(Number.isFinite)||o.width<.1||o.height<.1||o.start<0||o.start+o.width>ws[o.wall].length+.001||o.bottom<0||o.bottom+o.height>s.room.height+.001)throw Error('请检查门窗尺寸，门窗须在墙面范围内。');
  }
  for(const w of s.works){
    if(typeof w.id!=='string'||ids.has(w.id)||!['art','plinth','block','partition'].includes(w.type))throw Error('作品类型或编号无效。');
    ids.add(w.id);
    for(const field of ['width','height','depth'])if(!Number.isFinite(w[field])||w[field]<(field==='depth'?.0005:.005)||w[field]>30)throw Error('作品尺寸无效。');
    for(const field of ['x','z','elevation','rotation'])if(!Number.isFinite(w[field])||Math.abs(w[field])>1000)throw Error('作品位置无效。');
    for(const field of ['image','thumbnail']){if(w[field]&&!/^sample:[123]$|^asset:[a-f0-9]{32}$|^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(w[field]))throw Error('图片数据格式不受支持。');if(w[field]?.length>12*1024*1024)throw Error('单张图片过大。');}
    w.placed=w.placed!==false;
    if(w.lockAspect!==undefined&&typeof w.lockAspect!=='boolean')throw Error('照片比例锁定设置无效。');
    if(w.mat!==undefined&&(!Number.isFinite(w.mat)||w.mat<0||w.mat>.15))throw Error('卡纸留边须在 0 到 15 厘米之间。');
    if(w.frameWidth!==undefined&&(!Number.isFinite(w.frameWidth)||w.frameWidth<.002||w.frameWidth>.03))throw Error('框条宽度须在 0.2 到 3 厘米之间。');
    for(const field of ['frameOuterWidth','frameOuterHeight'])if(w[field]!==undefined&&(!Number.isFinite(w[field])||w[field]<.1||w[field]>30))throw Error('外框尺寸无效。');
    if(w.imageRatio!==undefined&&(!Number.isFinite(w.imageRatio)||w.imageRatio<.02||w.imageRatio>50))throw Error('图片比例无效。');
    w.name=String(w.name||'未命名作品').slice(0,120);w.frame=['none','white','black','wood'].includes(w.frame)?w.frame:'none';
    if(w.type==='art'){fitFrame(w);if(!ws[w.wall])w.wall=0;wallPosition(w,s.room);}
  }
  for(const fixture of (s.room.fixtures||[]).filter(f=>f.type==='tv'))if(fixture.image&&!/^asset:[a-f0-9]{32}$|^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(fixture.image))throw Error('电视静帧图片无效。');
  return s;
}
export function defaultState() {
  const room={points:[[-6,-4],[6,-4],[6,4],[-6,4]],height:3.4,measured:false,openings:[{type:'door',wall:2,start:5.1,width:1.8,height:2.3,bottom:0}]};
  const works=[1,2,3].map((n)=>({id:uid(),type:'art',name:`示例作品 ${String(n).padStart(2,'0')}`,image:`sample:${n}`,width:.8,height:1.013,depth:.035,elevation:1.05,wall:0,along:2.8+n*1.6,x:0,z:0,rotation:0,frame:'wood'}));
  works.push({id:uid(),type:'plinth',name:'示例展台',width:1.2,height:.9,depth:.6,elevation:0,x:1.7,z:.8,rotation:0,color:'#d6d6cd'});
  works.forEach(w=>{if(w.type==='art')wallPosition(w,room);});
  return {format:FORMAT,title:'我的个展',room,works};
}

export function measuredState(){
  const room={template:'user-gallery-2026-10',points:[[-4,-2.75],[4,-2.75],[4,2.75],[-4,2.75]],height:2.7,measured:true,provisional:false,floorColor:'#3d4242',tileSize:.8,
    openings:[{type:'window',wall:0,start:0,width:1.4,height:2.0,bottom:.65},{type:'door',wall:2,start:0,width:1.0,height:2.1,bottom:0},{type:'door',wall:2,start:6.9,width:1.1,height:2.1,bottom:0}],
    interiorWalls:[{name:'中间突出墙',a:[-.1,2.75],b:[-.1,.25],height:2.5,thickness:.12}],
    columns:[{x:-4,z:.25,diameter:.4,height:2.7},{x:-.1,z:.25,diameter:.4,height:2.7},{x:4,z:.25,diameter:.4,height:2.7}],
    fixtures:[{type:'switch',wall:2,along:1.295,elevation:1.25},{type:'switch',wall:2,along:6.795,elevation:1.25},{type:'pipe',wall:2,along:4.333,elevation:0},{type:'pipe',wall:2,along:4.43,elevation:0},{type:'tv',wall:3,along:1.0,elevation:1.25,width:.75,height:.45}],
    furniture:[{type:'chair',x:-3.65,z:-2.33,rotation:0},{type:'table',x:-3.18,z:-2.33,rotation:0},{type:'chair',x:-2.67,z:-2.33,rotation:0}]};
  return {format:FORMAT,title:'个展 · 场地布置',room,works:[]};
}
