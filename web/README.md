# Foresight Arena — panel

Next.js 15 (App Router) + wagmi + viem. Marketler, agent'ların gerekçeleri ve settlement
kaydı.

```bash
npm install
cp .env.local.example .env.local   # varsayılan: Celo Sepolia
npm run dev                        # http://localhost:3000
```

`.env.local` içindeki `NEXT_PUBLIC_RPC_URL`'i yerel fork'a (`127.0.0.1:8546`) yalnızca
`scripts/local-e2e.sh` çalışırken çevir. Panel her istekte market durumunu zincirden
okuyor — bu bilinçli bir tercih (ziyaretçinin gördüğü şey, staker'ın karşısına çıkacak
şey) ama bedeli şu: RPC ölüyse sayfa bayat veri göstermez, `ECONNREFUSED` ile 500 verir.
Fork kapandıktan sonra bu ayarı geri almayı unutmak, bu projede en kolay düşülen tuzak.

## İki tasarım kuralı

**1. Adres ve ABI elle yazılmıyor.** Adresler
`contracts/deployments/<chainId>.json`'dan okunuyor — o dosyayı deploy script'i üretiyor.
ABI'ler `npm run abis` ile Foundry çıktısından üretiliyor (`lib/abi.generated.ts`, elle
düzenlenmiyor). İkisi de aynı sebeple: elle kopyalanan bir adres, birileri güncellemeyi
unuttuğu ilk anda sessizce yanlış havuza işaret eder.

**2. Sayfa neyi gösteriyorsa zincirden okuyor.** Market listesi ve detayı
`force-dynamic`; bir marketin nasıl çözüleceği `IOutcomeResolver.describe()`'dan, agent
id'leri `ForesightPool.agentIdOf`'tan geliyor. Yani ziyaretçinin okuduğu kural, çözümü
gerçekten yapacak kontratın kendi anlattığı kural — panelin yanlış anlatabileceği bir
kopya değil.

## Sayfalar

| Yol | İş |
|---|---|
| `/` | Marketler: açık, settlement bekleyen, kapanmış. Havuz oranları ve toplam hacim. |
| `/market/[id]` | Pozisyon al, settle et, claim et. Resolver'ın kendi açıklaması + alınmış pozisyonların event günlüğü. |
| `/agents` | Üç agent: nasıl karar veriyor, neye güveniyor, **ne zaman pozisyon almayı reddediyor**. |
| `/how-it-works` | Pari-mutuel matematiği, void kuralları, tek güvenilen off-chain aktörün neden orada olduğu. |
| `/api/agents/[slug]/registration.json` | ERC-8004 `agentURI`'nin işaret ettiği kayıt belgesi. |

## Cüzdan

Yalnızca **injected** connector. WalletConnect barındırılmış bir proje id'si ister ve
ziyaretçi ile — tam olarak denetlenebilir olması gereken — bir kontrat çağrısı arasına
üçüncü bir taraf koyar. Bu panelin kimseden istediği şey için tarayıcı cüzdanı yeterli.

`wagmi/connectors` barrel'ı yerine `@wagmi/core`'dan import ediliyor: barrel Coinbase ve
Base connector'larını, dolayısıyla `@coinbase/cdp-sdk` ve opsiyonel `@x402/evm`'i client
bundle'a çekiyor ve build'i kırıyor.

## Testnet uyarısı

`NEXT_PUBLIC_CHAIN_ID` mainnet değilse başlıkta "Testnet — play money" etiketi ve ana
sayfada faucet kartı görünüyor. Testnet ile mainnet'te birebir aynı görünen bir panel,
birinin faucet token'ını değerli sanmasının yoludur.
