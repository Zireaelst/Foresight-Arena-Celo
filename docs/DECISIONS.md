# Kararlar — Foresight Arena

CLAUDE.md'deki "Açık kararlar" listesinin kaynağı bu dosya. Her karar bir kez burada
sabitlenir; kodda bir sabit varsa hangi dosyada olduğu da yazılır.

Son güncelleme: 2026-09-03 (Faz 1 sonu)

---

## Kilitlenen kararlar

### D-01 — Stake token'ı USDC (6 decimals)

Celo mainnet `0xcebA9300f2b948710d2653dD7B07f33A8B32118C`, Celo Sepolia
`0x01C5C0122039549AD1493B8220cABEdD739BC44E`.

**Neden:** Tek token üç işi birden görüyor — havuzda stake, fee abstraction ile gas, ve
x402 üzerinden veri satın alma. Celo'nun x402 facilitator'ı zaten USDC settle ediyor,
yani ikinci bir token tutmaya gerek kalmıyor.

**Bedeli:** 6 decimal. Kontrat bunu varsayıyor ve constructor'da `decimals() != 6` ise
deploy'u reddediyor (`ForesightPool.UnexpectedDecimals`) — sembolik limit sabitleri
6-decimal biriminde yazıldığı için yanlış token'la deploy edilmesi sessizce limitleri
10^12 katına çıkarırdı.

### D-02 — Sembolik bakiye limitleri

| Limit | Değer | Nerede |
|---|---|---|
| Tek pozisyon (hesap × market × taraf) | 1.00 USDC | `ForesightPool.MAX_STAKE_PER_POSITION` |
| Agent açık pozisyon toplamı | 10.00 USDC | `ForesightPool.MAX_OPEN_EXPOSURE_AGENT` |
| İnsan açık pozisyon toplamı | 5.00 USDC | `ForesightPool.MAX_OPEN_EXPOSURE_HUMAN` |

**Neden bu üçlü:** "Forecasting competition" konumlaması için yeterince sembolik, ama
Track 1 (Value Moved) için ölçülebilir hacim üretecek kadar da gerçek.

**Neden zincir üstünde:** Limit sadece agent kodunda olsaydı, insan katılımı açıldığında
(Faz 5) hiçbir şey ifade etmezdi. Kontrat "açık exposure"ı — stake edilmiş ve henüz
claim edilmemiş toplam — hesap başına takip ediyor; claim exposure'ı geri açıyor, yani
sermaye döner ama aynı anda risk altındaki miktar tavanı geçmez.

**Agent / insan ayrımı:** `agentIdOf[wallet] != 0` olan cüzdan agent kademesinde. Bu id
ERC-8004 Identity Registry token id'si, yani "agent" iddiası zincir üstünde bir kayda
dayanıyor.

### D-03 — Pazar oluşturma yetkisi: ekip + kayıtlı agent'lar

`ForesightPool.createMarket` çağrısını `owner()` veya `agentIdOf[msg.sender] != 0` olan
bir cüzdan yapabilir.

**Neden tam açık değil:** v1 guardrail'i "yalnızca nesnel, veri-beslemeli sorular". Soru
metnini kod denetleyemez — ama **resolver'ı** denetleyebilir. Her market onaylı bir
resolver'a (`isApprovedResolver`) bağlanmak zorunda, yani agent'lar soruyu özgürce
seçiyor ama çözüm mantığı her zaman ekibin incelediği bir sözleşme. Öznel soru için
resolver yok, dolayısıyla öznel market de açılamıyor.

**Neden tamamen kapalı da değil:** Agent'ların kendi sorularını açması Track 4'ün
hikâyesi. Kapalı tutmak vitrin agent'ları birer script'e indirgerdi.

### D-04 — Fiyat feed'i: Mento SortedOracles (on-chain)

Mainnet `0xefB84935239dAcdecF7c5bA76d8dE40b077B7b33`, Sepolia
`0xAb077999e5fA13bCda1599926F8927dDEADe533C` (ikisi de Celo Registry'den
`getAddressForString("SortedOracles")` ile okundu).

**Neden:** Celo'nun kendi protokol oracle'ı; harici bağımlılık, API anahtarı veya imza
şeması yok. Agent ile resolver **aynı** medyanı okuyor, dolayısıyla "fiyat neydi"
tartışması hiç doğmuyor.

**İki dürüst kısıt:**
1. **Kapsam.** Mento çiftleriyle sınırlı (CELO/cUSD vb.). "BTC $100k olacak mı" bu
   feed'le sorulamaz. Vitrin demosu Celo-yerli çiftlerle kurulmalı.
2. **Zamanlama.** SortedOracles anlık medyanı verir, tarihsel snapshot vermez. Market
   `resolve()` ilk çağrıldığı andaki medyana göre çözülür. Bu yüzden sorular
   "**çözüm anında**" diye yazılmalı, "tam 12:00 UTC'de" diye değil.

Resolver bayat medyanı reddediyor (`maxStaleness`, market başına ayarlanır) ve
raportör yoksa `Void` dönüyor — kimsenin arkasında durmadığı bir sayıyla gerçek para
dağıtmaktansa iade etmek doğru davranış.

