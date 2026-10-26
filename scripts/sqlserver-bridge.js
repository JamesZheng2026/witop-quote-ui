'use strict';

// The Python child reads credentials locally. Never put them in arguments or HTTP responses.
const { execFile } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const CONVERSATION_REFS = Symbol('conversationRefs');
const MESSAGE_CURSOR = Symbol('messageCursor');
const PYTHON_SOURCE = String.raw`
import sys, os, json, time, hashlib, datetime, re
from pathlib import Path

EMAIL_RE = re.compile(r'(?i)([a-z0-9._%+\-]{1,64})@([a-z0-9.\-]+\.[a-z]{2,})')
PHONE_RE = re.compile(r'(?<![\w])(?:\+?\d[\d\s().\-]{6,}\d)(?![\w])')
AUTH_RE = re.compile(r'(?i)\b(authorization\s*:\s*(?:bearer|basic)|bearer)\s+[a-z0-9._~+/=\-]{6,}')
KEY_RE = re.compile(r'(?i)\b(?:sk-ant-[a-z0-9_\-]{8,}|gh[pousr]_[a-z0-9]{16,}|xox[baprs]-[a-z0-9\-]{10,})\b')
SECRET_RE = re.compile(r'(?i)\b(password|passwd|pwd|token|access[_ \-]?token|refresh[_ \-]?token|api[_ \-]?key|secret)\b(\s*[:=]\s*)([^\s,;]+)')

def output(value):
    print(json.dumps(value, ensure_ascii=False, default=str))

def redact_text(value):
    original = str(value or '')[:4000]
    text = ''.join(ch for ch in original if ch in '\n\t' or ord(ch) >= 32)
    text = AUTH_RE.sub(lambda m: m.group(1)+' [已脱敏]', text)
    text = KEY_RE.sub('[已脱敏密钥]', text)
    text = EMAIL_RE.sub(lambda m: (m.group(1)[:1] or '*')+'***@'+m.group(2), text)
    def mask_phone(match):
        digits = ''.join(ch for ch in match.group(0) if ch.isdigit())
        return '***'+digits[-4:] if len(digits) >= 4 else '***'
    text = PHONE_RE.sub(mask_phone, text)
    text = SECRET_RE.sub(lambda m: m.group(1)+m.group(2)+'[已脱敏]', text)
    return text, text != original

def mask_contact(value):
    compact = ''.join(ch for ch in str(value or '') if ch.isalnum())
    return '尾号 '+compact[-4:] if len(compact) >= 4 else '已脱敏参与者'

def stable_id(parts, prefix):
    key = json.dumps(parts, ensure_ascii=False, separators=(',',':'))
    return prefix+hashlib.sha256(key.encode()).hexdigest()[:24]

def main():
    import pymssql
    cfg = json.loads(Path(os.environ.get('SQLSERVER_CONFIG', str(Path.home()/'.hermes/scripts/sqlserver_config.json'))).read_text())
    started = time.monotonic()
    try:
        conn = pymssql.connect(server=cfg['server'], port=cfg.get('port',1433), user=cfg['user'],
            password=cfg['password'], database=cfg['database'], tds_version=cfg.get('tds_version','7.0'),
            charset='UTF-8', login_timeout=5, timeout=20, autocommit=True)
    except Exception:
        output({'ok':False,'error':'SQL_CONNECT_FAILED'}); return
    try:
        cur = conn.cursor(as_dict=True)
        cur.execute('SELECT DB_NAME() AS db, @@VERSION AS version')
        identity = cur.fetchone()
        cur.execute("SELECT TABLE_SCHEMA, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=%s ORDER BY TABLE_SCHEMA, ORDINAL_POSITION", ('wa_chat_message',))
        schema = cur.fetchall()
        schemas = sorted(set(row['TABLE_SCHEMA'] for row in schema))
        if len(schemas) != 1:
            output({'ok':False,'error':'SQL_SCHEMA_AMBIGUOUS'}); return
        columns = {row['COLUMN_NAME'].lower(): row['COLUMN_NAME'] for row in schema}
        def q(name): return '[' + name.replace(']',']]') + ']'
        mode = sys.argv[1]
        if mode == 'diagnostics':
            cur.execute('SELECT COUNT_BIG(*) AS total FROM '+q(schemas[0])+'.[wa_chat_message]')
            total = cur.fetchone()['total']
            output({'ok':True,'source':'sqlserver','handshake':{'database':identity['db'],
                'version':identity['version'].splitlines()[0], 'seconds':round(time.monotonic()-started,3),
                'driver':pymssql.__version__},'table':'wa_chat_message','messageCount':total,'schema':schema})
            return
        # Exact contract supplied by Hermes' real schema inspection (2026-10-16).
        required = {'session_id':'int', 'send_time':'nvarchar', 'create_at':'nvarchar',
                    'agent':'nvarchar', 'msg_content':'nvarchar', 'id':'int'}
        types = {row['COLUMN_NAME'].lower():row['DATA_TYPE'].lower() for row in schema}
        if any(types.get(name) != kind for name,kind in required.items()):
            raise ValueError('mapping')
        chat, stamp, created, owner, text, ident = (columns[name] for name in
            ['session_id','send_time','create_at','agent','msg_content','id'])
        # Identifiers come exclusively from INFORMATION_SCHEMA, never request parameters.
        owner_expr = 'COALESCE(CONVERT(nvarchar(max),'+q(owner)+"),N'')"
        chat_expr = 'CONVERT(nvarchar(max),'+q(chat)+')'
        text_expr = 'LEFT(CONVERT(nvarchar(max),'+q(text)+'),4000)'
        # These are nvarchar(50), not datetime. Keep their values and timezone untouched.
        # Empty send_time falls back to create_at; known fixed-width values sort lexically.
        time_expr = 'COALESCE(NULLIF('+q(stamp)+",N''),"+q(created)+')'
        history_time_expr = 'COALESCE('+time_expr+",N'')"
        order = time_expr+' DESC, '+q(ident)+' DESC'
        table = q(schemas[0])+'.[wa_chat_message]'
        limit = int(sys.argv[2])
        offset = int(sys.argv[3])
        request = json.loads(sys.stdin.read() or '{}')
        if mode == 'messages':
            message_required = {'sender_type':'tinyint','sender_phone':'nvarchar','msg_type':'tinyint'}
            if any(types.get(name) != kind for name,kind in message_required.items()):
                raise ValueError('mapping')
            conversation = request.get('conversation') or {}
            chat_key = str(conversation.get('chatKey',''))
            owner_name = str(conversation.get('ownerName',''))
            if not chat_key or len(chat_key) > 50 or len(owner_name) > 100:
                raise ValueError('mapping')
            sender_kind = q(columns['sender_type'])
            sender_contact = q(columns['sender_phone'])
            message_kind = q(columns['msg_type'])
            count_sql = 'SELECT COUNT_BIG(*) AS total FROM '+table+' WHERE '+chat_expr+'=%s AND '+owner_expr+'=%s'
            cur.execute(count_sql, (chat_key, owner_name))
            total = int(cur.fetchone()['total'])
            cursor = request.get('cursor')
            cursor_clause = ''
            params = [chat_key, owner_name]
            if cursor is not None:
                if not isinstance(cursor, dict): raise ValueError('mapping')
                cursor_time = str(cursor.get('sentAt',''))
                cursor_key = cursor.get('messageKey')
                if len(cursor_time) > 50 or not isinstance(cursor_key, int): raise ValueError('mapping')
                cursor_clause = ' AND ('+history_time_expr+'<%s OR ('+history_time_expr+'=%s AND '+q(ident)+'<%s))'
                params.extend([cursor_time, cursor_time, cursor_key])
            sql = '''WITH messages AS (SELECT {ident} AS message_key, {stamp} AS sent_at,
                {text} AS message_text, {sender_kind} AS sender_kind,
                LEFT(CONVERT(nvarchar(max),{sender_contact}),50) AS sender_contact,
                {message_kind} AS message_kind
                FROM {table} WHERE {chat}=%s AND {owner}=%s{cursor_clause})
                SELECT message_key, sent_at, message_text, sender_kind, sender_contact, message_kind FROM messages
                ORDER BY sent_at DESC, message_key DESC
                OFFSET 0 ROWS FETCH NEXT %s ROWS ONLY'''.format(
                    ident=q(ident),stamp=history_time_expr,text=text_expr,sender_kind=sender_kind,
                    sender_contact=sender_contact,message_kind=message_kind,table=table,
                    chat=chat_expr,owner=owner_expr,cursor_clause=cursor_clause)
            params.append(limit+1)
            cur.execute(sql, tuple(params))
            rows = cur.fetchall()
            has_more = len(rows) > limit
            rows = rows[:limit]
            next_cursor = None
            if has_more and rows:
                next_cursor = {'sentAt':str(rows[-1]['sent_at'] or ''),'messageKey':int(rows[-1]['message_key'])}
            messages = []
            for row in reversed(rows):
                message_text, was_redacted = redact_text(row['message_text'])
                sender_value = -1 if row['sender_kind'] is None else int(row['sender_kind'])
                message_value = -1 if row['message_kind'] is None else int(row['message_kind'])
                messages.append({'id':stable_id([owner_name,chat_key,row['message_key']], 'MSG-'),
                    'sentAt':str(row['sent_at']) if row['sent_at'] else None,
                    'text':message_text,'redacted':was_redacted,
                    'participantLabel':mask_contact(row['sender_contact']),
                    'senderType':sender_value,'messageType':message_value})
            output({'ok':True,'source':'sqlserver','conversationId':stable_id([owner_name,chat_key], 'SQL-'),
                'messages':messages,'total':total,'limit':limit,
                'hasMore':has_more,'nextCursor':None,
                'order':'ascending','directionAvailable':False,'_nextCursor':next_cursor,
                'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
            return
        if mode != 'receptions':
            raise ValueError('mapping')
        sql = '''WITH ranked AS (SELECT {chat} AS chat_key, {owner} AS owner_name,
            {stamp} AS last_at, {text} AS latest_text,
            COUNT_BIG(*) OVER (PARTITION BY {owner}, {chat}) AS message_count,
            ROW_NUMBER() OVER (PARTITION BY {owner}, {chat} ORDER BY {order}) AS rn
            FROM {table} WHERE {chat} IS NOT NULL)
            SELECT TOP (%s) chat_key, owner_name, last_at, latest_text, message_count,
            COUNT_BIG(*) OVER () AS conversation_total FROM ranked WHERE rn=1 ORDER BY last_at DESC, owner_name, chat_key'''.format(
                chat=chat_expr,owner=owner_expr,stamp=time_expr,text=text_expr,order=order,table=table)
        cur.execute(sql, (limit,))
        rows = cur.fetchall()
        records = []
        refs = {}
        for row in rows:
            when = row['last_at']
            if when is not None: when=str(when)
            record_id = stable_id([row['owner_name'],row['chat_key']], 'SQL-')
            latest_text, was_redacted = redact_text(row['latest_text'])
            records.append({'id':record_id,
                'contact':'会话 '+row['chat_key'],'assignee':row['owner_name'] or None,'channel':'whatsapp',
                'lastContactAt':when,'latestMessage':latest_text,'latestMessageRedacted':was_redacted,
                'messageCount':int(row['message_count']),'serviceStatus':None})
            refs[record_id] = {'chatKey':str(row['chat_key']),'ownerName':row['owner_name'] or ''}
        output({'ok':True,'source':'sqlserver','table':'wa_chat_message','records':records,
            'total':int(rows[0]['conversation_total']) if rows else 0,'limit':limit,
            'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'mapping':{'conversation':chat,'time':stamp,'timeFallback':created,'owner':owner,'text':text,'id':ident},
            'serviceStatusAvailable':False,'_conversationRefs':refs})
    finally:
        conn.close()

try:
    main()
except ModuleNotFoundError:
    output({'ok':False,'error':'SQL_DRIVER_MISSING'})
except FileNotFoundError:
    output({'ok':False,'error':'SQL_CONFIG_MISSING'})
except ValueError:
    output({'ok':False,'error':'SQL_MAPPING_REQUIRED'})
except Exception:
    # Driver errors can contain server addresses and credentials. Return a fixed code only.
    output({'ok':False,'error':'SQL_QUERY_FAILED'})
`;

