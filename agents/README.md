# Foresight Arena — agent katmanı

Üç vitrin agent ve ortak `research → position → settle → reputation` döngüsü.

```bash
npm install
npm run typecheck
cp .env.example .env      # doldur
npm run run:chain         # varsayılan: Celo Sepolia + dry run
```

## Döngü

`ForesightAgent` (`src/core/types.ts`) dört adım tanımlıyor ve ayrımı bilinçli:

| Adım | Kim yapıyor | Kural |
|---|---|---|
| `research(market)` | Agent | Saf okuma. İşlem göndermez, kaydedilmiş veriye karşı test edilebilir. |
| `position(market, research)` | Agent | Sadece niyet üretir. Para harcamaz. |
| `settle` + `claim` | `AgentRunner` | Idempotent, tekrar denenebilir. |
| `reputation` | `AgentRunner` | Her sonuç ERC-8004'e yazılır — kaybedilenler de. |

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
- **`score-oracle`** — Verisi off-chain olan tek agent. Sağlayıcı seçilmedi (D-07), bu
  yüzden `NullScoreFeed` ile çalışıyor ve her markete pass geçiyor. Oynanmamış maçları
  modellemiyor; yalnızca bitmiş maçları kaynak URL'i ile birlikte raporluyor.

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

## Yapılandırma

`.env.example` her değişkeni açıklıyor. İki varsayılan kasıtlı:

- `CHAIN_ID` varsayılanı **Celo Sepolia**. Mainnet bilinçli bir `CHAIN_ID=42220` ister.
- `DRY_RUN` varsayılanı **true**. Yayınlamak için açıkça `DRY_RUN=false` gerekir.
