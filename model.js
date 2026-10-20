/* ReefTrace local multiscale pixel classifier. No external dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReefModel = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const SCHEMA = 'reeftrace-texture-rf-v2';
  const NAMES = [
    'relative red', 'relative green', 'relative blue', 'luminance', 'saturation',
    'mean luminance r2', 'contrast r2', 'mean luminance r5', 'contrast r5',
    'mean luminance r11', 'contrast r11', 'local normalized luminance',
    'fine/coarse luminance difference', 'gradient magnitude', 'mean gradient r3',
    'gradient variability r3', 'absolute Laplacian',
    'LBP uniformity r1', 'LBP neighborhood r1', 'mean LBP r5', 'LBP variability r5',
    'LBP uniformity r3', 'LBP neighborhood r3', 'structure coherence r3',
    'structure energy r3', 'Hessian eigenvalue high r2', 'Hessian eigenvalue low r2',
    'Hessian eigenvalue high r5', 'Hessian eigenvalue low r5'
  ];
  function random(seed = 32071) {
    let a = seed >>> 0;
    return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function box(values, w, h, r, squared = false) {
    const stride = w + 1, sat = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = 0; x < w; x++) { const v = values[y * w + x]; sum += squared ? v * v : v; sat[(y + 1) * stride + x + 1] = sum + sat[y * stride + x + 1]; }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      out[y * w + x] = (sat[y1 * stride + x1] - sat[y0 * stride + x1] - sat[y1 * stride + x0] + sat[y0 * stride + x0]) / ((x1 - x0) * (y1 - y0));
    }
    return out;
  }
  function sd(values, means, w, h, r) {
    const squares = box(values, w, h, r, true);
    for (let i = 0; i < squares.length; i++) squares[i] = Math.sqrt(Math.max(0, squares[i] - means[i] ** 2));
    return squares;
  }
  function features(data, w, h) {
    if (data.length !== w * h * 4 || !(w > 0 && h > 0)) throw Error('Invalid RGBA image');
    const n = w * h, maps = Array.from({length: NAMES.length}, () => new Float32Array(n)), gray = maps[3];
    for (let i = 0; i < n; i++) {
      const r = data[4 * i] / 255, g = data[4 * i + 1] / 255, b = data[4 * i + 2] / 255, sum = r + g + b + .02, max = Math.max(r, g, b), min = Math.min(r, g, b);
      maps[0][i] = r / sum; maps[1][i] = g / sum; maps[2][i] = b / sum;
      gray[i] = .2126 * r + .7152 * g + .0722 * b;
      maps[4][i] = max ? (max - min) / max : 0;
    }
    for (const [r, j] of [[2, 5], [5, 7], [11, 9]]) { maps[j] = box(gray, w, h, r); maps[j + 1] = sd(gray, maps[j], w, h, r); }
    const gx2 = new Float32Array(n), gy2 = new Float32Array(n), gxy = new Float32Array(n);
    const at = (a, x, y) => a[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      maps[11][i] = Math.max(-5, Math.min(5, (gray[i] - maps[7][i]) / (maps[8][i] + .02)));
      maps[12][i] = maps[5][i] - maps[9][i];
      const gx = (at(gray,x+1,y-1) + 2*at(gray,x+1,y) + at(gray,x+1,y+1) - at(gray,x-1,y-1) - 2*at(gray,x-1,y) - at(gray,x-1,y+1)) / 8;
      const gy = (at(gray,x-1,y+1) + 2*at(gray,x,y+1) + at(gray,x+1,y+1) - at(gray,x-1,y-1) - 2*at(gray,x,y-1) - at(gray,x+1,y-1)) / 8;
      maps[13][i] = Math.hypot(gx, gy); gx2[i] = gx * gx; gy2[i] = gy * gy; gxy[i] = gx * gy;
      maps[16][i] = Math.abs(at(gray,x+1,y)+at(gray,x-1,y)+at(gray,x,y+1)+at(gray,x,y-1)-4*gray[i]);
      for (const [radius, offset] of [[1,17],[3,21]]) {
        const dirs = [[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]];
        let count = 0, transitions = 0, first = 0, previous = 0;
        dirs.forEach(([dx,dy], k) => { const bit = +(at(gray,x+dx*radius,y+dy*radius) >= gray[i]); if (k === 0) first=bit; else transitions += +(bit !== previous); previous=bit; count+=bit; });
        transitions += +(first !== previous);
        maps[offset][i] = transitions <= 2 ? count / 8 : 1.25;
        maps[offset+1][i] = count / 8;
      }
      for (const [j, smooth, radius] of [[25, maps[5], 2], [27, maps[7], 5]]) {
        const dxx = at(smooth,x+1,y)-2*smooth[i]+at(smooth,x-1,y), dyy=at(smooth,x,y+1)-2*smooth[i]+at(smooth,x,y-1), dxy=(at(smooth,x+1,y+1)-at(smooth,x+1,y-1)-at(smooth,x-1,y+1)+at(smooth,x-1,y-1))/4;
        const delta=Math.sqrt((dxx-dyy)**2+4*dxy*dxy);
        maps[j][i]=radius*radius*(dxx+dyy+delta)/2; maps[j+1][i]=radius*radius*(dxx+dyy-delta)/2;
      }
    }
    maps[14]=box(maps[13],w,h,3); maps[15]=sd(maps[13],maps[14],w,h,3);
    maps[19]=box(maps[17],w,h,5); maps[20]=sd(maps[17],maps[19],w,h,5);
    const xx=box(gx2,w,h,3), yy=box(gy2,w,h,3), xy=box(gxy,w,h,3);
    for(let i=0;i<n;i++){ const energy=xx[i]+yy[i]; maps[23][i]=Math.sqrt((xx[i]-yy[i])**2+4*xy[i]*xy[i])/(energy+1e-6); maps[24][i]=Math.sqrt(energy); }
    return maps;
  }
  function row(maps, i) { return maps.map(a=>a[i]); }
  function train(samples, labels, options={}, progress=()=>{}) {
    const count=samples.length, dimensions=NAMES.length;
    if(count!==labels.length || count<60 || labels.some(y=>y!==0&&y!==1) || samples.some(s=>s.length!==dimensions||s.some(v=>!Number.isFinite(v)))) throw Error('Invalid training samples');
    const trees=[], importance=new Array(dimensions).fill(0), rng=random(options.seed||32071), treeCount=options.trees||40, maxDepth=options.maxDepth||12, minLeaf=options.minLeaf||6;
    const positives=labels.reduce((s,y)=>s+y,0); if(positives<30||count-positives<30)throw Error('Need at least 30 samples in each class');
    const gini=(p,n)=>n ? 2*p*(n-p)/n : 0; // Weighted impurity.
    function build(indices,depth){
      const n=indices.length, pos=indices.reduce((s,i)=>s+labels[i],0), probability=(pos+1)/(n+2);
      if(depth>=maxDepth || n<minLeaf*2 || !pos || pos===n) return {p:probability};
      const base=gini(pos,n); let best=null;
      const candidates=new Set(); while(candidates.size<Math.ceil(Math.sqrt(dimensions)))candidates.add(Math.floor(rng()*dimensions));
      for(const f of candidates){
        let low=Infinity, high=-Infinity;
        for(const i of indices){const v=samples[i][f];low=Math.min(low,v);high=Math.max(high,v)}
        if(high-low<1e-8)continue;
        // Random threshold search keeps training bounded in the browser.
        for(let attempt=0;attempt<10;attempt++){
          const threshold=low+rng()*(high-low); let leftN=0,leftP=0;
          for(const i of indices)if(samples[i][f]<=threshold){leftN++;leftP+=labels[i]}
          const rightN=n-leftN; if(leftN<minLeaf||rightN<minLeaf)continue;
          const gain=base-gini(leftP,leftN)-gini(pos-leftP,rightN);
          if(gain>1e-7&&(!best||gain>best.gain))best={f,t:threshold,gain};
        }
      }
      if(!best)return {p:probability};
      const left=[],right=[];for(const i of indices)(samples[i][best.f]<=best.t?left:right).push(i);
      importance[best.f]+=best.gain;
      return {f:best.f,t:best.t,l:build(left,depth+1),r:build(right,depth+1)};
    }
    for(let k=0;k<treeCount;k++){
      const bootstrap=Array.from({length:Math.min(count,16000)},()=>Math.floor(rng()*count));
      trees.push(build(bootstrap,0)); progress(k+1,treeCount);
    }
    const total=importance.reduce((s,v)=>s+v,0)||1;
    return {schema:SCHEMA,type:'Multiscale texture random forest',featureNames:NAMES.slice(),features:dimensions,trees,importance:importance.map(v=>v/total),samples:count,classSamples:{coral:positives,background:count-positives},trained:new Date().toISOString(),config:{maxDimension:options.maxDimension||1024,cleanupRadius:options.cleanupRadius??1},trainingImages:options.trainingImages||[]};
  }
  function predictFeatures(values, model){ let sum=0;for(const tree of model.trees){let n=tree;while(n.p===undefined)n=values[n.f]<=n.t?n.l:n.r;sum+=n.p}return sum/model.trees.length; }
  function predictPixel(maps,i,model){let sum=0;for(const tree of model.trees){let n=tree;while(n.p===undefined)n=maps[n.f][i]<=n.t?n.l:n.r;sum+=n.p}return sum/model.trees.length;}
  function validate(model){
    if(!model||model.schema!==SCHEMA||model.features!==NAMES.length||!Array.isArray(model.featureNames)||model.featureNames.join('|')!==NAMES.join('|')||!Array.isArray(model.trees)||!model.trees.length||model.trees.length>200) throw Error('Unsupported model. Retrain the old color model or load a ReefTrace texture model.');
    if(!Number.isInteger(model.samples)||model.samples<60||model.samples>100000||typeof model.type!=='string'||typeof model.trained!=='string'||!Array.isArray(model.importance)||model.importance.length!==NAMES.length||model.importance.some(v=>!Number.isFinite(v)||v<0||v>1)||!Array.isArray(model.trainingImages)||model.trainingImages.some(v=>typeof v!=='string'))throw Error('Invalid model metadata');
    if(model.evaluation){const e=model.evaluation;for(const k of ['tp','tn','fp','fn','pixels','images'])if(!Number.isInteger(e[k])||e[k]<0)throw Error('Invalid evaluation metadata');for(const k of ['iou','dice','precision','recall'])if(e[k]!==null&&(!Number.isFinite(e[k])||e[k]<0||e[k]>1))throw Error('Invalid evaluation scores');if(!Number.isFinite(e.threshold)||e.threshold<0||e.threshold>1)throw Error('Invalid evaluation threshold');}
    const c=model.config;if(!c||![768,1024,1536].includes(c.maxDimension)||![0,1,2].includes(c.cleanupRadius))throw Error('Invalid preprocessing settings');
    let nodes=0; const check=(n,depth)=>{if(!n||depth>20||++nodes>200000)throw Error('Invalid model tree');if(n.p!==undefined){if(!Number.isFinite(n.p)||n.p<0||n.p>1)throw Error('Invalid leaf probability');return}if(!Number.isInteger(n.f)||n.f<0||n.f>=NAMES.length||!Number.isFinite(n.t))throw Error('Invalid feature split');check(n.l,depth+1);check(n.r,depth+1)};model.trees.forEach(t=>check(t,0));return true;
  }
  function contains(x,y,p){let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++){let a=p[i],b=p[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c}return c}
  // Scanline fill uses pixel centres. Later annotations of the same class union;
  // conflicting coral/background annotations are ignored rather than guessed.
  function labelMask(annotations,w,h,sx,sy,fullBackground=false){
    const flags=new Uint8Array(w*h);
    function raster(rings,bit){
      const scaled=rings.filter(p=>p&&p.length>=3).map(p=>p.map(v=>[v[0]*sx,v[1]*sy]));
      if(!scaled.length)return;
      let min=Infinity,max=-Infinity;for(const p of scaled)for(const v of p){min=Math.min(min,v[1]);max=Math.max(max,v[1])}
      const minY=Math.max(0,Math.floor(min)),maxY=Math.min(h-1,Math.ceil(max));
      for(let y=minY;y<=maxY;y++){
        const crossings=[];for(const p of scaled)for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>y+.5)!==(b[1]>y+.5))crossings.push(a[0]+(y+.5-a[1])*(b[0]-a[0])/(b[1]-a[1]))}
        crossings.sort((a,b)=>a-b);for(let k=0;k+1<crossings.length;k+=2)for(let x=Math.max(0,Math.ceil(crossings[k]-.5));x<Math.min(w,Math.ceil(crossings[k+1]-.5));x++)flags[y*w+x]|=bit;
      }
    }
    for(const a of annotations)raster([a.points,...(a.holes||[])],a.kind==='coral'?1:2);
    const labels=new Int8Array(w*h);labels.fill(-1);for(let i=0;i<labels.length;i++){if(flags[i]===1)labels[i]=1;else if(flags[i]===2||(!flags[i]&&fullBackground))labels[i]=0}return labels;
  }
  function morph(mask,w,h,r,dilate){
    const out=new Uint8Array(mask.length);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let value=dilate?0:1;
      search:for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
        if(dx*dx+dy*dy>r*r)continue;
        const xx=Math.max(0,Math.min(w-1,x+dx)),yy=Math.max(0,Math.min(h-1,y+dy)),v=mask[yy*w+xx];
        if((dilate&&v)||(!dilate&&!v)){value=dilate?1:0;break search}
      }out[y*w+x]=value;
    }return out;
  }
  function cleanup(mask,w,h,r){if(!r)return mask.slice(); // Opening removes flecks; closing fills small cracks.
    return morph(morph(morph(morph(mask,w,h,r,false),w,h,r,true),w,h,r,true),w,h,r,false);
  }
  function signedArea(p){let s=0;for(let i=0,j=p.length-1;i<p.length;j=i++)s+=p[j][0]*p[i][1]-p[i][0]*p[j][1];return s/2}
  function simplify(p){return p.filter((v,i)=>{const a=p[(i+p.length-1)%p.length],b=p[(i+1)%p.length];return (v[0]-a[0])*(b[1]-v[1])!==(v[1]-a[1])*(b[0]-v[0])})}
  // Exact pixel-edge contours, including concave boundaries and interior holes.
  function contours(labels,id,indices,w,h){
    const stride=w+1,edges=new Map();
    function edge(x0,y0,x1,y1){const a=y0*stride+x0,b=y1*stride+x1;if(!edges.has(a))edges.set(a,[]);edges.get(a).push(b)}
    for(const i of indices){const x=i%w,y=Math.floor(i/w);if(!y||labels[i-w]!==id)edge(x,y,x+1,y);if(x===w-1||labels[i+1]!==id)edge(x+1,y,x+1,y+1);if(y===h-1||labels[i+w]!==id)edge(x+1,y+1,x,y+1);if(!x||labels[i-1]!==id)edge(x,y+1,x,y)}
    const rings=[];
    while(edges.size){const first=edges.keys().next().value;let v=first,previous=null;const points=[];let safety=0;
      do{
        points.push([v%stride,Math.floor(v/stride)]);let outgoing=edges.get(v);if(!outgoing?.length)throw Error('Open contour');let at=0;
        // At diagonal saddles, turn right to preserve separate pixel-edge rings.
        if(outgoing.length>1&&previous!==null){const dx=v%stride-previous%stride,dy=Math.floor(v/stride)-Math.floor(previous/stride);let best=-Infinity;outgoing.forEach((n,j)=>{const ex=n%stride-v%stride,ey=Math.floor(n/stride)-Math.floor(v/stride),score=dx*ey-dy*ex;if(score>best){best=score;at=j}})}
        const next=outgoing.splice(at,1)[0];if(!outgoing.length)edges.delete(v);previous=v;v=next;if(++safety>4*w*h+4)throw Error('Contour limit exceeded');
      }while(v!==first);
      const p=simplify(points);if(p.length>=3)rings.push(p);
    }
    return rings;
  }
  function regions(mask,w,h,minPixels=1){
    const labels=new Int32Array(mask.length),queue=new Int32Array(mask.length),objects=[];let id=0;
    for(let seed=0;seed<mask.length;seed++){
      if(!mask[seed]||labels[seed])continue;id++;let count=1;queue[0]=seed;labels[seed]=id;
      for(let head=0;head<count;head++){const i=queue[head],x=i%w,y=Math.floor(i/w);for(const j of [x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1])if(j>=0&&mask[j]&&!labels[j]){labels[j]=id;queue[count++]=j}}
      if(count<minPixels)continue;const indices=queue.slice(0,count),rings=contours(labels,id,indices,w,h);
      const outers=rings.filter(p=>signedArea(p)>0),holes=rings.filter(p=>signedArea(p)<0);
      for(const points of outers){const ownHoles=holes.filter(p=>contains(p[0][0]+.001,p[0][1]+.001,points));objects.push({points,holes:ownHoles,pixels:Math.abs(signedArea(points))-ownHoles.reduce((s,p)=>s+Math.abs(signedArea(p)),0)});}
    }return objects;
  }
  function metrics(truth,predicted){let tp=0,tn=0,fp=0,fn=0;for(let i=0;i<truth.length;i++){if(truth[i]<0)continue;if(truth[i]){if(predicted[i])tp++;else fn++}else{if(predicted[i])fp++;else tn++}}return {tp,tn,fp,fn};}
  function summarize(m){const {tp,tn,fp,fn}=m;return {...m,pixels:tp+tn+fp+fn,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,iou:tp+fp+fn?tp/(tp+fp+fn):null,dice:2*tp+fp+fn?2*tp/(2*tp+fp+fn):null};}
  return {SCHEMA,NAMES,random,features,row,train,predictFeatures,predictPixel,validate,labelMask,cleanup,regions,signedArea,contains,metrics,summarize,box};
});
