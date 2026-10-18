# RUNNER_SETUP.md — self-hosted GitHub Actions runner on Mac Studio

> Why: `staging-deploy.yml` (`runs-on: [self-hosted, macos, staging]`) only
> runs on a runner with all three labels. This file installs the runner,
> registers it with the `JamesZheng2026/witop-quote-ui` repo, and keeps it
> alive under launchd so it survives reboots and logouts.

Target host: **Mac Studio M2 Max (96 GB)**, user `james`.
Repo: `JamesZheng2026/witop-quote-ui`.
Runner labels: `self-hosted`, `macos`, `staging`.

---

## 0. Prerequisites

- `DOCKER_SETUP.md` completed; `docker info` works.
- `gh` is installed and authenticated:

  ```sh
  gh auth status
  # ✓ Logged in to github.com account JamesZheng2026
  ```

- A registration token (one-time, 1-hour TTL) from
  <https://github.com/JamesZheng2026/witop-quote-ui/settings/actions/runners/new>.
  We will fetch it with `gh` below.

---

## 1. Install the runner binary

```sh
mkdir -p ~/actions-runner && cd ~/actions-runner

# Latest stable for macOS arm64
curl -L -o actions-runner-osx-arm64-2.319.1.tar.gz \
  https://github.com/actions/runner/releases/download/v2.319.1/actions-runner-osx-arm64-2.319.1.tar.gz
# (Verify the .tar.gz checksum on the releases page if you are paranoid; SHA-256 is published next to each asset.)

tar xzf actions-runner-osx-arm64-2.319.1.tar.gz
rm actions-runner-osx-arm64-2.319.1.tar.gz
./config.sh --help | head -20   # sanity: binary launches
```

If `actions-runner-osx-x64-*` is needed (Intel Mac), use the matching tarball
from the same release page.

---

## 2. Register with the repo (one-time)

```sh
cd ~/actions-runner

# Fetch a short-lived registration token (valid 1 hour).
TOKEN=$(gh api -X POST \
  /repos/JamesZheng2026/witop-quote-ui/actions/runners/registration-token \
  --jq .token)

./config.sh \
  --unattended \
  --replace \
  --url https://github.com/JamesZheng2026/witop-quote-ui \
  --token "$TOKEN" \
  --name "mac-studio-staging-01" \
  --labels "self-hosted,macos,staging" \
  --work _work
```

Expected ending:

```
√ Connected to GitHub
√ Settings Saved.
√ Runner registered as mac-studio-staging-01
```

Verify in the GitHub UI:
<https://github.com/JamesZheng2026/witop-quote-ui/settings/actions/runners>
— the new runner should show **Idle** with the three labels.

---

## 3. Quick smoke (foreground)

```sh
cd ~/actions-runner
./run.sh
```

The terminal should print:

```
√ Connected to GitHub
Current runner version: 2.319.1
...
Listening for Jobs
```

Leave it running for a few minutes; if a `workflow_dispatch` is fired during
this window, the job should claim it. Stop with `Ctrl-C` once verified.

---

## 4. launchd registration (persistent)

The GitHub-supplied installer is the cleanest path; it drops a LaunchAgent:

```sh
cd ~/actions-runner
./svc.sh install james
./svc.sh start
./svc.sh status
```

Expected `status`:

```
status: Running
```

Equivalently:

```sh
launchctl list | grep actions.runner
# should show a PID line for org.JamesZheng2026.witop-quote-ui.mac-studio-staging-01
```

Logs:

- `~/actions-runner/_diag/Runner_*.log` (GitHub Actions runner)
- `~/Library/Logs/com.github.actions.RunnerHost.helper-service/*.log` (launchd)
- `~/actions-runner/svc.stderr.log` / `svc.stdout.log` (svc shim)

To remove later: `~/actions-runner/svc.sh uninstall && rm -rf ~/actions-runner`.

---

## 5. Verifying the label match

```sh
cd ~/actions-runner
./config.sh list
# or via the API:
gh api /repos/JamesZheng2026/witop-quote-ui/actions/runners --jq \
  '.runners[] | {name, status, labels: [.labels[].name]}'
```

Required labels: `self-hosted`, `macos`, `staging`.

---

## 6. Triggering a smoke job

After the runner is online and Docker is up:

1. Go to <https://github.com/JamesZheng2026/witop-quote-ui/actions/workflows/staging-deploy.yml>
2. `Run workflow` → branch `wt/t_phase5_v2` (PR #15) → `Run workflow`.
3. Watch the job: it should land on `mac-studio-staging-01`, pass Preflight,
   build the image, bring up the stack, hit `/healthz`, and tear down.

Expected logs:

- `Runner image: macos-15 ...`
- `SQL config OK: server=221.2.76.114 port=5001 db=Agent tds=7.0`
- `Image size: ... MB`
- `GET /healthz -> HTTP 200`
- `/healthz body contract satisfied: ok=true, source=sqlserver`
- `Stack torn down, throwaway config removed`

---

## 7. Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `Runner registration token is invalid` | Token expired (>1h) | Re-run the `gh api ... registration-token` step |
| `Cannot connect to the server: dial tcp ... i/o timeout` | macOS firewall or sleep proxy blocking outbound | System Settings → Network → Firewall → allow `Runner.Listener`; disable "Wake for network access" if causing churn |
| Job sits in `Queued` forever | Label mismatch | `./config.sh remove && ./config.sh --labels "self-hosted,macos,staging" ...` |
| `Cannot connect to the Docker daemon` during job | Docker Desktop not running | `open -a Docker`, wait for steady whale, retry dispatch |
| Runner disappears after reboot | svc.sh not installed | `~/actions-runner/svc.sh install james && ./svc.sh start` |
| `EACCES` on `_work` | Stale permissions from a prior registration | `rm -rf ~/actions-runner/_work && svc.sh restart` |

---

## 8. Removing the runner

```sh
cd ~/actions-runner
./svc.sh stop
./svc.sh uninstall
./config.sh remove --token "$(gh api -X POST \
  /repos/JamesZheng2026/witop-quote-ui/actions/runners/remove-token --jq .token)"
```

---

## 9. When you don't want the runner listening

If you only need an ad-hoc staging check, run the build directly on the host
without involving GitHub Actions:

```sh
cd /Users/james/witop-quote-ui/.worktrees/t_phase5_v2
docker build -t witop-staging:local .
docker compose --env-file .env.staging -p witop-staging up -d
sleep 6
curl -s http://127.0.0.1:8912/healthz
docker compose -p witop-staging down --remove-orphans
```

This bypasses the runner but produces the same artifacts and healthz evidence.
