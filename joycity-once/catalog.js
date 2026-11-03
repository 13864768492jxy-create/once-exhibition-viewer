const get=id=>document.getElementById(id);
let library=null;
let currentLayout=null,inspectWork=null;
function placementFor(id){return currentLayout?.works.find(w=>w.catalogId===id)||currentLayout?.freestandingGlass.find(w=>w.catalogId===id);}
const groups={all:'全部',once:'ONCE摄影',glass:'玻璃板',large:'大尺幅',performance:'VESSEL',poetry:'空间诗歌'};
function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function showDetail(work){
  const target=get('catalog-detail');target.replaceChildren();
  const back=node('button','catalog-back','返回作品列表');back.type='button';back.addEventListener('click',()=>{target.hidden=true;get('catalog-list').hidden=false;get('catalog-filter').hidden=false;});target.append(back);
  target.append(node('h3','',work.title));const img=node('img','catalog-large');img.src=work.detailImage||work.image;img.alt=work.title;target.append(img);
  const placement=placementFor(work.id);
  for(const text of [work.dimensions,work.dimensionNote,work.medium,work.presentation,placement?'位置：当前空间试排，可继续调整':'位置：待布置',placement?.note].filter(Boolean))target.append(node('p','',text));
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
    const img=node('img','');img.src=work.image;img.alt='';img.loading='lazy';button.append(img,node('strong','',work.title),node('span','',work.dimensions),node('small','',placementFor(work.id)?'试排02':'待布置'));button.addEventListener('click',()=>showDetail(work));li.append(button);list.append(li);
  }
}
export function installCatalog({layout=null,onInspect=null}={}){
  currentLayout=layout;inspectWork=onInspect;
  const panel=get('catalog-panel'),open=get('catalog-button');
  const setOpen=(visible)=>{panel.hidden=!visible;open.setAttribute('aria-expanded',String(visible));if(visible){get('details-panel').hidden=true;get('details-button').setAttribute('aria-expanded','false');}};
  open.addEventListener('click',()=>setOpen(panel.hidden));get('close-catalog').addEventListener('click',()=>{setOpen(false);open.focus();});
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){setOpen(false);open.focus();}});
  get('details-button').addEventListener('click',()=>{panel.hidden=true;open.setAttribute('aria-expanded','false');});
  get('catalog-filter').addEventListener('change',render);
  fetch('catalog.json?v=20261104-trial02',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('作品库读取失败');return r.json();}).then(data=>{
    library=data;get('catalog-summary').textContent='31幅摄影全部装裱 · 6块玻璃 · 4幅大图 · VESSEL。已放入当前空间试排，尚未定稿。';
    for(const [value,label]of Object.entries(groups)){const option=node('option','',label+(data.counts[value]?' · '+data.counts[value]:''));option.value=value;get('catalog-filter').append(option);}
    const poetry=get('catalog-poetry');poetry.append(node('h3','',data.poetry.title),node('p','','本轮先沿用原展诗稿试排地面位置。墙面与其他建筑位置的文字设计继续推敲。'),node('p','','载体：墙面、地面及其他建筑位置。'));
    for(const ref of data.poetry.references){const a=node('a','',ref.title);a.href=ref.url;a.target='_blank';a.rel='noopener noreferrer';poetry.append(a);}
    render();
  }).catch(error=>{get('catalog-summary').textContent=error.message+'，请刷新页面重试。';get('catalog-filter').hidden=true;});
}
