import {ExhibitionScene} from './scene.js?v=20261023-field-survey-108';
import {walls,cm,sampleImage} from './model.js?v=20261023-field-survey-108';

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
  $('view-tip').textContent=mode==='plan'?`编号对应作品清单 · 拖动平移 · 双指或滚轮缩放${state.room.tileCalibration?' · 地砖80cm，缝位已按实测校准':''}`:mode==='eye'?'拖动环顾 · 方向键或 W A S D 移动':'拖动转动视角 · 双指或滚轮缩放';
  if(mobile.matches)showList(false);
}
function renderList(medium,prefaceTrials=[]){
  const wallData=walls(state.room),root=$('work-list');
  for(const wall of wallData){
    const group=photos.filter(w=>w.wall===wall.index).sort((a,b)=>a.along-b.along||b.elevation-a.elevation);
    if(!group.length)continue;
    const heading=document.createElement('h2');heading.textContent=wall.name;root.append(heading);
    for(const w of group){
      const button=document.createElement('button');button.className='work';button.setAttribute('aria-pressed','false');
      const image=document.createElement('img');image.src=w.thumbnail||w.image;image.alt='';image.loading='lazy';
      const text=document.createElement('span'),title=document.createElement('strong'),caption=document.createElement('small');
      title.textContent=w.name;caption.textContent=`${cm(w.width)} × ${cm(w.height)} cm，2026，${medium}。${w.framingDescription||''}`;
      text.append(title,caption);button.append(image,text);buttons.set(w.id,button);root.append(button);
      button.onclick=()=>{changeView(`wall:${w.wall}`);select(w.id);$('view-tip').textContent=`${wall.name} · ${w.name}`;};
    }
  }
  const frameWorks=photos.filter(work=>['thin-white-matted','thin-black-matted','thin-black-unmatted'].includes(work.frameProfile)).sort((a,b)=>a.name.localeCompare(b.name));
  if(frameWorks.length){
    const heading=document.createElement('h2');heading.textContent='装裱特写';root.append(heading);
    for(const work of frameWorks){
      const button=document.createElement('button');button.className='work';const text=document.createElement('span'),title=document.createElement('strong'),caption=document.createElement('small');
      title.textContent=`${work.name.slice(-2)}号${work.frame==='white'?'白窄框':'黑细框'} · 正视`;
      const mx=work.matX??work.mat,my=work.matY??work.mat;
      caption.textContent=work.frameProfile==='thin-black-unmatted'?`${work.frameWidth*1000}毫米黑框 · 无白卡纸 · 画面${cm(work.width)}×${cm(work.height)}厘米`:`${work.frameWidth*1000}毫米${work.frame==='white'?'白':'黑'}框 · ${Math.abs(mx-my)<.00001?`每侧${cm(mx)}厘米`:`左右${cm(mx)}、上下${cm(my)}厘米`}白卡纸`;text.append(title,caption);button.append(text);
      button.onclick=()=>{changeView(`wall:${work.wall}`);scene.focusArtwork(work.id);showList(false);$('view-tip').textContent=`${title.textContent} · 拖动旋转，双指或滚轮缩放`;};root.append(button);
    }
  }
  const textHeading=document.createElement('h2');textHeading.textContent='展览文字';root.append(textHeading);
  const prefaceEntries=prefaceTrials.length?prefaceTrials.map(trial=>[`悬挂前言 · ${trial.label}`,'同一版式 · 完整引诗','wall:2',null,'curation-preface-01',trial.image]):[['悬挂前言 · 引诗','月亮升起。潮水对此一无所知。','wall:2',null,'curation-preface-01']];
  for(const [title,caption,mode,floorId,textId,variantImage] of [...prefaceEntries,['地面诗 · 阅读动线','我在以后看见他们，','plan'],['地面诗 · 起句','我在以后看见他们，','eye','floor-poem-1'],['地面诗 · 迎着风','迎着风谈论明天。','eye','floor-poem-2'],['地面诗 · 群山','群山还未合拢，','eye','floor-poem-3'],['地面诗 · 21前方','河流带有未命名的方向，从每个人流过。','eye','floor-poem-4'],['地面诗 · 世界','已经发生的世界，横亘在我与他们之间。','eye','floor-poem-5'],['地面诗 · 终句','他们再也看不见我。','eye','floor-poem-6']]){
    const button=document.createElement('button');button.className='work';const text=document.createElement('span'),name=document.createElement('strong'),description=document.createElement('small');name.textContent=title;description.textContent=caption;text.append(name,description);button.append(text);button.onclick=()=>{changeView(mode);if(floorId)scene.focusFloorPoem(floorId);if(textId)scene.focusTextPanel(textId);if(variantImage)scene.setTextPanelImage(textId,variantImage).catch(()=>{$('view-tip').textContent='字体方案暂未载入，请再点一次。';});if(textId&&mobile.matches)showList(false);$('view-tip').textContent=title;};root.append(button);
  }
}
try{
  const response=await fetch('data.json?v=20261023-field-survey-108');if(!response.ok)throw Error('方案没有载入');
  const data=await response.json();state=data.state;
  const framingNote=data.framingPlan?'黑色木质悬浮框：05、11、17。白窄框24、27、28、32、34统一上下左右各6厘米白卡纸。黑细框16、26、31保持图面，改每侧4厘米白卡纸，外框随之加大。08、20、21为8毫米黑窄框，无白卡纸。未装框照片四周留2厘米白边，四角距纸边各1厘米钉固。':'';
  if(framingNote){const note=document.createElement('p');note.className='framing-note';note.textContent=framingNote;$('works').insertBefore(note,$('work-list'));}
  if(state.room.measurements?.wall1){
    const note=document.createElement('p');note.className='framing-note';
    const measured=state.room.measurements;
    note.textContent=measured.ceiling?`墙1全长 ${measured.wall1.length.toFixed(2)} m，层高 ${state.room.height.toFixed(2)} m。突出墙高 ${measured.interiorWall.height.toFixed(2)} m，上方通透；高窗下沿 ${measured.clerestory.bottom.toFixed(2)} m。进深5.385m。大窗宽1.365m、左距墙角0.416m为实测；高窗宽、窗上沿、梁与灯位按实景暂估。`:`墙1总长 ${measured.wall1.length.toFixed(2)} m（实测）。窗户细部尺寸暂估。`;
    $('works').insertBefore(note,$('work-list'));
  }
  photos=state.works.filter(w=>w.sourceFile&&w.placed!==false);
  scene=new ExhibitionScene($('viewport'),{
    select,beginDrag:()=>{},drag:()=>{},endDrag:()=>{},
    imageSource:async source=>source.startsWith('sample:')?sampleImage(source.slice(7)):new URL(source,location.href).href
  });
  await Promise.all([700,500].map(weight=>document.fonts.load(`${weight} 48px "Once Poetry Sans"`)));
  scene.editable=false;scene.update(state);renderList(data.medium,data.prefaceFontTrials);changeView('overview');$('loading').hidden=true;
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
