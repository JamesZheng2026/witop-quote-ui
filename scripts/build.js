// Emit metadata for this checkout before docker build. Missing Git data is fatal.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
function getGitShort() {
  try {
    const options = { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }
    // Do not accidentally attribute a source archive to an enclosing repository.
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], options).trim()
    if (fs.realpathSync(top) !== fs.realpathSync(root)) return 'unknown'
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], options).trim()
    return /^[0-9a-f]{7,40}$/.test(sha) ? sha : 'unknown'
  } catch {
    return 'unknown'
  }
}

const ts = Date.now()
const info = { sha: getGitShort(), ts, builtAt: new Date(ts).toISOString() }
const out = path.join(__dirname, 'build-info.json')
fs.writeFileSync(out, JSON.stringify(info, null, 2) + '\n')
console.log('build-info written:', out, info)
if (info.sha === 'unknown') {
  console.error('Cannot determine this checkout SHA; refusing to build.')
  process.exitCode = 1
}
