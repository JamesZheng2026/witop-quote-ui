# DOCKER_SETUP.md — Mac Studio (Witop staging runner host)

> Why: Phase 5 staging-deploy now runs on a self-hosted runner (see
> `.github/workflows/staging-deploy.yml` `runs-on: [self-hosted, macos, staging]`).
> The runner needs Docker so it can `docker build` and `docker compose up`.
> This file walks through installing Docker Desktop, enabling the engine, and
> proving the bridge to SQL Server 221.2.76.114:5001.

Target host: **Mac Studio M2 Max (96 GB)**, macOS 15.7.9, user `james`.
Target time: ~20 minutes (mostly download).

---

## 1. Install Docker Desktop

### 1.1 Download

```sh
# Apple Silicon (M2 Max)
brew install --cask docker
```

If `brew` is missing or you prefer the manual route, download
`Docker.dmg` (Apple Silicon) from
<https://www.docker.com/products/docker-desktop/> and double-click.

### 1.2 First launch

1. Open `Docker` from `/Applications`.
2. Accept the privileged helper prompt (touch ID / password).
3. Wait until the menu bar whale icon is steady (engine is up). First launch
   initializes the linux VM and can take 30–90 s.

### 1.3 Confirm the CLI works

```sh
docker --version            # >= 27.x
docker info | head -20      # should not error
docker compose version      # >= 2.30
```

Expected: no errors, `Server Version` reports a real engine, `Storage Driver`
is `desktop-linux` (Apple VirtIOFS) or `overlay2`.

---

## 2. Increase resource ceiling (recommended)

`Docker Desktop → Settings → Resources`:

- CPUs: 8 (or leave at default if your Mac is busy with other things)
- Memory: 8 GB (container image + pymssql wheels are ~400 MB)
- Disk: 60 GB
- Swap: 1 GB
- Virtual file system: VirtIOFS (default; faster on macOS 15)

Apply & restart. The whale will bounce once.

---

## 3. Bridge sanity check (TCP to SQL Server)

Before wiring the runner, prove that **the Mac can reach** the SQL host. This
catches VPN / firewall / DNS problems early.

```sh
nc -vz 221.2.76.114 5001
# expected: Connection to 221.2.76.114 port 5001 [tcp/*] succeeded!
```

If `nc` is missing:

```sh
nc -h 2>/dev/null || brew install netcat
```

If the connection **fails**:

- The Mac may be on a different network than the one that hosts the SQL
  Server. Check `scutil --dns` and `ifconfig en0`.
- A VPN may need to be on (or off) — confirm with the network admin.
- **Do not proceed to RUNNER_SETUP.md** until this passes; otherwise the
  workflow will fail at Preflight even with real secrets.

---

## 4. Smoke build (no runner yet)

Once Docker is healthy, do a one-off build to make sure the image builds and
runs end-to-end on this host:

```sh
cd /Users/james/witop-quote-ui/.worktrees/t_phase5_v2
# Build (load=true, no push, like CI)
docker build -t witop-staging:smoke .

# Generate throwaway config (we mirror CI; you can paste the real JSON below)
cat > /tmp/sqlserver_config.json <<'JSON'
{
  "server": "221.2.76.114",
  "port": 5001,
  "user": "agent_agent",
  "password": "Agent@2026!",
  "database": "Agent",
  "tds_version": "7.0"
}
JSON
chmod 600 /tmp/sqlserver_config.json

# Run a one-shot container with the bridge
docker run --rm -p 8765:8765 \
  -e SQLSERVER_CONFIG=/run/secrets/sqlserver_config.json \
  -e SQLSERVER_PYTHON=/usr/local/bin/python3 \
  -v /tmp/sqlserver_config.json:/run/secrets/sqlserver_config.json:ro \
  witop-staging:smoke &
APP_PID=$!
sleep 6
curl -s http://127.0.0.1:8765/healthz | head -c 200
echo
kill $APP_PID 2>/dev/null || true
```

Expected body shape:

```json
{"ok":true,"source":"sqlserver","ts":"2026-..."}
```

If `source` is not `sqlserver` or `ok` is `false`, the bridge is failing; the
container logs will show why (look for `SQL_CONNECT_FAILED` / `SQL_DRIVER_MISSING`
/ `SQL_MAPPING_REQUIRED`).

---

## 5. Cleanup

```sh
docker image prune -f
docker builder prune -f  # optional; safe
```

---

## 6. Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `docker: command not found` | Docker app not launched yet | Open `Docker.app`, wait for steady whale |
| `Cannot connect to the Docker daemon` | Engine not running | Whale still animating; wait or `Docker → Troubleshoot → Restart` |
| `image buildx error: failed to solve` | Apple VirtIOFS race | `Settings → Resources → Use containerized filesystem` off, or upgrade to 4.34+ |
| `permission denied /var/run/docker.sock` | File ownership 0660 root:docker | `sudo chown $USER:docker /var/run/docker.sock` (rare on macOS) |
| `nc: connectx: Operation timed out` | LAN/VPN not reaching 221.2.76.114 | See section 3 — fix the network before continuing |

---

## 7. Next

Continue with `RUNNER_SETUP.md` to install and launchd-register the
self-hosted GitHub Actions runner so `workflow_dispatch` can pick jobs up.
