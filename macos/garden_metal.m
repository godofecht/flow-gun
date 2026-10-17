// macOS-only Metal raster backend for the *real* Flow garden state.
// Vertex/fragment shaders are both emitted by src/garden_gpu.flow, shared
// with WebGPU. The deterministic Flow simulation is never duplicated.
// Renderer failure returns 0 and Flow's original software rasterizer runs.
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include <stdint.h>
#include <stdlib.h>
#include <math.h>

#define GARDEN_CELLS 4096
#define GARDEN_W 512
#define GARDEN_H 480
#define MAX_VERTICES 200000
#if __has_feature(objc_arc)
#define GARDEN_RELEASE(obj) ((void)0)
#else
#define GARDEN_RELEASE(obj) [(obj) release]
#endif

typedef struct { float x,y,z,r,g,b; } GardenVertex;
static GardenVertex *mesh = NULL;
static uint32_t used = 0;
static id<MTLDevice> metal = nil;
static id<MTLCommandQueue> queue = nil;
static id<MTLRenderPipelineState> pipeline = nil;
static id<MTLDepthStencilState> depthState = nil;
static id<MTLTexture> colorTexture = nil;
static id<MTLTexture> depthTexture = nil;
static uint8_t *readback = NULL;
static int supported = -1;

static float sat(float a) { return fminf(1.0f, fmaxf(0.0f, a)); }
static void push(float x,float y,float z,float r,float g,float b) {
    if (!mesh || used>=MAX_VERTICES) return;
    mesh[used++] = (GardenVertex){x,y,z,sat(r),sat(g),sat(b)};
}
static void tri(const float a[3],const float b[3],const float c[3],
                float r,float g,float bl) {
    push(a[0],a[1],a[2],r,g,bl);
    push(b[0],b[1],b[2],r,g,bl);
    push(c[0],c[1],c[2],r,g,bl);
}
static void quad(const float a[3],const float b[3],const float c[3],
                 const float d[3],float r,float g,float bl) {
    tri(a,b,c,r,g,bl);tri(a,c,d,r,g,bl);
}
static void plantQuad(float x,float y,float z,float height,float radius,
                      float r,float g,float b) {
    float a[3]={x-radius,y,z}, bb[3]={x+radius,y,z};
    float c[3]={x+radius*0.5f,y+height,z},d[3]={x-radius*0.5f,y+height,z};
    quad(a,bb,c,d,r,g,b);
    float e[3]={x,y,z-radius},f[3]={x,y,z+radius};
    float gg[3]={x,y+height,z+radius*0.5f},h[3]={x,y+height,z-radius*0.5f};
    quad(e,f,gg,h,r,g,b);
}
static void point(float p[3],int x,int y,const float *height) {
    p[0]=(float)(x*2-32);
    const int sx=x<32?x*2:63;
    const int sy=y<32?y*2:63;
    p[1]=height[sy*64+sx];
    p[2]=(float)(y*2-32);
}
static void buildScene(const int32_t *ground,const int32_t *plants,const int32_t *age,
                       const float *wet,const float *food,const uint32_t *ga,
                       const uint32_t *gb,const float *height) {
    used=0;
    for(int y=0;y<32;y++)for(int x=0;x<32;x++){
        float a[3],b[3],d[3],e[3];
        point(a,x,y,height);point(b,x+1,y,height);
        point(d,x,y+1,height);point(e,x+1,y+1,height);
        int i=(y*2)*64+x*2;
        float r=0.25f,g=0.30f+wet[i]*0.13f,bl=0.21f;
        if(ground[i]==1){r=0.14f;g=0.36f;bl=0.42f;}
        if(ground[i]==2){r=0.59f;g=0.52f;bl=0.36f;}
        tri(a,d,b,r,g,bl);tri(b,d,e,r,g,bl);
    }
    for(int i=0;i<GARDEN_CELLS;i++){
        int kind=plants[i];
        if(kind==0||ground[i]!=0)continue;
        float x=(float)(i%64)-31.5f,z=(float)(i/64)-31.5f;
        float stature=(float)(((ga[i]>>8)&255)+((gb[i]>>8)&255))/510.0f;
        float branch=(float)(((ga[i]>>16)&255)+((gb[i]>>16)&255))/510.0f;
        float pigment=(float)(((ga[i]>>24)&255)+((gb[i]>>24)&255))/510.0f;
        float maturity=sat((float)age[i]/(14.0f+22.0f*stature));
        float vigor=sat(0.34f+food[i]*0.38f+wet[i]*0.28f);
        float growth=maturity*vigor;
        float tall=(kind==4?1.6f+2.04f*stature:kind==2?0.85f+1.13f*stature:
                   kind==3?0.65f+0.86f*stature:0.22f+0.24f*stature)*growth;
        float wide=(kind==4?0.57f+0.75f*branch:kind==3?0.35f+0.34f*branch:
                   kind==2?0.29f+0.21f*branch:0.20f+0.22f*branch)*growth;
        float r=kind==4?0.11f:kind==3?0.12f:kind==2?0.19f:0.25f;
        float g=kind==4?0.43f:kind==3?0.52f:kind==2?0.61f:0.65f;
        float b=kind==4?0.18f:kind==3?0.21f:kind==2?0.25f:0.29f;
        plantQuad(x,height[i],z,tall,wide,r,g,b);
        if(kind==2&&age[i]>14&&wet[i]>0.29f){
            float pr=pigment<0.36f?0.62f:pigment>0.67f?0.98f:0.94f;
            float pg=pigment<0.36f?0.50f:pigment>0.67f?0.78f:0.52f;
            float pb=pigment<0.36f?0.91f:pigment>0.67f?0.34f:0.60f;
            plantQuad(x,height[i]+tall*0.8f,z,fmaxf(tall*0.25f,0.09f),
                      wide*0.55f,pr,pg,pb);
        }
    }
}

