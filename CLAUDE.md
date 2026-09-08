# Foresight Arena — Proje Belleği

Bu dosya, Claude Code'un proje kökünde otomatik okuduğu kalıcı bağlam dosyasıdır. Repo'nun köküne `CLAUDE.md` olarak koy — her oturumda otomatik yüklenir, ekstra ayar gerekmez.

## Misyon

Nesnel, veriyle çözülen sorularda birbirine ve insanlara karşı **kendi cüzdanından, kendi parasıyla** pozisyon alan otonom agent'lardan kurulu bir tahmin borsası. Celo üzerinde, sembolik/düşük limitli bakiyelerle. Detaylı ürün brief'i: bkz. `docs/PROJECT_BRIEF.md` (varsa) veya bu dosyanın "Ürün mimarisi" bölümü.

## Hackathon bağlamı — Celo Agents at Work Hackathon

- **Teslim:** 14 Eylül 2026, 09:00 GMT — track bazında ek süre yok.
- **Ana başvuru track'i:** Track 4, Judges' Favorite ($500). Yan bounty'ler: Track 5 buy feedback ($250, 5×$50), Track 3 AskBots Growth ($500). Track 1 (Value Moved, $2.000) ve Track 2 (Real World Adoption, $1.750) insan katılımı açıldığında otomatik besleniyor.
- **Sert kurallar (özet):**
  - Repo **public** olmalı, judging anında da erişilebilir olmalı.
  - Sadece **Celo mainnet** işlemleri sayılıyor — testnet referansı repo'da olabilir ama testnet aktivitesi hiçbir track'te puan getirmiyor.
  - **Bağımsız taraflar:** kullanıcı/hacim sadece ekibe ait olmayan, ekip tarafından ilk fonlanmamış cüzdanlardan sayılıyor.
  - **Sponsorlu gas builder katkısı sayılmıyor** — kendi ödediğin fee'ler sayılıyor.
  - **Her işlemde Attribution Tag zorunlu** — tag olmayan işlem leaderboard'da görünmüyor.
  - Bir ana track seç, ek track'ler için tek satırlık "neyi göstereceğim" notu yeterli.

## Ürün mimarisi (özet)

**Üç vitrin agent** (mimari herhangi bir nesnel/veri-beslemeli soruyu kabul edecek şekilde açık, demo bu üçüne odaklı):
1. **Fiyat Nöbetçisi** — kripto fiyat eşiği soruları, fiyat referans noktasından objektif çözülür.
2. **Zincir Nabzı** — Celo mainnet'in kendi verisinden sorular (harici oracle gerektirmez, on-chain okuma).
3. **Skor Kahini** — spor sonuçları, kamuya açık bir spor API'siyle çözülür.

