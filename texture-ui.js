'use strict';
/* Model controls live in the existing dialog. Main layout and CSS are unchanged. */
let engine=null,requestId=0,pending=new Map(),working=false,cancelled=false;
function worker(){
  if(engine)return engine;
  engine=new Worker('worker.js');
  engine.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;if(data.type==='progress'){trainingNotice(data.message);return}pending.delete(data.id);if(data.type==='error')task.reject(Error(data.message));else task.resolve(data.result)};
  engine.onerror=e=>{for(const task of pending.values())task.reject(Error(e.message||'Model worker failed'));pending.clear();engine.terminate();engine=null};
  return engine;
}
function callWorker(action,args={},transfers=[]){if(cancelled)return Promise.reject(Error('Cancelled. Previous model and annotations were kept.'));return new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,{resolve,reject});try{worker().postMessage({id,action,...args},transfers)}catch(e){pending.delete(id);reject(e)}})}
function trainingNotice(text){notice(text);const p=$('trainingProgress');if(p)p.textContent=text}
function busy(value){working=value;if(value)cancelled=false;document.querySelectorAll('header button, main button, main input, main select, #modalBody button, #modalBody input, #modalBody select').forEach(e=>{if(e.id!=='stopTraining')e.disabled=value});cv.style.pointerEvents=value?'none':'';const close=$('modal').querySelector(':scope > button');if(close)close.disabled=value;const cancel=$('stopTraining');if(cancel)cancel.hidden=!value}
function cancelWork(){if(!working)return;cancelled=true;if(engine){engine.terminate();engine=null}for(const task of pending.values())task.reject(Error('Cancelled. Previous model and annotations were kept.'));pending.clear();trainingNotice('Cancelling…')}
async function fingerprint(a){if(!a.fingerprint){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(a.src));a.fingerprint=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')}return a.fingerprint}
function manual(a){return a.annotations.filter(n=>n.source!=='model')}
function textPercent(v){return v==null?'—':(100*v).toFixed(1)+'%'}
function modelStatus(){
  const m=project.model;if(!m)return '<p>No model yet. Add coral and background polygons in training images.</p>';
  if(m.schema!==ReefModel.SCHEMA)return '<p>Legacy color-only model detected. Your annotations are safe; train a texture model to replace it.</p>';
  const top=m.featureNames.map((name,i)=>({name,value:m.importance?.[i]||0})).sort((a,b)=>b.value-a.value).slice(0,8);
  const scores=m.evaluation;
  return `<p><b>${esc(m.type)}</b> · ${m.features} features · ${m.trees.length} trees · ${m.samples} balanced training samples.<br>Trained ${esc(m.trained)}. Working image maximum ${m.config.maxDimension}px.</p><h3>Most used features</h3><table><tr><th>Feature</th><th>Split importance</th></tr>${top.map(f=>`<tr><td>${esc(f.name)}</td><td>${textPercent(f.value)}</td></tr>`).join('')}</table><p class="muted">Split importance describes this forest, not biological causation or held-out performance. Correlated features can share importance.</p>${scores?`<h3>Last held-out evaluation</h3><p>Coral IoU ${textPercent(scores.iou)} · Dice ${textPercent(scores.dice)} · Precision ${textPercent(scores.precision)} · Recall ${textPercent(scores.recall)}<br>${scores.images} complete reviewed images · vote threshold ${scores.threshold} · ${scores.pixels.toLocaleString()} evaluated pixels.</p><p class="muted">${scores.sameSite?'Some held-out images share a site label with training: these results do not establish transfer to new sites. ':''}Evaluation uses the final cleaned mask at working resolution. Touching-colony separation and identity are not evaluated. Revalidate after editing labels or changing threshold/cleanup.</p>`:'<p>No held-out performance measured yet. Mark separate validation/test images fully annotated and reviewed, then evaluate.</p>'}`;
}
function modelDialog(){
  const m=project.model?.schema===ReefModel.SCHEMA?project.model:null;
  modal(`<h2>Local texture model</h2><div id="modelSummary">${modelStatus()}</div><h3>Training settings</h3><label>Working image maximum dimension<select id="modelResolution"><option value="768">768 px · faster</option><option value="1024">1024 px · balanced</option><option value="1536">1536 px · more detail and memory</option></select></label><label>Forest size<select id="modelTrees"><option value="32">32 trees</option><option value="48">48 trees</option><option value="64">64 trees</option></select></label><label>Mask cleanup radius<select id="modelCleanup"><option value="0">None · preserve thin features</option><option value="1">1 working pixel · opening + closing</option><option value="2">2 working pixels · stronger smoothing</option></select></label><p class="muted">Texture windows span radii 1–11 working pixels. Training and prediction use the same resolution. Match camera distance, framing and image scale across surveys. Cleanup can change area and merge/split thin structures.</p><div class="tools"><button id="trainNow" class="primary">Train texture model</button><button id="saveModel">Save model</button><button id="loadModel">Load model</button><button id="evaluateModel">Evaluate held-out images</button><button id="stopTraining" hidden>Cancel operation</button></div><p id="trainingProgress" role="status"></p><p class="muted">Training uses only manually drawn or explicitly accepted coral/background polygons in train images. Pixels outside those polygons are ignored. The old model stays active until training succeeds. No photos or features leave your computer.</p>`);
  $('modelResolution').value=String(m?.config.maxDimension||1024);$('modelCleanup').value=String(m?.config.cleanupRadius??0);$('modelTrees').value=String(m?.trees.length||32);
  $('trainNow').onclick=trainTexture;$('saveModel').onclick=saveModel;$('loadModel').onclick=()=>$('modelFile').click();$('evaluateModel').onclick=evaluateModel;$('stopTraining').onclick=cancelWork;
  // Cleanup is an inference setting; do not require retraining. Other settings
  // are read only by Train and remain attached to the trained model.
  $('modelCleanup').onchange=()=>{if(project.model?.schema===ReefModel.SCHEMA){project.model.config.cleanupRadius=+$('modelCleanup').value;delete project.model.evaluation;persist();$('modelSummary').innerHTML=modelStatus()}};
}
$('train').onclick=modelDialog;
const modelFile=document.createElement('input');modelFile.id='modelFile';modelFile.type='file';modelFile.accept='.json';modelFile.hidden=true;document.body.append(modelFile);
function saveModel(){try{ReefModel.validate(project.model);download('reeftrace-texture-model.reefmodel.json',{format:'reeftrace-model',version:2,model:project.model});trainingNotice('Model saved locally, with all trees, feature definitions and preprocessing settings. No photos are included.')}catch(e){trainingNotice(e.message)}}
modelFile.onchange=async e=>{if(working)return;try{const f=e.target.files[0];if(!f)return;if(f.size>25*1024*1024)throw Error('Model file exceeds the 25 MB limit.');const data=JSON.parse(await f.text());if(data.format!=='reeftrace-model'||data.version!==2)throw Error('Select a ReefTrace texture model file, not a full project backup.');ReefModel.validate(data.model);project.model=data.model;await persist();render();modelDialog();trainingNotice('Local model loaded. You can now apply it to new photos without the original training photos.')}catch(e){trainingNotice('Model load failed: '+e.message)}finally{modelFile.value=''}};
async function trainTexture(){
  if(working)return;
  const candidates=project.images.filter(a=>a.split==='train'&&manual(a).length);
  if(!candidates.length)return trainingNotice('Add manual coral and background outlines to images assigned to train.');
  const options={maxDimension:+$('modelResolution').value,trees:+$('modelTrees').value,cleanupRadius:+$('modelCleanup').value,maxDepth:12};
  busy(true);
  try{
    await callWorker('reset');const sourceRecords=[];
    for(let i=0;i<candidates.length;i++){
      const a=candidates[i];trainingNotice(`Extracting texture features: ${i+1}/${candidates.length} · ${a.name}…`);
      const p=await pixels(a,options.maxDimension),hash=await fingerprint(a);
      await callWorker('sample',{...p,annotations:manual(a),fingerprint:hash},[p.data.buffer]);sourceRecords.push({fingerprint:hash,site:a.site,date:a.date,name:a.name});
    }
    const result=await callWorker('train',{options});result.sourceRecords=sourceRecords;ReefModel.validate(result);project.model=result;await persist();render();if($('modelSummary'))$('modelSummary').innerHTML=modelStatus();
    trainingNotice(`Texture forest trained: ${result.samples} balanced samples, ${result.features} features. Evaluate on separate images before batch use. Save model creates a reusable local file.`);
  }catch(e){trainingNotice('Training: '+e.message)}finally{busy(false)}
}
$('batch').onclick=async()=>{
  if(working){cancelWork();return;}try{ReefModel.validate(project.model)}catch(e){return notice(e.message)}
  const threshold=+$('threshold').value,minArea=+$('minarea').value;if(!(minArea>=10))return notice('Minimum region must be at least 10 original-image pixels.');
  const targets=project.images.filter(a=>!a.reviewed);if(!targets.length)return notice('All images are reviewed. Uncheck reviewed on an image to generate new suggestions.');
  // Stage the whole batch before modifying the project. Cancel/errors keep all
  // previous annotations, including suggestions from an earlier run.
  const staged=[];busy(true);$('batch').disabled=false;$('batch').textContent='Cancel batch';
  try{
    for(let i=0;i<targets.length;i++){
      const a=targets[i];trainingNotice(`Segmenting texture: ${i+1}/${targets.length} · ${a.name}…`);
      const p=await pixels(a,project.model.config.maxDimension);
      const regions=await callWorker('infer',{...p,model:project.model,threshold,minArea,annotations:manual(a)},[p.data.buffer]);
      staged.push({a,annotations:regions.map(r=>({id:crypto.randomUUID(),kind:'coral',points:r.points,holes:r.holes,track:'',state:'uncertain',source:'model',notes:'Texture-forest suggestion; exact working-pixel boundary. Review species, boundaries and colony separation before accepting.'}))});
    }
    for(const {a,annotations}of staged)a.annotations=manual(a).concat(annotations);
    await persist();selected=-1;details();render();trainingNotice(`Batch finished: ${staged.reduce((s,x)=>s+x.annotations.length,0)} suggestions. Manual annotations were preserved. Review boundaries and use Apply details to accept a suggestion for future training.`);
  }catch(e){trainingNotice('Batch: '+e.message)}finally{busy(false);$('batch').textContent='Suggest on unreviewed images'}
};
async function evaluateModel(){
  if(working)return;try{ReefModel.validate(project.model)}catch(e){return trainingNotice(e.message)}
  const targets=project.images.filter(a=>['validation','test'].includes(a.split)&&a.reviewed);
  if(!targets.length)return trainingNotice('Choose validation/test images, delineate ALL colonies, accept or delete every suggestion, and mark each image reviewed. Unoutlined pixels will count as background.');
  if(targets.some(a=>a.annotations.some(n=>n.source==='model')))return trainingNotice('Held-out images still contain model suggestions. Correct and explicitly accept or delete them first.');
  if(!targets.some(a=>manual(a).some(n=>n.kind==='coral')))return trainingNotice('Held-out evaluation needs at least one manually annotated coral colony.');
  const threshold=+$('threshold').value;busy(true);
  try{
    const totals={tp:0,tn:0,fp:0,fn:0},perImage=[],sites=new Set((project.model.sourceRecords||[]).map(x=>x.site).filter(Boolean));let sameSite=false;
    for(let i=0;i<targets.length;i++){
      const a=targets[i];if((project.model.trainingImages||[]).includes(await fingerprint(a)))throw Error(`${a.name} was used to train this model. Use different held-out photos, or retrain after changing the split.`);
      sameSite ||= !!a.site&&sites.has(a.site);trainingNotice(`Evaluating held-out image ${i+1}/${targets.length} · ${a.name}…`);
      const p=await pixels(a,project.model.config.maxDimension),counts=await callWorker('evaluate',{...p,model:project.model,threshold,annotations:manual(a)},[p.data.buffer]);
      for(const k of Object.keys(totals))totals[k]+=counts[k];perImage.push({name:a.name,site:a.site,date:a.date,...ReefModel.summarize(counts)});
    }
    if(!totals.tp&&!totals.fn)throw Error('No coral pixels remain at this working resolution. Increase resolution or use larger annotations.');
    project.model.evaluation={...ReefModel.summarize(totals),images:targets.length,perImage,sameSite,threshold,cleanupRadius:project.model.config.cleanupRadius,evaluated:new Date().toISOString(),protocol:'Pooled pixel metrics on complete reviewed held-out images, at model working resolution.'};
    await persist();$('modelSummary').innerHTML=modelStatus();trainingNotice('Held-out evaluation complete. These pixel scores do not measure individual-colony separation.');
  }catch(e){trainingNotice('Evaluation: '+e.message)}finally{busy(false)}
}
// COCO polygons cannot represent subtractive interior holes. Use uncompressed
// COCO RLE for those instances; polygons without holes retain polygon export.
function annotationRLE(annotation,w,h){const mask=ReefModel.labelMask([{...annotation,kind:'coral'}],w,h,1,1),counts=[];let value=0,run=0;for(let x=0;x<w;x++)for(let y=0;y<h;y++){const bit=+(mask[y*w+x]===1);if(bit===value)run++;else{counts.push(run);run=1;value=bit}}counts.push(run);return {size:[h,w],counts}}

const annotationKeyHandler=document.onkeydown;document.onkeydown=e=>{if(!working)annotationKeyHandler(e)};

$('modal').addEventListener('cancel',e=>{if(working)e.preventDefault()});
