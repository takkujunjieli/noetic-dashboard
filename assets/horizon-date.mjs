// Calendar dates use New York days; UTC arithmetic avoids DST-length days.
const DAY=86400000;
export function validDeadline(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function parseDeadline(value){
 if(value==='')return '';
 if(validDeadline(value))return value;
 const match=String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
 const iso=match?`${match[3]}-${match[1]}-${match[2]}`:'';
 return validDeadline(iso)?iso:null;
}
export function displayDeadline(value){return validDeadline(value)?`${value.slice(5,7)}/${value.slice(8,10)}/${value.slice(0,4)}`:'';}
export function easternDay(at=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at)),read=type=>parts.find(p=>p.type===type)?.value;
 return `${read('year')}-${read('month')}-${read('day')}`;
}
export function daysToDeadline(deadline,from=easternDay()){return validDeadline(deadline)&&validDeadline(from)?Math.max(0,Math.round((Date.parse(deadline)-Date.parse(from))/DAY)):'';}
