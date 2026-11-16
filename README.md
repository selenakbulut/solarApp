# GES Saatlik Üretim Tahmini

Bu uygulama, güneş enerjisi santralleri için saatlik üretim tahmini oluşturur ve kayıtlı tahminleri gerçekleşen üretimle karşılaştırır. İlk sürüm Streamlit ile geliştirildi. Güncel sürümde FastAPI, React/Vite ve SQLite kullanılıyor.

## Kurulum

Windows üzerinde Python 3.12 ve Node.js 22.12 veya üzeri gerekir. PyCharm terminalini proje kökünde aç ve ilk kurulumda şu komutları çalıştır:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd web
npm install
cd ..
```

## Çalıştırma

**Terminal 1 · Backend**

Proje kökünde çalıştır:

```powershell
.\.venv\Scripts\python.exe -m uvicorn api:app --host 127.0.0.1 --port 8000
```

**Terminal 2 · Frontend**

İkinci terminali de proje kökünde aç:

```powershell
cd web
npm run dev
```

- Uygulama: <http://127.0.0.1:5173>
- Swagger API dokümantasyonu: <http://127.0.0.1:8000/docs>

Vite, `/api` isteklerini FastAPI’ye yönlendirir. Uygulamayı durdurmak için iki terminalde de `Ctrl+C` kullan.

## Kullanım

1. Bir santral seç veya yeni santral ekle.
2. İleri tahmin oluştur ya da geçmiş hava verilerinden üretim hesapla. Her başarılı hesaplama ayrı bir tahmin sürümü olarak kaydedilir.
3. Gerçek üretim verisini CSV veya Excel olarak yükle. Dosyanın enerji birimini ve saat etiketinin aralık başlangıcı mı, bitişi mi olduğunu seç.
4. Karşılaştırma ekranında kayıtlı tahmin ile gerçek üretimi incele. Saatlik ve günlük sonuçları, MAE, RMSE ve bias değerlerini görüntüle.

Tahmin saatleri **aralık bitişini** gösterir. Örneğin `15:00`, `14:00–15:00` aralığıdır. Gerçek üretim dosyan aralık başlangıcını gösteriyorsa yükleme sırasında bu seçeneği işaretle. Uygulama etiketi bir saat ileri alarak eşleştirir. Enerji `kWh`, ortalama güç `kW` olarak gösterilir.

## Üretim modeli ve hava verisi

- Fiziksel üretim hesabı `backend/model.py` içinde yapılır. Hesap panel düzlemindeki ışınımı, sıcaklığı, santral kapasitesini, panel yaşını, inverter verimini ve kayıpları kullanır.
- `backend/services/production_adjustments.py`, güneş konumu ve hava koşullarına göre saatlik düzeltmeleri uygular.
- Hava verisi Open-Meteo’dan alınır. Sayfa yenileme kayıtlı verileri okur. Yeni tahmin oluştururken eksik veya yenileme zamanı gelmiş saatler için dış istek yapılır.
- İleri tahmin hava verisi, yeniden istendiğinde 6 saat sonra yenilenebilir. Son 7 gündeki arşiv verisi için bu süre 24 saattir. Önceki tahminlerin kayıtlı girdileri kendi sürümlerinde saklanır.

Varsayılan veritabanı proje kökündeki `solar.db` dosyasıdır. Boş bir kurulumda tablolar açılışta oluşturulur. Başka bir veritabanı kullanmak için backend’i çalıştırmadan önce `SOLAR_DB_PATH` ortam değişkenini ayarla. Uygulamanın varsayılan günlük dış istek sınırı 50’dir ve `SOLAR_DAILY_API_LIMIT` ile değiştirilebilir.

## Proje yapısı

| Konum | İçerik |
| --- | --- |
| `api.py` | FastAPI giriş noktası |
| `backend/routes/` | API endpoint’leri |
| `backend/services/` | Hava verisi, tahmin ve karşılaştırma işlemleri |
| `backend/repositories/` | SQLite okuma ve yazma işlemleri |
| `backend/model.py` | Fiziksel üretim hesabı |
| `web/` | React/Vite arayüzü |
| `tests/` | Backend ve model testleri |

API yollarının tam listesi Swagger’da yer alır. Temel işlemler `GET /sites`, `POST /forecasts`, `POST /actuals/import` ve `GET /forecasts/{run_id}/comparison` üzerinden yapılır.

## Test

Proje kökünde çalıştır:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```