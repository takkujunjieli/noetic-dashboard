// Display names are independent of the immutable IDs used by fills, P&L and
// Workflow bindings. Apply the same name to current data and old snapshots.
export function accountDisplayName(id='',label=''){
 if(id==='rh-7159'||id==='hui-rh-7159'||label==='rh-7159')return 'hui-rh-7159';
 return label||id||'';
}
