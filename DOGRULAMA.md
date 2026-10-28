# Doğrulama kaydı

27 Ekim 2026 React/Vite geçişi sonrası doğrulama. Ortam: Windows, Python 3.12.10,
Node.js 24.19.0, Windows PowerShell 5.1 ve PowerShell 7.

## Backend/model

Komut: `.venv\Scripts\python.exe -m pytest -q`

```text
38 passed, 1 skipped, 33 subtests passed
```

Önceki 41 testin üçü kaldırılan Streamlit istemcisine aitti. Backend/model/kabul
testleri değiştirilmedi veya devre dışı bırakılmadı. Yıllık kabul testi ayrı
`solar_yillik_test.db` bulunmadığı için atlanır; geçmiş sayılmaz.

API testleri geçici SQLite ve sahte hava yanıtı kullanır; canlı hava servisi
isteği göndermez. Saat bitişi, günlük özet, önbellek/kota, doğrulama, sürümlü kayıt,
fallback, gerçek üretim import, hata metrikleri ve CSV/XLSX sözleşmelerini denetler.

## React istemcisi

API ve Vite hızlı başlatıcıyla 18000/15173 portlarında, kopya veritabanıyla açıldı.
`GES_WEB_URL=http://127.0.0.1:15173` ile:

- `node web/scripts/smoke.mjs`: 13 başarılı, 0 hata, 0 atlama.
- `node web/scripts/workflows.mjs`: 11 başarılı, 0 hata, 0 atlama.
- Runtime browser hatası: 0. Kalıcı API yazımı: 0.
- `web/` içinde `node node_modules/vite/bin/vite.js build`: başarılı.

Smoke gerçek kayıt okuma, sayfa/santral/sürüm, grafik filtresi, CSV indirme,
mobil menü ve hata/yeniden deneme davranışlarını kontrol eder. Workflow, gerçek
render edilen formda CSV/XLSX, Windows-1254, MWh, saat başlangıcı, saha eşleştirme,
negatif/yinelenen veri, onay, kayıp yüzdesi ve tahmin/fallback isteklerini dener.
Yazmalar test içinde yakalanır; üretim uygulaması gerçek API istemcisidir.

Scriptler veriyi API üzerinden keşfeder. Boş veya yetersiz veri bulunan başka
kurulumlarda ilgili kontroller açık gerekçeyle atlanır. Atlanmış kontrol başarı
sayılmaz. Kanıt çıktıları `.local-preview/smoke-results.json` ve
`.local-preview/workflows-results.json` altındadır.

## Başlatma/kapatma

- Python/web ilk kurulum betiği `setup-local.ps1 -Dev`: başarılı.
- PS dosyalarının sözdizimi denetimi: başarılı.
- Windows PowerShell 5.1 üzerinde özel portlarla Preview başlangıcı ve status: başarılı.
- Aynı ayarla tekrarlı başlangıç aynı worker PID'lerini korudu.
- Farklı modla başlangıç ve dolu port devralma isteği reddedildi; çalışan süreçler korundu.
- Vite `/api/sites` proxy'si doğru backend'den 9 santrali okudu.
- Kapatma iki proje portunu boşalttı; başka state ile başlatılan servisleri etkilemedi.
- Normal modda `SOLAR_DB_PATH` ayrık test DB'siyle doğrulandı.
- Tekrarlı kapatma zararsız; stale PID/uyuşmayan komut kimliği sahiplik olarak kabul edilmez.
- `baslat.bat -Preview -NoBrowser`, `durum.bat`, `durdur.bat` varsayılan 8000/5173
  portlarında uçtan uca başarılı. Kontrol sonunda proje servisleri kapatıldı.

Başlatma/kapatma doğrulaması gerçek `solar.db` dosyasını değiştirmeden yapıldı.
Geçiş öncesi/sonrası backend kaynakları, `api.py` ve asıl `solar.db` SHA-256 değerleri
karşılaştırıldı; aynı kaldı. Yerel kanıt: `.local-preview/migration-baseline.json`.

## Sınırlar

Bu testler fiziksel modelin gerçek santrale isabetini veya ileri tahmin kalitesini
kanıtlamaz. Canlı Open-Meteo isteği/kota tüketimi, harici SCADA ve bulut dağıtımı
bu geçişin doğrulama kapsamına eklenmedi. Güncel teknik devir kaydı `changes.md`dir.
