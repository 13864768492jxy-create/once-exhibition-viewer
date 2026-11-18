const get=id=>document.getElementById(id);
let library=null;
let currentLayout=null,inspectWork=null,inspectGroup=null;
function placementFor(id){return currentLayout?.works.find(w=>w.catalogId===id)||currentLayout?.freestandingGlass.find(w=>w.catalogId===id);}
function displayDimensions(work){const p=placementFor(work.id);return p?.joinedGroup?`玻璃板 ${Math.round(p.width*100)} × ${Math.round(p.height*100)} cm · 当前试排`:work.dimensions;}
const groups={all:'全部',once:'ONCE摄影',glass:'玻璃板',large:'大尺幅',performance:'VESSEL',traveler:'旅人（候选）',poetry:'空间诗歌'};
function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
const poemFocusIds={
  future:'book-arrival',mountains:'book-mountains','mountains-open':'book-mountains',
  river:'book-river-wall','river-through':'book-river-wall','river-each':'book-river-wall',
  world:'curation-opening',across:'language-split-word','across-gen':'language-gen-wall',between:'book-between',
  ending:'book-ending',moon:'book-moon','moon-english':'book-moon',sea:'book-sea-floor',shore:'book-shore-wall',
  'glass-sea-echo':'book-glass',waves:'book-glass','night-sky':'book-night-sky',moonlight:'book-moonlight',
  'far-waves':'book-far-waves-print','glass-growing':'spatial-glass-transmission',
};
function renderPoetry(){
  const target=get('catalog-poetry');target.replaceChildren();
  target.append(node('h3','','空间诗歌 · 选读'),node('p','','以下是当前展厅中的文字选段，点击可在空间中查看；完整诗作的分行与翻页见诗册。'));
  const book=node('a','','阅读完整诗册');book.href='https://13864768492jxy-create.github.io/once-exhibition-viewer/book/';book.target='_blank';book.rel='noopener noreferrer';
  const bookLine=node('p');bookLine.append(book);target.append(bookLine);
  const poems=new Map((currentLayout?.poems||[]).map(p=>[p.id,p]));
  const focusIds=new Set((currentLayout?.focusGroups||[]).map(g=>g.id));
  const positions=/trial(?:20|21)$/.test(currentLayout?.revision)?{
    ...poemFocusIds,world:'curation-world',river:'curation-river-wide','river-through':'curation-river-return',
    ending:'curation-ending-walk',...(/trial21$/.test(currentLayout.revision)?{mountains:'curation-mountains-walk','mountains-open':'curation-mountains-walk'}:{})
  }:poemFocusIds;
  const listed=new Set();
  function appendList(parent,records){
    const list=node('ul');
    for(const poem of records){
      const label=poem.text.replace(/\n+/g,' / '),focusId=positions[poem.id];
      const item=node('li'),button=node('button','catalog-back',label);button.type='button';button.dataset.poemId=poem.id;
      button.setAttribute('aria-label','在空间中查看：'+label);
      if(inspectGroup&&focusIds.has(focusId)){button.dataset.focusId=focusId;button.addEventListener('click',()=>inspectGroup(focusId));}
      else button.disabled=true;
      item.append(button);list.append(item);listed.add(poem.id);
    }
    parent.append(list);
  }
  for(const sequence of currentLayout?.readingSequences||[]){
    const ids=[...new Set(sequence.sequence||[])],records=ids.map(id=>poems.get(id)).filter(Boolean);
    if(!records.length)continue;
    const section=node('section');section.append(node('h4','',sequence.title));appendList(section,records);target.append(section);
  }
  const other=[...poems.values()].filter(p=>!listed.has(p.id));
  if(other.length){const section=node('section');section.append(node('h4','','其他空间文字'));appendList(section,other);target.append(section);}
}
function showDetail(work){
  const target=get('catalog-detail');target.replaceChildren();
  const back=node('button','catalog-back','返回作品列表');back.type='button';back.addEventListener('click',()=>{target.hidden=true;get('catalog-list').hidden=false;get('catalog-filter').hidden=false;});target.append(back);
  target.append(node('h3','',work.title));
  if(work.video){const video=node('video','catalog-large');video.src=work.video;video.poster=work.image;video.controls=true;video.preload='metadata';video.playsInline=true;video.setAttribute('aria-label',work.title+' 原装置记录预览');target.append(video);}
  else{const img=node('img','catalog-large');img.src=work.detailImage||work.image;img.alt=work.title;target.append(img);}
  const placement=placementFor(work.id);
  for(const text of [placement?.joinedGroup?displayDimensions(work):null,work.dimensions,work.dimensionNote,work.medium,placement?.joinedGroup?(currentLayout.poetryGlassPanels?.length?'六件作品与两块透明诗板并列，整排560 × 180 cm；原图比例保留，未印区透明。':'六块作品玻璃边对边并列，整组420 × 180 cm；保留原图比例，余区透明。'):work.presentation,placement?'位置：当前空间试排，可继续调整':'位置：待布置',placement?.note].filter(Boolean))target.append(node('p','',text));
  if(placement&&inspectWork){const inspect=node('button','inspect-work','在空间中查看');inspect.type='button';inspect.addEventListener('click',()=>inspectWork(placement.id));target.append(inspect);}
  get('catalog-list').hidden=true;get('catalog-filter').hidden=true;target.hidden=false;get('catalog-panel').scrollTop=0;back.focus({preventScroll:true});
}
function render(){
  if(!library)return;
  const value=get('catalog-filter').value,list=get('catalog-list');list.replaceChildren();get('catalog-detail').hidden=true;list.hidden=false;
  get('catalog-poetry').hidden=value!=='poetry';
  if(value==='poetry')return;
  for(const work of library.items.filter(x=>value==='all'||x.group===value)){
    const li=node('li','catalog-item');const button=node('button','catalog-work');button.type='button';button.setAttribute('aria-label','查看 '+work.title);
    const img=node('img','');img.src=work.image;img.alt='';img.loading='lazy';button.append(img,node('strong','',work.title),node('span','',displayDimensions(work)),node('small','',placementFor(work.id)?'当前试排':'待布置'));button.addEventListener('click',()=>showDetail(work));li.append(button);list.append(li);
  }
}
export function installCatalog({layout=null,onInspect=null,onFocus=null}={}){
  currentLayout=layout;inspectWork=onInspect;inspectGroup=onFocus;
  const panel=get('catalog-panel'),open=get('catalog-button');
  const setOpen=(visible)=>{panel.hidden=!visible;open.setAttribute('aria-expanded',String(visible));if(visible){get('details-panel').hidden=true;get('details-button').setAttribute('aria-expanded','false');}};
  open.addEventListener('click',()=>setOpen(panel.hidden));get('close-catalog').addEventListener('click',()=>{setOpen(false);open.focus();});
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){setOpen(false);open.focus();}});
  get('details-button').addEventListener('click',()=>{panel.hidden=true;open.setAttribute('aria-expanded','false');});
  get('catalog-filter').addEventListener('change',render);
  fetch('catalog.json?v=20261107-trial14',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('作品库读取失败');return r.json();}).then(data=>{
    if(!currentLayout?.works.some(w=>w.id==='traveler-1')){data.items=data.items.filter(w=>w.group!=='traveler');delete data.counts.traveler;data.counts.all=data.items.length;}
    if(currentLayout?.excludedWorkIds?.length){data.items=data.items.filter(w=>!currentLayout.excludedWorkIds.includes(w.id));data.counts.all=data.items.length;for(const key of ['once','glass','large','performance','traveler'])data.counts[key]=data.items.filter(w=>w.group===key).length;}
    library=data;get('catalog-summary').textContent=(currentLayout?.selectedPhotographyCount||31)+'幅摄影全部装裱 · 6块玻璃 · 4幅大图 · VESSEL。'+(data.counts.traveler?'另试放《旅人-1》，尚未确认加入。':'当前空间试排，尚未定稿。');
    for(const [value,label]of Object.entries(groups)){if(value==='traveler'&&!data.counts.traveler)continue;const option=node('option','',label+(data.counts[value]?' · '+data.counts[value]:''));option.value=value;get('catalog-filter').append(option);}
    renderPoetry();
    render();
  }).catch(error=>{get('catalog-summary').textContent=error.message+'，请刷新页面重试。';get('catalog-filter').hidden=true;});
}
