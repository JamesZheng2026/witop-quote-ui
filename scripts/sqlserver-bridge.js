'use strict';

// The Python child reads credentials locally. Never put them in arguments or HTTP responses.
const { execFile } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const PYTHON_SOURCE = String.raw`
import sys, os, json, time, hashlib, datetime
from pathlib import Path

def output(value):
    print(json.dumps(value, ensure_ascii=False, default=str))

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
        owner_expr = 'COALESCE(CONVERT(nvarchar(max),'+q(owner)+"),N'')" if owner else "N''"
        chat_expr = 'CONVERT(nvarchar(max),'+q(chat)+')'
        text_expr = 'LEFT(CONVERT(nvarchar(max),'+q(text)+'),4000)' if text else "N''"
        # These are nvarchar(50), not datetime. Keep their values and timezone untouched.
        # Empty send_time falls back to create_at; known fixed-width values sort lexically.
        time_expr = 'COALESCE(NULLIF('+q(stamp)+",N''),"+q(created)+')'
        order = time_expr+' DESC, '+q(ident)+' DESC'
        sql = '''WITH ranked AS (SELECT {chat} AS chat_key, {owner} AS owner_name,
            {stamp} AS last_at, {text} AS latest_text,
            COUNT_BIG(*) OVER (PARTITION BY {owner}, {chat}) AS message_count,
            ROW_NUMBER() OVER (PARTITION BY {owner}, {chat} ORDER BY {order}) AS rn
            FROM {table} WHERE {chat} IS NOT NULL)
            SELECT TOP (%s) chat_key, owner_name, last_at, latest_text, message_count,
            COUNT_BIG(*) OVER () AS conversation_total FROM ranked WHERE rn=1 ORDER BY last_at DESC, owner_name, chat_key'''.format(
                chat=chat_expr,owner=owner_expr,stamp=time_expr,text=text_expr,order=order,
                table=q(schemas[0])+'.[wa_chat_message]')
        cur.execute(sql, (int(sys.argv[2]),))
        rows = cur.fetchall()
        records = []
        for row in rows:
            when = row['last_at']
            if when is not None: when=str(when)
            key = json.dumps([row['owner_name'],row['chat_key']],ensure_ascii=False)
            records.append({'id':'SQL-'+hashlib.sha256(key.encode()).hexdigest()[:24],
                'contact':'会话 '+row['chat_key'],'assignee':row['owner_name'] or None,'channel':'whatsapp',
                'lastContactAt':when,'latestMessage':row['latest_text'] or '',
                'messageCount':int(row['message_count']),'serviceStatus':None})
        output({'ok':True,'source':'sqlserver','table':'wa_chat_message','records':records,
            'total':int(rows[0]['conversation_total']) if rows else 0,'limit':int(sys.argv[2]),
            'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'mapping':{'conversation':chat,'time':stamp,'timeFallback':created,'owner':owner,'text':text,'id':ident},
            'serviceStatusAvailable':False})
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

function querySqlServer({ mode = 'receptions', limit = 50 } = {}) {
  if (!['receptions', 'diagnostics'].includes(mode)) return Promise.reject(new Error('INVALID_MODE'));
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return Promise.reject(new Error('INVALID_LIMIT'));
  return new Promise((resolve, reject) => {
    execFile(pythonExecutable(), ['-c', PYTHON_SOURCE, mode, String(limit)], {
      timeout: 30000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', windowsHide: true
    }, (error, stdout) => {
      if (error) return reject(new Error('SQL_BRIDGE_FAILED'));
      try {
        const result = JSON.parse(stdout);
        if (!result.ok) return reject(new Error(result.error || 'SQL_QUERY_FAILED'));
        resolve(result);
      } catch (parseError) {
        reject(new Error('SQL_BRIDGE_INVALID_RESPONSE'));
      }
    });
  });
}

module.exports = { querySqlServer };
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
