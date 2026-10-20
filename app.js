import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const $=id=>document.getElementById(id), host=$('viewer');
let scene,camera,renderer,controls,clock,vrm,grid;
let motion='idle',motionStart=0,idle=true,baseBones=[];
function init(){
 scene=new THREE.Scene();scene.background=new THREE.Color(0x111621);
 camera=new THREE.PerspectiveCamera(32,1,.05,200);camera.position.set(0,1.5,4);
 renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;host.prepend(renderer.domElement);
 controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.target.set(0,1,0);
 scene.add(new THREE.HemisphereLight(0xdce5ff,0x393343,2.2));
 const key=new THREE.DirectionalLight(0xffead8,3);key.position.set(3,5,4);scene.add(key);
 const fill=new THREE.DirectionalLight(0x9aaeff,2);fill.position.set(-4,2,-3);scene.add(fill);
 grid=new THREE.GridHelper(10,20,0x46506b,0x293247);scene.add(grid);
 const floor=new THREE.Mesh(new THREE.CircleGeometry(5,64),new THREE.MeshStandardMaterial({color:0x151a26,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.01;scene.add(floor);
 clock=new THREE.Clock();resize();addEventListener('resize',resize);renderer.setAnimationLoop(render);bind();
}
function resize(){if(!renderer)return;const w=host.clientWidth||800,h=host.clientHeight||600;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);if(vrm)fitCamera()}
function fitCamera(){vrm.scene.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(vrm.scene);if(b.isEmpty())return;const s=b.getSize(new THREE.Vector3()),c=b.getCenter(new THREE.Vector3()),height=Math.max(s.y,1),aspect=Math.max(host.clientWidth/Math.max(host.clientHeight,1),.5),vf=THREE.MathUtils.degToRad(camera.fov),hf=2*Math.atan(Math.tan(vf/2)*aspect),dist=Math.max(height*.62/Math.tan(vf/2),Math.max(s.x,.5)*.7/Math.tan(hf/2),2);controls.target.set(c.x,b.min.y+height*.53,c.z);camera.position.set(c.x,controls.target.y+height*.05,c.z+dist);camera.near=dist/100;camera.far=dist*30;camera.updateProjectionMatrix();controls.minDistance=height*.4;controls.maxDistance=dist*3;controls.update()}
async function loadVRM(fileOrUrl,name='White_Haired_Girl.vrm'){
 $('loading').classList.remove('hidden');$('loading').textContent='Loading avatar…';
 try{const loader=new GLTFLoader();loader.register(p=>new VRMLoaderPlugin(p));const gltf=await loader.loadAsync(fileOrUrl);if(!gltf.userData.vrm)throw Error('File is not a readable VRM avatar');if(vrm){scene.remove(vrm.scene);VRMUtils.deepDispose(vrm.scene)}vrm=gltf.userData.vrm;VRMUtils.rotateVRM0(vrm);scene.add(vrm.scene);vrm.scene.traverse(o=>{if(o.isMesh)o.frustumCulled=false});cacheBones();fitCamera();$('modelName').textContent=name;$('status').textContent='Avatar ready';buildExpressions();$('loading').classList.add('hidden');setMotion('idle')}catch(e){console.error(e);$('loading').textContent='Load error: '+e.message;$('status').textContent='Load failed'}}
function cacheBones(){
 baseBones=[];
 const names=['hips','spine','chest','neck','head','leftShoulder','rightShoulder','leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand'];
 for(const n of names){const b=vrm.humanoid?.getNormalizedBoneNode(n);if(b)baseBones.push({n,b,rot:b.rotation.clone(),pos:b.position.clone(),quat:b.quaternion.clone()})}
 // Aim upper arms toward relaxed world-space directions using the actual joint positions,
 // instead of guessing Euler Z angles for this rig.
 vrm.scene.updateMatrixWorld(true);
 const aimBone=(upperName,lowerName,handedness)=>{
   const upper=baseBones.find(x=>x.n===upperName)?.b, lower=baseBones.find(x=>x.n===lowerName)?.b;
   if(!upper||!lower)return;
   const p0=new THREE.Vector3(),p1=new THREE.Vector3();
   upper.getWorldPosition(p0);lower.getWorldPosition(p1);
   const current=p1.sub(p0).normalize();
   const target=new THREE.Vector3(handedness*0.22,-0.96,0.18).normalize();
   const delta=new THREE.Quaternion().setFromUnitVectors(current,target);
   const worldQ=upper.getWorldQuaternion(new THREE.Quaternion());
   worldQ.premultiply(delta);
   const parentQ=upper.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
   upper.quaternion.copy(parentQ.multiply(worldQ));
 };
 aimBone('leftUpperArm','leftLowerArm',1);
 aimBone('rightUpperArm','rightLowerArm',-1);
 vrm.scene.updateMatrixWorld(true);
 // Add a mild elbow bend toward the front, preserving each rig's local orientation.
 for(const [name,sign] of [['leftLowerArm',1],['rightLowerArm',-1]]){
   const x=baseBones.find(v=>v.n===name);
   if(x){x.b.rotation.x-=0.06;x.b.rotation.z+=sign*0.08}
 }
 for(const x of baseBones){x.rot.copy(x.b.rotation);x.pos.copy(x.b.position);x.quat.copy(x.b.quaternion)}
}
function buildExpressions(){const root=$('expressions');root.innerHTML='';const ex=vrm.expressionManager?.expressions||[];const names=[...new Set(ex.map(e=>e.expressionName||e.name).filter(Boolean))];if(!names.length){root.textContent='No expressions found';return}for(const n of names){const b=document.createElement('button');b.textContent=({joy:'Joy',fun:'Fun',sorrow:'Sorrow',angry:'Angry',surprised:'Surprised',blink:'Blink',blink_l:'Blink L',blink_r:'Blink R',aa:'A',ih:'I',ou:'U',ee:'E',oh:'O',neutral:'Neutral'})[n.toLowerCase()]||n;b.title=n;b.onclick=()=>{for(const k of names)vrm.expressionManager.setValue(k,k===n?1:0);root.querySelectorAll('button').forEach(x=>x.classList.toggle('selected',x===b))};root.append(b)}}
function setMotion(m){motion=m;motionStart=clock.elapsedTime;document.querySelectorAll('[data-motion]').forEach(b=>b.classList.toggle('selected',b.dataset.motion===m));$('motionLabel').textContent=m[0].toUpperCase()+m.slice(1)}
function applyMotion(t){if(!vrm)return;for(const x of baseBones){x.b.rotation.copy(x.rot);x.b.position.copy(x.pos)}const get=n=>baseBones.find(x=>x.n===n)?.b,head=get('head'),neck=get('neck'),chest=get('chest')||get('spine'),spine=get('spine'),hips=get('hips'),arm=get('rightUpperArm'),forearm=get('rightLowerArm'),u=t-motionStart;if(motion==='idle'&&idle){const breath=Math.sin(t*1.25),sway=Math.sin(t*.55);if(head){head.rotation.x+=Math.sin(t*.8)*.012;head.rotation.z+=sway*.012}if(neck)neck.rotation.z-=sway*.006;if(chest)chest.rotation.x+=breath*.008;if(spine)spine.rotation.x+=breath*.004;if(hips)hips.position.y+=Math.sin(t*1.25)*.003;for(const [name,sign] of [['leftShoulder',1],['rightShoulder',-1]]){const b=get(name);if(b)b.rotation.z+=sway*.006*sign}}else if(motion==='nod'){if(head)head.rotation.x+=Math.sin(u*9)*.22*Math.max(0,1-u/1.5);if(u>1.5)setMotion('idle')}else if(motion==='wave'){const raise=Math.min(1,u/0.7),lower=Math.min(1,Math.max(0,(4.8-u)/0.7)),e=raise*lower;const upper=get('rightUpperArm'),lowerArm=get('rightLowerArm'),hand=get('rightHand');const aimSegment=(a,b,dir)=>{if(!a||!b)return;vrm.scene.updateMatrixWorld(true);const p=new THREE.Vector3(),q=new THREE.Vector3();a.getWorldPosition(p);b.getWorldPosition(q);const current=q.sub(p).normalize(),target=dir.clone().normalize(),delta=new THREE.Quaternion().setFromUnitVectors(current,target),world=a.getWorldQuaternion(new THREE.Quaternion());world.premultiply(delta);const parent=a.parent.getWorldQuaternion(new THREE.Quaternion()).invert();a.quaternion.copy(parent.multiply(world));vrm.scene.updateMatrixWorld(true)};if(upper&&lowerArm){const side=-1;aimSegment(upper,lowerArm,new THREE.Vector3(side*0.72,0.68,0.02).lerp(new THREE.Vector3(side*0.72,0.68,0.02),1-e));aimSegment(lowerArm,hand,new THREE.Vector3(side*0.10,0.96,0.12))}if(hand){/* Infer palm normal from the actual index/little/middle finger joints in this VRM rig, then aim it toward the camera. */const index=get('rightHand')?.getObjectByName('J_Bip_R_Index1')||vrm.humanoid?.getRawBoneNode('rightIndexProximal'),little=vrm.humanoid?.getRawBoneNode('rightLittleProximal'),middle=vrm.humanoid?.getRawBoneNode('rightMiddleProximal');const idx=hand.children.find(n=>/Index1/.test(n.name))||index,lit=hand.children.find(n=>/Little1/.test(n.name))||little,mid=hand.children.find(n=>/Middle1/.test(n.name))||middle;if(idx&&lit&&mid){vrm.scene.updateMatrixWorld(true);const pI=idx.getWorldPosition(new THREE.Vector3()),pL=lit.getWorldPosition(new THREE.Vector3()),pM=mid.getWorldPosition(new THREE.Vector3()),pH=hand.getWorldPosition(new THREE.Vector3());const spread=pI.sub(pL).normalize(),fingers=pM.sub(pH).normalize(),normal=spread.cross(fingers).normalize(),toward=camera.position.clone().sub(pH).normalize();if(normal.dot(toward)<0)normal.negate();const delta=new THREE.Quaternion().setFromUnitVectors(normal,toward);const world=hand.getWorldQuaternion(new THREE.Quaternion());world.premultiply(delta);const parent=hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert();hand.quaternion.slerp(parent.multiply(world),e)}/* Side-to-side wave: rotate around the hand's local forward axis, not its pitch axis. */hand.rotation.z+=Math.sin(u*10)*0.30*e}if(u>4.8)setMotion('idle')}else if(motion==='bow'){const e=u<.6?u/.6:u<1.4?1:Math.max(0,(2-u)/.6);if(chest)chest.rotation.x-=.48*e;if(head)head.rotation.x-=.2*e;if(u>2)setMotion('idle')}}
function bind(){$('vrmFile').onchange=e=>{const f=e.target.files[0];if(f){const u=URL.createObjectURL(f);loadVRM(u,f.name).finally(()=>URL.revokeObjectURL(u))}e.target.value=''};$('reset').onclick=fitCamera;$('clearExpression').onclick=()=>{for(const e of vrm?.expressionManager?.expressions||[])vrm.expressionManager.setValue(e.expressionName||e.name,0);$('expressions').querySelectorAll('button').forEach(b=>b.classList.remove('selected'))};$('idle').onchange=e=>idle=e.target.checked;document.querySelectorAll('[data-motion]').forEach(b=>b.onclick=()=>setMotion(b.dataset.motion))}
function render(){const d=Math.min(clock.getDelta(),.05),t=clock.elapsedTime;applyMotion(t);vrm?.update(d);controls.update();renderer.render(scene,camera)}
init();loadVRM('./assets/White_Haired_Girl.vrm');
