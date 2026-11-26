import{r as e}from"./rolldown-runtime-XKyaHtl9.js";import{Jt as t,at as n,en as r,s as i,t as a,un as o}from"./Panel-pBzDqYmt.js";import{$i as s,Ga as c,Gt as l,Ln as u,Ri as d,V as f,Yt as p,eo as m,mt as h,ut as g}from"./three.core-BTFibstQ.js";import{a as _,i as v,r as y,t as b}from"./DoublePressToReset-DnHPxwxQ.js";import{n as x,t as S}from"./FitCameraToAspect-DXaBs0Ek.js";import{n as C,t as w}from"./TextureManager-C-M1W3q5.js";import{r as T}from"./VolumeTransferFunctions-YkcNBjtf.js";var E=e(o());function D({pixelated:e}){let t=_(e=>e.gl),n=_(e=>e.internal.active),r=_(e=>e.performance.current),i=_(e=>e.viewport.initialDpr),a=_(e=>e.setDpr);return E.useEffect(()=>{let r=t.domElement;return()=>{n&&a(i),e&&r&&(r.style.imageRendering=`auto`)}},[]),E.useEffect(()=>{a(r*i),e&&t.domElement&&(t.domElement.style.imageRendering=r===1?`auto`:`pixelated`)},[r]),null}var O=t(),k=.5,A=2048,j=`
out vec3 vPosition;
void main() {
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,M=`
precision highp float;
precision highp sampler3D;
uniform sampler3D uVolume;
uniform sampler2D uTransferFunction;
uniform vec3 uCameraPosition;
uniform vec3 uVoxelSize;
uniform float uStepSize;
uniform float uOpacityExponent;
uniform bool uLighting;
in vec3 vPosition;
out vec4 fragmentColor;

// A per-pixel random number in [0, 1) without sin() ("hash without sine", D. Hoskins): the common
// fract(sin(dot(p, k)) · 43758.5) loses precision at large pixel coordinates on many GPUs, and its offsets then form
// patterns (moiré) instead of noise.
float pixelHash(vec2 pixel) {
    vec3 mixed = fract(vec3(pixel.xyx) * 0.1031);
    mixed += dot(mixed, mixed.yzx + 33.33);
    return fract((mixed.x + mixed.y) * mixed.z);
}

vec2 intersectBox(vec3 origin, vec3 direction) {
    vec3 inverse = 1.0 / direction;
    vec3 near = (vec3(-0.5) - origin) * inverse;
    vec3 far = (vec3(0.5) - origin) * inverse;
    vec3 entry = min(near, far);
    vec3 exit = max(near, far);
    return vec2(max(max(entry.x, entry.y), entry.z), min(min(exit.x, exit.y), exit.z));
}

// Linear interpolation between the lookup table's two nearest entries, done here rather than by texture filtering: it
// places entry i exactly at value i / (n − 1) (a filtered lookup at value v is off by up to half an entry), and it
// works for any table texture, including ones that cannot be filtered linearly (32-bit float without an extension) or
// use nearest filtering, which steps the classification into contour rings wherever opacity ramps steeply.
vec4 classify(float value) {
    float last = float(textureSize(uTransferFunction, 0).x - 1);
    float position = clamp(value, 0.0, 1.0) * last;
    int lower = int(floor(position));
    int upper = min(lower + 1, int(last));
    return mix(texelFetch(uTransferFunction, ivec2(lower, 0), 0), texelFetch(uTransferFunction, ivec2(upper, 0), 0),
               position - float(lower));
}

vec3 gradientAt(vec3 point) {
    vec3 step = uVoxelSize;
    return vec3(
        texture(uVolume, point + vec3(step.x, 0.0, 0.0)).r - texture(uVolume, point - vec3(step.x, 0.0, 0.0)).r,
        texture(uVolume, point + vec3(0.0, step.y, 0.0)).r - texture(uVolume, point - vec3(0.0, step.y, 0.0)).r,
        texture(uVolume, point + vec3(0.0, 0.0, step.z)).r - texture(uVolume, point - vec3(0.0, 0.0, step.z)).r
    ) / (2.0 * step);
}

