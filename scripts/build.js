// scripts/build.js — emit scripts/build-info.json with current git sha + ts
// Run via: node scripts/build.js
// Output: scripts/build-info.json consumed by index.html at runtime
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function getGitShort() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch (e) {
    return 'unknown'
  }
}

const info = {
  sha: getGitShort(),
  ts: Date.now(),
  builtAt: new Date().toISOString(),
}

const out = path.join(__dirname, 'build-info.json')
fs.writeFileSync(out, JSON.stringify(info, null, 2) + '\n')
console.log('build-info written:', out, info)
