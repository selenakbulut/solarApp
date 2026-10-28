# Teknik değişiklik ve devir notları

Tarih: 27 Ekim 2026

Bu belge tasarım dilini anlatmaz. Mevcut GES projesinin Streamlit'ten
React/Vite'a geçirilmesi, çalıştırılması ve bakımına ilişkin teknik kayıttır.
Projeyi devralan kişi veya yapay zekâ için başlangıç noktasıdır.

## 1. Kapsam ve korunan iskelet

Önce: Streamlit Python istemcisi → HTTP → FastAPI → mevcut model/SQLite.

Şimdi: React/Vite web istemcisi → `/api` proxy → aynı FastAPI → aynı model/SQLite.

- `api.py` ve `backend/` uygulama kodu değiştirilmedi.
- Endpoint yolları, HTTP metotları, istek/yanıt şemaları ve hata davranışları korunur.
- Üretim modeli, hava servisi, önbellek/kota, repository ve SQL mantığı backend'dedir.
- Backend kaynakları ve asıl `solar.db` için geçiş öncesi/sonrası SHA-256
  karşılaştırması yapıldı; değişiklik bulunmadı.
- FastAPI ve Vite hâlâ iki ayrı servistir. Hızlı başlatıcı onları birlikte yönetir;
  backend React içine taşınmadı veya tek sunucuya gömülmedi.

## 2. Streamlit'in kaldırılması

Kaldırılan kaynaklar:

- `app.py`: eski Streamlit giriş noktası.
- `frontend/application.py`, `api_client.py`, `charts.py`, `imports.py`.
- `frontend/pages/` içindeki beş Python sayfası ve paket `__init__.py` dosyaları.
- `tests/test_frontend.py`: iki Streamlit AppTest ve eski Python import yardımcısının testi.

`requirements.txt` içinden yalnız `streamlit` ve `altair` çıkarıldı.
`requests`, `pandas`, `openpyxl`, `timezonefinder`, `tzdata` ve FastAPI/Uvicorn
bağımlılıkları backend tarafından kullanıldığından korundu. Eski sanal ortamda
kurulu Streamlit paketleri bulunabilir; artık uygulama tarafından kullanılmazlar.
Yerel `frontend/` altında kalmış `__pycache__` dosyaları kaynak kod değildir ve
çalıştırma akışına dahil değildir.

Eski `python -m streamlit run app.py` komutu ve 8501 portu artık kullanılmaz.

## 3. React istemcisinin sorumlulukları

Yeni frontend `web/` altındadır:

| Dosya/klasör | Sorumluluk |
| --- | --- |
| `web/src/main.jsx`, `App.jsx` | React başlangıcı, gezinme, seçili santral ve sayfa durumu |
| `web/src/pages/Forecasts.jsx` | Kayıtlı tahmin, yeni ileri/geçmiş hesaplama, export |
| `web/src/pages/Sites.jsx` | Santral listesi/ekleme, konum arama, dokuz kayıp katsayısı |
| `web/src/pages/Actuals.jsx` | CSV/XLSX okuma, sütun/saha eşleştirme, doğrulama ve import |
| `web/src/pages/Analysis.jsx` | Gerçek üretim doğrulaması ve iki tahminin senaryo karşılaştırması |
| `web/src/api.js` | HTTP istekleri, iptal/zaman aşımı, hata ve tarih/sayı biçimleme |
| `web/src/components/` | Ortak kontroller, tablolar ve grafik bileşenleri |
| `web/vite.config.js` | Geliştirme ve paket önizlemesinde FastAPI proxy |
| `web/package.json`, `pnpm-lock.yaml` | Web bağımlılıkları ve kilitli sürümler |

Bu arayüz mock değildir. Üretim kodu `fetch('/api' + path)` ile gerçek API'ye
bağlanır. Santral, tahmin, kayıp ve gerçek üretim kaydı gibi yazma işlemleri API'ye
gider. Yalnız tarayıcı testlerindeki istek yakalama, test yazmalarını taklit eder.
Test dosyaları uygulamanın çalışma paketine import edilmez.

API ayrımı örneği: tarayıcının `/api/sites` isteği FastAPI'deki mevcut `/sites`
endpoint'ine iletilir. Backend'e `/api` öneki veya CORS değişikliği eklenmedi.

Dosya okuma/önizleme ve istemci doğrulamaları Python UI'dan JavaScript'e taşındı.
UTF-8/Windows-1254 CSV, XLSX, MWh→kWh dönüşümü, çoklu saha eşleştirme ve saat
başlangıcı/bitişi seçenekleri korunur. Başlangıç etiketine +1 saati backend uygular;
frontend payload'a ikinci kez saat eklemez. Son doğrulama ve atomik kayıt yine
backend'in sorumluluğudur. Günlük üretim toplamları istemcide yeniden gruplanmaz;
API'nin `daily`/`complete_day` sonuçları kullanılır.

