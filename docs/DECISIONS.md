# Kararlar — Foresight Arena

CLAUDE.md'deki "Açık kararlar" listesinin kaynağı bu dosya. Her karar bir kez burada
sabitlenir; kodda bir sabit varsa hangi dosyada olduğu da yazılır.

Son güncelleme: 2026-09-08 (Faz 3–5: frontend, x402, testnet)

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

### D-07 — Spor verisi: tek API değil, bağımsız kaynaklardan **oydaşma** ✅

`ScoreConsensus` (`agents/src/agents/score-oracle/consensus.ts`) birbirinden bağımsız,
ücretsiz ve anahtarsız üç kaynağa soruyor ve **hepsi aynı kesin skoru** bildirmeden hiçbir
şey yayımlamıyor:

| Sağlayıcı | Anahtar | Neden panelde |
|---|---|---|
| TheSportsDB | gerekmiyor | Hesap açmadan sorgulanabiliyor — yani bizi denetlemek isteyen de sorgulayabilir |
| ESPN site API | gerekmiyor | Diğerlerinden bağımsız bir editoryal operasyon |
| football-data.org | `FOOTBALL_DATA_TOKEN` (opsiyonel) | Üçüncü bir bağımsız görüş; **kritik yolda değil** |

**Neden tek sağlayıcı seçmedik:** Tek API seçmek, o API'nin işletmecisini her spor
marketinin arkasındaki sessiz otorite yapardı — projenin geri kalanının kaçınmak için
uğraştığı güvenilen üçüncü taraf tam olarak bu. Bu, güveni ortadan kaldırmıyor; **hata
modunu** değiştiriyor: tek bir işletmecinin hatası artık *yanlış çözüm* değil, *çözmeyi
reddetme* üretiyor. Reddetmek her zaman kurtarılabilir (`voidMarket` → iade); yanlış
çözmek değil.

**Kurallar bilinçli olarak muhafazakâr:**
- Sadece **bitmiş** maçlar sayılıyor. "Devam ediyor" diyen bir sağlayıcı oy değildir.
- Uzlaşma **kesin skor** üzerinde olmalı, sadece "kim kazandı" üzerinde değil.
- **Yeter sayı sağlansa bile tek bir muhalif varsa yayımlanmıyor.** Bir olgu
  anlaşmazlığında oy çokluğuyla karar vermek, kaynaklardan birinin yanlış olduğunu
  bilerek çözmek olurdu. Test: `consensus.test.ts` → "a dissenting source blocks
  settlement even when a quorum agrees".

**Takım adı normalizasyonu** ayrı bir tuzaktı: "Man Utd" / "Manchester United" /
"Manchester Utd" aynı kulüp. Belirteçler (`fc`, `ac`, `as`, `de`…) **yalnızca kendi
başına bir sözcük olduklarında** atılıyor — önek olarak atmak "Arsenal"ı "enal" yapıyordu
(gerçekten oldu, test bunu koruyor).

**`eventKey` atanmıyor, türetiliyor:** `keccak256` of
`foresight-arena/fixture/1|lig|tarih|evSahibi|deplasman|koşul` (normalize edilmiş adlarla).
Yani bir marketin iddia ettiği maça gerçekten işaret ettiğini herkes yeniden hesaplayıp
doğrulayabiliyor. Kayıt: `shared/fixtures.json`.

### D-10 — İtibarı agent değil, **bağımsız bir skor tutucu** yazıyor

ERC-8004 Reputation Registry, bir agent'ın sahibinden gelen geri bildirimi
**`Self-feedback not allowed`** ile reddediyor (Celo Sepolia'da doğrulandı: agent'ın kendi
cüzdanından revert, üçüncü bir cüzdandan geçiyor).

**Bu iyi haber.** Projenin "itibar bir vitrin değil" iddiasını kayıt defterinin kendisi
zorluyor. Ama Faz 1'deki tasarım agent'ın kendi sonucunu yazacağını varsayıyordu — o kod
hiç çalışamazdı. Bu yüzden:

- `AgentRunner` artık itibar **yazmıyor**; döngüsü `research → position → settle → claim`.
  Kapanan marketleri `CycleResult.settlements` olarak döndürüyor.
- `agents/src/ops/scorekeeper.ts` ayrı bir cüzdanla (`SCOREKEEPER_PRIVATE_KEY`) çalışıyor,
  her kapanmış marketi zincirden okuyup her agent için bir kayıt yazıyor — **kaybedenler
  dahil**.
- Skor tutucunun yazdığı her şey kamuya açık zincir durumunun saf bir fonksiyonu (hangi
  cüzdan hangi tarafa yatırdı, market nasıl çözüldü), yani skor tutucuya *güvenilmesi*
  gerekmiyor: aynı kontrattan yeniden hesaplanıp kontrol edilebilir.
- `.scorekeeper.json` defteri aynı (agent, market) çiftinin iki kez yazılmasını önlüyor;
  kayıt defteri tekrar yazımı kabul ediyor, yani bu olmadan geçmiş şişerdi.

