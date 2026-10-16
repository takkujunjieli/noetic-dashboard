// Frozen references in Workflow snapshots. Importing more fills never expands them.
// `role` is retained only for pre-v3 historical links. New links are pure
// execution facts: their active thesis is determined from the underlying.
export const TRADE_ROLES = {entry:'建仓',add:'加仓',reduce:'减仓',exit:'退出',hedge:'对冲',roll:'展期',adjust:'调整'};
export function validateExecutionLinks(data) {
  if (data == null) return;
  if (!Array.isArray(data) || data.some(x => !x || typeof x.link_id !== 'string' || typeof x.trade_id !== 'string' || (x.role != null && !TRADE_ROLES[x.role]) || !['active','unlinked'].includes(x.status) || !Array.isArray(x.allocations) || !x.allocations.length || x.allocations.some(a => typeof a.fill_id !== 'string' || !Number.isFinite(a.quantity) || a.quantity <= 0) || typeof x.event_id !== 'string' || !Number.isInteger(x.link_revision))) throw Error('成交关联快照格式无效');
}
export function applyExecutionEvent(c, event) {
  if (event.link.workflow_case_id !== c.id) return false;
  const links = c.nodes.positions.data.executionLinks || [];
  const previous = links.find(x => x.link_id === event.link.link_id);
  if (previous && previous.link_revision >= event.revision) return false;
  c.positionNodeVersion = 2;
  c.nodes.positions.data.executionLinks = [...links.filter(x => x.link_id !== event.link.link_id), {...structuredClone(event.link), event_id:event.event_id,link_revision:event.revision}];
  return true;
}
