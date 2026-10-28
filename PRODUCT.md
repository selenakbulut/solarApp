# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
GES işletmecileri ve enerji analistleri çalışma varsayımıdır; kullanıcı tasarım kararlarını devretti.

## Product Purpose
Güneş enerji santralleri için saatlik üretim tahmini oluşturmak, kayıtlı sürümleri incelemek ve gerçek üretimle karşılaştırmak.

## Operating Context
Türkçe yerel uygulama. FastAPI servisleri ve SQLite mevcut iş mantığını yönetir. Tek web istemcisi React/Vite'tır ve aynı API sözleşmesini kullanır. Streamlit istemcisi kullanıcının isteğiyle kaldırılmıştır. Hızlı başlatmada normal mod gerçek solar.db'yi, açık Preview modu ayrık kopyayı kullanır.

## Capabilities and Constraints
Santral listeleme/ekleme, konum arama, dokuz kayıp katsayısı, ileri/geçmiş tahmin, CSV/Excel export, CSV/Excel actual import, saatlik/günlük doğrulama ve iki tahminin senaryo karşılaştırması. Backend, üretim modeli ve mevcut veriler değişmez. Saat etiketleri aralık bitişidir; günlük özet API'den alınır. Kayıtlı sürüm güncel hava verisi garantisi taşımaz. Fallback ve geçmiş hesaplama uyarıları görünür tutulur.

## Evidence on Hand
README.md ve backend/routes gerçek API sözleşmesi. solar.db müşteri kayıtları içerir. Marka/logo/fotoğraf/testimonial sağlanmadı; uydurulmaz. Otomatik doğrulamada veritabanı kopyası kullanılır; normal çalışma gerçek veritabanına bağlıdır.

## Product Principles
- Hesaplama mantığı yalnız backend'de kalır.
- Sonuç ve veri kapsamı görünür olur.
- Teknik ayrıntılar gerektiğinde açılır.
- Yazma işlemleri açık eylem ve geri bildirim taşır.
