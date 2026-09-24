import * as THREE from './vendor/three.module.js';
import {galaxyData,neighborhood,connected,starId} from './galaxy-model.mjs';
const names={hypothesis:'Hypothesis',signal:'Signal',returns:'Expected Return',construction:'Portfolio Construction',risk:'Risk Budget',positions:'Position Management',attribution:'Attribution'};
const colors={hypothesis:'#b6a5ff',signal:'#b6a5ff',returns:'#87d9c2',construction:'#87d9c2',risk:'#87d9c2',positions:'#8abafa',attribution:'#edabc8'};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createGalaxy(host,{onStar,onNebula,onBackground}){
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const canvasHost=document.createElement('div'),overlay=document.createElement('div');canvasHost.className='galaxy-canvas';overlay.className='galaxy-labels';host.append(canvasHost,overlay);
 let graph,selected='',focused='',signature='',data={nodes:[],links:[],nebulae:[]},neighbors=new Set(),clouds=[],labels=[],disposed=false,frame;
 function fallback(message){canvasHost.hidden=true;overlay.classList.add('galaxy-fallback');overlay.innerHTML=`<p class="hint">${esc(message)} · 使用节点导航。</p>`+data.nebulae.map(c=>`<section><h3>${esc(c.title)}</h3>${data.nodes.filter(n=>n.caseId===c.id).map(n=>`<button data-star="${esc(n.id)}">${names[n.key]} · ${n.state}</button>`).join('')}</section>`).join('');}
 function glowTexture(){const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d'),g=ctx.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.08,'rgba(255,255,255,.9)');g.addColorStop(.25,'rgba(255,255,255,.24)');g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);return new THREE.CanvasTexture(c);}
 const texture=glowTexture();
 function star(n){const group=new THREE.Group();const mat=new THREE.SpriteMaterial({map:texture,color:colors[n.key],transparent:true,depthWrite:false});const halo=new THREE.Sprite(mat);halo.scale.set(34,34,1);group.add(halo);const core=new THREE.Mesh(new THREE.SphereGeometry(n.state==='running'?3.3:2.7,12,8),new THREE.MeshBasicMaterial({color:n.state==='running'?'#edfff9':colors[n.key]}));group.add(core);const ring=new THREE.Mesh(new THREE.RingGeometry(7.2,7.8,40),new THREE.MeshBasicMaterial({color:colors[n.key],transparent:true,opacity:.4,side:THREE.DoubleSide}));group.add(ring);group.userData={halo,core,ring};return group;}
 try{
  graph=new window.ForceGraph3D(canvasHost,{controlType:'orbit',rendererConfig:{alpha:true,antialias:true}})
   .backgroundColor('#00000000').showNavInfo(false).nodeLabel(()=> '').enableNodeDrag(false).cooldownTicks(0)
   .nodeThreeObject(star).linkOpacity(.55).linkColor(l=>selected?(connected(l,selected)?'#c2f8e5':'#344254'):'#637d90')
   .linkWidth(l=>selected&&connected(l,selected)?1.6:.55)
   .linkDirectionalArrowLength(l=>l.kind==='design'?0:3).linkDirectionalArrowRelPos(.65)
   .onNodeClick(n=>onStar(n.caseId,n.key)).onBackgroundClick(()=>onBackground());
  graph.renderer().setPixelRatio(Math.min(devicePixelRatio,1.7));
  const controls=graph.controls();controls.enableRotate=false;controls.screenSpacePanning=true;controls.enableDamping=!reduced;controls.minDistance=180;controls.maxDistance=10000;controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
  const geometry=new THREE.BufferGeometry(),pts=[];let seed=71;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};for(let i=0;i<1700;i++)pts.push((rnd()-.5)*11000,(rnd()-.5)*9000,-500-rnd()*3500);
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));const stars=new THREE.Points(geometry,new THREE.PointsMaterial({color:'#b5c7e8',size:2.4,transparent:true,opacity:.65,sizeAttenuation:true}));graph.scene().add(stars);
 }catch(e){graph=null;fallback('3D 场景不可用');}
 function refreshHighlight(){if(!graph)return;graph.linkColor(graph.linkColor()).linkWidth(graph.linkWidth());for(const n of data.nodes){const obj=n.__threeObj;if(!obj?.userData?.halo)continue;const active=n.id===selected,near=neighbors.has(n.id),opacity=!selected||near?1:.23;obj.userData.halo.material.opacity=opacity;obj.userData.core.material.transparent=true;obj.userData.core.material.opacity=opacity;obj.userData.ring.material.opacity=active?1:n.state==='running'?.65:.2;obj.userData.ring.scale.setScalar(active?1.6:1);obj.userData.halo.scale.setScalar(active?46:34);}}
 function layoutLabels(){if(disposed||!graph)return;const camera=graph.camera(),rect=host.getBoundingClientRect();const distance=camera.position.distanceTo(graph.controls().target),detail=distance<1400;for(const item of labels){const v=new THREE.Vector3(...item.point).project(camera),el=item.el;const inView=v.z>-1&&v.z<1&&Math.abs(v.x)<1.12&&Math.abs(v.y)<1.12;el.hidden=!inView;el.style.left=`${(v.x+1)*rect.width/2}px`;el.style.top=`${(-v.y+1)*rect.height/2}px`;if(item.node){const active=item.node.id===selected,near=neighbors.has(item.node.id);el.classList.toggle('is-selected',active);el.classList.toggle('is-neighbor',!!selected&&near&&!active);el.classList.toggle('is-dim',!!selected&&!near);el.classList.toggle('is-distant',!detail&&!near);el.setAttribute('aria-pressed',String(active));}}
 frame=requestAnimationFrame(layoutLabels);}
 if(graph)frame=requestAnimationFrame(layoutLabels);
 overlay.addEventListener('click',e=>{const s=e.target.closest('[data-star]');if(s){const n=data.nodes.find(n=>n.id===s.dataset.star);if(n)onStar(n.caseId,n.key);return;}const b=e.target.closest('[data-nebula]');if(b)onNebula(b.dataset.nebula);});
 const resize=new ResizeObserver(()=>{if(graph){graph.width(host.clientWidth).height(host.clientHeight);}});resize.observe(host);
 function overview(){focused='';if(!graph)return;const radius=Math.max(300,...data.nebulae.map(n=>Math.hypot(n.center.x,n.center.y)+300)),aspect=host.clientWidth/host.clientHeight;graph.cameraPosition({x:0,y:0,z:Math.min(9500,Math.max(950,radius*2.6/Math.min(aspect,1.5)))},{x:0,y:0,z:0},reduced?0:850);}
 function focus(caseId,key){focused=caseId;const c=data.nebulae.find(c=>c.id===caseId);if(!graph||!c)return;const n=key?data.nodes.find(n=>n.id===starId(caseId,key)):null;const x=n?.x??c.center.x,y=n?.y??c.center.y-40;graph.cameraPosition({x,y,z:key?540:850},{x,y,z:0},reduced?0:700);}
 return {
 update(cases,selection){const newData=galaxyData(cases),sig=JSON.stringify(cases.map(c=>[c.id,c.title,c.archived,...Object.values(c.nodes).map(n=>n.state)]));selected=selection?.caseId?starId(selection.caseId,selection.key):'';
  if(sig!==signature){signature=sig;data=newData;if(!graph){fallback('3D 场景不可用');return;}
   clouds.forEach(o=>{graph.scene().remove(o);o.material.dispose();});clouds=[];graph.graphData({nodes:data.nodes,links:data.links});
   for(const c of data.nebulae){for(let j=0;j<3;j++){const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,color:j===1?'#256c80':'#62419b',transparent:true,opacity:.13,depthWrite:false}));sprite.position.set(c.center.x+(j-1)*100,c.center.y-35+(j===1?40:0),-80-j);sprite.scale.set(580,500,1);graph.scene().add(sprite);clouds.push(sprite);}}
   overlay.innerHTML=data.nebulae.map(c=>`<button class="nebula-label" data-nebula="${esc(c.id)}"><span>NEBULA ${c.archived?' / ARCHIVED':c.demo?' / DEMO':''}</span><strong>${esc(c.title)}</strong></button>`).join('')+data.nodes.map(n=>`<button class="star-label" data-star="${esc(n.id)}" data-node="${n.key}" aria-label="${esc(cases.find(c=>c.id===n.caseId).title)} · ${names[n.key]} · ${n.state}"><i style="--star:${colors[n.key]}"></i><span>${names[n.key]}<small>${n.state}</small></span></button>`).join('');
   labels=[...data.nebulae.map(c=>({el:[...overlay.querySelectorAll('[data-nebula]')].find(el=>el.dataset.nebula===c.id),point:[c.center.x,c.center.y+210,0]})),...data.nodes.map(n=>({el:[...overlay.querySelectorAll('[data-star]')].find(el=>el.dataset.star===n.id),point:[n.x,n.y,n.z],node:n}))];
  }
  neighbors=neighborhood(selected,data.links);refreshHighlight();
 },focus,overview,
 zoom(factor){if(!graph)return;const cam=graph.camera(),target=graph.controls().target,p=cam.position.clone().sub(target).multiplyScalar(factor).add(target);graph.cameraPosition(p,target,reduced?0:220);},
 destroy(){disposed=true;cancelAnimationFrame(frame);resize.disconnect();graph?._destructor();texture.dispose();},
 };
}
