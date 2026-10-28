# GES saatlik üretim tahmini

React/Vite arayüzü ve mevcut FastAPI backend'i. Streamlit istemcisi emekli
edilmiştir; app.py ve frontend/ Python kaynakları artık kullanılmaz. Backend,
üretim modeli, endpoint'ler ve veritabanı sözleşmesi değiştirilmemiştir.
Teknik geçişin tam kaydı: [changes.md](changes.md).

## Hızlı kullanım (Windows)

İlk kurulum: Python 3.12 ve Node.js 22.12+ kurulu olmalıdır.

```powershell
.\kurulum.bat
.\baslat.bat
.\durum.bat
.\durdur.bat
```

BAT dosyaları çift tıklamayla da kullanılabilir. Başlatıcı iki servisi görünmeyen
arka plan süreçleri olarak başlatır; iki terminal açmak gerekmez. Kapatıcı yalnız
başlatıcının sahiplik kaydını doğrulayabildiği proje süreçlerini kapatır.

| Adres | İşlev |
| --- | --- |
| http://127.0.0.1:5173 | React arayüzü |
| http://127.0.0.1:8000/health | API sağlık kontrolü |
| http://127.0.0.1:8000/docs | Swagger |

Normal başlatma gerçek solar.db dosyasına bağlanır. Ortamdaki SOLAR_DB_PATH
varsa o veritabanı kullanılır. Yeni tahmin, santral, kayıp ve gerçek üretim kayıtları
seçilen gerçek veritabanına yazılır. Uygulama mock veri sunmaz.

Ayrı veritabanıyla önizleme:

```powershell
.\baslat.bat -Preview
```

Preview modu ilk kullanımda solar.db kopyasını .local-preview/solar.preview.db
olarak hazırlar; var olan kopyayı ezmez. Normal/Preview arasında geçmek için önce
durdur.bat çalıştırılır. Başka uygulamaya ait dolu portlar kullanılmaz veya kapatılmaz.

PowerShell karşılıkları ve seçenekler:

```powershell
.\start-local.ps1 -Preview -NoBrowser
.\start-local.ps1 -ApiPort 18000 -WebPort 15173 -NoBrowser
.\status-local.ps1
.\stop-local.ps1
```

State ve loglar .local-run/ altında saklanır. İsteğe bağlı -StateDirectory ile
ayrı bir süreç kaydı kullanılabilir; stop/status aynı dizinle çağrılmalıdır.
Başlatıcı eksik Python/web bağımlılıklarında kurulum.bat komutunu gösterir.
Venv başka bilgisayardan taşınmışsa kurulum.bat onu mevcut Python 3.12'ye onarır.

## Elle çalıştırma ve derleme

```powershell
# Birinci terminal / proje kökü
.\.venv\Scripts\python.exe -m uvicorn api:app --host 127.0.0.1 --port 8000

# İkinci terminal
cd web
npm run dev
```

web/ altında npm run build, statik çıktıyı web/dist/ içine üretir. npm run preview
4173 portunda derlenmiş paketi gösterir. /api istekleri Vite üzerinden FastAPI'ye
aktarılır; CORS veya backend endpoint değişikliği gerekmez. Gerçek sunucuya
dağıtımda aynı /api yönlendirmesi ayrıca kurulmalıdır; Vite geliştirme sunucusu
hosting çözümü değildir.

Kilitli web kurulumu: web/ altında pnpm install --frozen-lockfile. npm install
da desteklenir. Paket sürümleri web/package.json, tam çözüm pnpm-lock.yaml içindedir.

## İlk kullanım

- Üst çubuktan santral seç. Paket mevcut 9 santralini içerir; Saha 1/2/3 ID'leri 12/13/14'tür.
- **Üretim tahmini**: kayıtlı sürümleri görüntüle veya formdan yeni tahmin oluştur.
- **Santraller ve Kayıplar**: konum ara, santral ekle, dokuz kayıp katsayısını düzenle.
- **Gerçek Üretim**: CSV/Excel sütunlarını eşleştir, kWh/MWh ve saat anlamını seç,
  önizlemeyi kontrol et ve kaydet. Eşleşen saha/saat yeniden yüklenirse gerçek kayıt güncellenir.
- **Karşılaştırma**: seçilen tahmin sürümünü gerçeklerle saatlik/günlük karşılaştır.
- **Senaryolar**: aynı santralin iki farklı kayıtlı tahminini ortak saatlerde karşılaştır.

Sayfa yenileme yalnızca yerel API üzerinden SQLite okumaları yapar. Open-Meteo'ya
ancak konum arama veya yeni tahmin işlemiyle, önbellek eksikse istek gönderilir.

## Veritabanı ve Faz 1 uyumluluğu

Paketteki `solar.db`, gönderdiğin `solar(4).db` dosyasının **değiştirilmemiş kopyasıdır**.
API ilk açılışta eksik tabloları ekler ve eski hava kayıtlarını ortak konum
önbelleğine aktarır. Mevcut santraller, tahmin ID'leri, saatlik sonuçlar ve
gerçek üretim kayıtları silinmez veya yeniden hesaplanmaz. İçe aktarma özgün
dosyayı etkilemez; yalnızca bu yeni klasördeki kopya kullanılır.