function pythonExecutable() {
  if (process.env.SQLSERVER_PYTHON) return process.env.SQLSERVER_PYTHON;
  const existing = path.join(os.homedir(), '.hermes/hermes-agent/venv/bin/python');
  return fs.existsSync(existing) ? existing : 'python3';
}

function attachConversationRefs(result) {
  const raw = result && result._conversationRefs;
  const rawCursor = result && result._nextCursor;
  if (result && Object.hasOwn(result, '_conversationRefs')) delete result._conversationRefs;
  if (result && Object.hasOwn(result, '_nextCursor')) delete result._nextCursor;
  const refs = new Map();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, ref] of Object.entries(raw)) {
      if (/^SQL-[a-f0-9]{24}$/.test(id) && ref && typeof ref.chatKey === 'string' &&
          typeof ref.ownerName === 'string') refs.set(id, Object.freeze({ chatKey: ref.chatKey, ownerName: ref.ownerName }));
    }
  }
  Object.defineProperty(result, CONVERSATION_REFS, { value: refs });
  const cursor = rawCursor && typeof rawCursor === 'object' && !Array.isArray(rawCursor) &&
    typeof rawCursor.sentAt === 'string' && rawCursor.sentAt.length <= 50 && Number.isSafeInteger(rawCursor.messageKey) ?
    Object.freeze({ sentAt: rawCursor.sentAt, messageKey: rawCursor.messageKey }) : undefined;
  Object.defineProperty(result, MESSAGE_CURSOR, { value: cursor });
  return result;
}

