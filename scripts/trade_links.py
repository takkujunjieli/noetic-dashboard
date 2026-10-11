"""Append-only execution-to-workflow association events; broker facts stay immutable."""
import math
import uuid
from pathlib import Path
from trade_journal import _atomic_write, _utc_now
import json

ROLES = ('entry', 'add', 'reduce', 'exit', 'hedge', 'roll', 'adjust')


def load_links(path: Path):
    if not path.exists():
        return {'schema': 'trade-links', 'version': 1, 'revision': 0, 'events': [], 'links': []}
    value = json.loads(path.read_text())
    if value.get('schema') != 'trade-links' or value.get('version') != 1 or not isinstance(value.get('events'), list):
        raise ValueError('交易关联文件格式无效')
    return value


def mutate_links(path, body, journal):
    document = load_links(path)
    operation_id = body.get('operation_id')
    if not isinstance(operation_id, str) or not 1 <= len(operation_id) <= 128:
        raise ValueError('缺少 operation_id')
    previous = next((e for e in document['events'] if e['operation_id'] == operation_id), None)
    if previous:
        return document
    action = body.get('action')
    if action not in ('link', 'update', 'unlink'):
        raise ValueError('关联操作无效')
    existing = next((x for x in document['links'] if x['link_id'] == body.get('link_id')), None)
    if action != 'link' and (not existing or existing['status'] != 'active'):
        raise ValueError('关联不存在或已解除')
    if action == 'unlink':
        link = {**existing, 'status': 'unlinked'}
    else:
        case = body.get('workflow_case')
        if not isinstance(case, dict) or not isinstance(case.get('id'), str) or not case['id'] or not isinstance(case.get('title'), str) or not isinstance(case.get('revision'), int) or case['revision'] < 1 or case.get('archived') is not False:
            raise ValueError('请选择有效且未归档的 Workflow')
        if existing and existing['workflow_case_id'] != case['id']:
            raise ValueError('请先解除旧关联，再关联其他 Workflow')
        role = body.get('role')
        if role not in ROLES:
            raise ValueError('交易角色无效')
        fills = {f['fill_id']: f for f in journal['fills']}
        allocations = body.get('allocations')
        if not isinstance(allocations, list) or not allocations:
            raise ValueError('至少分配一条成交')
        seen = set()
        trade_id = body.get('trade_id')
        if existing and existing['trade_id'] != trade_id:
            raise ValueError('关联的交易身份不可更改')
        for item in allocations:
            fid, quantity = item.get('fill_id'), item.get('quantity')
            fill = fills.get(fid)
            if not fill or fill['trade_id'] != trade_id or fid in seen:
                raise ValueError('成交不属于该交易或重复分配')
            seen.add(fid)
            if isinstance(quantity, bool) or not isinstance(quantity, (int, float)) or not math.isfinite(quantity) or quantity <= 0:
                raise ValueError('分配数量必须大于 0')
            if fill['kind'] == 'option' and quantity != int(quantity):
                raise ValueError('期权分配张数必须为整数')
            used = sum(a['quantity'] for link in document['links'] if link['status'] == 'active' and (not existing or link['link_id'] != existing['link_id']) for a in link['allocations'] if a['fill_id'] == fid)
            if used + quantity > fill['qty'] + 1e-9:
                raise ValueError('分配数量超过该成交剩余可分配数量')
            if role != 'hedge' and fill['underlying'] not in case.get('underlyings', []):
                raise ValueError('成交标的不属于该 Workflow 的 In Action Allocation')
        link = {'link_id': existing['link_id'] if existing else 'link:v1:' + uuid.uuid4().hex,
                'trade_id': trade_id, 'fill_ids': [a['fill_id'] for a in allocations],
                'workflow_case_id': case['id'], 'workflow_title': case['title'], 'node': 'positions',
                'role': role, 'allocations': allocations, 'status': 'active',
                'journal_revision': journal['revision'], 'workflow_revision': case['revision'],
                'created_at': existing['created_at'] if existing else _utc_now()}
    link['updated_at'] = _utc_now()
    revision = document['revision'] + 1
    event = {'event_id': 'link-event:v1:' + uuid.uuid4().hex, 'operation_id': operation_id,
             'revision': revision, 'action': action, 'at': link['updated_at'], 'link': link}
    document['links'] = [x for x in document['links'] if x['link_id'] != link['link_id']] + [link]
    document['events'].append(event)
    document['revision'] = revision
    _atomic_write(path, document)
    return document