**Ayrıca düzeltildi:** `ReputationClient.summary()` `clients` için boş dizi
varsayıyordu; kayıt defteri boş listeyi `clientAddresses required` ile reddediyor. O
metot hiç çalışmamıştı.

### D-11 — Celo Sepolia'da iki **açıkça etiketli** vekil kontrat

Testnet'te iki bağımlılık kırık çıktı ve ikisi de demoyu imkânsız kılıyordu:

| Sorun | Ölçüm | Vekil |
|---|---|---|
| Sepolia USDC (`0x01C5…C44E`) gerçek bir Circle FiatToken; **kimse mint edemiyor** (`mint` → "caller is not a minter") | `masterMinter` = `0xDd75…8457`, `isMinter(bizim)` = false | `TestnetUSDC` — 6 decimal, **herkese açık faucet** (50 tUSDC / saat / alıcı) |
| Sepolia'daki Mento SortedOracles **384 gün bayat** | `medianTimestamp(cUSD)` = 1755614497 | `TestnetSortedOracles` — `ISortedOracles` arayüzünün aynısı, sahibi yazıyor |

**Neden faucet zorunluydu:** Kimsenin edinemediği bir stake token'ıyla "bağımsız insanlar
katılabilir" (Faz 5, Track 2) iddiası boş olurdu. Faucet, cüzdanını bağlayan birinin bizden
para istemeden pozisyon almasını sağlıyor — hackathon'un "bağımsız katılımcı" tanımı da tam
bu.

**Sınırlar dürüstçe:** `TestnetSortedOracles`'ın güven modeli gerçeğinden **daha kötü** —
tek bir sahip fiyatı yazıyor. Bu, stake token'ının faucet oyuncağı olduğu bir ağda kabul
edilebilir, başka hiçbir yerde değil. `Deploy.s.sol` bunu `block.chainid` ile zorluyor:
ikisi de yalnızca Sepolia'da deploy ediliyor, mainnet'te havuz gerçek USDC'de settle ediyor
ve resolver doğrudan Mento'yu okuyor. `ops:price-feed` mainnet'te çalışmayı reddediyor.

Yayımlanan fiyat da tek kaynaklı değil: Coinbase + CoinGecko + Kraken **medyanı**, ikiden
az kaynak yanıtlarsa yayımlamıyor. `report` `block.timestamp` damgalıyor, yani bayatlık
kontrolü gerçek kalıyor — vekil, bayat bir fiyatı taze göstermek için kullanılamıyor.

### D-12 — x402: kendi facilitator'ımızı da barındırıyoruz + testnet token'ında EIP-3009

Celo'nun facilitator'ı (`api.x402.celo.org`) kayıt sırasında verilen bir `X-API-Key`
istiyor. Ödeme yolunu elimizde olmayan bir kimlik bilgisine bağlamamak için facilitator
repo'da: `services/data-market/src/facilitator.ts`, `GET /supported` + `POST /verify` +
`POST /settle`. Celo'nunkine geçmek tek bir URL değişikliği (`X402_FACILITATOR_URL`).

Bu, testnet token'ına **EIP-3009** (`transferWithAuthorization`) eklemeyi gerektirdi —
gerçek USDC'de var ve x402'nin "exact" şeması onunla settle ediyor. Onsuz arena, ödeme
katmanının hareket ettiremediği bir token'da settle ediyor olurdu.

**Satılan şey gerçek:** çapraz kontrol edilmiş skor raporu — her kaynağın kendi okuması,
URL'i ve okunan yükün hash'i. Sadece bir hüküm satmak güven satmak olurdu; hesabı da
satmak alıcının satın aldığı şeyi doğrulamasını sağlıyor. `DATA_MARKET_URL` ayarlıysa Skor
Kahini raporu **satın alıyor** (`PurchasedScoreFeed`) ve satın alma başarısızsa yerel
hesaplamaya **sessizce düşmüyor** — pass geçiyor.

Agent tarafında `spendControls` bilinçli: bilinmeyen varlık reddediliyor ve
`maxAmountPerPayment` tavanı var. Tavansız izin, gözetimsiz bir agent'a herhangi bir fiyatı
imzalatabilirdi.

**Ölçülen akış (yerel fork):** 402 → EIP-3009 imzası → facilitator relay → 200 + `payment-response`
makbuzu. Alıcı −10.000, satıcı +10.000 base unit. Agent gas ödemiyor.

### D-13 — Agent, oracle adresini **resolver'dan** okuyor

`PriceSentinel` başlangıçta oracle adresini kendi adres tablosundan alıyordu. Testnet'te
resolver vekil feed'e, tablo ise Mento'nun (bakımsız) feed'ine işaret ediyor — yani agent
ile resolver **farklı sayılara** bakıyordu. Bu, agent'ın merkezî iddiasını ("fiyatın ne
olduğu tartışması hiç doğmaz") sessizce çürütüyordu.

Artık `MentoPriceResolver.sortedOracles()` çağrılıyor. Agent ile resolver'ın ayrışması
mümkün değil, çünkü adres tek bir yerden geliyor: çözümü yapacak kontrattan.