## 4. Kurulum ve tek komutla yönetim

Windows için Python 3.12 ve Node.js 22.12+ gerekir. npm veya pnpm kullanılabilir.
Kilitli web kurulumu pnpm 11.25.0 ile doğrulandı.

İlk kurulum:

```powershell
.\kurulum.bat
# Test bağımlılıkları da isteniyorsa:
.\kurulum.bat -Dev
```

Günlük kullanım:

```powershell
.\baslat.bat
.\durum.bat
.\durdur.bat
```

Bu BAT dosyaları çift tıklanabilir. `baslat.bat` API ve Vite'ı arka planda,
görünür terminal pencereleri açmadan başlatır ve tarayıcıyı açar. Başlatma işleminin
tamamlanması uygulamanın kapanması anlamına gelmez; kapatmak için `durdur.bat` gerekir.

PowerShell karşılıkları:

```powershell
.\start-local.ps1 -NoBrowser
.\status-local.ps1
.\stop-local.ps1
```

Dosyalar:

- `setup-local.ps1` / `kurulum.bat`: `.venv` ve bağımlılıkları hazırlar.
- `start-local.ps1` / `baslat.bat`: servisleri başlatır.
- `stop-local.ps1` / `durdur.bat`: servisleri kapatır.
- `status-local.ps1` / `durum.bat`: servis, adres ve veritabanını gösterir.
- `tools/local-common.ps1`: ortak süreç/sahiplik, kilit ve hazır olma yardımcıları.

Betikler proje konumunu kendi dosya yollarından bulur; başka çalışma dizininden
çağrılabilir. Başka bilgisayara taşınmış bozuk `.venv`, kurulum sırasında mevcut
Python 3.12 ile onarılır. Sağlıklı ortam yeniden yaratılmaz. Unicode kullanıcı
yolları için Python yorumlayıcı yolu ASCII JSON üzerinden okunur.
Paket hazırlama kontrolünde Node/Python sürüm sorguları Windows PowerShell 5.1'in
tırnak aktarma davranışına da uyarlandı; `kurulum.bat`ın kullandığı kabukla doğrulandı.

Node önce isteğe bağlı `GES_NODE_PATH`, sonra PATH üzerinden bulunur. Bu makinedeki
Codex'in paketli Node/pnpm yolu yalnız son bir yerel fallback'tir; başka makinede
normal Node/npm kurulumu yeterlidir. Başka projeye veya Codex'e zorunlu çalışma
bağımlılığı yoktur.

`web/pnpm-workspace.yaml`, yalnız kilitli `esbuild@0.28.2` kurulum betiğine izin
verir. pnpm 11'in ilk kurulumda etkileşimli build onayı istemesi bu paket için
giderilmiştir; bütün bağımlılık betikleri genel olarak açılmamıştır.

## 5. Gerçek veritabanı ve önizleme ayrımı

Normal `baslat.bat`:

- `SOLAR_DB_PATH` tanımlıysa onu, değilse proje kökündeki gerçek `solar.db` dosyasını kullanır.
- Göreli veritabanı yolu proje köküne göre çözülür.
- UI'dan yapılan kayıtlar bu veritabanına yazılır.

Ayrı önizleme:

```powershell
.\baslat.bat -Preview
```

Bu mod `.local-preview/solar.preview.db` kullanır. İlk kullanımda mevcut `solar.db`
kopyalanır; var olan önizleme kopyası ezilmez. API ve iş mantığı aynıdır, veri
dosyası farklıdır. Normal ve Preview arasında geçmeden önce `durdur.bat` çalıştırın.

Backend'in mevcut ilk açılış şema hazırlaması korunur. Normal modu ilk kez
başlatmak backend'in kendi şema hazırlamasını gerçek veritabanında çalıştırabilir;
bu geçiş için yeni bir migration veya model değişikliği eklenmemiştir.

## 6. Portlar, ayarlar ve süreç güvenliği

Varsayılan arayüz: `http://127.0.0.1:5173`.
API: `http://127.0.0.1:8000`; Swagger: `/docs`.
İki servis de yalnız yerel IPv4 adresinde dinler; tek Uvicorn worker kullanılır.

```powershell
.\start-local.ps1 -Preview -NoBrowser -ApiPort 18000 -WebPort 15173
```

