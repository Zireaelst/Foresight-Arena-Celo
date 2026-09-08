# Foresight Arena — sözleşme katmanı

Foundry projesi. Bağımlılıklar (`forge-std`, OpenZeppelin v5.1.0) `lib/` altında
vendor'lanmış, git submodule yok — repo klonlandığı gibi derleniyor.

```bash
forge build
forge test                                        # 68 test, hepsi offline
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
| `src/testnet/TestnetUSDC.sol` | **Testnet vekili** — 6 decimal, açık faucet, EIP-3009 |
| `src/testnet/TestnetSortedOracles.sol` | **Testnet vekili** — `ISortedOracles`, sahibi yazıyor |

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

## Testnet'teki iki vekil, ve neden var

Celo Sepolia'da iki bağımlılık kırık, ikisi de demoyu imkânsız kılıyordu:

- **USDC mint edilemiyor.** `0x01C5…C44E` gerçek bir Circle FiatToken; `mint` herkes için
  `FiatToken: caller is not a minter` diyor. Kimsenin edinemediği bir stake token'ıyla
  "bağımsız insanlar katılabilir" iddiası boş olurdu. Yerine `TestnetUSDC`: 6 decimal
  (havuz başka bir şeyi reddediyor), alıcı başına saatte 50 tUSDC veren açık faucet, ve
  x402'nin "exact" şemasının settle ettiği **EIP-3009**.
- **Mento oracle 384 gün bayat.** `medianTimestamp(cUSD)` = 1755614497. Resolver bayat
  medyanı doğru şekilde reddediyor, yani her fiyat marketi void olurdu. Yerine
  `TestnetSortedOracles`: aynı arayüz, sahibi yazıyor, `reportedAt` = `block.timestamp`
  (bayatlık kontrolü gerçek kalıyor).

`Deploy.s.sol` bunu `block.chainid` ile zorluyor: ikisi de yalnızca Sepolia'da deploy
ediliyor. Mainnet'te havuz **gerçek USDC**'de settle ediyor ve fiyat resolver'ı doğrudan
**Mento'yu** okuyor.

`TestnetSortedOracles`'ın güven modeli gerçeğinden **daha kötü** — tek bir sahip fiyatı
yazıyor. Stake token'ının faucet oyuncağı olduğu bir ağda kabul edilebilir, başka hiçbir
yerde değil.

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

Deploy `deployments/<chainId>.json` yazıyor — agent katmanı ve panel adresleri oradan
okuyor, güncellenmesi hatırlanması gereken bir README'den değil.

Uçtan uca yerel deneme için `scripts/local-e2e.sh` (repo kökü) Celo Sepolia'yı forklayıp
tam turu koşuyor: deploy, **gerçek** ERC-8004 registry'lerine kayıt, market açma,
agent'ların pozisyon alması, settlement ve itibar yazımı. `script/LocalDemo.s.sol` daha
küçük bir anvil senaryosu, sadece yerel kullanım için.
