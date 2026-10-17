// Real Flow ecology -> WebGPU geometry and depth rendering.
// Shader comes from src/garden_gpu.flow, never a handwritten WGSL substitute.
const SIZE=64, CELLS=4096, WIDTH=512, HEIGHT=480;
const overlay=document.createElement('canvas');
overlay.width=WIDTH; overlay.height=HEIGHT; overlay.hidden=true;
overlay.setAttribute('aria-hidden','true');
Object.assign(overlay.style,{position:'fixed',zIndex:'20',pointerEvents:'none',display:'none'});
document.body.appendChild(overlay);
let device,context,pipeline,depth,uniform,group,vertices,capacity=0;
let geometry=null, previousEpoch=-1, queued=false, latest;
const clamp=x=>Math.min(1,Math.max(0,x));
function v(out,p,c) { out.push(...p,...c.map(clamp)); }
function tri(out,a,b,c,color) { v(out,a,color);v(out,b,color);v(out,c,color); }
function quad(out,a,b,c,d,color) { tri(out,a,b,c,color);tri(out,a,c,d,color); }
function foliage(out,x,y,z,h,r,color) {
  quad(out,[x-r,y,z],[x+r,y,z],[x+r/2,y+h,z],[x-r/2,y+h,z],color);
  quad(out,[x,y,z-r],[x,y,z+r],[x,y+h,z+r/2],[x,y+h,z-r/2],color);
}
export function gardenGeometry(w) {
  const out=[];
  const {ground,plant,age,wet,food,ga,gb,heights}=w;
  if (![ground,plant,age,wet,food,ga,gb,heights].every(a=>a?.length===CELLS))
    throw new TypeError('Expected 4096-cell Flow state arrays');
  // Same terrain lattice and heights as Flow's native 3D scene.
  function p(x,y) {
    return [x*2-32,heights[Math.min(63,y*2)*SIZE+Math.min(63,x*2)],y*2-32];
  }
  for(let y=0;y<32;y++) for(let x=0;x<32;x++) {
    const i=y*2*SIZE+x*2;
    const c=ground[i]===1?[0.14,0.36,0.42]:
      ground[i]===2?[0.59,0.52,0.36]:
      [0.25,0.30+wet[i]*0.13,0.21];
    const a=p(x,y),b=p(x+1,y),d=p(x,y+1),e=p(x+1,y+1);
    tri(out,a,d,b,c);tri(out,b,d,e,c);
  }
  for(let i=0;i<CELLS;i++) {
    const kind=plant[i];
    if (!kind||ground[i]!==0) continue;
    const x=i%SIZE-31.5,z=Math.floor(i/SIZE)-31.5;
    const stat=(((ga[i]>>>8)&255)+((gb[i]>>>8)&255))/510;
    const branch=(((ga[i]>>>16)&255)+((gb[i]>>>16)&255))/510;
    const pigment=(((ga[i]>>>24)&255)+((gb[i]>>>24)&255))/510;
    const growth=clamp(age[i]/(14+22*stat))*clamp(0.34+food[i]*0.38+wet[i]*0.28);
    const h=(kind===4?1.6+2.04*stat:kind===2?0.85+1.13*stat:
      kind===3?0.65+0.86*stat:0.22+0.24*stat)*growth;
    const radius=(kind===4?0.57+0.75*branch:kind===3?0.35+0.34*branch:
      kind===2?0.29+0.21*branch:0.20+0.22*branch)*growth;
    const color=kind===4?[0.11,0.43,0.18]:kind===3?[0.12,0.52,0.21]:
      kind===2?[0.19,0.61,0.25]:[0.25,0.65,0.29];
    foliage(out,x,heights[i],z,h,radius,color);
    if (kind===2&&age[i]>14&&wet[i]>0.29) {
      const petals=pigment<0.36?[0.62,0.50,0.91]:
        pigment>0.67?[0.98,0.78,0.34]:[0.94,0.52,0.60];
      foliage(out,x,heights[i]+h*0.8,z,Math.max(h*0.25,0.09),
        radius*0.55,petals);
    }
  }
  return new Float32Array(out);
}
function align() {
  const canvas=globalThis.flowGfx?.canvas;
  if(!canvas||overlay.hidden)return;
  const box=canvas.getBoundingClientRect();
  const sx=box.width/742,sy=box.height/660;
  Object.assign(overlay.style,{
    left:(box.left+20*sx)+'px',top:(box.top+90*sy)+'px',
    width:(512*sx)+'px',height:(480*sy)+'px'
  });
}
function draw(w) {
  if(w.epoch!==previousEpoch||!geometry){
    geometry=gardenGeometry(w);previousEpoch=w.epoch;
  }
  const required=geometry.byteLength;
  if(required>capacity){
    vertices?.destroy();capacity=Math.max(required,capacity*2,1<<20);
    vertices=device.createBuffer({size:capacity,
      usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  }
  device.queue.writeBuffer(vertices,0,geometry);
  const matrix=new Float32Array(16);
  for(let r=0;r<4;r++)for(let c=0;c<4;c++)
    matrix[c*4+r]=w.viewproj[r*4+c];
  device.queue.writeBuffer(uniform,0,matrix);
  const enc=device.createCommandEncoder();
  const pass=enc.beginRenderPass({
    colorAttachments:[{view:context.getCurrentTexture().createView(),
      clearValue:{r:0.28,g:0.45,b:0.58,a:1},loadOp:'clear',storeOp:'store'}],
    depthStencilAttachment:{view:depth.createView(),
      depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0,group);
  pass.setVertexBuffer(0,vertices);
  pass.draw(geometry.length/6);
  pass.end();
  device.queue.submit([enc.finish()]);
  overlay.hidden=false;overlay.style.display='block';align();
  globalThis.flowGardenGPU.frames++;
}
function fallback(reason){
  console.info('Flow Garden WebGPU fallback: '+String(reason));
  globalThis.flowGardenGPU.ready=false;
  globalThis.flowGardenGPU.hide();
}
globalThis.flowGardenGPU={
  ready:false,frames:0,
  hide(){overlay.hidden=true;overlay.style.display='none';},
  submit(world){
    latest=world;
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{
      queued=false;
      if(!this.ready||!latest)return;
      try{draw(latest);}catch(error){fallback(error);}
    });
  }
};
async function start(){
  if(!navigator.gpu)return;
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter)return;
  device=await adapter.requestDevice();
  device.lost.then(info=>fallback('device lost: '+info.message));
  const res=await fetch('../gpu/garden_scene/sh0_garden.wgsl');
  if(!res.ok)throw new Error('Flow WGSL unavailable: HTTP '+res.status);
  const source=await res.text();
  if(!source.includes('Generated from Flow by'))
    throw new Error('Rejecting shader not generated by Flow');
  const shader=device.createShaderModule({code:source});
  const validation=await shader.getCompilationInfo();
  const errors=validation.messages.filter(x=>x.type==='error');
  if(errors.length)throw new Error(errors.map(x=>x.message).join('; '));
  context=overlay.getContext('webgpu');
  const format=navigator.gpu.getPreferredCanvasFormat();
  context.configure({device,format,alphaMode:'opaque'});
  depth=device.createTexture({size:[WIDTH,HEIGHT],format:'depth24plus',
    usage:GPUTextureUsage.RENDER_ATTACHMENT});
  pipeline=device.createRenderPipeline({
    layout:'auto',
    vertex:{module:shader,entryPoint:'vs_main',
      buffers:[{arrayStride:24,attributes:[
        {shaderLocation:0,offset:0,format:'float32x3'},
        {shaderLocation:1,offset:12,format:'float32x3'}]}]},
    fragment:{module:shader,entryPoint:'fs_main',targets:[{format}]},
    primitive:{topology:'triangle-list',cullMode:'none'},
    depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}
  });
  uniform=device.createBuffer({size:64,
    usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),
    entries:[{binding:0,resource:{buffer:uniform}}]});
  globalThis.flowGardenGPU.ready=true;
}
start().catch(fallback);
window.addEventListener('resize',align);
window.addEventListener('scroll',align,{passive:true});
