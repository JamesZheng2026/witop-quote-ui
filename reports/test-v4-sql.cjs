#!/usr/bin/env node
'use strict';
// Driver fixture: checks query/mapping/error handling without opening a SQL connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'witop-v4-driver-test-'));
const bridge = path.resolve(__dirname, '../scripts/sqlserver-bridge.js');
const sentinel = 'PRIVATE_TEST_PASSWORD';
const environment = { ...process.env, PYTHONPATH: folder,
  SQLSERVER_CONFIG: path.join(folder, 'config.json') };
fs.writeFileSync(environment.SQLSERVER_CONFIG, JSON.stringify({ server: 'fixture.invalid', port: 1433,
  user: 'fixture-user', password: sentinel, database: 'fixture' }));
fs.writeFileSync(path.join(folder, 'pymssql.py'), String.raw`
import os
__version__='fixture-only'
class Cursor:
    def execute(self, sql, params=None):
        if os.environ.get('V4_FIXTURE_ERROR'): raise RuntimeError('PRIVATE_TEST_PASSWORD')
        assert not any(x in sql.upper() for x in ['INSERT ', 'UPDATE ', 'DELETE ', 'EXEC ', 'DROP '])
        if 'INFORMATION_SCHEMA' in sql:
            assert params==('wa_chat_message',)
            self.rows=[{'TABLE_SCHEMA':'dbo','COLUMN_NAME':name,'DATA_TYPE':kind} for name,kind in
                [('session_id','int'),('agent','nvarchar'),('send_time','nvarchar'),('create_at','nvarchar'),('msg_content','nvarchar'),('id','int'),
                 ('sender_type','tinyint'),('sender_phone','nvarchar'),('msg_type','tinyint')]]
            if os.environ.get('V4_FIXTURE_BAD_SCHEMA'): self.rows[2]['DATA_TYPE']='datetime'
        elif 'DB_NAME' in sql:
            self.rows=[{'db':'fixture','version':'Fixture SQL Server'}]
        elif 'COUNT_BIG(*) AS total' in sql:
            if params is None: self.rows=[{'total':4}]
            else:
                assert params==('1','Owner A')
                self.rows=[{'total':2}]
        elif 'WITH messages AS' in sql:
            assert params[:2]==('1','Owner A')
            assert params[-1]==3
            assert 'WHERE CONVERT(nvarchar(max),[session_id])=%s' in sql
            assert "COALESCE(CONVERT(nvarchar(max),[agent]),N'')=%s" in sql
            assert 'OFFSET 0 ROWS FETCH NEXT %s ROWS ONLY' in sql
            if len(params) > 3:
                assert params[2:5]==('2026-06-24 01:58:50','2026-06-24 01:58:50',1)
                self.rows=[]
            else: self.rows=[
              {'message_key':2,'sent_at':'2026-06-24 01:59:50','message_text':'Email buyer@example.com password=PRIVATE_MESSAGE_SECRET Authorization: Bearer sk-ant-1234567890 phone 87654321',
               'sender_kind':1,'sender_contact':'+86 138 0000 1234','message_kind':1},
              {'message_key':1,'sent_at':'2026-06-24 01:58:50','message_text':'Call +86 138 0000 1234',
               'sender_kind':None,'sender_contact':'+86 138 0000 1234','message_kind':None}]
        elif 'WITH ranked AS' in sql:
            assert params==(5,)
            assert 'PARTITION BY COALESCE(CONVERT(nvarchar(max),[agent])' in sql
            assert 'CONVERT(nvarchar(max),[session_id])' in sql
            assert "ORDER BY COALESCE(NULLIF([send_time],N''),[create_at]) DESC, [id] DESC" in sql
            assert 'LEFT(CONVERT(nvarchar(max),[msg_content]),4000)' in sql
            assert 'CONVERT(datetime' not in sql and 'CAST(' not in sql
            assert '[dbo].[wa_chat_message]' in sql
            self.rows=[{'chat_key':'1','owner_name':owner,'last_at':'2026-06-24 01:58:50',
                'latest_text':'PRIVATE_TEST_MESSAGE','message_count':2,'conversation_total':2} for owner in ['Owner A','Owner B']]
        else: raise AssertionError('unexpected query')
    def fetchone(self): return self.rows[0]
    def fetchall(self): return self.rows
class Connection:
    def cursor(self,as_dict=False):
        assert as_dict
        return Cursor()
    def close(self): pass
def connect(**kwargs):
    if os.environ.get('V4_FIXTURE_CONNECT_ERROR'): raise RuntimeError('PRIVATE_TEST_PASSWORD')
    assert kwargs['password']=='PRIVATE_TEST_PASSWORD'
    assert kwargs['login_timeout']==5 and kwargs['timeout']==20
    return Connection()
`);
try {
  const run = args => execFileSync(process.execPath, [bridge, ...args], { env: environment, encoding: 'utf8' });
  const output = run([]);
  assert(!output.includes(sentinel));
  assert(!output.includes('PRIVATE_TEST_MESSAGE'));
  assert(!output.includes('same-contact'));
  const data = JSON.parse(output);
  assert.equal(data.records.length, 2);
  assert.notEqual(data.records[0].id, data.records[1].id, 'Same contact under different agents has different stable IDs');
  assert.equal(data.mapping.conversation, 'session_id');
  assert.equal(data.mapping.time, 'send_time');
  assert.equal(data.mapping.timeFallback, 'create_at');
  assert.equal(data.mapping.text, 'msg_content');
  const full = JSON.parse(execFileSync(process.execPath, ['-e',
    'require(process.argv[1]).querySqlServer({limit:5}).then(r=>console.log(JSON.stringify(r)))', bridge],
    { env: environment, encoding: 'utf8' }));
  assert.equal(full.records[0].lastContactAt, '2026-06-24 01:58:50', 'Source nvarchar time stays byte-for-byte unchanged');
  assert.equal(full.records[0].contact, '会话 1', 'Session ID is not misrepresented as a customer phone');
  assert.equal(data.serviceStatusAvailable, false);
  assert.equal(data.records[0].hasMessage, true);
  assert.equal(data.records[0].messageCount, 2);
  const historyOutput = execFileSync(process.execPath, ['-e',
    `const bridge=require(process.argv[1]);bridge.querySqlServer({mode:'messages',limit:2,conversation:{chatKey:'1',ownerName:'Owner A'}}).then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{process.stderr.write(JSON.stringify({error:e.message}));process.exitCode=1})`, bridge],
    { env: environment, encoding: 'utf8' });
  assert(!historyOutput.includes('buyer@example.com'));
  assert(!historyOutput.includes('+86 138 0000 1234'));
  assert(!historyOutput.includes('PRIVATE_MESSAGE_SECRET'));
  assert(!historyOutput.includes('sk-ant-1234567890'));
  assert(!historyOutput.includes('87654321'));
  const history = JSON.parse(historyOutput);
  assert.equal(history.ok, true);
  assert.equal(history.messages.length, 2);
  assert.equal(history.messages[0].sentAt, '2026-06-24 01:58:50', 'Message page is returned oldest-to-newest');
  assert.equal(history.messages[0].senderType, -1, 'Nullable sender metadata does not fail the whole conversation');
  assert.equal(history.messages[0].messageType, -1);
  assert.equal(Object.hasOwn(history.messages[0], 'participantId'), false, 'No reversible cross-conversation participant hash is exposed');
  assert.equal(history.messages[1].redacted, true);
  assert.match(history.messages[0].participantLabel, /^尾号 /);
  assert.equal(history.total, 2);
  assert.equal(history.hasMore, false);
  assert.equal(history.order, 'ascending');
  const emptyHistory = JSON.parse(execFileSync(process.execPath, ['-e',
    `const bridge=require(process.argv[1]);bridge.querySqlServer({mode:'messages',limit:2,conversation:{chatKey:'1',ownerName:'Owner A'},cursor:{sentAt:'2026-06-24 01:58:50',messageKey:1}}).then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{process.stderr.write(JSON.stringify({error:e.message}));process.exitCode=1})`, bridge],
    { env: environment, encoding: 'utf8' }));
  assert.equal(emptyHistory.messages.length, 0);
  assert.equal(emptyHistory.total, 2, 'A keyset page beyond the end retains the real conversation total');
  const diagnostics = JSON.parse(run(['--diagnostics']));
  assert.equal(diagnostics.schema.length, 9);
  assert.equal(diagnostics.messageCount, 4);
  assert.equal(diagnostics.handshake.driver, 'fixture-only');
  for (const [extra, expected] of [
    [{ V4_FIXTURE_CONNECT_ERROR: '1' }, 'SQL_CONNECT_FAILED'],
    [{ V4_FIXTURE_ERROR: '1' }, 'SQL_QUERY_FAILED'],
    [{ V4_FIXTURE_BAD_SCHEMA: '1' }, 'SQL_MAPPING_REQUIRED']
  ]) {
    const result = spawnSync(process.execPath, [bridge], { env: { ...environment, ...extra }, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).error, expected);
    assert(!(result.stdout + result.stderr).includes(sentinel));
  }
  console.log('PASS SQL bridge: real-schema contract, paged/redacted chat history, unchanged nvarchar time, bounded queries, agent/contact partition, stable IDs, no fabricated completion, private CLI evidence, sanitized errors (driver fixture; real SQL unverified)');
} finally {
  for (const name of ['pymssql.py', 'config.json']) fs.unlinkSync(path.join(folder, name));
  // Python may write bytecode; keep the temporary folder rather than recursively deleting it.
}