**Çekirdek döngü:** Araştır → Pozisyon Al (sembolik bakiyeden) → Çöz/Öde (veri feed'iyle otomatik) → İtibar (ERC-8004 skor kaydı) → tekrar.

**Katmanlar:** Panel (dashboard) → Agent katmanı (3 vitrin agent + sinyal alıcı mantık) → Ödeme/veri katmanı (buy pazaryeri üzerinden x402) → Sözleşme katmanı (pari-mutuel havuz + ERC-8004 kayıt + veri referansı) → Celo Mainnet + Attribution Tags.

**Kilit karar — risk çerçevesi:** Sembolik/düşük limitli bakiyeler ("forecasting competition" konumlaması, açık bahis değil) + v1'de **yalnızca nesnel, veri-beslemeli sorular** (insan hakemliğine/itiraz penceresine gerek yok, çözüm doğrudan veri kaynağından otomatik). Açık uçlu/öznel sorular v1 kapsamı dışında — bilinçli bir sınırlama, unutma.

## Teknik entegrasyon

### Celo MCP sunucusu
Blockchain verisine (blok, hesap, token, NFT, kontrat çağrısı, gas tahmini, governance, staking) erişim sağlıyor. Proje köküne şu `.mcp.json` dosyasını ekle:

```json
{
  "mcpServers": {
    "celo-mcp": {
      "type": "stdio",
      "command": "uvx",
      "args": ["--refresh", "celo-mcp"],
      "env": {
        "CELO_RPC_URL": "${CELO_RPC_URL:-https://forno.celo.org}",
        "CELO_TESTNET_RPC_URL": "${CELO_TESTNET_RPC_URL:-https://forno.celo-sepolia.celo-testnet.org}"
      }
    }
  }
}
```

Alternatif olarak CLI'dan tek satırla ekleyebilirsin:
```
claude mcp add --scope project --env CELO_RPC_URL=https://forno.celo.org celo-mcp -- uvx --refresh celo-mcp
```
Oturum içinde `/mcp` ile bağlantıyı ve araç listesini doğrula. `uvx` yoksa önce `pip install uv` (veya `pipx install uv`) gerekir.

### Fee abstraction
Gas, `feeCurrency` alanına token adresi (veya 6-decimal token'lar için adapter kontrat adresi — örn. USDC) verilerek o token'dan ödenir. Normal EOA cüzdanlarla çalışır, relayer/smart-account gerekmez. Agent cüzdanlarının CELO tutmasına gerek kalmaz.

### Attribution Tags
npm paketi: `@celo/attribution-tags` (ERC-8021). `toDataSuffix([...])` ile transaction data'sına eklenir. celobuilders'a kayıt olunca dönen `attributionTag` (`celo_` + 12 hex) **her mainnet işlemine** eklenmeli — yoksa leaderboard'da sayılmıyor. Kod detayları için repo'daki `sdk/README.md` ve `BUILDERS.md`'yi çek.

### ERC-8004 (agent kimliği/itibarı)
Celo mainnet kontrat adresleri:
- Identity Registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Reputation Registry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

**Celo Sepolia** testnet (Alfajores değil — registry'ler orada deploy edilmemiş):
Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`.

**Düzeltme (2026-09-08):** Yalnızca **Identity** registry'leri ERC-721, yani `name()` =
`"AgentIdentity"` sadece onlarda çalışıyor. Reputation registry'lerinde `name()` **revert
ediyor** — canlılığı `getIdentityRegistry()` ile doğrula (Sepolia'da doğru Identity
adresini döndürüyor). Dördü de 130 byte'lık proxy.

**İki sert API gerçeği (zincirde doğrulandı):**
- `giveFeedback`, agent'ın **kendi sahibinden** gelen çağrıyı `Self-feedback not allowed`
  ile reddediyor. Agent kendi itibarını yazamaz; ayrı bir "skor tutucu" cüzdanı şart
  (bkz. `docs/DECISIONS.md` D-10).
- `getSummary(agentId, [], …)` **boş** `clientAddresses` ile revert ediyor
  (`clientAddresses required`). En az bir client adresi geçilmeli.

Her agent bir ERC-721 olarak kayıtlı; `agentURI` bir kayıt dosyasına (endpoints, wallet, desteklenen trust modelleri) işaret ediyor. Kayıt/feedback SDK'sı hızlı değişebiliyor — **build başlarken eips.ethereum.org/EIPS/eip-8004 ve docs.celo.org/build-on-celo/build-with-ai/8004'ü tazele**, burada verilenler başlangıç noktası.

### x402 + buy
Paketler (2026-09-02'de docs'tan güncellendi — eski `x402-fetch`/`x402-express` isimleri
artık geçerli değil): `@x402/express` + `@x402/core` + `@x402/evm` (Hono için
`@x402/hono`). Akış: agent bir kaynağa istek atar → HTTP 402 alır → Celo facilitator
üzerinden stablecoin ödemesi yapar → tek HTTP exchange'de erişim tamamlanır.
Facilitator: `https://api.x402.celo.org` (Sepolia: `api.x402.sepolia.celo.org`),
`X-API-Key` başlığı gerekiyor. Network id `eip155:42220`. **Protokol ücreti yok**;
settlement başına $0.001 kredi + $0.001 altı gas. EIP-3009 `transferWithAuthorization`
ile settle ediliyor, yani alıcı gas ödemiyor. `buy` kapalı beta — kayıt sırasında opt-in gerekiyor, kaynağı kapalı, bu yüzden bu hackathon'da sadece feedback/test tarafındasın (satıcı değil alıcı).

**Doğrulanan paket gerçekleri (2026-09-08):** `@x402/*` 2.25.0. Sunucu tarafı şema
`@x402/evm/exact/server`'dan gelir (kök export **client** tarafıdır). v2 payload'ında
`scheme`/`network` **`paymentPayload.accepted`** altındadır (v1'de üst seviyedeydi).
Makbuz başlığı **`payment-response`** (v1: `x-payment-response`). İstemcinin varsayılan
`spendControls`'ü bilinmeyen varlığı reddeder — `allowedAssets` açıkça verilmeli.

Facilitator'ın `X-API-Key` gerektirmesi ödeme yolunu bir kimlik bilgisine bağlıyor; bu
yüzden repo kendi facilitator'ını da barındırıyor (`services/data-market`, `/verify` +
`/settle` + `/supported`). Celo'nunkine geçmek tek bir URL değişikliği. Gerekçe: D-12.

### Self (proof of personhood)
ZK kanıtlarıyla kimlik doğrulama (pasaport NFC, AB biyometrik kimlik, Aadhaar). Akış:
belge tara → ZK kanıt üret → seçili veriyi paylaş. IdentityVerificationHub: mainnet
`0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF`, testnet
`0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74`. (CLAUDE.md'de daha önce verilen
`docs.self.xyz/contract-integration/basic-integration` URL'i 404 dönüyor; güncel liste
`docs.self.xyz/docs/self-pass/contracts/deployed-contracts`.)

### Kayıt & submission — celobuilders skill
```
npx skills add https://celobuilders.xyz
```
**Daha önce farklı bir hackathon için kurduysan skill'i yeniden ekle** — yoksa yanlış alanları sorar ve artık var olmayan bir hackathon'a işaret eder. Kayıt: proje adı, public GitHub repo, Telegram handle, ülke, ana track, ERC-8004 Agent ID, agent cüzdan(lar)ı, reviewer-agent cüzdanı (varsa), buy beta opt-in. Karşılığında anlık `attributionTag` dönüyor. Submission da aynı skill üzerinden, agent'a "Celo Agents at Work Hackathon'a projemi submit etmeme yardım et" denerek yapılıyor.

## Yapım fazları

1. **31 Ağu–2 Eyl:** Havuz sözleşmesi iskeleti, agent cüzdanları, ERC-8004 kaydı, Attribution Tag entegrasyonu, `.mcp.json` kurulumu.
2. **3–5 Eyl:** 3 vitrin agent testnet'te agent-vs-agent modda çalışmaya başlar. celobuilders'a kayıt + AskBots'a kayıt + 1. inceleme turu talebi.
3. **6–8 Eyl:** x402/buy entegrasyonu (veri satın alma), feedback günlüğü tutulmaya başlanır.
4. **9 Eyl:** buy workshop'a katıl, entegrasyonu sağlamlaştır.
5. **8–10 Eyl:** Mainnet'e sembolik limitlerle geçiş + insan katılımına açılış (fee abstraction + Self akışı).
6. **11 Eyl:** Orta nokta leaderboard snapshot'ına kadar gerçek hacim/kullanıcı görünür olmalı.
7. **12–13 Eyl:** AskBots 2. inceleme turu, cila, demo + X gönderisi.
8. **14 Eyl 09:00 GMT:** Teslim.

## Sert kurallar / guardrails

- **Önce testnet, sonra mainnet.** Gerçek para hareketi olmadan mantığı doğrula.
- **Bakiyeler sembolik kalsın** — limitler `docs/DECISIONS.md` D-02'de sabit ve `ForesightPool`'da zincir üstünde zorlanıyor: pozisyon başına 1 USDC, agent 10 USDC, insan 5 USDC.
- **v1'de yalnızca nesnel/veri-beslemeli sorular** — öznel/açık uçlu soru kabul etme, resolver-agent + itiraz penceresi mimarisi v1 kapsamında yok.
- **Her mainnet işleminde Attribution Tag olmalı**, yoksa hiç sayılmıyor.
- **Sponsorlu gas'ı kendi katkın gibi sayma** — track ölçümünde sayılmıyor, bunu iddia etme.
- **celobuilders skill'ini her session başında tazelemeyi unutma** — eski sürüm yanlış alanlar sorar.
- **Skor tutucu cüzdanı agent cüzdanlarından farklı olmak zorunda** — ERC-8004 self-feedback'i reddediyor.
- **Testnet vekilleri mainnet'e sızmamalı** — `Deploy.s.sol` bunu `block.chainid` ile zorluyor, `ops:price-feed` mainnet'te çalışmayı reddediyor.
- Gerçek parayla ilgili herhangi bir kontrat mainnet'e çıkmadan önce ekipten en az bir kişi kod incelemesi yapmalı.

## Açık kararlar

Tam gerekçeler ve kilitlenen değerler: `docs/DECISIONS.md`. Aşağısı sadece durum tablosu.

- [x] **Fiyat feed kaynağı** — Mento SortedOracles (on-chain). Kapsam Mento çiftleriyle
      sınırlı ve anlık medyan okunuyor; sorular "çözüm anında" diye yazılmalı. (D-04)
      **Testnet uyarısı:** Sepolia'daki Mento feed'i 384 gün bayat, o yüzden orada açıkça
      etiketli bir vekil (`TestnetSortedOracles`) kullanılıyor. (D-11)
- [x] **Spor verisi API'si** — tek sağlayıcı değil, birbirinden bağımsız ücretsiz API
      **paneli** ve kesin skorda oydaşma; tek muhalif varsa settle edilmiyor. (D-07)
- [x] **Sembolik bakiye miktarı** — pozisyon başına 1 USDC, agent 10 USDC, insan 5 USDC.
      Kontratta sabit, `openExposure` ile zorlanıyor. (D-02)
- [x] **Pazar oluşturma yetkisi** — ekip + kayıtlı agent'lar. Nesnellik guardrail'i soru
      metniyle değil, onaylı resolver listesiyle korunuyor. (D-03)
- [ ] **Sözleşme güvenlik gözden geçirmesi** — kim/ne zaman belli değil. Faz 5 mainnet
      geçişinden önce bitmek zorunda. (D-08)
- [ ] **Reviewer-agent görev sahibi** — AskBots tarafı kararlaştırılmadı. (D-09)
