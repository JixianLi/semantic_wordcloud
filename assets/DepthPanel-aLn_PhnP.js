import{r as e}from"./rolldown-runtime-XKyaHtl9.js";import{Jt as t,at as n,en as r,s as i,t as a,un as o}from"./Panel-pBzDqYmt.js";import{a as s,i as c,r as l,t as u}from"./DoublePressToReset-DnHPxwxQ.js";import{$i as d,E as f,eo as p,ir as m,sn as h}from"./three.core-BTFibstQ.js";import{n as g,t as _}from"./FitCameraToAspect-DXaBs0Ek.js";import{w as v}from"./index-dEBzibsB.js";import{t as y}from"./TerrainSurfaceGeometry-KrbcrpJM.js";var b=e(o(),1),x=`
varying float vDepth;

void main() {
    #ifdef USE_INSTANCING
        vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
        vec4 viewPosition = modelViewMatrix * worldPosition;
    #else
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    #endif

    vDepth = -viewPosition.z;
    gl_Position = projectionMatrix * viewPosition;
}
`,S=`
uniform float cameraNear;
uniform float cameraFar;

varying float vDepth;

void main() {
    // Logarithmic depth for better near-object differentiation
    float logNear = log(cameraNear);
    float logFar = log(cameraFar);
    float logDepth = log(max(vDepth, cameraNear));

    float normalizedDepth = (logDepth - logNear) / (logFar - logNear);
    normalizedDepth = clamp(normalizedDepth, 0.0, 1.0);

    // Invert: near (0) -> white (1), far (1) -> black (0)
    float inverted = 1.0 - normalizedDepth;

    gl_FragColor = vec4(inverted, inverted, inverted, 1.0);
}
`;function C(e){return new d({vertexShader:x,fragmentShader:S,uniforms:{cameraNear:{value:e.near},cameraFar:{value:e.far}}})}function w(e,t,n){e.uniforms.cameraNear.value=t,e.uniforms.cameraFar.value=n}var T=new f,E=new f,D=new p;function O(e,t){if(T.makeEmpty(),e.traverseVisible(e=>{e instanceof h?(e.computeBoundingBox(),E.copy(e.boundingBox).applyMatrix4(e.matrixWorld),T.union(E)):e instanceof m&&e.geometry&&(e.geometry.boundingBox||e.geometry.computeBoundingBox(),E.copy(e.geometry.boundingBox).applyMatrix4(e.matrixWorld),T.union(E))}),T.isEmpty())return{near:.1,far:100};let n=1/0,r=-1/0;for(let e=0;e<8;e++)D.set(e&1?T.max.x:T.min.x,e&2?T.max.y:T.min.y,e&4?T.max.z:T.min.z).applyMatrix4(t.matrixWorldInverse),n=Math.min(n,-D.z),r=Math.max(r,-D.z);return n=Math.max(.001,n),r=Math.max(n+.001,r),{near:n,far:r*1.2}}function k(){let{scene:e,camera:t}=s(),n=(0,b.useMemo)(()=>C({near:.1,far:100}),[]);return(0,b.useEffect)(()=>()=>n.dispose(),[n]),c(()=>{let{near:r,far:i}=O(e,t);w(n,r,i)}),(0,b.useEffect)(()=>(e.overrideMaterial=n,()=>{e.overrideMaterial=null}),[e,n]),null}function A(e,t){let n=e.domElement,r=n.width,i=n.height,a=e.getContext(),o=new Uint8Array(r*i*4);a.readPixels(0,0,r,i,a.RGBA,a.UNSIGNED_BYTE,o);let s=document.createElement(`canvas`);s.width=r,s.height=i;let c=s.getContext(`2d`),l=c.createImageData(r,i),u=l.data;for(let e=0;e<i;e++){let t=i-1-e;for(let n=0;n<r;n++){let i=(t*r+n)*4,a=(e*r+n)*4,s=o[i],c=o[i+3];u[a]=s,u[a+1]=s,u[a+2]=s,u[a+3]=c}}c.putImageData(l,0,0);let d=s.toDataURL(`image/png`),f=document.createElement(`a`);f.download=t,f.href=d,f.click()}var j=t(),M=[1.7,1.3,1.9],N=r(function(){let e=i().globalContext,{mean:t}=e.ensemble,n=(0,b.useMemo)(()=>y(t,e.heightScale),[t,e.heightScale]);return(0,b.useEffect)(()=>()=>n.dispose(),[n]),(0,j.jsx)(`mesh`,{geometry:n,children:(0,j.jsx)(`meshBasicMaterial`,{})})});function P({saveRef:e}){let{gl:t,scene:n,camera:r}=s();return(0,b.useEffect)(()=>(e.current=()=>{t.render(n,r),A(t,`terrain-depth.png`)},()=>{e.current=null}),[t,n,r,e]),null}function F(){let e=(0,b.useRef)(null);return(0,j.jsx)(a,{panelName:`Depth`,scene:!0,appbarContent:(0,j.jsx)(v,{size:`small`,onClick:()=>e.current?.(),sx:{mr:.5},children:`Save PNG`}),children:(0,j.jsx)(n,{sx:{width:1,height:1,minHeight:0,aspectRatio:`4 / 3`},children:(0,j.jsxs)(l,{frameloop:`demand`,camera:{position:M,fov:38},children:[(0,j.jsx)(_,{position:M,minimumAspect:1.25}),(0,j.jsx)(u,{}),(0,j.jsx)(k,{}),(0,j.jsx)(N,{}),(0,j.jsx)(P,{saveRef:e}),(0,j.jsx)(g,{makeDefault:!0,maxPolarAngle:Math.PI*.47,minDistance:1.2,maxDistance:9})]})})})}export{F as default};