void main() {
    vec3 direction = normalize(vPosition - uCameraPosition);
    vec2 span = intersectBox(uCameraPosition, direction);
    float t = max(span.x, 0.0);
    if (t >= span.y) discard;
    float jitter = pixelHash(gl_FragCoord.xy);
    t += jitter * uStepSize;

    vec4 accumulated = vec4(0.0);
    for (int step = 0; step < ${A}; step++) {
        if (t > span.y) break;
        vec3 point = uCameraPosition + t * direction + 0.5;
        float value = texture(uVolume, point).r;
        vec4 classified = classify(value);
        float alpha = 1.0 - pow(1.0 - classified.a, uOpacityExponent);
        if (alpha > 0.002) {
            vec3 color = classified.rgb;
            if (uLighting) {
                vec3 gradient = gradientAt(point);
                float magnitude = length(gradient);
                if (magnitude > 1e-4) {
                    vec3 normal = gradient / magnitude;
                    float facing = abs(dot(normal, direction));
                    color = color * (0.3 + 0.7 * facing) + vec3(0.25 * pow(facing, 40.0));
                }
            }
            accumulated.rgb += (1.0 - accumulated.a) * alpha * color;
            accumulated.a += (1.0 - accumulated.a) * alpha;
            if (accumulated.a > 0.98) break;
        }
        t += uStepSize;
    }
    if (accumulated.a < 0.002) discard;
    // The transfer function texture holds linear light (TextureManager); encode for the screen as three's materials do.
    fragmentColor = linearToOutputTexel(vec4(accumulated.rgb / accumulated.a, accumulated.a));
}`;function N(e,[t,n,r]){let i=e instanceof Uint8Array?new g(e,t,n,r):new g(Uint16Array.from(e,h.toHalfFloat),t,n,r);return i.format=d,i.type=e instanceof Uint8Array?c:p,i.minFilter=u,i.magFilter=u,i.wrapS=i.wrapT=i.wrapR=f,i.unpackAlignment=1,i.needsUpdate=!0,i}function P({data:e,dimensions:t,transferFunction:n,samplesPerVoxel:r=1,lighting:i=!0}){let a=(0,E.useRef)(null),o=_(e=>e.invalidate),c=(0,E.useMemo)(()=>N(e,t),[e,t]);(0,E.useEffect)(()=>()=>c.dispose(),[c]);let u=(0,E.useMemo)(()=>new s({glslVersion:l,vertexShader:j,fragmentShader:M,side:1,transparent:!0,depthWrite:!1,uniforms:{uVolume:{value:null},uTransferFunction:{value:null},uCameraPosition:{value:new m},uVoxelSize:{value:new m},uStepSize:{value:.01},uOpacityExponent:{value:1},uLighting:{value:!0}}}),[]);(0,E.useEffect)(()=>()=>u.dispose(),[u]);let d=Math.max(...t);return(0,E.useLayoutEffect)(()=>{let e=u.uniforms;e.uVolume.value=c,e.uTransferFunction.value=n,e.uVoxelSize.value.set(1/t[0],1/t[1],1/t[2]),e.uLighting.value=i,o()},[u,c,n,t,i,o]),(0,E.useEffect)(()=>o(),[r,o]),(0,E.useEffect)(()=>C(n,o),[n,o]),v(e=>{let t=a.current;if(!t)return;let n=u.uniforms;t.worldToLocal(n.uCameraPosition.value.copy(e.camera.position));let i=r*(e.performance.current<1?k:1);n.uStepSize.value=1/(d*i),n.uOpacityExponent.value=1/i}),(0,O.jsx)(`mesh`,{ref:a,material:u,scale:t.map(e=>e/d),children:(0,O.jsx)(`boxGeometry`,{args:[1,1,1]})})}var F=new m(1.1,1,1.3);function I(){let e=_(e=>e.performance.regress),t=(0,E.useRef)(!1);return(0,O.jsx)(x,{makeDefault:!0,minDistance:.6,maxDistance:6,dampingFactor:.12,onStart:()=>{t.current=!0,e()},onEnd:()=>{t.current=!1},onChange:()=>{t.current&&e()}})}var L=r(function(){let e=i().globalContext,t=T(e,e.dataset),n=w().getTexture(t.textureName,t.textureName),{data:r,dimensions:a}=e.volume;return n?(0,O.jsx)(`group`,{rotation:[-Math.PI/2,0,0],children:(0,O.jsx)(P,{data:r,dimensions:a,transferFunction:n,samplesPerVoxel:e.samplesPerVoxel,lighting:e.lighting})}):null});function R(){return(0,O.jsx)(a,{panelName:`Volume`,scene:!0,children:(0,O.jsx)(n,{sx:{width:1,height:1,minHeight:0},children:(0,O.jsxs)(y,{frameloop:`demand`,performance:{min:.5},camera:{position:F.toArray(),fov:40},children:[(0,O.jsx)(S,{position:F.toArray()}),(0,O.jsx)(b,{}),(0,O.jsx)(D,{pixelated:!0}),(0,O.jsx)(L,{}),(0,O.jsx)(I,{})]})})})}export{R as default};