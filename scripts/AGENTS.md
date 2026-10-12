# Verification suites

Every new or revised `verify-*.sh` suite must run the permanent channel guard:

```sh
node reports/test-channel-preserve.cjs
```

Run it after the state unit tests and before task-specific checks. Preserve its
nonzero exit status, including when piping through `tee` (`set -euo pipefail`).
The standalone `bash scripts/verify-channel-preserve.sh` additionally proves the
historical bug and fix using all application sources from each commit; it needs
Git history containing `4bb22a5` and `b4a8040`. The default guard tests only the
current working files and is suitable for shallow CI checkouts.

The jsdom harness requires the Node version in `reports/package.json` and jsdom
30.1.2. Dependency provisioning is separate from verification: use the declared
test-only manifest (`npm install --prefix reports`) in an authorized setup step,
or provide an existing compatible installation through `NODE_PATH`. Verification
must fail if jsdom is unavailable; never skip or download dependencies silently.

Optional browser visual checks are separate; record `visual_skipped=true` when
not run. Do not treat jsdom checks as browser visual evidence.
