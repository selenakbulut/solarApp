# GES arayüz sistemi

Kullanıcı web istemcisi teknoloji seçimini ve tasarım kararlarını devretti. Daha sonra ML_Deneme projesinin cam yüzeylerini ve özellikle hareketli güneş paneli arka planını görsel referans olarak seçti. Bu açık tercih önceki Dose uyarlamasının malzeme kararlarından önceliklidir.

## Görsel yön

Referans: C:/Users/Yazılım/Desktop/Sistem/ML_Deneme/ai_ozet/arayuz/index.html. Referans proje salt okunur incelenir; modeline veya servislerine bağlanılmaz.

Soğuk taş tonları, grafit gezinme alanı, sıcak amber enerji serisi ve koyu yeşil eylemler. Cam etkisi gezinme ve çalışma alanını arka plandan ayırır. GES'in imzası gerçek saatlik üretim eğrisi ve API'nin günlük özetidir. Sahte metrik, müşteri iddiası veya marka eklenmez.

## Katmanlar ve okunabilirlik

- En arkada referanstaki perspektif güneş paneli tarlası yavaş hareket eder.
- Yüzen grafit gezinme alanı ve üst çubuk hafif buzlu camdır.
- Ana dış çerçeve kullanıcının ince ayarıyla yaklaşık %85 opaklıkta ve 24px blur ile arka planı hafifçe geçirir. İç metrik, grafik ve bilgi yüzeyleri korunur. Blur desteği olmayan tarayıcıda opak yüzey kullanılır.
- Grafik ve tabloların veri yüzeyleri opaktır. Panel çizgileri veya gökyüzü değişimleri sayısal verinin arkasına taşınmaz.
- Kontrast yalnız blur veya yazı gölgesine dayanmaz. Renkler semantik tokenlardan gelir; alan sınırları ve klavye odağı ayrıca doğrulanır.

## Hareket

- Arka plan çizimi en fazla 14 FPS ve DPR 1,5 kullanır; sekme görünmezken durur.
- GES enerji kelime işareti sabittir. Çevresindeki 32 saniyelik yörüngede güneş yükselir, gün batımında turunculaşır, alt yörüngede aya dönüşür ve yeniden gün doğumuna döner. Alt açıklama kaldırılmıştır.
- Üst çubuktaki hareket düğmesi arka planı ve logo döngüsünü durdurur/başlatır. Tercih yerel olarak saklanır. Logo görünmezken döngüsü durur.
- prefers-reduced-motion etkinse sahne sabit kalır; sistem tercihi aşılmaz.
- İmleci takip eden parlama, grain veya veri üzerinde dekoratif hareket yoktur.

## Uygulama sistemi

- Yerel Instrument Sans, sabit uygulama yazı ölçeği, tabular rakamlar ve belirgin birimler.
- Mevcut beş hedef korunur. Telefonlarda gezinme menü düğmesiyle açılır; aktif santral üst çubuktan seçilir.
- Veri bölgelerinde dolu, yükleniyor, boş ve hata durumları; yazma işlemlerinde bekleme ve gerçek sonuç bildirimi bulunur.
- Kontroller 44px etkileşim hedefi ve görünür klavye odağı taşır. Mobil tablolar kendi alanında kayar ve ilk sütun sabittir.
- Yeni görsel katmanlar API istemcisini, formları ve iş akışlarını değiştirmez.

## İşlevsel sınırlar

Backend, üretim modeli ve mevcut veriler korunur. Kullanıcının isteğiyle Streamlit kaldırılmış; React/Vite tek istemci olmuştur. Günlük özet API'den gelir. 00:00 önceki üretim gününe aittir. Tahmin kaynağı, oluşturulma zamanı, saat dilimi ve hava yaşı açıklanır. Geçmiş hesaplama ileri tahmin diye sunulmaz. Normal başlatma gerçek veritabanını, açık önizleme modu ve otomatik doğrulama kopyayı kullanır.
