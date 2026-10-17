// Generated from Flow by lib/stdlib/gpu_shader.flow. Do not edit.
struct U { v: array<vec4<f32>, 4> };
@group(0) @binding(0) var<uniform> u: U;
struct VOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) v0: vec3<f32>,
};
@vertex fn vs_main(@location(0) a0: vec3<f32>, @location(1) a1: vec3<f32>, @builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VOut {
    var vout: VOut;
    let t0 = (mat4x4<f32>(u.v[0], u.v[1], u.v[2], u.v[3]) * vec4<f32>(a0, 1.0));
    vout.pos = vec4<f32>(t0.x, t0.y, (0.5 * (t0.z + t0.w)), t0.w);
    vout.v0 = a1;
    return vout;
}
@fragment fn fs_main(vin: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4<f32> {
    return vec4<f32>(vin.v0, 1.0);
}
