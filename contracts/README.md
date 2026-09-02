# Foresight Arena — sözleşme katmanı

Foundry projesi. Bağımlılıklar (`forge-std`, OpenZeppelin v5.1.0) `lib/` altında
vendor'lanmış, git submodule yok — repo klonlandığı gibi derleniyor.

```bash
forge build
forge test                                        # 53 test, hepsi offline
CELO_RPC_URL=https://forno.celo.org forge test --match-contract MentoFork -vv
```

## Ne var

| Dosya | İş |
|---|---|
| `src/ForesightPool.sol` | Pari-mutuel havuz, sembolik limitler, ödeme |
| `src/interfaces/IOutcomeResolver.sol` | Çözüm arayüzü + `Outcome` enum'u |
| `src/resolvers/MentoPriceResolver.sol` | Fiyat Nöbetçisi — Mento SortedOracles |
| `src/resolvers/ChainMetricResolver.sol` | Zincir Nabzı — gas-kapalı `staticcall` |
| `src/resolvers/AttestedScoreResolver.sol` | Skor Kahini — tek-yazımlık attestation |
| `src/config/CeloAddresses.sol` | Ağ adresleri, hepsi zincirden doğrulanmış |

## Ödeme matematiği

Kazanan taraftaki her stake, kaybeden havuzdan payı oranında alır:

```
payout = stake × (yesPool + noPool) / winningPool
```

Ev yok, komisyon yok, maker/taker yok — kontrat saf bir yeniden dağıtım kasası. Stake
edilen neyse dağıtılabilecek olan o. Bölme aşağı yuvarlıyor; artan toz kontratta kalıyor
(son claim eden kişinin transferi yuvarlama yüzünden patlamasın diye). Fuzz testi
`testFuzz_payoutsNeverExceedStakes` bu iki özelliği birlikte doğruluyor.

**Tek taraflı kitap `Void` olur.** Kimse karşı tarafı almadıysa dağıtılacak karşı taraf
riski de yoktur; tek başına gelen kişiye bedava "kazanç" vermek yerine herkes iade alır.

## Adresleri yeniden doğrulama

```bash
REG=0x000000000000000000000000000000000000ce10
cast call $REG "getAddressForString(string)(address)" "SortedOracles" --rpc-url https://forno.celo.org
cast call 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 "name()(string)" --rpc-url https://forno.celo.org
```

## Deploy

Önce testnet — proje guardrail'i:

```bash
export CELO_TESTNET_RPC_URL=https://forno.celo-sepolia.celo-testnet.org
forge script script/Deploy.s.sol --rpc-url celo_sepolia --broadcast --private-key $DEPLOYER_PRIVATE_KEY
```

Mainnet aynı komut, `--rpc-url celo` ile. **Çalıştırmadan önce D-08 (güvenlik incelemesi)
kapanmış olmalı.**

Uçtan uca yerel deneme için `script/LocalDemo.s.sol` bir anvil düğümüne tam bir arena
kuruyor (mock USDC dahil). Sadece yerel kullanım için.
