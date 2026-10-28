# Referans incelemesi ve mimari kararlar

> Bu belge ilk FastAPI + Streamlit ayrıştırmasının tarihsel kaydıdır.
> Streamlit istemcisi 27 Ekim 2026'da kaldırıldı; tek istemci `web/` altındaki
> React/Vite uygulamasıdır. Güncel çalıştırma ve geçiş bilgileri `README.md`
> ve `changes.md` içindedir. Aşağıdaki eski dosya yolları tarihsel bağlamı korur.

İncelenen depo: https://github.com/LordStylo/ges-tahmin/tree/main

İncelenen commit: `278a2a5f38c500574987e4774be960e31cb069b8`

GitHub web sayfası arama aracında açılamadığı için depo salt okunur olarak
Git ile indirildi; README ve `src/ges_forecast` altındaki uygulama, model,
veri katmanı, analiz ve depolama kodu incelendi. Depo değiştirilmedi.

| Konu | Referans depoda | Bu teslimdeki karar |
| --- | --- | --- |
| Web sunucusu | `wsgiref.simple_server`, WSGI uygulaması; FastAPI değil | FastAPI + Uvicorn backend, Streamlit HTTP istemcisi |
| Katmanlar | Model, hava, depolama, analiz modülleri ayrı | Aynı sorumluluk ayrımı; ayrıca router, schema, repository, service ve UI sayfaları |
| Veritabanı | Ayrı şema, UUID tahmin ID'leri | Mevcut `sites`, `forecast_runs`, `forecast_results`, `actual_production` ve integer ID'ler korunur |
| Ön bellek | 60 dakika tazelik penceresinden sonra yeniden çağrı mümkün | Aynı saklı konum/saat için süre dolması gerekçesiyle yeniden çağrı yapılmaz |
| Azimut | Pusulada kuzey 0°, servise dönüştürme | Kullanıcının mevcut güney 0° Open-Meteo referansı korunur; çift dönüşüm yapılmaz |
| Fiziksel model | Rüzgâr etkisi ve ilk yıl ayrı yaşlanma dahil farklı model | Gönderilen `solar_model(6).py` birebir korunur; bu çalışma model kalibrasyonu değildir |
| Gerçek üretim analizi | Saat ve hava tipi kırılımları, dünün aynı saati referansı | Backend analizi; model ve referans yalnız ortak alt kümede, geriye dönük etiketiyle karşılaştırılır |
| Dışa aktarım | CSV / XLSX | Backend'de CSV / XLSX; UI yalnız indirme isteği gönderir |

Referans deponun şeması veya modeli bu projeye kopyalanmadı. Amacımız,
kullanıcının verisini yeni bir uygulamanın içine zorla taşımak yerine mevcut
projenin fiziksel hesabını ve kayıt geçmişini koruyarak servis katmanı eklemekti.

## Kaynak dosyaların yeni karşılıkları

| Gönderilen dosya | Yeni karşılık |
| --- | --- |
| `app(20261026-195955).py` | `frontend/application.py`, `pages/`, `charts.py`, `imports.py` |
| `database(7).py` | `backend/database.py`, `legacy_schema.py`, `repositories/` |
| `solar_model(6).py` | `backend/model.py` (birebir) |
| `production(6).py` | `backend/repositories/forecasts.py` ve `services/forecasts.py` |
| `save_weather(6).py`, `historical_weather(3).py` | `backend/services/weather.py`, `repositories/weather.py` |
| `geocoding(4).py` | WeatherService.geocode ve konum önbelleği |
| `test_faz1_sahalar1(1).py` | `tests/test_phase1_acceptance.py` (import ve DB yolu güncellendi) |
| `test_gecmis_uretim_3_saha(4).py` | `tools/historical_production.py` (bağlantı kapanışı da düzeltildi) |
| `solar(4).db` | Pakette `solar.db`; ham kopya, ilk açılışta ek şema hazırlanır |

API girdileri sunucuda doğrulanır. Frontend dosya sütunlarını eşleştirip
gönderilecek JSON'u hazırlar; model veya SQL kodu çalıştırmaz. POST /forecasts
hava önbelleği → veri → model → atomik tahmin kaydı zincirini yürütür.

İstemci için adres tek yerde `frontend/api_client.py` içindedir ve ortam
değişkeniyle değiştirilebilir. Backend veritabanı yolu çalışma klasöründen
bağımsızdır; tüm bağlantılar finally/context manager ile kapatılır.