static bool setup() {
    if(supported>=0)return supported==1;
    supported=0;
    @autoreleasepool {
        metal=MTLCreateSystemDefaultDevice();
        if(!metal)return false;
        NSString *path=[[[NSProcessInfo processInfo] environment]
                          objectForKey:@"FLOW_GARDEN_MSL"];
        if(!path)path=@"dist/gpu/garden_scene/sh0_garden.metal";
        NSError *error=nil;
        NSString *shader=[NSString stringWithContentsOfFile:path
                        encoding:NSUTF8StringEncoding error:&error];
        if(!shader)return false;
        id<MTLLibrary> lib=[metal newLibraryWithSource:shader options:nil error:&error];
        if(!lib)return false;
        id<MTLFunction> vs=[lib newFunctionWithName:@"vs_main"];
        id<MTLFunction> fs=[lib newFunctionWithName:@"fs_main"];
        if(!vs||!fs)return false;
        MTLRenderPipelineDescriptor *d=[[MTLRenderPipelineDescriptor alloc] init];
        d.vertexFunction=vs;d.fragmentFunction=fs;
        d.colorAttachments[0].pixelFormat=MTLPixelFormatRGBA8Unorm;
        d.depthAttachmentPixelFormat=MTLPixelFormatDepth32Float;
        d.vertexDescriptor=[MTLVertexDescriptor vertexDescriptor];
        d.vertexDescriptor.attributes[0].format=MTLVertexFormatFloat3;
        d.vertexDescriptor.attributes[0].offset=0;
        d.vertexDescriptor.attributes[0].bufferIndex=16;
        d.vertexDescriptor.attributes[1].format=MTLVertexFormatFloat3;
        d.vertexDescriptor.attributes[1].offset=12;
        d.vertexDescriptor.attributes[1].bufferIndex=16;
        d.vertexDescriptor.layouts[16].stride=sizeof(GardenVertex);
        pipeline=[metal newRenderPipelineStateWithDescriptor:d error:&error];
        if(!pipeline)return false;
        queue=[metal newCommandQueue];
        MTLDepthStencilDescriptor *ds=[[MTLDepthStencilDescriptor alloc] init];
        ds.depthCompareFunction=MTLCompareFunctionLess;
        ds.depthWriteEnabled=YES;
        depthState=[metal newDepthStencilStateWithDescriptor:ds];
        MTLTextureDescriptor *cd=[MTLTextureDescriptor
             texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm
             width:GARDEN_W height:GARDEN_H mipmapped:NO];
        cd.usage=MTLTextureUsageRenderTarget|MTLTextureUsageShaderRead;
        cd.storageMode=MTLStorageModeShared;
        colorTexture=[metal newTextureWithDescriptor:cd];
        MTLTextureDescriptor *dd=[MTLTextureDescriptor
             texture2DDescriptorWithPixelFormat:MTLPixelFormatDepth32Float
             width:GARDEN_W height:GARDEN_H mipmapped:NO];
        dd.usage=MTLTextureUsageRenderTarget;
        depthTexture=[metal newTextureWithDescriptor:dd];
        mesh=malloc(sizeof(GardenVertex)*MAX_VERTICES);
        readback=malloc(GARDEN_W*GARDEN_H*4);
        if(!queue||!depthState||!colorTexture||!depthTexture||!mesh||!readback)return false;
        supported=1;
        return true;
    }
}

