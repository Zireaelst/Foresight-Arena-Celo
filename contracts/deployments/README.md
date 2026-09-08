# Deployment records

`scripts/deploy-testnet.sh` (and `forge script script/Deploy.s.sol`) writes
`<chainId>.json` here. The agent layer and the dashboard read their addresses from these
files rather than from environment variables or a README, so a deployment cannot be
described by anything other than itself.

`*.json` is gitignored while the only records produced come from a local anvil fork:
anvil's addresses are deterministic and indistinguishable from real ones, so committing
them would advertise a deployment that does not exist. Once the arena is live on a real
network, commit that network's file — the dashboard needs it to render.
