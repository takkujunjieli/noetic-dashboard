// Explicit workflow relationships, independent of scene coordinates and storage.
export const STAR_LAYOUT={hypothesis:[-92,118,0],signal:[92,118,0],returns:[-132,0,0],construction:[0,35,8],risk:[132,0,0],positions:[0,-116,0],attribution:[0,-219,0]};
export const RELATIONS=[['hypothesis','signal','research'],['signal','construction','research'],['construction','returns','design'],['returns','risk','design'],['risk','construction','design'],['construction','positions','lifecycle'],['returns','positions','lifecycle'],['risk','positions','lifecycle'],['positions','attribution','attribution']];
export const starId=(caseId,key)=>`${caseId}:${key}`;
export function galaxyData(cases){const nodes=[],links=[],nebulae=[];
 cases.forEach((c,i)=>{const angle=i*2.399963229728653,radius=i?560*Math.sqrt(i):0,center={x:Math.cos(angle)*radius,y:Math.sin(angle)*radius,z:0};nebulae.push({id:c.id,title:c.title,center,archived:c.archived,demo:c.demo});
 for(const [key,p]of Object.entries(STAR_LAYOUT))nodes.push({id:starId(c.id,key),caseId:c.id,key,state:c.nodes[key].state,fx:center.x+p[0],fy:center.y+p[1],fz:p[2],x:center.x+p[0],y:center.y+p[1],z:p[2]});
 for(const [a,b,kind]of RELATIONS)links.push({source:starId(c.id,a),target:starId(c.id,b),kind,caseId:c.id});
 });return {nodes,links,nebulae};}
export function neighborhood(id,links){const ids=new Set(id?[id]:[]);for(const l of links){const a=typeof l.source==='object'?l.source.id:l.source,b=typeof l.target==='object'?l.target.id:l.target;if(a===id)ids.add(b);if(b===id)ids.add(a);}return ids;}
export function connected(link,id){return (link.source.id||link.source)===id||(link.target.id||link.target)===id;}