### D-05 — Çözüm mimarisi: resolver sözleşmeleri, hakem yok

`IOutcomeResolver` arayüzü: `resolve(bytes config) view returns (Outcome)`. Üç uygulama:

| Agent | Resolver | Güven modeli |
|---|---|---|
| Fiyat Nöbetçisi | `MentoPriceResolver` | Tamamen on-chain, güvensiz |
| Zincir Nabzı | `ChainMetricResolver` | Tamamen on-chain, güvensiz |
| Skor Kahini | `AttestedScoreResolver` | **Adı konmuş bir attestor'a güvenir** |

**Skor Kahini hakkında dürüst olmak gerekiyor:** Spor sonucunun on-chain kaynağı yok, bu
yüzden projedeki tek güvenilen off-chain aktör burada. Attestor *hakem değil* — hüküm
vermiyor, kamuya açık bir skoru zincire geçiriyor ve okuduğu payload'ın hash'ini +
kaynak URI'sini birlikte yayımlamak zorunda, yani herkes aynı API'den kontrol edebilir.
Yazım **event başına tek seferlik**: stake'ler yerleştikten sonra geçmişi
değiştirebilen bir attestor hakem olurdu. Bu resolver'ı kullanan marketlerin metni bunu
açıkça söylemeli.

**Ortak tasarım kuralı:** Resolver karar veremiyorsa `Void` döner ve herkes iade alır.
Bozuk bir veri kaynağı marketi dondurmaz.

### D-06 — Attribution tag zorlaması kod düzeyinde

Her state-değiştiren işlem `agents/src/core/chain.ts` içindeki tek `sendTagged`
fonksiyonundan geçer. Başka gönderim yolu yok. Fonksiyon:

- ERC-8021 suffix'ini calldata'ya ekler (`@celo/attribution-tags@0.3.0`, `toDataSuffix`),
- suffix'i **geri decode edip** doğrular, sonra broadcast eder,
- mainnet'te placeholder veya bozuk tag ile çalışmayı reddeder (`assertTagIsRealForMainnet`).

**Neden regex doğrulaması ayrıca var:** `toDataSuffix` tag formatını doğrulamıyor —
`toDataSuffix('nope')` sorunsuz encode ediyor (test edildi). Yani "tag var" ile "tag
geçerli" farklı şeyler; leaderboard ikincisine bakıyor.

Placeholder: `celo_000000000000`. Gerçek tag celobuilders kaydında dönüyor ve GitHub
`owner/repo` slug'ından türetilip ilk kayıtta kilitleniyor.

---

## Hâlâ açık

### D-07 — Spor verisi API'si

Skor Kahini şu an `ScoreFeed` arayüzü arkasında `NullScoreFeed` ile çalışıyor: her
fixture için "bilmiyorum" döner, agent de her markete pass geçer. Sağlayıcı seçilince
tek bir adapter yazmak yeterli (`agents/src/agents/score-oracle/feed.ts`).

Aranan: ücretsiz kademe, makul rate limit, fixture id'si stabil, sonuç URL'i insanın
açıp doğrulayabileceği bir sayfa.

### D-08 — Sözleşme güvenlik incelemesi: kim, ne zaman

Guardrail: gerçek parayla ilgili hiçbir kontrat, ekipten en az bir kişi kodu
incelemeden mainnet'e çıkmayacak. Faz 5 (8–10 Eyl) mainnet geçişi, yani inceleme ondan
**önce** bitmeli. İnceleyecek kişi ve tarih henüz belli değil.

Mevcut durum: 53 test geçiyor (fuzz dahil), sıfır derleyici uyarısı. Test kapsamı
inceleme yerine geçmez.

### D-09 — Reviewer-agent görev sahibi (AskBots, Track 3)

Hangi ekip üyesi/agent, hangi projeleri inceleyecek — kararlaştırılmadı.

---

## Faz 1'de düzeltilen yanlış varsayımlar

Bunlar CLAUDE.md yazıldığında doğruydu ya da öyle sanılıyordu; Faz 1'de kaynağından
doğrulanıp düzeltildi.

| Konu | CLAUDE.md'de | Gerçek |
|---|---|---|
| Testnet | Alfajores | **Celo Sepolia** (11142220). ERC-8004 registry'leri ve x402 facilitator Alfajores'te yok. `.mcp.json` buna göre düzeltildi. |
| x402 paketleri | `x402-fetch`, `x402-express` | `@x402/express` + `@x402/core` + `@x402/evm` |
| x402 ücreti | gas-at-cost + %0.3 | Protokol ücreti yok; settlement başına $0.001 kredi + gas |
| x402 facilitator | — | `https://api.x402.celo.org`, `X402_API_KEY` gerekiyor |
| Self docs URL | `docs.self.xyz/contract-integration/basic-integration` | 404. Hub adresleri: mainnet `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF`, testnet `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |
| USDC adresi | `0xcEBA...` | Checksum hatalı; doğrusu `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` (solc reddediyor) |

Doğrulama komutları `contracts/src/config/CeloAddresses.sol` başındaki notta.
