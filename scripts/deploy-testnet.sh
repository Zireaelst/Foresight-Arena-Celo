#!/usr/bin/env bash
#
# Deploys the arena to Celo Sepolia and brings it to life: contracts, ERC-8004
# registrations, a published price, funded agents, and one market per agent.
#
# Testnet only, by design. The project guardrail is that logic is proven with no real
# money at stake first, so this script refuses to touch mainnet -- a mainnet run is a
# deliberate, separate act that also requires the security review (D-08) to be closed.
#
#   scripts/deploy-testnet.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/agents/.env"
RPC="${CELO_TESTNET_RPC_URL:-https://forno.celo-sepolia.celo-testnet.org}"
CHAIN_ID=11142220

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
env_get() { grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

env_set() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    python3 - "$ENV_FILE" "$key" "$value" <<'PY'
import io,sys
path,key,value=sys.argv[1:4]
lines=io.open(path,encoding='utf-8').read().split('\n')
io.open(path,'w',encoding='utf-8').write(
    '\n'.join(f'{key}={value}' if l.split('=')[0]==key else l for l in lines))
PY
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE. Copy agents/.env.example and fill it in."; exit 1; }

step "checking that the wallets can pay for gas"
UNFUNDED=0
for role in DEPLOYER SCOREKEEPER PRICE_SENTINEL CHAIN_PULSE SCORE_ORACLE; do
  key="$(env_get "${role}_PRIVATE_KEY")"
  [ -n "$key" ] || { echo "  ${role}_PRIVATE_KEY is not set"; exit 1; }
  addr="$(cast wallet address --private-key "$key")"
  bal="$(cast balance "$addr" --rpc-url "$RPC")"
  printf '  %-15s %s  %s CELO\n' "$role" "$addr" "$(cast from-wei "$bal")"
  [ "$bal" = "0" ] && UNFUNDED=1
done

if [ "$UNFUNDED" = "1" ]; then
  cat <<'MSG'

Some wallets hold no CELO, so their transactions cannot be paid for.
Fund them at https://faucet.celo.org (choose Celo Sepolia) and run this again.
The deployer needs the most; the agents need only a little.
MSG
  exit 1
fi

step "deploying contracts to Celo Sepolia"
(cd "$ROOT/contracts" && CELO_TESTNET_RPC_URL="$RPC" forge script script/Deploy.s.sol \
  --rpc-url "$RPC" --broadcast --private-key "$(env_get DEPLOYER_PRIVATE_KEY)" \
  | grep -E "TestnetUSDC|TestnetSortedOracles|ForesightPool |Resolver |wrote")

python3 - "$ROOT" "$CHAIN_ID" <<'PY'
import io,json,sys
root,chain=sys.argv[1],sys.argv[2]
d=json.load(io.open(f'{root}/contracts/deployments/{chain}.json'))
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
seen=set(); out=[]
for line in lines:
    k=line.split('=')[0]
    if k in mapping: out.append(f'{k}={mapping[k]}'); seen.add(k)
    else: out.append(line)
out += [f'{k}={v}' for k,v in mapping.items() if k not in seen]
io.open(env,'w',encoding='utf-8').write('\n'.join(out))
print('  addresses written to agents/.env')
PY
env_set RPC_URL "$RPC"
env_set CHAIN_ID "$CHAIN_ID"

step "registering the agents in the ERC-8004 Identity Registry"
(cd "$ROOT/agents" && npm run --silent ops:register) | tee /tmp/register-testnet.log
while read -r line; do
  [ -n "$line" ] && env_set "${line%%=*}" "${line#*=}"
done < <(grep -E "_AGENT_ID=" /tmp/register-testnet.log)

step "publishing a CELO/USD rate to the testnet price feed"
(cd "$ROOT/agents" && npm run --silent ops:price-feed)

step "funding the agents with stake tokens"
(cd "$ROOT/agents" && npm run --silent ops:fund)

step "opening one market per agent"
(cd "$ROOT/agents" && npm run --silent ops:seed)

step "state"
(cd "$ROOT/agents" && npm run --silent ops:status)

cat <<MSG

Deployed to Celo Sepolia.

Next:
  cd agents && DRY_RUN=false npm run run:all    # agents research and take positions
  cd agents && npm run ops:attest -- --publish  # attest score fixtures once matches end
  cd agents && npm run ops:score -- --publish   # publish the record to ERC-8004
  cd web && npm run dev                         # the dashboard

Remember: attribution tags are still the placeholder. Register at celobuilders.xyz and set
ATTRIBUTION_TAG before any mainnet transaction -- untagged mainnet activity scores nothing.
MSG
