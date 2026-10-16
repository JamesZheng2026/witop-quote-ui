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

## SQL Server reception bridge

`server.js` serves the v4 entry and a read-only `/api/receptions` endpoint on
loopback. `sqlserver-bridge.js` invokes a Python runtime with pymssql; credentials
stay in the existing external config file. Do not copy credentials into the repo,
CLI arguments, browser payloads, logs, or reports. Do not expose arbitrary SQL or
filesystem paths through HTTP. Diagnostics are CLI-only and must omit messages
and customer identifiers. Real SQL handshake/schema evidence is required for
integration acceptance; injected test data validates behavior only.

The message table has no verified service-completion contract. Do not infer
service completion, AI summaries, or workflow transitions from message ownership.
Keep v4 live records separate from the historical mock state machine.
