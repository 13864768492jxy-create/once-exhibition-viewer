import * as THREE from 'three';
import { createPoetryEditorModel } from './poetry-editor-model.js?v=20261118-trial21';
import { createPoetryInkPicker } from './poetry-editor-picking.js?v=20261117-editor2';

export function installPoetryEditor({exhibition, layout, layoutSourceText, space, host, getCamera, getControls, focusEntry, onActive}) {
  const $ = s => document.querySelector(s);
  const canvas = host.querySelector('canvas');
  const storageKey = `once-poetry-draft:${exhibition.group.userData.poetryRasterManifest.sourceLayoutSHA256}`;
  let active=false, selected='between', gesture=null, comparing=false, savedTimer, restoring=false, ready=false;
  let savedDraft=null, mode='arrange', orbitClick=null;
  const pane=document.createElement('aside');
  pane.id='poetry-editor';pane.hidden=true;pane.setAttribute('aria-label','文字试排');
  pane.innerHTML=`
    <div class="editor-selection-bar">
      <div class="editor-heading"><h2>文字试排</h2><button id="editor-close">完成查看</button></div>
      <div class="editor-selection-caption"><label for="editor-poem">选择文字组</label><div><button id="editor-previous" aria-label="选择上一组文字">上一组</button><button id="editor-next" aria-label="选择下一组文字">下一组</button></div></div>
      <select id="editor-poem"></select>
    </div>
    <div class="editor-body">
    <p class="editor-intro">点击别的文字即可切换；远处的文字可从上方列表选择。拖动文字组，拉右下角等比缩放。</p>
    <div id="editor-restore" hidden><p>此浏览器中有一份保存的草稿。</p><button id="editor-restore-button">继续上次草稿</button></div>
    <p id="editor-surface" class="editor-meta"></p>
    <div class="editor-row"><button id="editor-front">正对文字</button><button id="editor-orbit" aria-pressed="false">环看空间</button></div>
    <label class="editor-lock"><input id="editor-lock" type="checkbox">锁定这组位置与大小</label>
    <p id="editor-lock-note" class="editor-meta" hidden>横与亘保留前后对位；需要调整时可取消锁定。</p>
    <fieldset class="editor-fields"><legend>大小与位置</legend>
      <label for="editor-scale">等比大小 <output id="editor-size"></output></label>
      <div class="editor-scale-row"><input id="editor-scale" type="range" min="25" max="200" step="1"><input id="editor-percent" type="number" min="25" max="200" step="1" aria-label="等比大小百分比"><span>%</span></div>
      <p id="editor-paper-note" class="editor-meta" hidden>纸面与装裱按当前实际尺寸显示，可移动。</p>
      <div class="editor-coordinates"><label>左右偏移 · cm<input id="editor-u" type="number" step="1"></label><label>上下偏移 · cm<input id="editor-v" type="number" step="1"></label></div>
      <p class="editor-meta">相对原位，沿当前承载面移动。方向键 1 cm；Shift＋方向键 10 cm。</p>
    </fieldset>
    <div class="editor-row editor-history"><button id="editor-undo">撤销</button><button id="editor-redo">重做</button><button id="editor-reset">恢复这组</button></div>
    <button id="editor-compare" class="editor-wide" aria-pressed="false">查看原版</button>
    <p id="editor-feedback" role="status" aria-live="polite"></p>
    <div class="editor-save"><label for="editor-name">方案名称</label><input id="editor-name" type="text" maxlength="60" value="我的文字试排">
      <div class="editor-row"><button id="editor-export">导出方案</button><button id="editor-import">载入方案</button></div>
      <input id="editor-file" type="file" accept=".json,application/json" hidden>
      <p id="editor-storage">修改仅存在此浏览器草稿中，公开展厅不会被覆盖。导出文件可留存或交给我继续调整。</p>
    </div></div>`;
  $('#workspace').append(pane);
  const overlay=document.createElement('div');overlay.id='poetry-selection';overlay.hidden=true;
  overlay.innerHTML='<svg aria-hidden="true"><path/></svg><button id="poetry-resize" aria-label="拖动等比缩放选中文字" title="拖动等比缩放"></button><span id="poetry-selection-label"></span>';
  host.append(overlay);
  const model=createPoetryEditorModel({THREE,exhibition,layout,layoutSourceText,space,onChange:()=>{if(!ready)return;updatePanel();if(!restoring&&!model.status.inTransaction)scheduleSave();}});
  ready=true;
  const entries=model.entries;
  const entryIds=[...entries.keys()];
  const inkHit=createPoetryInkPicker({THREE,getCamera,canvas});
  const title=e=>e.record.text.replace(/\n/g,' / ');
  for(const e of entries.values()) {const o=document.createElement('option');o.value=e.record.id;o.textContent=title(e);$('#editor-poem').append(o);}
  if(!entries.has(selected))selected=entries.keys().next().value;
  savedDraft=model.findSavedDraft(sha=>localStorage.getItem('once-poetry-draft:'+sha));
  if(savedDraft && savedDraft.baseRevision!==layout.revision){
    $('#editor-restore p').textContent='此浏览器保存有试排20的草稿，可在试排21继续调整。';
  }
  $('#editor-restore').hidden=!savedDraft;
  const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();
  const projected=[];
  function feedback(message,error=false){$('#editor-feedback').textContent=message;$('#editor-feedback').classList.toggle('error',error);}
  function scheduleSave(){clearTimeout(savedTimer);savedTimer=setTimeout(()=>{
    if(model.status.inTransaction){scheduleSave();return;}
    try{const draft=model.exportDraft();draft.name=$('#editor-name').value.trim()||'我的文字试排';localStorage.setItem(storageKey,JSON.stringify(draft));$('#editor-storage').textContent='已保存到此浏览器。导出方案可跨设备留存；公开展厅不会被覆盖。';}
    catch{$('#editor-storage').textContent='浏览器未能保存草稿，请点“导出方案”留存。';}
  },200);}
  function updatePanel(){
    const e=entries.get(selected);if(!e)return;const value=model.get(selected),bounds=model.getBounds(selected);
    $('#editor-poem').value=selected;$('#editor-surface').textContent=e.surfaceLabel+' · 原稿整组字形';
    $('#editor-previous').disabled=entryIds.indexOf(selected)===0;$('#editor-next').disabled=entryIds.indexOf(selected)===entryIds.length-1;
    $('#editor-size').textContent=`${(e.width*value.scale*100).toFixed(1)} × ${(e.height*value.scale*100).toFixed(1)} cm`;
    for(const id of ['editor-scale','editor-percent']){const input=$('#'+id);input.value=Math.round(value.scale*1000)/10;input.min=Math.ceil(bounds.scale.min*100);input.max=Math.floor(bounds.scale.max*100);input.disabled=e.locked||e.scaleLocked||comparing;}
    $('#editor-u').value=(value.u*100).toFixed(1);$('#editor-v').value=(value.v*100).toFixed(1);
    $('#editor-u').disabled=$('#editor-v').disabled=e.locked||comparing;
    $('#editor-lock').checked=e.locked;$('#editor-lock').disabled=comparing;
    $('#editor-lock-note').hidden=!['across','across-gen'].includes(selected);
    $('#editor-paper-note').hidden=!e.scaleLocked;
    $('#editor-undo').disabled=!model.status.canUndo||comparing;$('#editor-redo').disabled=!model.status.canRedo||comparing;
    $('#editor-reset').disabled=e.locked||comparing;
    $('#editor-compare').textContent=comparing?'回到我的草稿':'查看原版';$('#editor-compare').setAttribute('aria-pressed',String(comparing));
    $('#editor-open').textContent=model.status.changedCount?`文字试排 · ${model.status.changedCount}组已改`:'文字试排';
  }
  function setMode(value){mode=value;orbitClick=null;$('#editor-orbit').setAttribute('aria-pressed',String(value==='orbit'));}
  function select(id,focus=false){if(!entries.has(id))return;if(focus)setMode('arrange');if(gesture)endGesture(false);selected=id;updatePanel();if(focus)focusEntry(entries.get(id));update();feedback(entries.get(id).locked?'此组已锁定。取消锁定后可以调整。':'已选中「'+title(entries.get(id))+'」。拖动文字组，或点击其他文字切换。');}
  function setComparing(value){
    if(gesture)endGesture(false);orbitClick=null;comparing=value;
    for(const e of entries.values()){
      const p=model.get(e.record.id);e.object.matrix.copy(e.baseMatrix);
      if(!value)e.object.matrix.multiply(new THREE.Matrix4().makeTranslation(p.u,p.v,0)).multiply(new THREE.Matrix4().makeScale(p.scale,p.scale,1));
      e.object.matrixWorldNeedsUpdate=true;
    }
    exhibition.group.updateMatrixWorld(true);updatePanel();feedback(value?'正在查看当前发布版；再次点击返回草稿。':'已回到我的草稿。');
  }
  function setActive(value){
    if(gesture)endGesture(false);orbitClick=null;if(comparing)setComparing(false);active=value;pane.hidden=!value;
    document.body.classList.toggle('poetry-editing',value);$('#editor-open').setAttribute('aria-expanded',String(value));onActive(value);
    if(value){$('#catalog-panel').hidden=$('#details-panel').hidden=true;select(selected,true);}
    else {overlay.hidden=true;$('#editor-open').focus();}
  }
  function ray(event){const r=canvas.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,getCamera());return raycaster.ray;}
  function baseWorld(e){return e.object.parent.matrixWorld.clone().multiply(e.baseMatrix);}
  function onPlane(event,e){
    const world=baseWorld(e),normal=new THREE.Vector3(0,0,1).transformDirection(world),origin=new THREE.Vector3().setFromMatrixPosition(world);
    const hit=ray(event).intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal,origin),new THREE.Vector3());
    return hit?hit.applyMatrix4(world.clone().invert()):null;
  }
  function rectangle(e,event){
    const p=onPlane(event,e);if(!p)return null;const v=model.get(e.record.id),x=(p.x-v.u)/v.scale,y=(p.y-v.v)/v.scale;
    const dx=x-e.offsetX,dy=y-e.offsetY;
    if(Math.abs(dx)>e.width/2||Math.abs(dy)>e.height/2)return null;
    const point=new THREE.Vector3(x,y,0).applyMatrix4(e.object.matrixWorld);
    return {e,distance:point.distanceTo(getCamera().position)};
  }
  function visible(object){for(let o=object;o;o=o.parent)if(!o.visible)return false;return true;}
  function pick(event){
    const hits=[];for(const e of entries.values())if(visible(e.object)){const hit=rectangle(e,event);if(hit)hits.push(hit);}
    hits.sort((a,b)=>a.distance-b.distance);
    // Visible lettering wins over another group's transparent whitespace.
    return hits.find(hit=>inkHit(hit.e,event))?.e||hits[0]?.e;
  }
  function beginGesture(event,kind){
    if(!active||comparing||event.button!==0)return;
    if(gesture){event.preventDefault();event.stopImmediatePropagation();return;}
    if(event.isPrimary===false){orbitClick=null;return;}
    let e=entries.get(selected);
    if(kind==='move'){
      const hit=pick(event);
      if(mode==='orbit'){
        orbitClick=hit?{id:event.pointerId,x:event.clientX,y:event.clientY,entry:hit}:null;
        return; // OrbitControls keeps dragging; a short click still selects.
      }
      if(!hit)return;e=hit;select(e.record.id);
    }
    event.preventDefault();event.stopImmediatePropagation();host.focus({preventScroll:true});
    if(e.locked||(kind==='scale'&&e.scaleLocked)){feedback(e.locked?'此组已锁定；取消锁定后可以调整。':'纸面与外框保持当前实际尺寸。');return;}
    const point=onPlane(event,e);if(!point)return;
    const controls=getControls();gesture={id:event.pointerId,kind,e,point,x:event.clientX,y:event.clientY,moved:false,start:{...model.get(selected)},controls,enabled:controls.enabled};
    controls.enabled=false;canvas.setPointerCapture(event.pointerId);canvas.style.cursor=kind==='scale'?'nwse-resize':'grabbing';
  }
  function moveGesture(event){
    if(orbitClick&&event.pointerId===orbitClick.id&&Math.hypot(event.clientX-orbitClick.x,event.clientY-orbitClick.y)>4)orbitClick=null;
    if(!gesture||event.pointerId!==gesture.id)return;event.preventDefault();event.stopImmediatePropagation();const g=gesture;
    if(!g.moved&&Math.hypot(event.clientX-g.x,event.clientY-g.y)<=4)return;
    const p=onPlane(event,g.e);if(!p)return;
    if(!g.moved){g.moved=true;model.begin();clearTimeout(savedTimer);}
    if(g.kind==='move')model.change(g.e.record.id,{u:g.start.u+p.x-g.point.x,v:g.start.v+p.y-g.point.y},{commit:false});
    else {const x=g.e.offsetX+g.e.width/2,y=g.e.offsetY-g.e.height/2;const s=((p.x-g.start.u)*x+(p.y-g.start.v)*y)/(x*x+y*y);model.change(g.e.record.id,{scale:s},{commit:false});}
    feedback('松开鼠标完成这次调整。');
  }
  function endGesture(commit=true){
    if(!gesture)return;const g=gesture;gesture=null;
    if(canvas.hasPointerCapture(g.id))canvas.releasePointerCapture(g.id);g.controls.enabled=g.enabled;canvas.style.cursor='';
    if(g.moved){if(commit)model.commit();else model.cancel();if(commit)scheduleSave();feedback(commit?'已调整，可撤销。':'已取消这次调整。');}updatePanel();
  }
  canvas.addEventListener('pointerdown',e=>beginGesture(e,'move'),true);
  canvas.addEventListener('pointermove',moveGesture,true);
  canvas.addEventListener('pointerup',e=>{
    if(gesture&&e.pointerId===gesture.id){e.preventDefault();e.stopImmediatePropagation();endGesture(true);}
    const click=orbitClick;orbitClick=null;
    if(click&&e.pointerId===click.id&&Math.hypot(e.clientX-click.x,e.clientY-click.y)<=4&&pick(e)===click.entry){setMode('arrange');select(click.entry.record.id);}
  },true);
  canvas.addEventListener('pointercancel',e=>{orbitClick=null;if(e.pointerId===gesture?.id)endGesture(false);},true);
  canvas.addEventListener('lostpointercapture',e=>{orbitClick=null;if(e.pointerId===gesture?.id)endGesture(false);});
  $('#poetry-resize').addEventListener('pointerdown',e=>beginGesture(e,'scale'));
  window.addEventListener('blur',()=>{orbitClick=null;endGesture(false);});
  $('#editor-open').addEventListener('click',()=>setActive(!active));$('#editor-close').addEventListener('click',()=>setActive(false));
  $('#editor-poem').addEventListener('change',e=>select(e.target.value,true));
  $('#editor-previous').addEventListener('click',()=>select(entryIds[entryIds.indexOf(selected)-1],true));
  $('#editor-next').addEventListener('click',()=>select(entryIds[entryIds.indexOf(selected)+1],true));
  $('#editor-front').addEventListener('click',()=>select(selected,true));
  $('#editor-orbit').addEventListener('click',()=>{setMode(mode==='arrange'?'orbit':'arrange');feedback(mode==='orbit'?'拖动环看空间；点击任意文字即可选中并继续编辑。':'可以直接拖动文字，点击其他文字切换。');});
  $('#editor-lock').addEventListener('change',e=>{model.setLocked(selected,e.target.checked);updatePanel();scheduleSave();});
  for(const [id,key,factor] of [['editor-u','u',.01],['editor-v','v',.01],['editor-percent','scale',.01]])$('#'+id).addEventListener('change',event=>{
    const value=event.target.valueAsNumber;if(!Number.isFinite(value)){updatePanel();feedback('请输入有效数字。',true);return;}
    try{model.change(selected,{[key]:value*factor});feedback('已调整，可撤销。');}catch(error){feedback(error.message,true);updatePanel();}
  });
  let scaling=false;
  $('#editor-scale').addEventListener('input',e=>{if(!scaling){model.begin();scaling=true;}model.change(selected,{scale:Number(e.target.value)/100},{commit:false});});
  $('#editor-scale').addEventListener('change',()=>{if(scaling){scaling=false;model.commit();scheduleSave();}});
  $('#editor-undo').addEventListener('click',()=>{model.undo();feedback('已撤销。');});$('#editor-redo').addEventListener('click',()=>{model.redo();feedback('已重做。');});
  $('#editor-reset').addEventListener('click',()=>{model.reset(selected);feedback('已恢复这组的原始位置与大小，可撤销。');});
  $('#editor-compare').addEventListener('click',()=>setComparing(!comparing));
  $('#editor-name').addEventListener('change',scheduleSave);
  $('#editor-restore-button').addEventListener('click',()=>{try{if(comparing)setComparing(false);model.importDraft(savedDraft);if(savedDraft.name)$('#editor-name').value=savedDraft.name;$('#editor-restore').hidden=true;focusEntry(entries.get(selected));feedback('已载入上次草稿。');}catch(e){feedback(e.message,true);}});
  $('#editor-export').addEventListener('click',()=>{
    const draft=model.exportDraft();draft.name=$('#editor-name').value.trim()||'我的文字试排';
    const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=draft.name.replace(/[\\/:*?"<>|]/g,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);feedback('已导出我的草稿；文件可以重新载入。');
  });
  $('#editor-import').addEventListener('click',()=>$('#editor-file').click());
  $('#editor-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;try {if(file.size>150000)throw new Error('方案文件过大，请选择从此编辑器导出的 JSON。');const draft=JSON.parse(await file.text());if(comparing)setComparing(false);restoring=true;model.importDraft(draft);if(typeof draft.name==='string')$('#editor-name').value=draft.name.slice(0,60);restoring=false;$('#editor-restore').hidden=true;scheduleSave();focusEntry(entries.get(selected));feedback('方案已载入。');}
    catch(e){restoring=false;feedback('未载入：'+e.message,true);}finally{event.target.value='';}
  });
  window.addEventListener('keydown',event=>{
    if(!active||event.target.matches('input,select,textarea,button,a,summary'))return;
    const key=event.key.toLowerCase();
    if((event.metaKey||event.ctrlKey)&&key==='z'){event.preventDefault();if(!comparing)(event.shiftKey?model.redo():model.undo());return;}
    if(key==='escape'){if(gesture)endGesture(false);else if(comparing)setComparing(false);else setActive(false);return;}
    if(comparing||entries.get(selected).locked)return;const delta=(event.shiftKey?.1:.01);
    const changes={arrowleft:['u',-delta],arrowright:['u',delta],arrowup:['v',delta],arrowdown:['v',-delta]};
    if(changes[key]){event.preventDefault();const [axis,d]=changes[key];model.change(selected,{[axis]:model.get(selected)[axis]+d});}
  },true);
  function update(){
    if(!active||comparing||!visible(entries.get(selected).object)){overlay.hidden=true;return;}
    const e=entries.get(selected),cam=getCamera();e.object.updateWorldMatrix(true,false);projected.length=0;
    for(const [x,y] of [[-1,1],[1,1],[1,-1],[-1,-1]]){const p=new THREE.Vector3(e.offsetX+x*e.width/2,e.offsetY+y*e.height/2,.008).applyMatrix4(e.object.matrixWorld).project(cam);projected.push(p);}
    if(projected.some(p=>p.z>1||p.z< -1)){overlay.hidden=true;return;}
    overlay.hidden=false;const w=host.clientWidth,h=host.clientHeight;const points=projected.map(p=>[(p.x*.5+.5)*w,(-p.y*.5+.5)*h]);
    overlay.querySelector('path').setAttribute('d',points.map((p,i)=>(i?'L':'M')+p.join(',')).join(' ')+' Z');
    const handle=$('#poetry-resize'),[x,y]=points[2];handle.style.left=x+'px';handle.style.top=y+'px';handle.hidden=e.locked||e.scaleLocked||mode!=='arrange'||x<14||y<14||x>w-14||y>h-14;
    const label=$('#poetry-selection-label');label.textContent=e.locked?'已锁定':`${Math.round(model.get(selected).scale*100)}%`;label.style.left=Math.max(8,Math.min(w-80,points[0][0]))+'px';label.style.top=Math.max(8,Math.min(h-25,points[0][1]-27))+'px';
    overlay.classList.toggle('locked',e.locked);
  }
  updatePanel();
  const api={get active(){return active;},get selected(){return selected;},get comparing(){return comparing;},model,select,setActive,update,setComparing};
  if(new URLSearchParams(location.search).get('edit')==='1')setActive(true);
  return api;
}
