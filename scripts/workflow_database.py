"""Private current Workflow and immutable, explicitly generated versions."""
import json
import sqlite3
from contextlib import closing
from pathlib import Path

KEY = 'research-desk.workflow.v1'

class WorkflowConflict(ValueError):
    pass

def validate(store):
    if not isinstance(store, dict) or store.get('version') != 1 or not isinstance(store.get('cases'), list) or len(store['cases']) > 500:
        raise ValueError('Workflow 格式无效')
    ids = set()
    for case in store['cases']:
        if not isinstance(case, dict) or not isinstance(case.get('id'), str) or not case['id'] or case['id'] in ids or not isinstance(case.get('nodes'), dict) or not isinstance(case.get('events', []), list):
            raise ValueError('Workflow 实例格式无效或 ID 重复')
        ids.add(case['id'])
    # Reject non-finite values before a transaction can commit.
    json.dumps(store, allow_nan=False)

def connect(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=15)
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('CREATE TABLE IF NOT EXISTS current_workflow (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS workflow_versions (case_id TEXT NOT NULL, event_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(case_id,event_id), UNIQUE(case_id,revision))')
    return db

def current_store(db):
    row = db.execute('SELECT revision,body FROM current_workflow WHERE id=1').fetchone()
    if not row:
        return None, None
    store = json.loads(row[1])
    for case in store['cases']:
        case['events'] = [json.loads(r[0]) for r in db.execute('SELECT body FROM workflow_versions WHERE case_id=? ORDER BY revision', (case['id'],))]
    return store, row[0]

def read(path):
    with closing(connect(path)) as db:
        store, revision = current_store(db)
        return {'store': store, 'revision': revision}

def legacy(path):
    path = Path(path)
    if not path.exists():
        return None
    value = json.loads(path.read_text())
    return value.get('entries', {}).get(KEY, value)

def save(path, store, expected_revision, event=None):
    validate(store)
    with closing(connect(path)) as db, db:
        db.execute('BEGIN IMMEDIATE')
        previous, revision = current_store(db)
        if revision != expected_revision:
            raise WorkflowConflict('Workflow 已被其他页面更新，请刷新后重试')
        initial = revision is None
        if event is not None:
            if not isinstance(event, dict) or set(event) != {'caseId', 'event'}:
                raise ValueError('版本请求格式无效')
            target = next((c for c in store['cases'] if c['id'] == event['caseId']), None)
            item = event['event']
            if not target or not isinstance(item, dict) or item.get('type') != '手动生成版本' or item.get('snapshot', {}).get('id') != target['id'] or item.get('revision') != target.get('revision'):
                raise ValueError('手动版本与当前实例不匹配')
            snapshot = {k: v for k, v in target.items() if k != 'events'}
            if item['snapshot'] != snapshot:
                raise ValueError('手动版本内容与当前状态不一致')
        if not initial:
            previous_cases = {case['id']: case for case in previous['cases']}
            for case in store['cases']:
                expected = previous_cases.get(case['id'], {}).get('revision', 0)
                if event is not None and event['caseId'] == case['id']:
                    expected += 1
                if case.get('revision') != expected:
                    raise ValueError('版本号只能通过手动生成版本更新')
        body = json.loads(json.dumps(store, allow_nan=False))
        for case in body['cases']:
            events = case.pop('events', [])
            case['historyMode'] = 'manual'
            if initial:
                for item in events:
                    if item.get('snapshot', {}).get('id') != case['id'] or not isinstance(item.get('revision'), int):
                        raise ValueError('旧版本快照格式无效')
                    db.execute('INSERT INTO workflow_versions VALUES (?,?,?,?)', (case['id'], item['id'], item['revision'], json.dumps(item, ensure_ascii=False, allow_nan=False)))
        if event is not None:
            item = event['event']
            db.execute('INSERT INTO workflow_versions VALUES (?,?,?,?)', (event['caseId'], item['id'], item['revision'], json.dumps(item, ensure_ascii=False, allow_nan=False)))
        next_revision = (revision or 0) + 1
        db.execute('INSERT INTO current_workflow VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body', (next_revision, json.dumps(body, ensure_ascii=False, allow_nan=False)))
        saved, _ = current_store(db)
        return {'store': saved, 'revision': next_revision}
