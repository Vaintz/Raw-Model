import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const $=id=>document.getElementById(id), host=$('viewer');
let scene,camera,renderer,controls,clock,vrm,grid;
let motion='idle',motionStart=0,idle=true,baseBones=[];
let cameraStream=null,poseLandmarker=null,trackedPose=null,trackedFaceLandmarks=null,trackedFaceMatrix=null,lastPoseDetect=0,cameraActive=false,headTracking={x:0,y:0,z:0},headBase=null,eyeBase={left:null,right:null},landmarkCanvas=null,landmarkCtx=null;
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
async function startCameraTracking(){
 const status=$('cameraStatus'),video=$('cameraVideo'),start=$('cameraStart'),stop=$('cameraStop');
 try{
  status.textContent='Memuat model ekspresi wajah…';start.disabled=true;
  const vision=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs');
  const files=await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
  poseLandmarker=await vision.FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',delegate:'CPU'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true});
  cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});
  video.srcObject=cameraStream;await video.play();landmarkCanvas=$('landmarkCanvas');landmarkCtx=landmarkCanvas?.getContext('2d');if(landmarkCanvas)landmarkCanvas.style.display=$('showLandmarks')?.checked?'block':'none';cameraActive=true;trackedPose=null;trackedFaceLandmarks=null;trackedFaceMatrix=null;headTracking={x:0,y:0,z:0};headBase=null;eyeBase={left:null,right:null};setMotion('camera');
  start.disabled=true;stop.disabled=false;status.textContent='Kamera aktif. Hadapkan wajah ke kamera dengan pencahayaan cukup.';
 }catch(err){
  console.error('Camera tracking initialization failed:',err);const detail=err instanceof Error ? `${err.name}: ${err.message}` : (err?.message || err?.type || err?.target?.src || JSON.stringify(err) || String(err));status.textContent='Kamera gagal: '+detail;start.disabled=false;
  if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}
 }
}
function stopCameraTracking(){
 cameraActive=false;trackedPose=null;trackedFaceLandmarks=null;headTracking={x:0,y:0,z:0};headBase=null;eyeBase={left:null,right:null};
 if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}
 const v=$('cameraVideo');if(v)v.srcObject=null;if(landmarkCtx&&landmarkCanvas)landmarkCtx.clearRect(0,0,landmarkCanvas.width,landmarkCanvas.height);if(landmarkCanvas)landmarkCanvas.style.display='none';
 $('cameraStart').disabled=false;$('cameraStop').disabled=true;
 $('cameraStatus').textContent='Kamera dimatikan.';
 if(poseLandmarker){poseLandmarker.close();poseLandmarker=null}
 setMotion('idle');
}
function trackArm(upperName,lowerName,shoulder,elbow,wrist){
 const upper=baseBones.find(x=>x.n===upperName)?.b,lower=baseBones.find(x=>x.n===lowerName)?.b,hand=baseBones.find(x=>x.n===upperName.replace('UpperArm','Hand'))?.b;
 if(!upper||!lower||!shoulder||!elbow||!wrist)return;
 const direction=(a,b)=>new THREE.Vector3((b.x-a.x)*2.2,(a.y-b.y)*2.2,(a.z-b.z)*1.5).normalize();
 const aim=(a,b,dir)=>{
  vrm.scene.updateMatrixWorld(true);
  const p=new THREE.Vector3(),q=new THREE.Vector3();a.getWorldPosition(p);b.getWorldPosition(q);
  const current=q.sub(p).normalize(),delta=new THREE.Quaternion().setFromUnitVectors(current,dir);
  const world=a.getWorldQuaternion(new THREE.Quaternion());world.premultiply(delta);
  const parent=a.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  a.quaternion.slerp(parent.multiply(world),0.32);vrm.scene.updateMatrixWorld(true);
 };
 aim(upper,lower,direction(shoulder,elbow));aim(lower,hand||lower,direction(elbow,wrist));
}
function drawFaceLandmarks(){
 const canvas=$('landmarkCanvas'),toggle=$('showLandmarks'),video=$('cameraVideo');
 if(!canvas||!toggle||!video)return;
 canvas.style.display=toggle.checked&&cameraActive?'block':'none';
 if(!toggle.checked||!cameraActive||!landmarkCtx||video.readyState<2)return;
 const ctx=landmarkCtx,w=canvas.width,h=canvas.height;
 ctx.clearRect(0,0,w,h);
 ctx.save();ctx.translate(w,0);ctx.scale(-1,1);ctx.drawImage(video,0,0,w,h);
 if(trackedFaceLandmarks){
  ctx.fillStyle='#39ff88';ctx.strokeStyle='rgba(57,255,136,.45)';ctx.lineWidth=1;
  for(let i=0;i<trackedFaceLandmarks.length;i++){
   const p=trackedFaceLandmarks[i],x=p.x*w,y=p.y*h;
   ctx.beginPath();ctx.arc(x,y,i===1||i===10||i===152||i===234||i===454?3:1.1,0,Math.PI*2);ctx.fill();
  }
  const labels=[[1,'nose'],[10,'forehead'],[152,'chin'],[33,'eye L'],[263,'eye R'],[61,'mouth L'],[291,'mouth R']];
  ctx.font='12px sans-serif';ctx.fillStyle='#ffe66d';
  for(const [i,label] of labels){const p=trackedFaceLandmarks[i];if(p)ctx.fillText(label,p.x*w+5,p.y*h-6);}
 }else{
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#fff';ctx.font='16px sans-serif';ctx.fillText('Wajah belum terdeteksi',14,26);
 }
 ctx.restore();
}
function applyCameraTracking(t){
 if(!cameraActive||!poseLandmarker)return;
 const video=$('cameraVideo');
 if(video.readyState<2)return;
 const now=performance.now();
 if(now-lastPoseDetect>33){
  lastPoseDetect=now;
  try{const result=poseLandmarker.detectForVideo(video,now);trackedPose=result.faceBlendshapes?.[0]?.categories||null;trackedFaceLandmarks=result.faceLandmarks?.[0]||null;trackedFaceMatrix=result.facialTransformationMatrixes?.[0]?.data||null}catch(err){console.warn('Face tracking frame failed',err)}
 }
 drawFaceLandmarks();
 if(!trackedPose)return;
 // Prefer MediaPipe's facial transformation matrix for head pose; fall back to landmarks.
 const head=baseBones.find(x=>x.n==='head')?.b,neck=baseBones.find(x=>x.n==='neck')?.b;
 if(head){
  let target=null;
  if(trackedFaceMatrix?.length>=16){
   const m=new THREE.Matrix4().fromArray(trackedFaceMatrix);
   const rot=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m));
   const euler=new THREE.Euler().setFromQuaternion(rot,'YXZ');
   target={x:THREE.MathUtils.clamp(-euler.x,-.55,.55),y:THREE.MathUtils.clamp(euler.y,-.75,.75),z:THREE.MathUtils.clamp(-euler.z,-.5,.5)};
  } else if(trackedFaceLandmarks){
   const p=trackedFaceLandmarks,nose=p[1],left=p[234],right=p[454],forehead=p[10],chin=p[152];
   if(nose&&left&&right&&forehead&&chin){
    const cx=(left.x+right.x)/2,cy=(left.y+right.y)/2,width=Math.max(.001,right.x-left.x),height=Math.max(.001,chin.y-forehead.y);
    target={x:THREE.MathUtils.clamp(-((nose.y-cy)/height-.12)*2,-.45,.45),y:THREE.MathUtils.clamp(-(nose.x-cx)/width*1.5,-.65,.65),z:THREE.MathUtils.clamp(-Math.atan2(right.y-left.y,right.x-left.x),-.5,.5)};
   }
  }
  if(target){
   headTracking.x=THREE.MathUtils.lerp(headTracking.x,target.x,.22);headTracking.y=THREE.MathUtils.lerp(headTracking.y,target.y,.22);headTracking.z=THREE.MathUtils.lerp(headTracking.z,target.z,.22);
   head.rotation.x+=headTracking.x;head.rotation.y+=headTracking.y;head.rotation.z+=headTracking.z;
   if(neck){neck.rotation.x+=headTracking.x*.22;neck.rotation.y+=headTracking.y*.18;neck.rotation.z+=headTracking.z*.15;}
  }
 }
 const scores=Object.fromEntries(trackedPose.map(x=>[x.categoryName,x.score]));
 const expr=vrm?.expressionManager;if(!expr)return;
 const names=(expr.expressions||[]).map(x=>x.expressionName||x.name).filter(Boolean);
 const get=(...keys)=>Math.max(0,...keys.map(k=>scores[k]||0));
 const apply=(name,value)=>{const key=names.find(n=>n.toLowerCase()===name);if(key)expr.setValue(key,THREE.MathUtils.clamp(value,0,1))};
 // Clear tracked expressions each frame so a previous blink/look direction cannot stick.
 for(const n of ['joy','angry','sorrow','surprised','blink','blink_l','blink_r','lookup','lookdown','lookleft','lookright','aa','ih','ou','ee','oh'])apply(n,0);
 apply('joy',get('mouthSmileLeft','mouthSmileRight'));
 apply('angry',get('browDownLeft','browDownRight'));
 apply('sorrow',get('mouthFrownLeft','mouthFrownRight'));
 apply('surprised',Math.max(get('jawOpen')*.9,get('eyeWideLeft','eyeWideRight')*.65));
 const leftBlink=THREE.MathUtils.clamp((get('eyeBlinkLeft')-.18)/.55,0,1);
 const rightBlink=THREE.MathUtils.clamp((get('eyeBlinkRight')-.18)/.55,0,1);
 const hasLeft=names.some(n=>n.toLowerCase()==='blink_l'),hasRight=names.some(n=>n.toLowerCase()==='blink_r');
 if(hasLeft)apply('blink_l',leftBlink);if(hasRight)apply('blink_r',rightBlink);
 if(!hasLeft&&!hasRight)apply('blink',Math.max(leftBlink,rightBlink));
 apply('lookUp',get('eyeLookUpLeft','eyeLookUpRight'));apply('lookDown',get('eyeLookDownLeft','eyeLookDownRight'));
 apply('lookLeft',get('eyeLookOutLeft','eyeLookInRight'));apply('lookRight',get('eyeLookInLeft','eyeLookOutRight'));
 const jaw=get('jawOpen'),round=get('mouthPucker','mouthFunnel'),smile=get('mouthSmileLeft','mouthSmileRight');
 apply('aa',jaw*(1-round));apply('oh',jaw*round);apply('ou',round);apply('ih',smile*.45*(1-jaw));apply('ee',smile*.7*(1-jaw));
 $('motionLabel').textContent='Face Tracking';
}
function buildExpressions(){const root=$('expressions');root.innerHTML='';const ex=vrm.expressionManager?.expressions||[];const names=[...new Set(ex.map(e=>e.expressionName||e.name).filter(Boolean))];if(!names.length){root.textContent='No expressions found';return}for(const n of names){const b=document.createElement('button');b.textContent=({joy:'Joy',fun:'Fun',sorrow:'Sorrow',angry:'Angry',surprised:'Surprised',blink:'Blink',blink_l:'Blink L',blink_r:'Blink R',aa:'A',ih:'I',ou:'U',ee:'E',oh:'O',neutral:'Neutral'})[n.toLowerCase()]||n;b.title=n;b.onclick=()=>{for(const k of names)vrm.expressionManager.setValue(k,k===n?1:0);root.querySelectorAll('button').forEach(x=>x.classList.toggle('selected',x===b))};root.append(b)}}
function setMotion(m){motion=m;motionStart=clock.elapsedTime;document.querySelectorAll('[data-motion]').forEach(b=>b.classList.toggle('selected',b.dataset.motion===m));$('motionLabel').textContent=m[0].toUpperCase()+m.slice(1)}
function applyMotion(t){if(!vrm)return;for(const x of baseBones){x.b.rotation.copy(x.rot);x.b.position.copy(x.pos)}if(cameraActive){applyCameraTracking(t);return}const get=n=>baseBones.find(x=>x.n===n)?.b,head=get('head'),neck=get('neck'),chest=get('chest')||get('spine'),spine=get('spine'),hips=get('hips'),arm=get('rightUpperArm'),forearm=get('rightLowerArm'),u=t-motionStart;if(motion==='idle'&&idle){const breath=Math.sin(t*1.25),sway=Math.sin(t*.55);if(head){head.rotation.x+=Math.sin(t*.8)*.012;head.rotation.z+=sway*.012}if(neck)neck.rotation.z-=sway*.006;if(chest)chest.rotation.x+=breath*.008;if(spine)spine.rotation.x+=breath*.004;if(hips)hips.position.y+=Math.sin(t*1.25)*.003;for(const [name,sign] of [['leftShoulder',1],['rightShoulder',-1]]){const b=get(name);if(b)b.rotation.z+=sway*.006*sign}}else if(motion==='nod'){if(head)head.rotation.x+=Math.sin(u*9)*.22*Math.max(0,1-u/1.5);if(u>1.5)setMotion('idle')}else if(motion==='bow'){const e=u<.6?u/.6:u<1.4?1:Math.max(0,(2-u)/.6);if(chest)chest.rotation.x-=.48*e;if(head)head.rotation.x-=.2*e;if(u>2)setMotion('idle')}}
function bind(){$('vrmFile').onchange=e=>{const f=e.target.files[0];if(f){const u=URL.createObjectURL(f);loadVRM(u,f.name).finally(()=>URL.revokeObjectURL(u))}e.target.value=''};$('reset').onclick=fitCamera;$('clearExpression').onclick=()=>{for(const e of vrm?.expressionManager?.expressions||[])vrm.expressionManager.setValue(e.expressionName||e.name,0);$('expressions').querySelectorAll('button').forEach(b=>b.classList.remove('selected'))};$('idle').onchange=e=>idle=e.target.checked;$('cameraStart').onclick=startCameraTracking;$('cameraStop').onclick=stopCameraTracking;$('showLandmarks').onchange=e=>{const canvas=$('landmarkCanvas');if(canvas)canvas.style.display=e.target.checked&&cameraActive?'block':'none'};document.querySelectorAll('[data-motion]').forEach(b=>b.onclick=()=>setMotion(b.dataset.motion))}
function render(){const d=Math.min(clock.getDelta(),.05),t=clock.elapsedTime;applyMotion(t);vrm?.update(d);controls.update();renderer.render(scene,camera)}
init();loadVRM('./assets/White_Haired_Girl.vrm');
