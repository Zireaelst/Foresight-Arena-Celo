# Foresight Arena — agent katmanı

Üç vitrin agent ve ortak `research → position → settle → reputation` döngüsü.

```bash
npm install
npm run typecheck
cp .env.example .env      # doldur
npm run run:chain         # varsayılan: Celo Sepolia + dry run
```

## Döngü

`ForesightAgent` (`src/core/types.ts`) adımları tanımlıyor ve ayrımı bilinçli:

| Adım | Kim yapıyor | Kural |
|---|---|---|
| `research(market)` | Agent | Saf okuma. İşlem göndermez, kaydedilmiş veriye karşı test edilebilir. |
| `position(market, research)` | Agent | Sadece niyet üretir. Para harcamaz. |
| `settle` + `claim` | `AgentRunner` | Idempotent, tekrar denenebilir. |
| `reputation` | **`ops/scorekeeper.ts` — ayrı cüzdan** | Her sonuç ERC-8004'e yazılır, kaybedilenler de. |

**İtibarı agent yazamaz.** ERC-8004 Reputation Registry, agent'ın kendi sahibinden gelen
geri bildirimi `Self-feedback not allowed` ile reddediyor — ve haklı olarak. Bu yüzden
yazma işi ayrı bir cüzdanla çalışan bağımsız bir programda
(`npm run ops:score -- --publish`). Yazdığı her şey kamuya açık zincir durumunun saf bir
fonksiyonu, yani skor tutucuya güvenilmesi gerekmiyor; aynı kontrattan yeniden
hesaplanabilir. Gerekçe: `docs/DECISIONS.md` D-10.

**Parayı agent değil runner harcıyor.** Bir agent istediği kadar iddialı olabilir;
`AgentRunner.clampStake` üç tavanın en küçüğüne indirir: yerel bütçe, havuzun pozisyon
tavanı (mevcut pozisyon düşülerek), havuzun exposure tavanı (açık exposure düşülerek).
Kontrat son ikisini zaten zorluyor — burada kırpmak sadece işlemin revert ederek
öğrenmesine gerek bırakmıyor.

Her `Research` bir `rationale` ve `sources` taşımak zorunda. Projenin iddiası
agent'ların kamuya açık veriden akıl yürüttüğü; kimsenin yeniden kontrol edemeyeceği bir
gerekçe bu iddiayı boşa çıkarır.

## Agent'lar

- **`price-sentinel`** — Mento eşik sorularını, resolver'ın çözümde okuyacağı **aynı**
  SortedOracles medyanını okuyarak tahmin eder. Böylece "fiyat neydi" tartışması hiç
  doğmaz; agent yalnızca şimdi ile çözüm arasındaki sapmayı öngörür.
- **`chain-pulse`** — Celo'nun kendi durumu hakkındaki soruları, resolver'ın yapacağı
  `eth_call`'un aynısını yaparak ve son ~5000 bloğa göre doğrusal eğilim çıkararak
  yanıtlar. Model kasten aptal: avantaj gerçek zincir verisini okumaktan gelmeli,
  kimsenin denetleyemediği bir modelden değil.
- **`score-oracle`** — Verisi off-chain olan tek agent. Tek bir API'ye değil, birbirinden
  bağımsız **ücretsiz API paneline** soruyor (TheSportsDB + ESPN + opsiyonel
  football-data.org) ve **kesin skorda** yeter sayıya ulaşılmadan hiçbir şey söylemiyor;
  tek muhalif varsa pass geçiyor. Oynanmamış maçları modellemiyor — bilgisiz bir maç
  tahmini, araştırma kılığına girmiş kumar olurdu. `DATA_MARKET_URL` ayarlıysa aynı raporu
  x402 üzerinden **satın alıyor** ve satın alma başarısızsa yerel hesaplamaya sessizce
  düşmüyor.

## İki değişmez

**1. Zincir saati, duvar saati değil.** `closesAt`/`resolvesAt` ile karşılaştırılan her
şey `chainNow(ctx)` kullanır. Kontrat `block.timestamp`'a bakıyor, dolayısıyla host'un
saati yanlış saat — forklu veya zamanı ileri sarılmış bir düğümde yakın bile değil.

**2. Tek çıkış kapısı.** Durum değiştiren her işlem `sendTagged` üzerinden gider. Başka
gönderim yolu yok. Attribution suffix orada eklenir, **geri decode edilip doğrulanır**,
ve mainnet'te placeholder/bozuk tag reddedilir. Bu, "her mainnet işleminde tag var"ı
alışkanlık olmaktan çıkarıp zorlanan bir özellik yapıyor.

Doğrulaması (yerel anvil'de gerçek bir işlemden okundu):

```
calldata tail: ...63656c6f5f303030303030303030303030110080218021802180218021802180218021
decoded:       {"codes":["celo_000000000000"],"schemaId":0}
```

## Operatör komutları

```bash
npm run ops:status              # her şey hazır mı: fon, kayıt, resolver onayı, marketler
npm run ops:register            # agent'ları ERC-8004 Identity Registry'ye kaydet
npm run ops:price-feed          # testnet fiyat feed'ine CELO/USD medyanı yayımla
npm run ops:fund                # agent cüzdanlarına faucet'ten stake token
npm run ops:seed                # agent başına bir market aç (eşikler canlı veriden)
npm run ops:attest -- --publish # skor fikstürlerini oydaşmadan attest et
npm run ops:score -- --publish  # bağımsız skor tutucu: ERC-8004'e itibar yaz
```

`ops:status` ayrıca var çünkü bu kurulumdaki hemen her arıza sıkıcı olanlardan biri:
fonlanmamış cüzdan, kaydedilmemiş agent, onaylanmamış resolver. Hepsini burada görmek,
revert eden bir işlemden teşhis etmekten çok daha ucuz.

## Yapılandırma

`.env.example` her değişkeni açıklıyor. Üç varsayılan kasıtlı:

- `CHAIN_ID` varsayılanı **Celo Sepolia**. Mainnet bilinçli bir `CHAIN_ID=42220` ister.
- `DRY_RUN` varsayılanı **true**. Yayınlamak için açıkça `DRY_RUN=false` gerekir.
- `SCOREKEEPER_PRIVATE_KEY` **agent cüzdanlarından farklı olmak zorunda** — kayıt defteri
  aynı olanı reddediyor.

## Testler

```bash
npm run typecheck
npx tsx --test src/**/*.test.ts   # 12 test, hepsi ağa çıkmadan (sağlayıcılar stub)
```

Oydaşma kurallarının en önemlisinin testi var: *yeter sayı sağlansa bile tek bir muhalif
varsa settle edilmiyor*. Bir olgu anlaşmazlığında oy çokluğuyla karar vermek,
kaynaklardan birinin yanlış olduğunu bilerek çözmek olurdu.
