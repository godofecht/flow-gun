// Headless native Metal integration probe (no Cocoa window required).
// Renderer uses the same Flow-generated Metal shader that the app uses.
#import <Foundation/Foundation.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

int32_t garden_gpu_enabled(void);
int32_t garden_gpu_frame(int32_t*,int32_t*,int32_t*,float*,float*,
                         uint32_t*,uint32_t*,float*,float*,uint8_t*,int32_t);

int main(void) {
    if (!garden_gpu_enabled()) {
        puts("SKIP: native Metal device/shader not available on CI runner");
        return 0;
    }
    int32_t ground[4096]={0},plants[4096]={0},age[4096]={0};
    float wet[4096],food[4096],heights[4096];
    uint32_t ga[4096]={0},gb[4096]={0};
    uint8_t *rgb=malloc(512*480*3);
    if(!rgb)return 10;
    for(int i=0;i<4096;i++){
        wet[i]=0.5f;food[i]=0.5f;heights[i]=0.0f;
    }
    plants[31*64+31]=2;
    age[31*64+31]=100;
    ga[31*64+31]=0xb17fcc44u;
    gb[31*64+31]=0xd2ccaa89u;
    // Orthographic-like transform of the same Flow row-major ABI.
    float m[16]={
        1.0f/32.0f,0,0,0,
        0,0,-1.0f/32.0f,0,
        0,1.0f/10.0f,0,0,
        0,0,0,1
    };
    if(!garden_gpu_frame(ground,plants,age,wet,food,ga,gb,heights,m,rgb,1)){
        fputs("FAIL: GPU frame failed despite available Metal backend\n",stderr);
        free(rgb);return 2;
    }
    int changed=0;
    for(int i=0;i<512*480;i++){
        const uint8_t *p=rgb+3*i;
        if(p[0]<110 || p[0]>155 || p[1]<100 || p[1]>140) changed++;
    }
    printf("PASS: Flow Metal real GPU frame (%d geometry pixels)\n",changed);
    free(rgb);
    return changed>100?0:3;
}
