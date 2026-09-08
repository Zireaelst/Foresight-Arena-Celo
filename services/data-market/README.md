# Foresight Arena — veri pazarı (x402)

Agent'ların araştırmasını **satın aldığı** fiyatlı bir HTTP ucu, ve onu settle eden
facilitator.

```bash
npm install
npm start
# facilitator   http://127.0.0.1:4022
# data market   http://127.0.0.1:4021
```

## Ne satılıyor

`GET /reports/score-consensus?league=…&kickoffDate=…&homeTeam=…&awayTeam=…&condition=…`

Bir fikstürün çapraz kontrol edilmiş kesin skoru: **her kaynağın kendi okuması**, açılıp
doğrulanabilecek URL'i, kanonik fikstür dizesi, türetilmiş `eventKey` ve okunan yükün
hash'i.

Sadece bir hüküm satmak güven satmak olurdu. Hesabı da satmak alıcının satın aldığı şeyi
bizden bağımsız doğrulamasını sağlıyor — projenin geri kalanıyla aynı ilke.

## Akış

```
agent → GET (ödemesiz)          → 402 + PAYMENT-REQUIRED (fiyat, varlık, alıcı, EIP-712 domain)
agent → EIP-3009 authorization imzalar
agent → GET (PAYMENT başlığıyla) → resource server → facilitator /verify → /settle
                                  → 200 + payment-response makbuzu (tx hash)
```

Agent **gas ödemiyor**: facilitator imzalı authorization'ı zincire taşıyor. Fraction-of-a-cent
fiyatlamayı mümkün kılan şey bu.

## Neden kendi facilitator'ımız

Celo'nun facilitator'ı (`api.x402.celo.org`) kayıt sırasında verilen bir `X-API-Key`
istiyor. Ödeme yolunu elimizde olmayan bir kimlik bilgisine bağlamamak için facilitator
burada duruyor. HTTP kontratı `HTTPFacilitatorClient`'ın konuştuğu kontrat, yani
Celo'nunkine geçmek tek satır:

```bash
X402_FACILITATOR_URL=https://api.x402.sepolia.celo.org X402_API_KEY=… npm start
```

**Facilitator fon tutmuyor.** Authorization token'ları doğrudan ödeyenden satıcıya
taşıyor; facilitator yalnızca doğruluyor, relay ediyor ve gas'ı ödüyor. Bozuk bir
facilitator'ın yapabileceği en kötü şey settle etmemek.

Doğrulama iki katmanlı ve ayrımı kasıtlı: token'ın kendisi imza, süre ve replay'i
zorluyor (`simulateContract` ile aynen deneniyor); facilitator ise token'ın bilemeyeceği
şeyi kontrol ediyor — **doğru kişiye doğru miktarın** ödendiğini. Geçerli bir
authorization yanlış birine ödeme yapıyor olabilir; o, resource server'ın şartı.

## Yapılandırma

`../../agents/.env` okunuyor. İlgili anahtarlar:

| Değişken | İş |
|---|---|
| `STAKE_TOKEN_ADDRESS` | Ödemenin yapılacağı varlık (testnet'te `tUSDC`) |
| `DEPLOYER_PRIVATE_KEY` | Satıcı **ve** facilitator relayer'ı (testnet kolaylığı) |
| `DATA_MARKET_PRICE` | Çağrı başına fiyat, base unit (varsayılan `10000` = 0.01) |
| `X402_FACILITATOR_URL` | Ayarlıysa harici facilitator kullanılır |
| `X402_DEBUG` | `/verify` gövdesini loglar |
