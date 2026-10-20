'use strict';
importScripts('model.js');
const M=self.ReefModel;
let reservoir=[[],[]],seen=[0,0],rng=M.random(),sources=[];
function post(id,type,value){self.postMessage({id,type,...value})}
self.onmessage=({data:job})=>{
  const {id,action}=job;
  try{
    if(action==='reset'){reservoir=[[],[]];seen=[0,0];rng=M.random();sources=[];post(id,'result',{result:true});return;}
    if(action==='sample'){
      const {data,w,h,sx,sy,annotations,fingerprint}=job,labels=M.labelMask(annotations,w,h,sx,sy),maps=M.features(data,w,h),local=[[],[]],localSeen=[0,0],counts=[0,0];
      for(let i=0;i<labels.length;i++){
        const k=labels[i];if(k<0)continue;counts[k]++;
        // Bound contributions per image so a large colony cannot dominate a survey.
        const n=++localSeen[k];let index=local[k].length<2000?local[k].length:Math.floor(rng()*n);
        if(index<2000)local[k][index]=M.row(maps,i);
      }
      for(let k=0;k<2;k++)for(const sample of local[k]){let n=++seen[k],index=reservoir[k].length<6000?reservoir[k].length:Math.floor(rng()*n);if(index<6000)reservoir[k][index]=sample}
      sources.push(fingerprint);post(id,'result',{result:{coral:counts[1],background:counts[0]}});return;
    }
    if(action==='train'){
      const size=Math.min(reservoir[0].length,reservoir[1].length);
      if(size<30)throw Error('Outline more coral AND background: at least 30 working-resolution pixels per class are needed.');
      // Shuffle before balancing: otherwise early images dominate the smaller class.
      const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a.slice(0,size)};
      const bg=shuffle(reservoir[0]),fg=shuffle(reservoir[1]),samples=bg.concat(fg),labels=new Array(size).fill(0).concat(new Array(size).fill(1));
      const result=M.train(samples,labels,{...job.options,trainingImages:sources},(done,total)=>post(id,'progress',{message:`Training texture forest: ${done}/${total} trees…`}));
      reservoir=[[],[]];post(id,'result',{result});return;
    }
    if(action==='infer'||action==='evaluate'){
      M.validate(job.model);
      const {data,w,h,sx,sy,model,threshold}=job,maps=M.features(data,w,h),raw=new Uint8Array(w*h);
      for(let i=0;i<raw.length;i++)raw[i]=+(M.predictPixel(maps,i,model)>=threshold);
      let mask=M.cleanup(raw,w,h,model.config.cleanupRadius);
      if(action==='evaluate'){
        // Evaluation uses only complete, reviewed held-out images, with outside
        // coral polygons treated as background; model suggestions are excluded.
        const truth=M.labelMask(job.annotations,w,h,sx,sy,true);
        post(id,'result',{result:M.metrics(truth,mask)});return;
      }
      const exclusions=M.labelMask(job.annotations,w,h,sx,sy);
      for(let i=0;i<mask.length;i++)if(exclusions[i]>=0)mask[i]=0;
      const regions=M.regions(mask,w,h,job.minArea*sx*sy).map(r=>({points:r.points.map(v=>[v[0]/sx,v[1]/sy]),holes:r.holes.map(p=>p.map(v=>[v[0]/sx,v[1]/sy])),pixels:r.pixels/(sx*sy)}));
      post(id,'result',{result:regions});return;
    }
    throw Error('Unknown worker action');
  }catch(e){post(id,'error',{message:e.message||String(e)})}
};
