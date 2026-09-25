// Explicit workflow relationships, independent of scene coordinates and storage.
export const STAR_KEYS=['hypothesis','signal','returns','construction','risk','positions','attribution'];
export const STELLAR_COLORS=['#fff8ee','#fff1cc','#ffe0a0','#ffc18d','#ee987d','#e8efff'];
function randomFor(id){let seed=2166136261;for(const char of id)seed=Math.imul(seed^char.charCodeAt(0),16777619);return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
export function starCluster(id){const rnd=randomFor(id),points=[];for(let i=0;i<420;i++){const az=rnd()*Math.PI*2,cos=rnd()*2-1,r=260*Math.pow(rnd(),.65),sin=Math.sqrt(1-cos*cos);points.push({x:r*sin*Math.cos(az),y:r*cos*.86,z:r*sin*Math.sin(az)*.85,color:STELLAR_COLORS[Math.floor(rnd()*STELLAR_COLORS.length)],size:1+rnd()*2});}
 const selected=[];for(const point of points){if(selected.every(p=>Math.hypot(p.x-point.x,p.y-point.y,p.z-point.z)>105)){selected.push(point);if(selected.length===7)break;}}
 return {points,selected};}
export const RELATIONS=[['hypothesis','signal','research'],['signal','construction','research'],['construction','returns','design'],['returns','risk','design'],['risk','construction','design'],['construction','positions','lifecycle'],['returns','positions','lifecycle'],['risk','positions','lifecycle'],['positions','attribution','attribution']];
export const starId=(caseId,key)=>`${caseId}:${key}`;
export function galaxyData(cases,aspect=1.6){const nodes=[],links=[],nebulae=[];
 const centers=cases.map((_,i)=>{const angle=i*2.399963229728653,radius=i?900*Math.sqrt(i):0;return {x:Math.cos(angle)*radius,y:Math.sin(angle)*radius,z:Math.sin(i*1.7)*220};});
 if(centers.length>1){const xs=centers.map(c=>c.x),ys=centers.map(c=>c.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),width=maxX-minX,height=maxY-minY,ratio=Math.max(.35,Math.min(3,aspect)),targetW=Math.max(width+620,(height+620)*ratio),targetH=targetW/ratio;
  for(const c of centers){c.x=(c.x-(minX+maxX)/2)*(width?(targetW-620)/width:1);c.y=(c.y-(minY+maxY)/2)*(height?(targetH-620)/height:1);}
 }

 cases.forEach((c,i)=>{const center=centers[i],cluster=starCluster(c.id);nebulae.push({id:c.id,title:c.title,center,cluster,archived:c.archived,demo:c.demo,unsynced:!!c.unsynced});
 STAR_KEYS.forEach((key,j)=>{const p=cluster.selected[j];nodes.push({id:starId(c.id,key),caseId:c.id,key,color:p.color,state:c.nodes[key].state,fx:center.x+p.x,fy:center.y+p.y,fz:center.z+p.z,x:center.x+p.x,y:center.y+p.y,z:center.z+p.z});});
 for(const [a,b,kind]of RELATIONS)links.push({source:starId(c.id,a),target:starId(c.id,b),kind,caseId:c.id});
 });return {nodes,links,nebulae};}
export function neighborhood(id,links){const ids=new Set(id?[id]:[]);for(const l of links){const a=typeof l.source==='object'?l.source.id:l.source,b=typeof l.target==='object'?l.target.id:l.target;if(a===id)ids.add(b);if(b===id)ids.add(a);}return ids;}
export function connected(link,id){return (link.source.id||link.source)===id||(link.target.id||link.target)===id;}