Başlatıcı Vite'ın `SOLAR_API_BASE_URL` değişkenini seçilen API portuna ayarlar.
Çağıran terminaldeki önceki ortam değişkenleri işlem sonunda geri yüklenir.
`SOLAR_DAILY_API_LIMIT` backend'de önceki anlamını korur.
`.env.example` yalnız ayar örneğidir; `.env` otomatik okunmaz.

Süreç kaydı/loglar `.local-run/` altındadır:

- `processes.json`: mod, mutlak proje/DB yolu, portlar ve servis kimlikleri.
- `api.stdout.log`, `api.stderr.log`, `web.stdout.log`, `web.stderr.log`.
- `lifecycle.lock`: eşzamanlı başlatma/kapatmayı engeller.

`-StateDirectory` verilirse start/stop/status aynı dizinle çağrılmalıdır.
Kapatma öncesi PID, oluşturulma zamanı, executable ve komut satırı doğrulanır.
Windows venv launcher'ı ile gerçek Python worker'ı ayrı kaydedilir; doğrulanmış
çocuk süreçler de kapatılır. Başka uygulamaya ait dolu portlar veya eski elle
başlatılmış servisler sessizce devralınmaz. Aynı ayarla tekrar başlatma yeni süreç
üretmez; farklı mod/DB/port için önce kapatma istenir. Kısmi başlatma hatasında
yalnız o denemede başlatılan doğrulanmış süreçler geri alınır.

## 7. Derleme, test ve dağıtım sınırı

```powershell
.\.venv\Scripts\python.exe -m pytest -q
cd web
npm run build
npm run test:smoke
npm run test:workflows
```

Web testleri için API ve Vite açık, Chrome kurulu olmalıdır. Farklı adres:
`$env:GES_WEB_URL = 'http://127.0.0.1:15173'`.
Testler mevcut veriden uygun santral/tahmini keşfeder; sabit 12/13/49 ID'leri
aranmaz. Önkoşulu olmayan kontroller gerekçeyle atlanır, geçmiş sayılmaz.
Her iki browser scripti API yazmalarını engeller/yakalar. Müşteri kaydı oluşturmazlar.

Doğrulanan sonuçlar:

- Backend/model/kabul: **38 geçti, 1 atlandı, 33 alt kontrol geçti**.
- React smoke: **13 geçti**; workflow: **11 geçti**, atlanan yok.
- Web üretim derlemesi başarılı.
- Windows PowerShell 5.1 ile tekrarlı başlatma, mod uyuşmazlığı, port çakışması,
  status, Preview, normal modda `SOLAR_DB_PATH` ve kapatma doğrulandı.
- Üç BAT sarmalayıcısı da varsayılan portlarda uçtan uca doğrulandı. Önceki
  geliştirme oturumunun süreçleri kimlikleri kontrol edilerek emekli edildi;
  kontrol sonunda servisler kapalı bırakıldı. `baslat.bat` normal kullanım için hazırdır.
- Eski 41 Python testinden 3'ü emekli Streamlit istemcisine aitti. API/model
  testleri kapatılmadı; yeni UI doğrulaması browser scriptlerine taşındı.
- Yıllık kabul testi ayrı `solar_yillik_test.db` olmadığı için atlanır.

`npm run build` çıktısı `web/dist/` içindedir. `npm run preview`, 4173 portunda
paketi ve aynı API proxy'sini yerelde gösterir. Hosting yapılacaksa statik istemci
ve `/api` reverse proxy ayrıca kurulmalıdır; Vite dev server üretim hosting'i değildir.
Bu çalışma kimlik doğrulama, harici SCADA bağlantısı veya buluta dağıtım eklemez.

## 8. Devralan yapay zekâ için

Önce bu belgeyi, `README.md`, `web/src/api.js`, `web/vite.config.js` ve mevcut
`backend/routes/` sözleşmelerini okuyun. Frontend için Streamlit dosyalarını
yeniden kurmayın; Python yalnız backend ve analiz araçları içindir. Mevcut model,
saat bitişi anlamı, birimler ve kayıt şemaları bu çalışmanın dışında tutulmuştur.

`.venv/`, `node_modules/`, `web/dist/`, `.local-run/`, `.local-preview/`, DB ve loglar
makineye ait/üretilen çıktılardır; başka bilgisayara hazır ortam diye taşınmaz.
Yeni makinede bağımlılıkları kurun, gerçek DB'yi ayrıca taşıyın ve süreçleri yeniden
başlatın. Eski PID manifest'lerini taşımayın. `graphify-out/` varsa ilk incelemenin
üretilmiş grafiğidir; kaldırılmış Streamlit yollarını içerebilir ve güncel kaynak
yerine otorite kabul edilmemelidir.
