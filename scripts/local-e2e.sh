#!/usr/bin/env bash
#
# Full local run: fork Celo Sepolia, deploy, register the agents, open markets, let the
# agents trade, settle, and publish the record.
#
# The point of having this as one script is that every claim the README makes can be
# re-checked from a clean state in a couple of minutes, against the real ERC-8004
# registries (the fork keeps them) and the real score APIs.
#
#   scripts/local-e2e.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC="${LOCAL_RPC:-http://127.0.0.1:8546}"
PORT="${LOCAL_PORT:-8546}"
UPSTREAM="${CELO_TESTNET_RPC_URL:-https://forno.celo-sepolia.celo-testnet.org}"
ENV_FILE="$ROOT/agents/.env"

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
env_get() { grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

env_set() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    python3 - "$ENV_FILE" "$key" "$value" <<'PY'
import io,sys
path,key,value=sys.argv[1],sys.argv[2],sys.argv[3]
lines=io.open(path,encoding='utf-8').read().split('\n')
out=[f'{key}={value}' if l.split('=')[0]==key else l for l in lines]
io.open(path,'w',encoding='utf-8').write('\n'.join(out))
PY
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

step "starting an anvil fork of Celo Sepolia"
# Forking, not a bare chain: the ERC-8004 registries live on Sepolia and this project
# registers against the real ones rather than mocks.
if lsof -ti:"$PORT" >/dev/null 2>&1; then kill "$(lsof -ti:"$PORT")"; sleep 2; fi
anvil --fork-url "$UPSTREAM" --port "$PORT" --silent > /tmp/anvil-e2e.log 2>&1 &
for _ in $(seq 1 40); do
  cast block-number --rpc-url "$RPC" >/dev/null 2>&1 && break
  sleep 1
done
echo "forked at block $(cast block-number --rpc-url "$RPC")"

step "funding the project wallets from anvil's faucet account"
RICH=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
for key in DEPLOYER SCOREKEEPER PRICE_SENTINEL CHAIN_PULSE SCORE_ORACLE; do
  addr=$(cast wallet address --private-key "$(env_get "${key}_PRIVATE_KEY")")
  cast send "$addr" --value 2ether --private-key "$RICH" --rpc-url "$RPC" >/dev/null
  echo "  ${key}=${addr}"
done

step "deploying the contract layer"
(cd "$ROOT/contracts" && forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast \
  --private-key "$(env_get DEPLOYER_PRIVATE_KEY)" >/tmp/deploy-e2e.log 2>&1) \
  || { tail -20 /tmp/deploy-e2e.log; exit 1; }
grep -E "TestnetUSDC|TestnetSortedOracles|ForesightPool |Resolver " /tmp/deploy-e2e.log | sed 's/^ */  /'

python3 - "$ROOT" <<'PY'
import io,json,sys
root=sys.argv[1]
d=json.load(io.open(f'{root}/contracts/deployments/11142220.json'))
env=f'{root}/agents/.env'
mapping={
 'FORESIGHT_POOL_ADDRESS':d['foresightPool'],
 'MENTO_PRICE_RESOLVER_ADDRESS':d['mentoPriceResolver'],
 'CHAIN_METRIC_RESOLVER_ADDRESS':d['chainMetricResolver'],
 'ATTESTED_SCORE_RESOLVER_ADDRESS':d['attestedScoreResolver'],
 'TESTNET_PRICE_FEED_ADDRESS':d['priceFeed'],
 'STAKE_TOKEN_ADDRESS':d['stakeToken'],
}
lines=io.open(env,encoding='utf-8').read().split('\n')
seen=set()
out=[]
for line in lines:
    key=line.split('=')[0]
    if key in mapping:
        out.append(f'{key}={mapping[key]}'); seen.add(key)
    else:
        out.append(line)
for key,value in mapping.items():
    if key not in seen: out.append(f'{key}={value}')
io.open(env,'w',encoding='utf-8').write('\n'.join(out))
PY
env_set RPC_URL "$RPC"

step "registering the agents in the real ERC-8004 Identity Registry"
(cd "$ROOT/agents" && npm run --silent ops:register) | tee /tmp/register-e2e.log
while read -r line; do
  [ -n "$line" ] && env_set "${line%%=*}" "${line#*=}"
done < <(grep -E "_AGENT_ID=" /tmp/register-e2e.log)

step "publishing a CELO/USD rate to the testnet price feed"
(cd "$ROOT/agents" && npm run --silent ops:price-feed)

step "giving the agents stake tokens"
(cd "$ROOT/agents" && npm run --silent ops:fund)

step "opening one market per agent"
(cd "$ROOT/agents" && npm run --silent ops:seed)

step "agents research and take positions"
(cd "$ROOT/agents" && DRY_RUN=false npm run --silent run:all) 2>&1 | grep -E "^\[|stake |rationale" | head -40

step "taking the other side, so the books are not one-sided"
POOL=$(env_get FORESIGHT_POOL_ADDRESS)
TOKEN=$(env_get STAKE_TOKEN_ADDRESS)
DK=$(env_get DEPLOYER_PRIVATE_KEY)
DEPLOYER=$(cast wallet address --private-key "$DK")
cast send "$TOKEN" "faucet(address)" "$DEPLOYER" --private-key "$DK" --rpc-url "$RPC" >/dev/null
COUNT=$(cast call "$POOL" "marketCount()(uint256)" --rpc-url "$RPC" | awk '{print $1}')
cast send "$TOKEN" "approve(address,uint256)" "$POOL" 10000000 --private-key "$DK" --rpc-url "$RPC" >/dev/null
for id in $(seq 0 $((COUNT-1))); do
  yes=$(cast call "$POOL" "getMarket(uint256)((address,address,uint64,uint64,uint8,uint128,uint128,string,bytes))" "$id" --rpc-url "$RPC" | tr ',' '\n' | sed -n '6p' | tr -dc '0-9')
  # Take whichever side the agents left empty.
  side=$([ "${yes:-0}" = "0" ] && echo 1 || echo 0)
  cast send "$POOL" "stake(uint256,uint8,uint256)" "$id" "$side" 1000000 --private-key "$DK" --rpc-url "$RPC" >/dev/null \
    && echo "  market $id: took side $side"
done

step "attesting the score fixtures from multi-source consensus"
(cd "$ROOT/agents" && npm run --silent ops:attest -- --publish) 2>&1 | grep -E "=>|attested in|no consensus" | sed 's/^/  /'

step "advancing the chain past settlement time"
cast rpc evm_increaseTime 2000 --rpc-url "$RPC" >/dev/null
cast rpc evm_mine --rpc-url "$RPC" >/dev/null

step "agents settle and claim"
(cd "$ROOT/agents" && DRY_RUN=false npm run --silent run:all) 2>&1 | grep -E "resolving|claiming" | sed 's/^/  /'

step "the independent scorekeeper publishes the record to ERC-8004"
(cd "$ROOT/agents" && npm run --silent ops:score -- --publish) 2>&1 | grep -E "score|wrote" | sed 's/^/  /'

step "final state"
(cd "$ROOT/agents" && npm run --silent ops:status)

cat <<MSG

Done. The arena is live on the local fork.

  dashboard    cd web && npm run dev      (with web/.env.local pointing at $RPC)
  data market  cd services/data-market && npm start
  anvil log    /tmp/anvil-e2e.log
MSG