Yeni tablolar: `weather_cache_hours`, `raw_api_responses`, `location_results`,
`forecast_metadata`, `forecast_hour_inputs`. Bunlar yanıtın tamamını saklamak,
aynı konumdaki sahalarda tekrar isteği önlemek ve tahmin girdilerini dondurmak içindir.
Ham hava verisi, sonuçlar ve gerçek üretim ayrı tutulur.

`solar.db` örnek veri değil, gönderdiğin kayıtları içerir. `.gitignore` veritabanını,
logları ve `.venv` klasörünü Git dışında tutar. Kodları Git'e eklerken veritabanını
zorla ekleme. Sıfırdan boş veritabanıyla başlatıldığında ilk santral arayüzden eklenebilir.

## Yapı

| Konum | Sorumluluk |
| --- | --- |
| api.py / backend/ | Mevcut FastAPI, model, veritabanı, servis ve API sözleşmeleri |
| web/src/App.jsx | React kabuğu, gezinme ve santral seçimi |
| web/src/pages/ | Tahmin, santral/kayıp, yükleme, doğrulama ve senaryo akışları |
| web/src/api.js | Aynı kökenli /api HTTP istemcisi, iptal ve hata yönetimi |
| web/vite.config.js | /api önekini mevcut FastAPI yollarına yönlendiren proxy |
| tools/local-common.ps1 | Yerel servis yönetiminin ortak süreç/sahiplik yardımcıları |
| start-local.ps1, stop-local.ps1, status-local.ps1 | Hızlı başlatma, kapatma ve durum kontrolü |
| setup-local.ps1 | Python ortamı ve web bağımlılıklarının kurulumu |
| tests/ | Mevcut backend/model/kabul testleri |
| web/scripts/ | React tarayıcı kontrolleri |
| changes.md | Teknik geçiş ve bakım notları |

## Ortak ayarlar

Backend ayarları ve anlamları korunur:

```powershell
$env:SOLAR_DB_PATH = 'C:\veriler\solar.db'
$env:SOLAR_DAILY_API_LIMIT = '50'
.\baslat.bat
```

Göreli veritabanı yolları proje köküne göre çözülür. Varsayılan gerçek
solar.db'dir; Preview modu ayrı kopyayı kullanır. .env.example yalnız örnektir,
otomatik yüklenmez. Hızlı başlatıcı Vite proxy adresini kendi API portuna ayarlar.
Vite elle başlatılıyorsa SOLAR_API_BASE_URL hedefi değiştirilebilir.

## Endpoint sözleşmesi

| Metot | Yol | İşlem |
| --- | --- | --- |
| GET | `/health` | Bağlantı kontrolü |
| GET | `/api-usage` | Günlük hava servisi denemesi / uygulama sınırı |
| GET / POST | `/sites` | Santral listeleme / ekleme |
| GET / PUT | `/sites/{site_id}/losses` | Kayıp katsayılarını okuma / değiştirme |
| GET | `/geocoding?name=Ankara` | Önbellekli konum arama |
| POST | `/forecasts` | İleri veya geçmiş hava verisiyle hesaplama ve sürüm kaydı |
| GET | `/sites/{site_id}/forecasts` | Santralin tahmin geçmişi |
| GET | `/sites/{site_id}/forecasts/latest` | Son kayıtlı ileri/legacy tahmin |
| GET | `/forecasts/{run_id}` | Belirli tahmin ve saatlik sonuçları |
| GET | `/forecasts/{run_id}/export?format=csv` | CSV; format=xlsx ile Excel |
| GET | `/sites/{site_id}/actuals` | Gerçek üretim kayıtları |
| POST | `/actuals/import` | Doğrulanmış gerçek üretim satırlarını kaydetme |
| GET | `/forecasts/{run_id}/comparison` | Saatlik/günlük sapma ve hata analizi |
| GET | `/scenarios/compare?first_run_id=46&second_run_id=39` | Ortak saatlerde senaryo karşılaştırma |

Yeni ileri tahmin isteği:

```json
{"site_id": 12, "forecast_days": 3}
```

Eğim, azimut, panel sayısı/gücü, AC güç, yaş ve sıcaklık katsayısı opsiyonel
senaryo girdileridir; boş bırakılanlar saha kaydından alınır. Saha kaydı
senaryo nedeniyle değiştirilmez. Her başarılı hesaplama yeni `run_id` oluşturur.
`latest` güncellik garantisi değil, son kayıtlı sürümdür; parametreleri ve tarihleri kontrol et.

Geçmiş hesaplama:

```json
{"site_id": 12, "source": "historical", "start_date": "2026-10-10", "end_date": "2026-10-12"}
```

Bu sonuç ileri tahmin başarısı olarak etiketlenmez. Tamamlanmış geçmiş günler
seçilmelidir; arşivin yakın günleri henüz sunmaması durumunda açık hata döner.