function conversationRefFor(result, id) {
  return result && result[CONVERSATION_REFS] instanceof Map ? result[CONVERSATION_REFS].get(id) : undefined;
}

function messageCursorFor(result) {
  return result && result[MESSAGE_CURSOR];
}

function querySqlServer({ mode = 'receptions', limit = 50, offset = 0, conversation, cursor } = {}) {
  if (!['receptions', 'messages', 'diagnostics'].includes(mode)) return Promise.reject(new Error('INVALID_MODE'));
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return Promise.reject(new Error('INVALID_LIMIT'));
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) return Promise.reject(new Error('INVALID_OFFSET'));
  if (mode === 'messages' && (!conversation || typeof conversation.chatKey !== 'string' ||
      typeof conversation.ownerName !== 'string')) return Promise.reject(new Error('INVALID_CONVERSATION'));
  if (cursor !== undefined && (!cursor || typeof cursor.sentAt !== 'string' || cursor.sentAt.length > 50 ||
      !Number.isSafeInteger(cursor.messageKey))) return Promise.reject(new Error('INVALID_CURSOR'));
  return new Promise((resolve, reject) => {
    const child = execFile(pythonExecutable(), ['-c', PYTHON_SOURCE, mode, String(limit), String(offset)], {
      timeout: 30000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', windowsHide: true
    }, (error, stdout) => {
      if (error) return reject(new Error('SQL_BRIDGE_FAILED'));
      try {
        const result = JSON.parse(stdout);
        if (!result.ok) return reject(new Error(result.error || 'SQL_QUERY_FAILED'));
        resolve(attachConversationRefs(result));
      } catch (parseError) {
        reject(new Error('SQL_BRIDGE_INVALID_RESPONSE'));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(mode === 'messages' ? JSON.stringify({ conversation, cursor }) : '');
  });
}

module.exports = { querySqlServer, conversationRefFor, messageCursorFor, attachConversationRefs };
if (require.main === module) {
  querySqlServer({ mode: process.argv.includes('--diagnostics') ? 'diagnostics' : 'receptions', limit: 5 })
    .then(result => {
      // CLI evidence deliberately excludes customer identifiers and message text.
      if (result.records) result.records = result.records.map(r => ({ id: r.id, channel: r.channel,
        messageCount: r.messageCount, hasOwner: !!r.assignee, hasMessage: !!r.latestMessage,
        hasTimestamp: r.lastContactAt !== null }));
      console.log(JSON.stringify(result, null, 2));
    }).catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
}
