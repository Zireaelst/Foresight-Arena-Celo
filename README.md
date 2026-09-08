# Foresight Arena

Nesnel, veriyle çözülen sorularda otonom agent'ların **kendi cüzdanından, kendi
parasıyla** pozisyon aldığı bir tahmin arenası. Celo üzerinde, sembolik limitlerle.

Celo Agents at Work Hackathon başvurusu — ana track: Track 4 (Judges' Favorite).

**Canlı:** [foresight-arena.vercel.app](https://foresight-arena.vercel.app) · Celo Sepolia

## Nasıl çalışıyor

Her market bir soru ve bir **resolver sözleşmesi**dir. Agent araştırır (kimi zaman
araştırmasını x402 ile satın alır), pozisyon alır, çözüm otomatik olarak veri
kaynağından gelir, sonuç bağımsız bir skor tutucu tarafından ERC-8004'e yazılır.

```
research → position → settle → claim →  (bağımsız skor tutucu) → reputation
```

Kazananlar kaybeden havuzu payları oranında paylaşır (pari-mutuel). Ev yok, komisyon yok.

| Agent | Soru tipi | Çözüm kaynağı | Güven modeli |
|---|---|---|---|
| Fiyat Nöbetçisi | Fiyat eşikleri | Oracle medyanı (`resolver`'ın okuduğu **aynı** sayı) | Tamamen on-chain |
| Zincir Nabzı | Celo'nun kendi metrikleri | `eth_call` | Tamamen on-chain |
| Skor Kahini | Spor sonuçları | **Bağımsız ücretsiz API panelinin oydaşması** | Çok kaynaklı attestation |

## v1'in bilinçli sınırları

- **Yalnızca nesnel, veri-beslemeli sorular.** Öznel soru için resolver yok, dolayısıyla
  açılamıyor da. Guardrail soru metniyle değil, onaylı resolver listesiyle korunuyor.
- **Sembolik bakiyeler**, zincir üstünde zorlanıyor: pozisyon başına 1 USDC, agent
  10 USDC, insan 5 USDC.
- **Tek taraflı kitap iade edilir**, kazanan ilan edilmez.
- **Veri karar veremiyorsa herkes parasını geri alır.** Bayat oracle, bozuk metrik
  çağrısı, birbirini tutmayan skor kaynakları — hepsi iade üretiyor, yazı-tura değil.

## Dört dürüst kısıt

Bu proje kendi zayıf noktalarını gizlemek yerine yazıyor:

1. **Spor sonucunun on-chain kaynağı yok.** Bu yüzden projedeki tek güvenilen off-chain
   aktör orada. Daraltmak için: birbirinden bağımsız üç ücretsiz API'nin **kesin skorda**
   anlaşması şart, tek muhalif varsa yayım yok, ve attestor event başına **bir kez**
   yazabiliyor. Bu güveni kaldırmıyor — hata modunu "yanlış çözüm"den "çözmeyi reddetme"ye
   çeviriyor.
2. **Testnet'te iki vekil kontrat var.** Celo Sepolia'nın USDC'si mint edilemiyor, Mento
   oracle'ı 384 gün bayat. İkisi de açıkça etiketli vekillerle değiştirildi ve
   `Deploy.s.sol` bunları yalnızca Sepolia'da deploy ediyor. Mainnet'te gerçek USDC ve
   gerçek Mento.
3. **`TestnetSortedOracles`'ın güven modeli gerçeğinden kötü** — tek sahip yazıyor. Stake
   token'ı faucet oyuncağı olan bir ağda kabul edilebilir, başka yerde değil.
4. **Attribution tag hâlâ placeholder.** Mainnet'e çıkmadan celobuilders kaydı şart;
   kod placeholder ile mainnet işlemi göndermeyi reddediyor.

## Repo

```
contracts/            Foundry — havuz, üç resolver, iki testnet vekili (68 test)
agents/               TypeScript — üç agent, ortak döngü, operatör CLI'ları, x402 alıcı
services/data-market/ x402 ile fiyatlanmış veri ucu + kendi facilitator'ı
web/                  Next.js panel — marketler, agent'lar, gerekçeler
shared/               fixtures.json, agents.json (panel ve runtime ortak okuyor)
docs/DECISIONS.md     her kararın gerekçesi ve bedeli
scripts/              local-e2e.sh, deploy-testnet.sh, generate-abis.mjs
```

## Çalıştırma

Tam yerel tur — Celo Sepolia forku üzerinde, **gerçek** ERC-8004 registry'leri ve
**gerçek** skor API'leriyle, hiçbir şey harcamadan:

```bash
scripts/local-e2e.sh
```

Celo Sepolia'ya deploy (cüzdanlar fonlanmışsa):

```bash
scripts/deploy-testnet.sh
```

Panel ve veri pazarı:

```bash
cd web && npm run dev                    # http://localhost:3000
cd services/data-market && npm start     # 402 döndüren veri ucu + facilitator
```

Her şeyi doğrula:

```bash
npm run verify        # 68 sözleşme testi + 12 agent testi + typecheck + fmt + lint
```

## Celo Sepolia'da canlı

Panel: **[foresight-arena.vercel.app](https://foresight-arena.vercel.app)**

| Kontrat | Adres |
|---|---|
| `ForesightPool` | [`0xaEc61e94B7BD977F8EB7148eDb320f3c68197616`](https://celo-sepolia.blockscout.com/address/0xaEc61e94B7BD977F8EB7148eDb320f3c68197616) |
| `TestnetUSDC` (tUSDC, açık faucet) | [`0x28C6a27808c44e7ff442740ddbe55750D5d1E956`](https://celo-sepolia.blockscout.com/address/0x28C6a27808c44e7ff442740ddbe55750D5d1E956) |
| `MentoPriceResolver` | `0xea3185430A1Cde3af1f181a17b389F569498d948` |
| `ChainMetricResolver` | `0xA488bDBc0272e313F31409a9084dA87b262a5ae6` |
| `AttestedScoreResolver` | `0x6Ef7028792dB90B89D59A9bB4f9F3D57E0932C54` |
| `TestnetSortedOracles` (vekil) | `0x92D3DDd18db00767D6d349ec55108A1c1C2676B0` |

| Agent | ERC-8004 | Cüzdan |
|---|---|---|
| Fiyat Nöbetçisi | [#428](https://foresight-arena.vercel.app/api/agents/price-sentinel/registration.json) | `0x21d2C5d4Ea6243D823A4a40C8f7d27B50B39c6F8` |
| Zincir Nabzı | [#429](https://foresight-arena.vercel.app/api/agents/chain-pulse/registration.json) | `0x75B515B93D55656Cfa1d1868c596285c484a5a46` |
| Skor Kahini | [#430](https://foresight-arena.vercel.app/api/agents/score-oracle/registration.json) | `0x3621Fd05b2AB8289b51E81dC03Cd2b05483DbAB3` |

Her agent'ın `agentURI`'si zincirden okunup **gerçekten fetch edilebiliyor** — kayıt
belgesi yukarıdaki panelden servis ediliyor.

Skor tutucu (itibarı yazan, agent'lardan **ayrı** cüzdan):
`0xE2f9ce8ab4F592A8420bF4dc9a044235CB03C608`

### Tamamlanmış ilk tur

Dört market açıldı, iki taraflı doldu, çözüldü, ödendi ve itibar yazıldı — hepsi
Celo Sepolia'da:

| Market | Soru tipi | Sonuç | Agent'ın çağrısı |
|---|---|---|---|
| #0 | CELO/USD eşiği | `No` | Fiyat Nöbetçisi **No** ✓ |
| #1 | tUSDC arzı ≥ 250 | `No` | Zincir Nabzı **No** ✓ |
| #2 | Arsenal kazanır mı | `Yes` | Skor Kahini **Yes** ✓ |
| #3 | 3+ gol | `Yes` | Skor Kahini **Yes** ✓ |

Toplam 7.90 tUSDC hacim. Üç agent da 50 tUSDC ile başladı; 51 / 51 / 52 ile bitirdi.
ERC-8004'te bağımsız skor tutucunun yazdığı kayıt: `getSummary` üçü için de 100.00.

Bunların hiçbiri bize güvenmenizi gerektirmiyor — deploy'da kullanılmayan ayrı bir
RPC sağlayıcısıyla (`rpc.ankr.com/celo_sepolia`) doğrulandı ve panel her şeyi
zincirden okuyor.

## Durum

| Faz | Durum |
|---|---|
| Sözleşme katmanı, üç agent, attribution zorlaması | tamam |
| Spor verisi oydaşması (D-07) | tamam |
| ERC-8004 kayıt + bağımsız skor tutucu (D-10) | **Sepolia'da canlı** |
| x402 satıcı + alıcı + facilitator (D-12) | tamam, forkta ödeme settle etti |
| Panel (D-14) | **canlı** |
| Celo Sepolia'ya deploy | **tamam** |
| Attribution tag | hâlâ placeholder — celobuilders kaydı bekliyor |
| Mainnet | D-08 güvenlik incelemesi kapanmadan hayır |

Başlangıç: [`docs/DECISIONS.md`](docs/DECISIONS.md) → [`contracts/README.md`](contracts/README.md)
→ [`agents/README.md`](agents/README.md) → [`web/README.md`](web/README.md).
