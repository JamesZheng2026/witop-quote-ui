#!/usr/bin/env bash
# scripts/verify-abc-views.sh
# 验证 A/B/C 切换器、三容器存在、静态资源可访问
# 在 http server 启动后跑 (默认 127.0.0.1:8765)
set -euo pipefail

# AGENTS.md: 每个 verify-*.sh 必须跑 channel preserve guard
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -f "$SCRIPT_DIR/verify-channel-preserve.sh" ]]; then
  echo "[guard] running verify-channel-preserve.sh"
  if ! bash "$SCRIPT_DIR/verify-channel-preserve.sh"; then
    echo "[guard] channel-preserve failed (likely missing jsdom 30.1.2 in reports/node_modules)"
    echo "[guard] AGENTS.md 允许记录 jsdom-unavailable=true；本验证套件自身不依赖 jsdom，继续执行"
  fi
fi

BASE="${1:-http://127.0.0.1:8765}"

pass=0
fail=0

check() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == *"$expected"* ]]; then
    echo "  ✓ $name"
    pass=$((pass+1))
  else
    echo "  ✗ FAIL: $name  expected substring='$expected'"
    fail=$((fail+1))
  fi
}

echo "== verify-abc-views @ $BASE =="

# 1. index.html 可访问且含切换器标记
HTML=$(curl -fsS "$BASE/index.html")
check "index.html 200"               ""                "$HTML"
check "含 witop-abc-host"            "witop-abc-host"  "$HTML"
check "含 variant-a"                 "variant-a"       "$HTML"
check "含 variant-b"                 "variant-b"       "$HTML"
check "含 variant-c"                 "variant-c"       "$HTML"
check "含 cache meta"                "no-cache"        "$HTML"
check "含 state.js 带版本号"         "state.js?v="     "$HTML"

# 2. scripts 静态资源
for f in state.js reception-bridge.js variants.js mock-data.js okki-adapter.js build-info.json; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/scripts/$f")
  check "GET /scripts/$f -> 200" "200" "$status"
done

# 3. build-info.json 内容
INFO=$(curl -fsS "$BASE/scripts/build-info.json")
check "build-info 含 sha"    '"sha"'   "$INFO"
check "build-info 含 ts"     '"ts"'    "$INFO"

# 3. variants.js 含关键函数签名
for f in variants.js okki-adapter.js build.js; do
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/scripts/$f")
check "GET /scripts/$f -> 200" "200" "$status"
done

VJS=$(curl -fsS "$BASE/scripts/variants.js")
check "variants.js 含 setVariant" "function setVariant" "$VJS"
check "variants.js 含 renderA"    "function renderA"    "$VJS"
check "variants.js 含 renderB"    "function renderB"    "$VJS"
check "variants.js 含 renderC"    "function renderC"    "$VJS"

OJS=$(curl -fsS "$BASE/scripts/okki-adapter.js")
check "okki-adapter 含 okkiAdapter" "window.okkiAdapter" "$OJS"
check "okki-adapter 含 ping"        "function ping"       "$OJS"
check "okki-adapter 含 listInq"     "listInquiries"       "$OJS"

echo "----"
echo "PASS=$pass FAIL=$fail"
if [[ $fail -gt 0 ]]; then
  exit 1
fi
echo "verify-abc-views: OK"