Aynı ilke panelde de var: dashboard bir marketin nasıl çözüleceğini
`IOutcomeResolver.describe()`'dan okuyor, agent id'lerini `ForesightPool.agentIdOf`'tan
okuyor — hiçbiri statik bir dosyadan değil.

### D-14 — Panel: Next.js 15 + wagmi + viem, adresleri deployment'tan okuyor

`web/`. Sunucu bileşenleri her istekte zincirden okuyor (`force-dynamic`), yani bir
ziyaretçinin gördüğü şey bir staker'ın karşısına çıkacak şey. Cüzdan bağlantısı yalnızca
**injected** — WalletConnect barındırılmış bir proje id'si ve ziyaretçi ile kontrat
çağrısı arasına üçüncü bir taraf gerektirirdi.

Adresler `contracts/deployments/<chainId>.json`'dan okunuyor; ABI'ler
`scripts/generate-abis.mjs` ile Foundry çıktısından **üretiliyor**. İkisi de aynı sebeple:
elle kopyalanan bir adres/ABI, birileri güncellemeyi unuttuğu ilk anda çürüyor.

## Hâlâ açık

### D-08 — Sözleşme güvenlik incelemesi: kim, ne zaman

Guardrail: gerçek parayla ilgili hiçbir kontrat, ekipten en az bir kişi kodu
incelemeden mainnet'e çıkmayacak. Faz 5 (8–10 Eyl) mainnet geçişi, yani inceleme ondan
**önce** bitmeli. İnceleyecek kişi ve tarih henüz belli değil.

Mevcut durum: 53 test geçiyor (fuzz dahil), sıfır derleyici uyarısı. Test kapsamı
inceleme yerine geçmez.

### D-09 — Reviewer-agent görev sahibi (AskBots, Track 3)

Hangi ekip üyesi/agent, hangi projeleri inceleyecek — kararlaştırılmadı.

---

## Kaynağından doğrulanıp düzeltilen yanlış varsayımlar

Bunlar CLAUDE.md yazıldığında doğruydu ya da öyle sanılıyordu; zincire/dokümana sorulunca
düzeltildi.

| Konu | CLAUDE.md'de | Gerçek |
|---|---|---|
| Testnet | Alfajores | **Celo Sepolia** (11142220). ERC-8004 registry'leri ve x402 facilitator Alfajores'te yok. `.mcp.json` buna göre düzeltildi. |
| x402 paketleri | `x402-fetch`, `x402-express` | `@x402/express` + `@x402/core` + `@x402/evm` |
| x402 ücreti | gas-at-cost + %0.3 | Protokol ücreti yok; settlement başına $0.001 kredi + gas |
| x402 facilitator | — | `https://api.x402.celo.org`, `X402_API_KEY` gerekiyor |
| Self docs URL | `docs.self.xyz/contract-integration/basic-integration` | 404. Hub adresleri: mainnet `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF`, testnet `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |
| USDC adresi | `0xcEBA...` | Checksum hatalı; doğrusu `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` (solc reddediyor) |

### Faz 3–5'te bulunanlar

| Konu | Sanılan | Gerçek |
|---|---|---|
| ERC-8004 registry doğrulaması | "Dördü de `name()` = `AgentIdentity` ile doğrulandı" | Yalnızca **Identity** registry'leri ERC-721; Reputation registry'lerinde `name()` **revert ediyor**. Canlılık `getIdentityRegistry()` ile doğrulanıyor (Sepolia'da doğru Identity adresini döndürüyor). İkisi de 130 byte'lık proxy. |
| Agent kendi itibarını yazar | Varsayım | `Self-feedback not allowed` — imkânsız. Bkz. D-10. |
| `getSummary(agentId, [], …)` | Boş `clients` çalışır | `clientAddresses required` ile revert. En az bir client adresi zorunlu. |
| Sepolia Mento oracle | Kullanılabilir | `medianTimestamp` = 1755614497, **384 gün bayat**. Bkz. D-11. |
| Sepolia USDC | Faucet'lenebilir | Gerçek Circle FiatToken, herkese kapalı `mint`. Bkz. D-11. |
| x402 payload'ında `scheme`/`network` | Üst seviyede | v2'de **`paymentPayload.accepted`** altında (v1 üst seviyedeydi). |
| x402 makbuz başlığı | `x-payment-response` | v2'de **`payment-response`**. |
| x402 istemci varsayılanı | Her varlığı öder | Varsayılan `spendControls` bilinmeyen varlığı **reddediyor**; açıkça `allowedAssets` gerekiyor. |
| `wagmi/connectors` | Hafif | Barrel, Coinbase/Base connector'larını ve `@coinbase/cdp-sdk` → opsiyonel `@x402/evm`'i client bundle'a çekiyor; build kırılıyor. `injected`'ı `@wagmi/core`'dan almak gerekiyor. |
| `@x402/evm` `ExactEvmScheme` | Tek sınıf | Kök export **client** tarafı; sunucu için `@x402/evm/exact/server` gerekiyor. |

Doğrulama komutları `contracts/src/config/CeloAddresses.sol` başındaki notta.
