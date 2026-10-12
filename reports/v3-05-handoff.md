# V3-05 channel-preserve regression handoff

Task: `t_1050f7e6` (codex-tech), local-only implementation.
Worktree: `/Users/james/witop-quote-ui/.worktrees/t_1050f7e6`
Branch: `wt/t_1050f7e6`; base/HEAD: `1d19fc9`.
No implementation commit, push, PR, merge, deployment, or dependency installation.

## Change scope

- `reports/test-channel-preserve.cjs`: portable jsdom harness with isolated DOM
  and storage for each case; executes the real state machine, bridge, channel tab
  and transfer button. Verifies the active channel, all pane/tab states, drawer
  visibility/content and successful transfer status/history. Runtime errors or
  swallowed render warnings fail the suite. Re-queries DOM after rendering.
- `scripts/verify-channel-preserve.sh`: state checks, channel history/current
  checks and diff validation with `pipefail`, saving the channel validation log.
- `scripts/AGENTS.md`: requires the current-worktree channel guard in every future
  verification suite and documents separate dependency provisioning.
- `reports/package.json`: private test-only jsdom 30.1.2 dependency and compatible
  Node engine, with current and historical test commands.
- `reports/channel-preserve-validation.txt`: actual wrapper output.
- `reports/v3-05-handoff.md`: this review handoff.

Application files (`index.html`, state/bridge) and existing verification suites
are unchanged. No CI service configuration exists in this checkout; the new
suite and future-suite instructions are the local verification integration.

## Verification

Node: 24.20.0. Runs used the existing installation:
`NODE_PATH=/private/tmp/v3-04-channel-test/node_modules` (jsdom 30.1.2).
Fresh environments need the declared test dependencies provisioned first.
Verification scripts do not download dependencies or skip missing jsdom.

| Command (with NODE_PATH where jsdom is used) | Exit | Result |
| --- | --- | --- |
| `node reports/test-channel-preserve.cjs --revision 4bb22a5` | 1, expected | 1 PASS / 2 FAIL: refresh and transfer reset WhatsApp to email; record change passes |
| `node reports/test-channel-preserve.cjs --revision b4a8040` | 0 | 3 PASS / 0 FAIL |
| `node reports/test-channel-preserve.cjs` | 0 | 3 PASS / 0 FAIL (current files) |
| `bash scripts/verify-channel-preserve.sh` | 0 | 39 state PASS; 9 channel/history PASS; diff check passes |
| `bash scripts/verify-a2.sh` | 0 | 50 PASS / 0 FAIL, 4 existing warnings |
| `bash scripts/verify-v3-01.sh` | 0 | 75 PASS / 0 FAIL, 2 existing warnings |
| `bash scripts/verify-v3-01b.sh` | 0 | 191 cumulative PASS / 0 FAIL |
| `node --check reports/test-channel-preserve.cjs` | 0 | Syntax valid |
| `bash -n scripts/verify-channel-preserve.sh` | 0 | Syntax valid |
| `git diff --check` | 0 | No whitespace errors |

Historical loading reads **all three application sources** from each revision;
no checkout changes or mixing old HTML with the current bridge/state. Default
mode tests current files only; `--two-phase` validates the two historical commits
and current files. Phase A accepts only the specific channel assertion failures,
not arbitrary harness errors. Explicit `--revision 4bb22a5` exits nonzero.

Legacy scripts ran through `bash -c` with only their top-level `tee` destination
redirected to temporary evidence files. V3-01b's nested suites also generated the
two tracked validation reports; those outputs were preserved as temporary
evidence and those initially clean reports restored byte-for-byte from HEAD.
All original assertions and child verification commands were retained.

Additional complete validation logs:

- `/private/tmp/witop-v3-05-validation-inmlm9fj/verify-a2.sh.output.txt`
- `/private/tmp/witop-v3-05-validation-inmlm9fj/verify-v3-01.sh.output.txt`
- `/private/tmp/witop-v3-05-validation-inmlm9fj/verify-v3-01b.sh.output.txt`
- `/private/tmp/witop-v3-05-validation-inmlm9fj/nested-a2-validation.txt`
- `/private/tmp/witop-v3-05-validation-inmlm9fj/nested-v3-01-validation.txt`

## Review and limitations

`visual_skipped=true`. jsdom is functional DOM evidence, not browser rendering.
The legacy Chrome smoke launches reported SIGABRT, already recorded as warnings;
no optional visual script was run, retried, or escalated. The referenced
`scripts/run-visual.sh` is absent from this task's checkout and is not needed for
the required functional guard.

Independent review remains pending. Keep changes uncommitted for review. If a
later authorized commit is made, include `visual_skipped=true` in its body.
The callback tools returned `user rejected MCP tool call`; the canonical CLI
returned `delegate_task child contexts cannot mutate Kanban tasks via the CLI`.
Do not bypass that guard or edit the board database. This local handoff is not
proof of a successful Kanban review transition.

Final review request also returned `user rejected MCP tool call`. Read-only
canonical database readback after that attempt: task `t_1050f7e6` is still
`running`, assigned to `codex-worker`. An authorized coordinator must submit the
review transition through its own canonical tool context; implementation and
validation evidence are ready here.

## Resumed verification (2026-10-12)

Preserved all six pre-existing untracked deliverables and reviewed their scope
against the current card (assigned to `codex-worker`, `local-only`, no declared
dependencies). No application changes or implementation commit were needed.

Re-ran the wrapper with the existing jsdom 30.1.2 installation: exit 0,
39 state PASS / 0 FAIL and 9 channel/history PASS / 0 FAIL. Re-ran the explicit
buggy revision: exit 1 as required, with 1 PASS / 2 channel-regression FAIL.
Node and shell syntax checks and `git diff --check` passed. The legacy suite
results above are evidence from the prior run, not new runs in this resumption.

The current `kanban_show`, start-comment and `kanban_request_review` calls each
returned `user rejected MCP tool call`, with no further reason. No lifecycle
mutation was attempted through the CLI or database. The review transition remains
unconfirmed; an authorized coordinator must submit the review request. Changes
remain uncommitted on `wt/t_1050f7e6` at `1d19fc9`; `visual_skipped=true`.
