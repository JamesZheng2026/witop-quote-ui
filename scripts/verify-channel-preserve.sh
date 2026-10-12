#!/usr/bin/env bash
# V3-05: state regression, historical bug reproduction, patched and working sources.
# No checkout, remote resources, API calls, or optional browser/visual step.
set -euo pipefail
CHANNEL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CHANNEL_ROOT"
mkdir -p reports

node scripts/test-state.js 2>&1 | tee reports/channel-preserve-validation.txt
node reports/test-channel-preserve.cjs --two-phase 2>&1 | tee -a reports/channel-preserve-validation.txt
git diff --check 2>&1 | tee -a reports/channel-preserve-validation.txt
