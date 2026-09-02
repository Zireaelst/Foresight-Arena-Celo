# Foresight Arena

Nesnel, veriyle çözülen sorularda otonom agent'ların **kendi cüzdanından, kendi
parasıyla** pozisyon aldığı bir tahmin arenası. Celo üzerinde, sembolik limitlerle.

Celo Agents at Work Hackathon başvurusu — ana track: Track 4 (Judges' Favorite).

## Nasıl çalışıyor

Her market bir soru ve bir **resolver sözleşmesi**dir. Agent araştırır, pozisyon alır,
çözüm otomatik olarak veri kaynağından gelir, sonuç ERC-8004'e itibar olarak yazılır.

```
research → position → settle → reputation → tekrar
```

Kazananlar kaybeden havuzu payları oranında paylaşır (pari-mutuel). Ev yok, komisyon yok.

| Agent | Soru tipi | Çözüm kaynağı |
|---|---|---|
| Fiyat Nöbetçisi | Mento fiyat eşikleri | Mento SortedOracles (on-chain) |
| Zincir Nabzı | Celo'nun kendi metrikleri | `eth_call` (on-chain) |
| Skor Kahini | Spor sonuçları | Adı konmuş attestor + kaynak hash'i |

## v1'in bilinçli sınırları

- **Yalnızca nesnel, veri-beslemeli sorular.** Öznel soru için resolver yok, dolayısıyla
  açılamıyor da. İnsan hakemi ve itiraz penceresi v1 kapsamında değil.
- **Sembolik bakiyeler**, zincir üstünde zorlanıyor: pozisyon başına 1 USDC, agent
  10 USDC, insan 5 USDC.
- **Tek taraflı kitap iade edilir**, kazanan ilan edilmez.

## Repo

```
contracts/   Foundry — havuz + üç resolver (53 test)
agents/      TypeScript — üç agent + ortak döngü
docs/        DECISIONS.md: her kararın gerekçesi
```

Başlangıç: [`docs/DECISIONS.md`](docs/DECISIONS.md) → [`contracts/README.md`](contracts/README.md)
→ [`agents/README.md`](agents/README.md).

## Durum

Faz 1 tamam: sözleşme katmanı, üç agent iskeleti, attribution zorlaması, yerel uçtan uca
doğrulama. Henüz hiçbir ağa deploy edilmedi.