## Saatler ve birimler — önemli

- Yeni tahminlerde saat damgası **saat bitişidir**: 15:00 = 14:00–15:00.
- Üç günlük ileri tahmin yarın 00:00'da başlayan 72 aralığı kapsar. Etiketler
  yarın 01:00'dan dördüncü gün 00:00'a kadardır. Günlük toplamlar aralık
  başlangıcının gününe göre hesaplanır; son 00:00 önceki güne dahildir.
- Önceki sürümün 00:00–23:00 etiketli sonuçları değiştirilmez. Bunlar bitiş
  semantiğiyle gösterildiğinde ilk/son günlük toplam kısmi olabilir.
- Gerçek dosyada başlangıç etiketi varsa arayüzden bunu seç: backend +1 saat
  uygular. Bitiş etiketi zaten varsa tekrar saat ekleme. Dakikası/saati bozuk,
  yinelenen, negatif veya sonlu olmayan değerler reddedilir; hatalı toplu
  yüklemede hiçbir satır yazılmaz. Saat dilimi içeren tarihler saha saatine çevrilir.
- Enerji kWh, ortalama güç kW'dır. Bir saatlik modelde sayısal değerler eşit
  olabilir; birimler farklıdır. CSV/Excel MWh girdisi istemcide kWh'a çevrilir.
- Gerçek üretim sıfırken yüzde sapma boş/null döner. Günlük toplamlar yalnız
  eşleşen saatlerden alınır; eksik/kısmi günler işaretlenir.
- Bu sürümün tam-gün kontrolleri Türkiye / Europe/Istanbul için test edilmiştir.
  Yaz-kış saati kullanan bölgelerin 23/25 saatlik günleri ayrıca uyarlanmalıdır.

## Model ve önbellek davranışı

Modelin NOCT=45°C, yıllık %0,5 yaşlanma, yük oranına bağlı inverter eğrisi ve
varsayılan DC %5 / AC %2 hesabı aynen korunmuştur. Dokuz özel katsayı girilirse
varsayılanların yerine kullanılır. Wind/rakım çekilse de mevcut formül bunları
doğrudan kullanmaz; izleyici hareketi ve ilk yıl için ayrı yaşlanma eklenmedi.

Önbellek süresi doldu diye aynı saatlere yeniden istek gönderilmez. Aynı
konum/saat dilimi/eğim/azimut ve kaynak için kayıtlar yeniden kullanılır.
Tahmin ile arşiv önbellekleri ayrıdır. API yanıtındaki tüm geçerli saatler ve
ham JSON saklanır. Eksik saat bulunan günler istenir. Günlük kota rezervasyonu
veritabanında atomiktir; tek worker içindeki eşzamanlı aynı talepler tekilleştirilir.

Bağlantı veya kota hatasında aynı teknik parametre/kayıp/sıcaklık katsayısına
uyan eski ileri tahmin varsa uyarıyla gösterilir; yeni tahmin sürümü yazılmaz.
Uygun eski kayıt yoksa açık hata döner. UI oluşturulma ve hava verisi yaşını gösterir.

## Testler

Backend/model:

```powershell
.\kurulum.bat -Dev
.\.venv\Scripts\python.exe -m pytest -q
```

React arayüzü için API ve Vite açıkken web/ içinde npm run test:smoke ve
npm run test:workflows çalıştırılır. Kurulu Chrome gerekir. Farklı adres için
GES_WEB_URL kullanılabilir. Testler mevcut santral/tahmin verilerini salt okunur
keşfeder; veri önkoşulu sağlanmayan kontroller açıkça atlanır. Workflow testleri
yazma isteklerini yalnız tarayıcı testinde yakalar; müşteri verilerine yazmaz.
Çalışan uygulama gerçek API'yi kullanır. Ayrıntılı sonuçlar DOGRULAMA.md içindedir.

Tarihsel CLI (API çağrısı/yazma yapmaz; önceki betiğin ham saat etiketi düzeni):

```powershell
python -m tools.historical_production --start 2026-10-10 --end 2026-10-12
```

## Kapsam ve sınırlar

Bu teslim yerel Faz 2 servisidir. Harici izleme sisteminin isteği/JSON sözleşmesi
paylaşılmadığından o sisteme canlı bağlantı yapıldığı iddia edilmez. Başka bir
sunucuya açılacaksa ağ erişimi ve kimlik doğrulaması ayrıca yapılandırılır.
Gerçek üretim doğruluğu, model kalibrasyonu ve eşit bilgi ufkunda ileri tahmin
karşılaştırması ayrı doğrulama çalışmasıdır. Referans yöntem ekranda yalnız
aynı saat alt kümesinde **geriye dönük** karşılaştırılır; veri yayın zamanları
bilinmeden ileri tahmin kazanımı iddiası yapılmaz.

GitHub incelemesi ve alınan mimari kararlar: `REFERANS_INCELEMESI.md`.
