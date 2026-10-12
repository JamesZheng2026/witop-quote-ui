#!/usr/bin/env bash
# A2 extends A1's structural/button/ID/escaping checks with provider and workflow checks.
# A1 baseline findings are warnings; A2 additions must pass. No checkout or remote access.
set -euo pipefail
A2_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$A2_ROOT"
mkdir -p reports
set +e
node <<'JS' 2>&1 | tee reports/a2-validation.txt
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const html = fs.readFileSync('index.html', 'utf8');
const base = execFileSync('git', ['show', 'f6b793b:index.html'], {encoding: 'utf8'});
let pass = 0, fail = 0, warn = 0, viewsChecked = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (error) { fail++; console.log('FAIL ' + name + ': ' + error.message); }
}
function warning(message) { warn++; console.log('WARN ' + message); }
const idsOf = source => [...source.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const ids = idsOf(html), baseIds = idsOf(base);
const newIds = ids.filter(id => !baseIds.includes(id));
const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(m => m[0]);
const baseButtons = new Set([...base.matchAll(/<button\b[^>]*>/g)].map(m => m[0]));
const newButtons = buttons.filter(button => !baseButtons.has(button));
console.log('=== A2 Validation ===');
console.log('Target: ' + process.cwd() + '/index.html');
console.log('Date: ' + new Date().toISOString());
console.log('Baseline: f6b793b (A1 script inspected read-only; no A1 code imported)');
check('HTML/body structure pairs', () => {
  for (const tag of ['html', 'body', 'main']) {
    assert.equal((html.match(new RegExp('<' + tag + '\\b', 'g')) || []).length, 1);
    assert.equal((html.match(new RegExp('</' + tag + '>', 'g')) || []).length, 1);
  }
});
check('All IDs unique (including new IDs)', () => assert.equal(new Set(ids).size, ids.length));
check('All ' + newIds.length + ' new IDs contain no whitespace', () => assert(newIds.every(id => !/\s/.test(id))));
check('All ' + newButtons.length + ' new/changed buttons have type="button"', () => assert(newButtons.length && newButtons.every(b => /\btype="button"/.test(b))));
check('A1 Saudi Arabia ID preserved exactly', () => assert.equal(html.match(/id="adj-Saudi Arabia"/g).length, 1));
warning('A1 legacy id="adj-Saudi Arabia" remains intentionally; see fix/html-issues-round1.');
const oldUntyped = buttons.filter(b => !/\btype="button"/.test(b));
if (oldUntyped.length) warning(oldUntyped.length + ' unchanged baseline buttons lack type; A1 owns these.');
check('Existing escHtml and intentBadge preserved', () => assert(html.includes('function escHtml') && html.includes('function intentBadge')));
warning('A1 legacy intentBadge uses innerHTML/string rendering; its separate hardening is not imported.');
check('No new CDN dependencies', () => {
  const dependencies = source => [...source.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="(https:[^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(dependencies(html), dependencies(base));
});
check('README untouched on this branch', () => assert.equal(spawnSync('git', ['diff','f6b793b','--','README.md'], {encoding:'utf8'}).stdout, ''));
check('No networking introduced in application script', () => assert(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/.test(html)));
const requiredNodes = ['view-inquiry-detail','nav-inquiry-detail','detail-header','detail-customer','detail-specs','detail-quote-history','detail-current-state','detail-activities','detail-actions','detail-metadata','detail-empty','detail-reject-reason','q-breakdown','q-risk-flags','q-citations','s-ai-provider','s-ai-api-key','view-quality-report','r-avgquality','inquiry-status-popover'];
check('Inquiry detail / quote / settings / quality DOM nodes exist', () => requiredNodes.forEach(id => assert(ids.includes(id), id)));
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
check('All inline scripts parse', () => scripts.forEach(script => new vm.Script(script)));
const source = scripts[scripts.length - 1];
// Dependency-free DOM harness. Missing IDs return null like the browser; this does not claim browser layout QA.
function makeContext(initialStore = {}) {
  const elements = new Map();
  let download = null;
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const [,tag,attrs,id] = match;
    const classes = new Set((attrs.match(/class="([^"]*)"/) || [,''])[1].split(/\s+/));
    const el = {id,tag,attrs,value:(attrs.match(/value="([^"]*)"/) || [,''])[1],textContent:'',innerHTML:'',
      classList:{ add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,force){if(force === undefined) force=!classes.has(c); force?classes.add(c):classes.delete(c);}},
      scrollIntoView(){},showPopover(){this.open=true;},hidePopover(){this.open=false;},removeAttribute(){}, classes};
    let domValue=String(el.value);
    Object.defineProperty(el,'value',{get:()=>domValue,set:v=>{domValue=String(v);}});
    if (tag === 'select') {
      const start = match.index + match[0].length;
      const contents = html.slice(start, html.indexOf('</select>',start));
      el.value = (contents.match(/<option value="([^"]*)"/) || [,''])[1];
    }
    elements.set(id,el);
  }
  const store = new Map(Object.entries(initialStore));
  const document = {getElementById(id){return elements.get(id)||null;},
    querySelectorAll(selector){return [...elements.values()].filter(el=>el.classes.has(selector.slice(1)));},
    documentElement:{classList:{add(){}}},body:{appendChild(){}},
    createElement(tag){return {tag,click(){download=this;},remove(){}};}};
  const context = vm.createContext({console,document,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
    performance:{now:()=>performance.now()},setTimeout:()=>0,Blob,URL:{createObjectURL:()=> 'blob:mock-a2',revokeObjectURL(){}},
    matchMedia:()=>({matches:false}),fetch(){throw new Error('Forbidden network call');}});
  context.window=context;
  vm.runInContext(source,context);
  return {context,elements,store,getDownload:()=>download,run:code=>vm.runInContext(code,context)};
}
async function runtimeTests() {
  const app = makeContext();
  const {run,context,elements,store}=app;
  check('window.aiQuoteEngine / quoteInquiry exported',()=>assert.equal(typeof context.aiQuoteEngine.quoteInquiry,'function'));
  check('window.quoteInquiry exported',()=>assert.equal(typeof context.quoteInquiry,'function'));
  check('Provider table has mock/rules/llm and four named adapters',()=>{
    for(const name of ['mock','rules','llm','openai','anthropic','openrouter','minimax']) assert.equal(typeof context.aiProviders[name].fn,'function');
    assert.equal(context.aiProviders.mock.needsKey,false);assert.equal(context.aiProviders.openai.needsKey,true);
  });
  check('STATUSES explicit seven states and transitionInquiry exported',()=>{
    assert.equal(run('STATUSES.join(",")'),'New,Reviewed,Quoting,Quoted,Negotiating,Won,Lost');
    assert.equal(typeof context.transitionInquiry,'function');
  });
  check('All original MOCK_INQUIRIES fields/values preserved',()=>{
    const baselineContext=vm.createContext({});
    const declaration=base.slice(base.indexOf('const MOCK_INQUIRIES = ['),base.indexOf('// State'));
    vm.runInContext(declaration,baselineContext);
    assert.equal(run('JSON.stringify(MOCK_INQUIRIES)'),vm.runInContext('JSON.stringify(MOCK_INQUIRIES)',baselineContext));
    assert(run('inquiries.every(i => Object.keys(i).every(k => k === "activities" || k in MOCK_INQUIRIES.find(m => m.id === i.id)))'));
  });
  check('Legacy Rejected migrated; historical totals preserved and flagged',()=>{
    assert.equal(run('inquiries.find(i=>i.id==="INQ-013").status'),'Lost');
    assert.equal(run('inquiries[1].quoteBreakdown.total'),24300);
    assert(run('inquiries[1].quoteBreakdown.riskFlags.includes("legacy-total-mismatch")'));
  });
  check('6 view DOM rendering/navigation smoke checks',()=>{
    for(const name of ['dashboard','inquiries','inquiry-detail','quote-panel','settings','quality-report']){
      run('showView('+JSON.stringify(name)+')');
      assert.equal(elements.get('view-'+name).classList.contains('hidden'),false);
      assert.equal([...elements.values()].filter(e=>e.classes.has('view')&&!e.classList.contains('hidden')).length,1);
      viewsChecked++;
    }
  });
  check('List rows route to detail without generating a quote',()=>{
    run('openInquiryDetail("INQ-003")');
    assert.equal(run('currentView'),'inquiry-detail');assert.equal(run('selectedInquiry.quoteBreakdown'),null);
    assert(elements.get('detail-actions').innerHTML.includes('Generate Quote'));
    assert(run('tableRowHTML(selectedInquiry).includes("openInquiryDetail")'));
  });
  check('Status history popover stops row navigation',()=>{
    let stopped=false;context.openStatusHistory('INQ-003',{stopPropagation(){stopped=true;}});
    assert(stopped);assert(elements.get('inquiry-status-popover').open);context.closeStatusHistory();
    assert(!elements.get('inquiry-status-popover').open);
  });
  check('Illegal transition throws, alerts and preserves status',()=>{
    assert.throws(()=>context.transitionInquiry('INQ-003','New','Won','Test','invalid'),/Illegal transition/);
    assert.equal(run('selectedInquiry.status'),'New');assert(!elements.get('ui-error').classList.contains('hidden'));
  });
  const mock=await run('quoteInquiry(inquiries[0], getDefaultSettings())');
  check('Mock retains original qty/material/labor/logistics/margin totals',()=>{
    assert.equal(mock.material.amount,30000);assert.equal(mock.craft.amount,7200);
    assert.equal(mock.logistics.amount,14000);assert.equal(mock.margin.amount,10240);assert.equal(mock.total,61440);
  });
  check('QuoteResult schema and arithmetic',()=>{
    for(const field of ['material','craft','logistics','compliance','margin']){assert(Number.isFinite(mock[field].amount));assert(mock[field].reason);}
    for(const field of ['material','craft','logistics','compliance']) assert(mock[field].confidence>=0&&mock[field].confidence<=1);
    assert(Array.isArray(mock.material.sourceQuotes));assert.equal(mock.logistics.containerCount,4);
    assert.equal(mock.subtotal+mock.margin.amount,mock.total);assert.equal(mock.unitPrice,25.6);
    assert(mock.generatedAt&&mock.processingMs>=0&&mock.overallConfidence>=0&&mock.overallConfidence<=1);
    assert(mock.riskFlags.includes('buyer-risk-word'));assert(mock.citations.every(c=>c.source==='mock'));
  });
  const rules=await run('quoteInquiry(inquiries.find(i=>i.id==="INQ-006"), {...getDefaultSettings(), aiProvider:"rules"})');
  check('Rules quotes SGS + LC compliance and region margin with reasons',()=>{
    assert.equal(rules.compliance.amount,300);assert.equal(rules.margin.percent,18);
    assert(rules.compliance.reason.includes('SGS'));assert.equal(rules.provider,'rules');
    assert.equal(rules.total,rules.subtotal+rules.margin.amount);
  });
  const tier=await run('quoteInquiry(inquiries[8], {...getDefaultSettings(), aiProvider:"rules", matRule:"tiered",margin:0,adjustments:{Germany:0}})');
  check('Rules bulk tier / CE / margin clamp / risk flag',()=>{
    assert.equal(tier.material.amount,95000);assert.equal(tier.compliance.amount,150);assert.equal(tier.margin.percent,5);
    assert(tier.riskFlags.includes('high-quantity-low-margin'));
  });
  let missingError;
  try{await run('quoteInquiry(inquiries[0], {...getDefaultSettings(), aiProvider:"llm"})');}catch(e){missingError=e;}
  check('Missing LLM key rejects with exact error',()=>assert.equal(missingError.message,'API key not configured'));
  for(const provider of ['llm','openai','anthropic','openrouter','minimax']){
    const result=await run('quoteInquiry(inquiries[0], {...getDefaultSettings(), aiProvider:'+JSON.stringify(provider)+', aiApiKey:"PLACEHOLDER_ONLY"})');
    check(provider+' returns mock + warning, without network',()=>{assert.equal(result.provider,'llm');assert.equal(result.warnings[0],'LLM provider not configured');assert.equal(result.total,mock.total);});
  }
  check('Key settings memory-only persistence',()=>{
    elements.get('s-ai-provider').value='openai';elements.get('s-ai-api-key').value='PLACEHOLDER_ONLY';run('saveSettings()');
    assert.equal(run('settings.aiApiKey'),'PLACEHOLDER_ONLY');
    for(const value of store.values()){assert(!value.includes('aiApiKey'));assert(!value.includes('PLACEHOLDER_ONLY'));}
    assert.equal(JSON.parse(store.get('witop_settings')).aiProvider,'openai');
  });
  const reloaded=makeContext(Object.fromEntries(store));
  check('Reload keeps provider but clears key',()=>{assert.equal(reloaded.run('settings.aiApiKey'),'');assert.equal(reloaded.run('settings.aiProvider'),'openai');});
  run('settings.aiApiKey="";settings.aiProvider="llm"');
  await run('regenerateQuote()');
  check('Missing key UI feedback leaves inquiry and history unchanged',()=>{
    assert.equal(run('selectedInquiry.status'),'New');assert.equal(run('selectedInquiry.quoteBreakdown'),null);
    assert.equal(elements.get('ui-error').textContent,'API key not configured');
  });
  run('settings=getDefaultSettings()');await run('regenerateQuote()');
  check('Generate routes detail → quote, New → Reviewed → Quoting',()=>{
    assert.equal(run('currentView'),'quote-panel');assert.equal(run('selectedInquiry.status'),'Quoting');
    assert.equal(run('selectedInquiry.activities.filter(a=>a.type==="transition").map(a=>a.fromState+"→"+a.toState).join(",")'),'New→Reviewed,Reviewed→Quoting');
    assert(run('selectedInquiry.activities.some(a=>a.type==="quote_generated")'));
    assert.equal((elements.get('q-breakdown').innerHTML.match(/title=/g)||[]).length,5);
  });
  run('showEditForm()');elements.get('edit-compliance').value='100';elements.get('edit-marginpct').value='25';run('applyEdit()');
  check('Edit recalculates five parts and records history/activity',()=>{
    assert(run('selectedInquiry.activities.some(a=>a.type==="quote_edited")'));
    assert.equal(run('selectedInquiry.quoteHistory.at(-1).status'),'Edited');
    assert.equal(run('selectedInquiry.quoteBreakdown.citations.length'),0);
    assert.equal(run('selectedInquiry.quoteBreakdown.total'),run('selectedInquiry.quoteBreakdown.subtotal+selectedInquiry.quoteBreakdown.margin.amount'));
  });
  run('showEditForm()');elements.get('edit-marginpct').value='51';const preEdit=run('JSON.stringify(selectedInquiry.quoteBreakdown)');run('applyEdit()');
  check('Invalid edit preserves prior quote and shows error',()=>assert.equal(run('JSON.stringify(selectedInquiry.quoteBreakdown)'),preEdit));
  run('cancelEdit();approveQuote()');
  check('Approve transitions Quoting → Quoted and creates immutable record',()=>{
    assert.equal(run('selectedInquiry.status'),'Quoted');assert.equal(run('quoteRecords.length'),1);
    assert(run('selectedInquiry.activities.some(a=>a.type==="quote_approved")'));assert(run('quoteRecords[0].quote !== selectedInquiry.quoteBreakdown'));
  });
  const decision=run('JSON.stringify(quoteRecords[0].quote)');await run('regenerateQuote()');
  check('Regeneration re-enters Quoting and preserves decision snapshot',()=>{
    assert.equal(run('selectedInquiry.status'),'Quoting');assert.equal(run('JSON.stringify(quoteRecords[0].quote)'),decision);
    assert(run('selectedInquiry.activities.filter(a=>a.type==="quote_generated").length===2'));
  });
  run('approveQuote();startNegotiating();markWon()');
  check('Quoted → Negotiating → Won path is reachable',()=>assert.equal(run('selectedInquiry.status'),'Won'));
  const wonQuote=run('JSON.stringify(selectedInquiry.quoteBreakdown)');await run('regenerateQuote()');
  check('Closed Won inquiry cannot regenerate',()=>assert.equal(run('JSON.stringify(selectedInquiry.quoteBreakdown)'),wonQuote));
  run('openInquiryDetail("INQ-001")');await run('regenerateQuote()');
  elements.get('reject-reason').value='urgent: revised delivery unavailable';run('confirmReject()');
  check('Quote rejection reaches Lost with reason, activity and record',()=>{
    assert.equal(run('selectedInquiry.status'),'Lost');assert(run('selectedInquiry.activities.some(a=>a.type==="quote_rejected"&&a.note.includes("urgent"))'));
    assert.equal(run('quoteRecords.at(-1).status'),'Rejected');assert.equal(run('selectedInquiry.quoteHistory.at(-1).reason'),'urgent: revised delivery unavailable');
  });
  run('openInquiryDetail("INQ-005")');elements.get('detail-reject-reason').value='';run('confirmDetailReject()');
  check('Reject requires non-empty reason',()=>assert.equal(run('selectedInquiry.status'),'New'));
  elements.get('detail-reject-reason').value='Buyer project cancelled';run('confirmDetailReject()');
  check('Pre-quote rejection logs Lost without fabricating quote record',()=>{assert.equal(run('selectedInquiry.status'),'Lost');assert.equal(run('quoteRecords.length'),3);});
  check('Activities conform to ts/type/fromState/toState/actor/note',()=>assert(run('inquiries.every(i=>i.activities.every(a=>Object.keys(a).sort().join(",")==="actor,fromState,note,toState,ts,type"))')));
  check('Four-dimensional scoring / risk deductions / grades / clamps',()=>{
    const quote=JSON.parse(decision);
    const clean=context.scoreQuoteRecord({quote,processingTime:'0m',notes:'',reason:''});assert.equal(clean.total,100);assert.equal(clean.grade,'A');
    const risky=context.scoreQuoteRecord({quote,processingTime:'10m',notes:'ASAP urgent cheap lowest 敏感',reason:''});assert.equal(risky.total,65);assert.equal(risky.grade,'C');assert.equal(risky.risk_word_score,0);
    assert.equal(context.scoreQuoteRecord({quote,processingTime:'40m'}).response_time_score,0);
    assert.equal(context.scoreQuoteRecord({processingTime:'0m'}).completeness_score,0);
    quote.compliance.amount=0;assert.equal(context.scoreQuoteRecord({quote,processingTime:'0m'}).completeness_score,0);
    quote.margin.percent=36;assert.equal(context.scoreQuoteRecord({quote,processingTime:'0m'}).price_reasonableness_score,0);
  });
  check('Quality expansion, averages and JSON download carry scores',()=>{
    run('renderReport();exportQualityJSON()');
    assert(elements.get('report-table-body').innerHTML.includes('<details>'));assert(elements.get('r-avgquality').textContent.includes('/100'));
    const exported=JSON.parse(run('JSON.stringify(qualityExportData())'));assert.equal(exported.length,3);assert(exported.every(r=>r.quality.deductions));
    assert(app.getDownload().download.endsWith('.json'));assert(!JSON.stringify(exported).includes('aiApiKey'));
  });
  check('Rendered new buttons and inline event handlers are valid',()=>{
    for(const el of elements.values()){
      for(const match of el.innerHTML.matchAll(/<button\b[^>]*>/g)) assert(/type="button"/.test(match[0]));
      for(const match of el.innerHTML.matchAll(/\bon(?:click|change|input)="([^"]*)"/g)) new vm.Script('(function(event){'+match[1]+'})');
    }
  });
  const restart=makeContext(Object.fromEntries(store));
  check('Activities, quote records and legacy migration survive reload once',()=>{
    assert.equal(restart.run('quoteRecords.length'),3);
    assert.equal(restart.run('inquiries.find(i=>i.id==="INQ-013").activities.filter(a=>a.type==="legacy_migration").length'),1);
  });
}
runtimeTests().catch(error=>{fail++;console.log('FAIL Runtime harness: '+error.stack);}).finally(()=>{
  check('git diff --check',()=>assert.equal(spawnSync('git',['diff','--check'],{encoding:'utf8'}).status,0));
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if(fs.existsSync(chrome)){
    const profile=fs.mkdtempSync('/private/tmp/witop-a2-headless-');
    const browser=spawnSync(chrome,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir='+profile,'--dump-dom','about:blank'],{encoding:'utf8',timeout:10000,maxBuffer:1000000});
    warning('Headless Chrome launch: status='+browser.status+', signal='+(browser.signal||'none')+'; no browser visual QA claimed.');
  }else warning('Headless Chrome not available; no browser visual QA claimed.');
  console.log('DOM harness views checked: '+viewsChecked+'/6 (not browser visual rendering).');
  console.log('=== Summary ===');console.log('PASS: '+pass);console.log('FAIL: '+fail);console.log('WARN: '+warn);
  console.log('Report: '+process.cwd()+'/reports/a2-validation.txt');
  process.exitCode=fail?1:0;
});
JS
A2_EXIT=${PIPESTATUS[0]}
set -e
exit "$A2_EXIT"
