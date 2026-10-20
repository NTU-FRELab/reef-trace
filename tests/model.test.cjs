'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const APP=fs.existsSync(path.join(__dirname,'../dist/model.js'))?path.join(__dirname,'../dist'):path.join(__dirname,'..');
const M=require(path.join(APP,'model.js'));
function rgba(w,h,pixel){let d=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=pixel(x,y);for(let c=0;c<3;c++)d[(y*w+x)*4+c]=v;d[(y*w+x)*4+3]=255}return d}
function polygon(points,kind='coral',holes=[]){return {points,kind,holes,source:'manual'}}
const square=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
test('feature bank is finite on flat, black, white and single-pixel images',()=>{for(const [w,h]of [[1,1],[2,3],[48,32]])for(const gray of [0,127,255]){const f=M.features(rgba(w,h,()=>gray),w,h);assert.equal(f.length,29);for(const m of f)assert(m.every(Number.isFinite));assert(f[13].every(v=>v===0))}});
test('scanline labels preserve unlabeled pixels, overlaps, holes and independent islands',()=>{
 const donut=polygon(square(1,1,9,9),'coral',[square(3,3,7,7)]),island=polygon(square(4,4,6,6));
 const a=M.labelMask([island,donut,polygon(square(0,0,2,2),'background')],10,10,1,1);
 assert.equal(a[0],0);assert.equal(a[11],-1);assert.equal(a[55],1);assert.equal(a[33],-1);assert.equal(a[22],1);assert.equal(a[99],-1);
 const b=M.labelMask([island,donut],10,10,1,1,true);assert.equal(b[33],0);assert.equal(b[55],1);
});
test('exact contours preserve concavity, holes, edges and area without convex filling',()=>{
 const w=12,h=12,mask=new Uint8Array(w*h);for(let y=1;y<11;y++)for(let x=1;x<11;x++)mask[y*w+x]=1;
 for(let y=3;y<6;y++)for(let x=3;x<6;x++)mask[y*w+x]=0;
 for(let y=7;y<11;y++)for(let x=7;x<11;x++)mask[y*w+x]=0;
 const r=M.regions(mask,w,h);assert.equal(r.length,1);assert.equal(r[0].holes.length,1);assert.equal(r[0].pixels,75);
 const rebuilt=M.labelMask(r.map(p=>polygon(p.points,'coral',p.holes)),w,h,1,1,true);assert.deepEqual(Array.from(rebuilt),Array.from(mask));
 const all=new Uint8Array(16).fill(1);assert.equal(M.regions(all,4,4)[0].pixels,16);
});
test('random masks round-trip through contour polygons and interior holes',()=>{
 const rng=M.random(451);for(let k=0;k<80;k++){const w=16,h=16,mask=Uint8Array.from({length:w*h},()=>+(rng()>.4)),r=M.regions(mask,w,h),rebuilt=M.labelMask(r.map(p=>polygon(p.points,'coral',p.holes)),w,h,1,1,true);assert.deepEqual(Array.from(rebuilt),Array.from(mask),`mask ${k}`);assert.equal(r.reduce((s,p)=>s+p.pixels,0),mask.reduce((s,p)=>s+p,0))}
});
test('morphological opening removes isolated noise and None preserves all pixels',()=>{const a=new Uint8Array(81);a[40]=1;assert.equal(M.cleanup(a,9,9,1).reduce((s,v)=>s+v,0),0);assert.deepEqual(M.cleanup(a,9,9,0),a)});
function textured(w,h,swapped=false,brightness=0){return rgba(w,h,(x,y)=>{const fine=(x<w/2)!==swapped;return 90+brightness+80*(fine?((x+y)%2):((Math.floor(x/8)+Math.floor(y/8))%2))})}
let trained;
test('forest distinguishes equal-color-histogram textures on a separate shifted-brightness image',()=>{
 const w=96,h=64,maps=M.features(textured(w,h),w,h),samples=[],labels=[];
 // Both classes contain exactly the same two grayscale colors.
 for(let y=12;y<h-12;y++)for(let x=12;x<w-12;x++){if(Math.abs(x-w/2)<12)continue;samples.push(M.row(maps,y*w+x));labels.push(+(x<w/2))}
 trained=M.train(samples,labels,{trees:16,maxDimension:768,cleanupRadius:0});assert(M.validate(trained));
 const other=M.features(textured(w,h,true,12),w,h);let correct=0,total=0;
 for(let y=12;y<h-12;y++)for(let x=12;x<w-12;x++){if(Math.abs(x-w/2)<12)continue;correct+=+((M.predictPixel(other,y*w+x,trained)>=.5)===(x>=w/2));total++}
 assert(correct/total>.95,`texture accuracy ${correct/total}`);
 assert(trained.importance.slice(5).reduce((s,v)=>s+v,0)>.5,'forest must use non-color features');
 const restored=JSON.parse(JSON.stringify(trained));assert(M.validate(restored));assert.equal(M.predictPixel(other,20*w+20,restored),M.predictPixel(other,20*w+20,trained));
});
test('model imports reject legacy/incompatible and corrupt trees',()=>{assert.throws(()=>M.validate({type:'Gaussian appearance baseline'}));const corrupt=JSON.parse(JSON.stringify(trained));corrupt.trees[0]={f:99,t:0,l:{p:1},r:{p:0}};assert.throws(()=>M.validate(corrupt));const corrupt2=JSON.parse(JSON.stringify(trained));corrupt2.config.maxDimension=400;assert.throws(()=>M.validate(corrupt2))});
test('held-out metric math counts false positives/negatives and ignores unlabeled pixels',()=>{const m=M.summarize(M.metrics([1,1,0,0,-1],[1,0,1,0,1]));assert.equal(m.iou,1/3);assert.equal(m.dice,.5);assert.equal(m.precision,.5);assert.equal(m.recall,.5);assert.equal(m.pixels,4)});
test('worker end-to-end sampling, training, inference, and validation',()=>{
 const messages=[],sandbox={self:{postMessage:x=>messages.push(x)},importScripts:()=>{},Uint8Array,Uint8ClampedArray,Int8Array,Int32Array,Float32Array,Math,Error};sandbox.self.ReefModel=M;vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(APP,'worker.js'),'utf8'),sandbox);
 const send=(action,args={})=>{const id=messages.length+1;sandbox.self.onmessage({data:{id,action,...args}});let r=messages.filter(x=>x.id===id&&x.type!=='progress').at(-1);assert.notEqual(r.type,'error',r.message);return r.result};
 const w=96,h=64,annotations=[polygon(square(0,0,48,64)),polygon(square(48,0,96,64),'background')],pixels={data:textured(w,h),w,h,sx:1,sy:1};
 send('reset');const sampled=send('sample',{...pixels,annotations,fingerprint:'synthetic'});assert.equal(sampled.coral,3072);assert.equal(sampled.background,3072);
 const model=send('train',{options:{trees:8,maxDimension:768,cleanupRadius:0}});assert(M.validate(model));
 const objects=send('infer',{...pixels,model,threshold:.5,minArea:10,annotations:[]});assert(objects.length>0);
 const evaluation=send('evaluate',{...pixels,model,threshold:.5,annotations});assert(M.summarize(evaluation).iou>.9);
});
test('main page retains identical stylesheet and layout structure',()=>{
 const html=fs.readFileSync(path.join(APP,'index.html'),'utf8');
 const hash=s=>require('node:crypto').createHash('sha256').update(s).digest('hex');
 assert.equal(hash(html.match(/<style>([\s\S]*?)<\/style>/)[1]),'1716a86b59e1b8175e2237454ce04a4a8a56cd13b9f61837786d5f9f8e73c157');
 const structure=Array.from(html.matchAll(/<\/?(header|main|aside|section|nav|footer|dialog)\b/g),m=>m[0]).join('|');
 assert.equal(hash(structure),'ce52fd79a1cbd529f1d1bbd48cfe768f37ad3580fd58f16d726f72513b5fd6b8');
});
test('hole-bearing annotations export COCO RLE with correct column-major area',()=>{
 const source=fs.readFileSync(path.join(APP,'texture-ui.js'),'utf8'),start=source.indexOf('function annotationRLE('),end=source.indexOf('\n',start),sandbox={ReefModel:M};vm.createContext(sandbox);vm.runInContext(source.slice(start,end),sandbox);
 const a=polygon(square(1,1,7,7),'coral',[square(3,3,5,5)]),r=sandbox.annotationRLE(a,8,8),decoded=[];let bit=0;for(const count of r.counts){decoded.push(...Array(count).fill(bit));bit=1-bit}
 assert.equal(decoded.length,64);assert.equal(decoded.reduce((s,v)=>s+v,0),32);const truth=M.labelMask([a],8,8,1,1,true);for(let x=0;x<8;x++)for(let y=0;y<8;y++)assert.equal(decoded[x*8+y],truth[y*8+x]);
});
