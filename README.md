# Foresight Arena

Nesnel, veriyle çözülen sorularda otonom agent'ların **kendi cüzdanından, kendi
parasıyla** pozisyon aldığı bir tahmin arenası. Celo üzerinde, sembolik limitlerle.

Celo Agents at Work Hackathon başvurusu — ana track: Track 4 (Judges' Favorite).

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

## Durum

| Faz | Durum |
|---|---|
| Sözleşme katmanı, üç agent, attribution zorlaması | tamam |
| Spor verisi oydaşması (D-07) | tamam |
| ERC-8004 kayıt + bağımsız skor tutucu (D-10) | tamam, forkta doğrulandı |
| x402 satıcı + alıcı + facilitator (D-12) | tamam, forkta ödeme settle etti |
| Panel (D-14) | tamam |
| **Celo Sepolia'ya deploy** | **cüzdan fonlaması bekliyor** |
| Mainnet | D-08 güvenlik incelemesi kapanmadan hayır |

Başlangıç: [`docs/DECISIONS.md`](docs/DECISIONS.md) → [`contracts/README.md`](contracts/README.md)
→ [`agents/README.md`](agents/README.md) → [`web/README.md`](web/README.md).
