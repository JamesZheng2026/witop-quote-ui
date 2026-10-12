# CI Workflows

## lint.yml

**Trigger**: push to `main` + every PR

**Scope** (zero npm install, ~30s):

1. `bash -n` syntax check on `scripts/*.sh`
2. `node --check` syntax check on `scripts/*.js` and `reports/*.cjs`
3. `git diff --check` for whitespace + conflict markers
4. `bash scripts/verify-channel-preserve.sh` — V3-05 channel-preserve regression guard

**Why this design**:

- Static HTML/JS project, no `package.json`, no build step
- The V3-04 channel-preserve bug was caught by codex's manual review, NOT by a test — V3-05 added `verify-channel-preserve.sh` as the permanent regression guard
- Running it on every PR turns the manual review into a hard CI gate
- Zero external dependencies (no shellcheck, no eslint) → fast + free + reproducible

**Future expansion**:

- e2e-visual: add `run-visual.sh` with 60s hard timeout (V3-05 already wired wrapper)
- lint-only stays as a cheap fast tier; visual stays opt-in