int32_t garden_gpu_enabled(void) { return setup()?1:0; }
void garden_gpu_hide(void) { }

int32_t garden_gpu_frame(int32_t *ground,int32_t *plants,int32_t *age,
                         float *wet,float *food,uint32_t *ga,uint32_t *gb,
                         float *height,float *matrix,uint8_t *rgb,int32_t epoch) {
    (void)epoch;
    if(!setup()||!rgb||!matrix)return 0;
    @autoreleasepool {
        buildScene(ground,plants,age,wet,food,ga,gb,height);
        if(!used)return 0;
        id<MTLBuffer> vb=[metal newBufferWithBytes:mesh
                              length:used*sizeof(GardenVertex)
                              options:MTLResourceStorageModeShared];
        if(!vb)return 0;
        float m[16];
        for(int r=0;r<4;r++)for(int c=0;c<4;c++)
            m[c*4+r]=matrix[r*4+c];
        id<MTLCommandBuffer> cb=[queue commandBuffer];
        MTLRenderPassDescriptor *pass=[MTLRenderPassDescriptor renderPassDescriptor];
        pass.colorAttachments[0].texture=colorTexture;
        pass.colorAttachments[0].loadAction=MTLLoadActionClear;
        pass.colorAttachments[0].storeAction=MTLStoreActionStore;
        pass.colorAttachments[0].clearColor=MTLClearColorMake(0.28,0.45,0.58,1);
        pass.depthAttachment.texture=depthTexture;
        pass.depthAttachment.loadAction=MTLLoadActionClear;
        pass.depthAttachment.storeAction=MTLStoreActionDontCare;
        pass.depthAttachment.clearDepth=1.0;
        id<MTLRenderCommandEncoder> enc=[cb renderCommandEncoderWithDescriptor:pass];
        if(!enc){ GARDEN_RELEASE(vb); return 0; }
        [enc setRenderPipelineState:pipeline];
        [enc setDepthStencilState:depthState];
        [enc setVertexBuffer:vb offset:0 atIndex:16];
        [enc setVertexBytes:m length:sizeof(m) atIndex:0];
        [enc drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:used];
        [enc endEncoding];
        [cb commit];
        [cb waitUntilCompleted];
        if(cb.status!=MTLCommandBufferStatusCompleted){ GARDEN_RELEASE(vb); return 0; }
        [colorTexture getBytes:readback bytesPerRow:GARDEN_W*4
                       fromRegion:MTLRegionMake2D(0,0,GARDEN_W,GARDEN_H)
                       mipmapLevel:0];
        for(size_t k=0;k<(size_t)GARDEN_W*GARDEN_H;k++){
            rgb[3*k]=readback[4*k];
            rgb[3*k+1]=readback[4*k+1];
            rgb[3*k+2]=readback[4*k+2];
        }
        GARDEN_RELEASE(vb);
        return 1;
    }
}
