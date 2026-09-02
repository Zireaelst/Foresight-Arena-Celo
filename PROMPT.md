# Kickoff prompt — Claude Code'a ilk mesaj

Proje klasörünü oluşturup `git init` yaptıktan, `CLAUDE.md`, `REFERENCES.md` ve `.mcp.json`'ı köke koyduktan sonra `claude` çalıştır ve aşağıdakini yapıştır:

---

CLAUDE.md ve REFERENCES.md dosyalarını oku — bu Foresight Arena projesinin tam bağlamı, hackathon kuralları, mimari kararlar ve kullanılacak Celo primitive'leri orada.

Başlamadan önce:
1. `/mcp` ile celo-mcp bağlantısını doğrula, araç listesini göster.
2. REFERENCES.md'deki Celo docs sayfalarından 8004, fee-abstraction, x402 ve Self sayfalarını tazele (WebFetch ile) — bu alanlar hackathon süresince değişebiliyor, CLAUDE.md'deki bilgi başlangıç noktası, güncel doğrulama yapmadan koda geçme.
3. `npx skills add https://celobuilders.xyz` ile celobuilders skill'ini kur (daha önce kurulmuşsa yeniden kur — skill.md'nin bu hackathona ait olduğunu doğrula).

Sonra CLAUDE.md'deki "Yapım fazları" bölümündeki **Faz 1**'i uygula:
- Sözleşme katmanı için proje iskeletini kur (Foundry veya Hardhat — hangisini tercih edersen, gerekçesini kısaca söyle).
- Basit bir pari-mutuel havuz sözleşmesi taslağı yaz (YES/NO stake, kaybeden taraf kazanana orantılı dağıtılır), sembolik/düşük limitli bakiye varsayımıyla — kesin limit sayısını henüz sabitleme, CLAUDE.md'deki "Açık kararlar" listesinde bekliyor, bana sor.
- Üç vitrin agent için (Fiyat Nöbetçisi, Zincir Nabzı, Skor Kahini) klasör iskeletini ve ortak bir agent arayüzünü (research → position → settle → reputation döngüsü) kur.
- Attribution Tags SDK'sını (`@celo/attribution-tags`) projeye ekle, henüz gerçek tag olmadığı için placeholder ile.
- İlerledikçe CLAUDE.md'deki "Açık kararlar" listesini güncel tut — karar verdiğimiz her madde işaretlenmeli.

Her adımdan önce ne yapacağını kısaca söyle, büyük/geri alınamaz adımlardan (mainnet işlemi, gerçek para hareketi) önce mutlaka onay iste.

---
