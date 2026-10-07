#!/usr/bin/env bash
set -euo pipefail
cd /home/master/DDEV/CondoProof
command -v solana-test-validator >/dev/null
command -v node >/dev/null
command -v npm >/dev/null
[ -s target/deploy/condoproof.so ] || { echo 'Run anchor build first' >&2; exit 1; }
[ -s target/idl/condoproof.json ] || { echo 'IDL missing; run anchor build first' >&2; exit 1; }

# Reserve a dedicated loopback RPC pair and faucet port; never reset or reuse a live ledger.
python3 <<'PORTS'
import socket
sockets = []
try:
    for port in (18899, 18900, 18901):
        s = socket.socket(); s.bind(('127.0.0.1', port)); sockets.append(s)
except OSError as error:
    raise SystemExit(f'Local test port is occupied: {error}; nothing started')
finally:
    for s in sockets: s.close()
PORTS

test_dir=$(mktemp -d "${TMPDIR:-/tmp}/condoproof-chain-test.XXXXXXXX")
validator_pid=''
cleanup() {
  if [ -n "$validator_pid" ]; then
    kill "$validator_pid" 2>/dev/null || true
    wait "$validator_pid" 2>/dev/null || true
  fi
  # Keep failed-run diagnostics; successful temporary runtime/ledger is removed.
  if [ "$1" -eq 0 ]; then
    rm -rf -- "$test_dir"
  else
    printf '\nTest failed; diagnostics retained at %s/validator.log\n' "$test_dir" >&2
    tail -45 "$test_dir/validator.log" 2>/dev/null >&2 || true
  fi
}
trap 'cleanup "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Installing isolated test SDK (repository dependencies unchanged)...\n'
npm install --prefix "$test_dir/sdk" --ignore-scripts --no-audit --no-fund --save-exact @solana/web3.js@1.98.4

solana-test-validator \
  --ledger "$test_dir/ledger" \
  --bind-address 127.0.0.1 \
  --rpc-port 18899 \
  --faucet-port 18901 \
  --bpf-program 3TmQGbKRSaTb1r9vabWwWPeMKEXT72AkuyDf4P2Li7gF target/deploy/condoproof.so \
  >"$test_dir/validator.log" 2>&1 &
validator_pid=$!

node --input-type=module <<'READY'
const deadline = Date.now() + 120000;
let healthy = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch('http://127.0.0.1:18899', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      signal: AbortSignal.timeout(1500),
    });
    if ((await response.json()).result === 'ok') { healthy = true; break; }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!healthy) throw new Error('Local validator did not become healthy within 120 seconds');
READY
kill -0 "$validator_pid"
CONDOPROOF_TEST_MODULE_ROOT="$test_dir/sdk" node scripts/solana-local-smoke.mjs
