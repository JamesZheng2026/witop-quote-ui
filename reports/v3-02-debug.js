// debug localStorage stub
const { JSDOM } = require('/Users/james/.hermes/hermes-agent/node_modules/jsdom')
const fs = require('fs')
const WT = '/Users/james/witop-quote-ui/.worktrees/v3-02-integration'
const indexHtml = fs.readFileSync(WT + '/index.html', 'utf8')
const stateJs = fs.readFileSync(WT + '/scripts/state.js', 'utf8')
const bridgeJs = fs.readFileSync(WT + '/scripts/reception-bridge.js', 'utf8')
const stripped = indexHtml
  .replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '')
  .replace(/<link[^>]*>/g, '')
  .replace(/<\/body>/i, '<script>' + stateJs + '\n' + bridgeJs + '</script></body>')

const dom = new JSDOM(stripped, { url: 'http://localhost:8081/', runScripts: 'dangerously', pretendToBeVisual: true })
const w = dom.window
try { w.localStorage.clear() } catch (e) {}

const stub = {
  _data: {},
  getItem: function (k) { return this._data[k] || null },
  setItem: function (k, v) { this._data[k] = String(v) },
  removeItem: function (k) { delete this._data[k] }
}
w.localStorage = stub

console.log('before eval, stub._data:', JSON.stringify(stub._data))
console.log('w.localStorage has _data:', '_data' in w.localStorage)

w.eval(stateJs)
console.log('after state.js, stub._data:', JSON.stringify(stub._data))
console.log('w.localStorage === stub:', w.localStorage === stub)

w.eval(bridgeJs)
console.log('after bridge.js, stub._data:', JSON.stringify(stub._data))
console.log('window.ReceptionBridge:', typeof w.ReceptionBridge)

const r = w.ReceptionBridge.dispatchTrigger('REC-001', 'transfer_to_human')
console.log('dispatch result:', JSON.stringify(r))
console.log('after dispatch, stub._data:', JSON.stringify(stub._data))
console.log('w.localStorage === stub:', w.localStorage === stub)
console.log('w.localStorage._data:', w.localStorage._data)
