import {ExhibitionScene} from './scene.js?v=20261011-03';
import {walls,cm,sampleImage} from './model.js?v=20261011-connect-01';

const $=id=>document.getElementById(id);
const mobile=matchMedia('(max-width:760px)');
let scene,state,photos,buttons=new Map();
function showList(open){$('works').hidden=!open;$('list-toggle').setAttribute('aria-expanded',String(open));}
showList(!mobile.matches);
$('list-toggle').onclick=()=>showList($('works').hidden);
function select(id){
  const work=photos.find(w=>w.id===id);
  scene.setSelected(work?.id||null);
  for(const [key,button] of buttons)button.setAttribute('aria-pressed',String(key===work?.id));
}
function changeView(mode){
  scene.view(mode);select(null);document.body.classList.toggle('eye',mode==='eye');
  $('walk-controls').hidden=mode!=='eye';
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===mode)));
  $('view-tip').textContent=mode==='plan'?'编号对应作品清单 · 拖动平移 · 双指或滚轮缩放':mode==='eye'?'拖动环顾 · 方向键或 W A S D 移动':'拖动转动视角 · 双指或滚轮缩放';
  if(mobile.matches)showList(false);
}
function renderList(medium){
  const wallData=walls(state.room),root=$('work-list');
  for(const wall of wallData){
    const group=photos.filter(w=>w.wall===wall.index).sort((a,b)=>a.along-b.along||b.elevation-a.elevation);
    if(!group.length)continue;
    const heading=document.createElement('h2');heading.textContent=wall.name;root.append(heading);
    for(const w of group){
      const button=document.createElement('button');button.className='work';button.setAttribute('aria-pressed','false');
      const image=document.createElement('img');image.src=w.thumbnail||w.image;image.alt='';image.loading='lazy';
      const text=document.createElement('span'),title=document.createElement('strong'),caption=document.createElement('small');
      title.textContent=w.name;caption.textContent=`${cm(w.width)} × ${cm(w.height)} cm，2026，${medium}。`;
      text.append(title,caption);button.append(image,text);buttons.set(w.id,button);root.append(button);
      button.onclick=()=>{changeView(`wall:${w.wall}`);select(w.id);$('view-tip').textContent=`${wall.name} · ${w.name}`;};
    }
  }
}
try{
  const response=await fetch('data.json?v=20261011-01');if(!response.ok)throw Error('方案没有载入');
  const data=await response.json();state=data.state;photos=state.works.filter(w=>w.sourceFile&&w.placed!==false);
  scene=new ExhibitionScene($('viewport'),{
    select,beginDrag:()=>{},drag:()=>{},endDrag:()=>{},
    imageSource:async source=>source.startsWith('sample:')?sampleImage(source.slice(7)):new URL(source,location.href).href
  });
  scene.editable=false;scene.update(state);renderList(data.medium);changeView('overview');$('loading').hidden=true;
  document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>changeView(button.dataset.view));
  for(const button of document.querySelectorAll('[data-walk]')){
    const direction=button.dataset.walk;
    const step=()=>scene.moveEye(direction==='forward'?1:direction==='back'?-1:0,direction==='right'?1:direction==='left'?-1:0);
    button.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();step();scene.navigation.add(direction);button.setPointerCapture(e.pointerId);});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>scene.navigation.delete(direction));
    button.onclick=e=>{if(e.detail===0)step();};
  }
  $('viewport').addEventListener('render-error',()=>{$('loading').textContent='三维画面暂时中断，请刷新页面重新打开。';$('loading').hidden=false;});
}catch(error){$('loading').textContent='展厅暂时没有载入，请刷新页面重试。';console.error(error);}
