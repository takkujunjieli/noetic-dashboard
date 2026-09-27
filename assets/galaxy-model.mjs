// Explicit workflow relationships, independent of scene coordinates and storage.
export const STAR_KEYS=['hypothesis','signal','returns','construction','risk','positions','attribution'];
export const STELLAR_COLORS=['#fff8ee','#fff1cc','#ffe0a0','#ffc18d','#ee987d','#e8efff'];
function randomFor(id){let seed=2166136261;for(const char of id)seed=Math.imul(seed^char.charCodeAt(0),16777619);return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
export function starCluster(id){const rnd=randomFor(id),points=[];for(let i=0;i<420;i++){const az=rnd()*Math.PI*2,cos=rnd()*2-1,r=260*Math.pow(rnd(),.65),sin=Math.sqrt(1-cos*cos);points.push({x:r*sin*Math.cos(az),y:r*cos*.86,z:r*sin*Math.sin(az)*.85,color:STELLAR_COLORS[Math.floor(rnd()*STELLAR_COLORS.length)],size:1+rnd()*2});}
 const selected=[];for(const point of points){if(selected.every(p=>Math.hypot(p.x-point.x,p.y-point.y,p.z-point.z)>105)){selected.push(point);if(selected.length===7)break;}}
 return {points,selected};}
export const RELATIONS=[['hypothesis','signal','research'],['signal','construction','research'],['construction','returns','design'],['returns','risk','design'],['risk','construction','design'],['construction','positions','lifecycle'],['returns','positions','lifecycle'],['risk','positions','lifecycle'],['positions','attribution','attribution']];
export const starId=(caseId,key)=>`${caseId}:${key}`;
function halton(index,base){let result=0,fraction=1/base;while(index>0){result+=fraction*(index%base);index=Math.floor(index/base);fraction/=base;}return result;}
export function nebulaCenters(count,aspect=1.6){const widthScale=Math.max(.82,Math.min(1.38,Math.sqrt(Math.max(.35,Math.min(3,aspect))/1.35))),centers=[];
 for(let i=0;i<count;i++){if(i===0){centers.push({x:0,y:0,z:0});continue;}const theta=2*Math.PI*halton(i,2),cos=2*halton(i,3)-1,sin=Math.sqrt(1-cos*cos),radius=920*Math.cbrt(i)*(.9+.22*halton(i,5));centers.push({x:Math.cos(theta)*sin*radius*widthScale,y:Math.sin(theta)*sin*radius/widthScale,z:cos*radius});}
 return centers;
}
export function deepSpaceField(seed='galaxy-background',shellCount=2400,bandCount=1700){const rnd=randomFor(seed),palette=['#9fb8e9','#d5e2ff','#fff7df','#f2c9a5'],shell=[],band=[],gaussian=()=>Math.sqrt(-2*Math.log(Math.max(rnd(),1e-9)))*Math.cos(2*Math.PI*rnd());
 const point=(direction,radius)=>{const color=palette[Math.floor(rnd()*palette.length)];return {x:direction[0]*radius,y:direction[1]*radius,z:direction[2]*radius,color};};
 for(let i=0;i<shellCount;i++){const az=rnd()*Math.PI*2,cos=rnd()*2-1,sin=Math.sqrt(1-cos*cos),radius=6500+14500*Math.pow(rnd(),.42);shell.push(point([sin*Math.cos(az),sin*Math.sin(az),cos],radius));}
 const patches=[.18,1.4,2.75,4.15,5.45],tilt=.42;
 for(let i=0;i<bandCount;i++){const longitude=rnd()<.58?patches[Math.floor(rnd()*patches.length)]+gaussian()*.28:rnd()*Math.PI*2,latitude=Math.max(-.3,Math.min(.3,gaussian()*.075)),cl=Math.cos(latitude),local=[Math.cos(longitude)*cl,Math.sin(latitude),Math.sin(longitude)*cl],x=local[0]*Math.cos(tilt)-local[1]*Math.sin(tilt),y=local[0]*Math.sin(tilt)+local[1]*Math.cos(tilt),radius=5200+12500*Math.pow(rnd(),.55);band.push(point([x,y,local[2]],radius));}
 return {shell,band};
}
export function galaxyData(cases,aspect=1.6){const nodes=[],links=[],nebulae=[];
 const centers=nebulaCenters(cases.length,aspect);

 cases.forEach((c,i)=>{const center=centers[i],cluster=starCluster(c.id);nebulae.push({id:c.id,title:c.title,center,cluster,archived:c.archived,demo:c.demo,unsynced:!!c.unsynced});
 STAR_KEYS.forEach((key,j)=>{const p=cluster.selected[j];nodes.push({id:starId(c.id,key),caseId:c.id,key,color:p.color,state:c.nodes[key].state,fx:center.x+p.x,fy:center.y+p.y,fz:center.z+p.z,x:center.x+p.x,y:center.y+p.y,z:center.z+p.z});});
 for(const [a,b,kind]of RELATIONS)links.push({source:starId(c.id,a),target:starId(c.id,b),kind,caseId:c.id});
 });return {nodes,links,nebulae};}
export function neighborhood(id,links){const ids=new Set(id?[id]:[]);for(const l of links){const a=typeof l.source==='object'?l.source.id:l.source,b=typeof l.target==='object'?l.target.id:l.target;if(a===id)ids.add(b);if(b===id)ids.add(a);}return ids;}
export function connected(link,id){return (link.source.id||link.source)===id||(link.target.id||link.target)===id;}
