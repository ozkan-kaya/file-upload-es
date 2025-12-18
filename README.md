# Dosya Yükleme ve Arama Sistemi (Elasticsearch Entegrasyonlu)

Angular (Frontend) ve Node.js (Backend) kullanılarak geliştirilmiş, Elasticsearch tabanlı güçlü bir dosya arama motoruna sahip dosya yönetim sistemidir.

Bu proje ile şunları yapabilirsiniz:
- **Akıllı Arama:** Elasticsearch altyapısı sayesinde yüklenen dosyaların (PDF, Word, Excel) hem isminde hem de **içeriğinde** tam metin arama yapın.
- **Döküman İçeriği Tarama:** Yüklenen dosyaların içeriği otomatik olarak metne dönüştürülür ve aranabilir hale gelir.
- **Hata Toleranslı (Fuzzy) Arama:** Yazım hatalarına rağmen doğru sonuçlara ulaşın (Örn: "rapor" yerine "rapr" yazsanız bile bulur).
- **Gelişmiş Filtreleme:** Dosya türü (PDF, Doc, XLS), yükleme tarihi ve boyuta göre dosyaları yönetin.
- **Kullanıcı Dostu Arayüz:** Arama sonuçlarında renklendirilmiş (highlight) eşleşmeler.

## Ön Koşullar

- **Node.js:** v18 veya üzeri
- **Elasticsearch:** v8.x (Yerel veya Docker üzerinde çalışır durumda olmalı)

## Kurulum

Projeyi indirdikten sonra hem frontend hem de backend bağımlılıklarını yükleyin:

```bash
# Backend
cd backend
npm install

# Frontend
cd frontend
npm install
```

## Yapılandırma (.env ve Ortam Değişkenleri)

Projenin çalışabilmesi için backend ve frontend ayarlarının yapılması gerekmektedir.

### 1. Backend Yapılandırması
`backend/.env` dosyası oluşturun ve aşağıdaki ayarları kendi ortamınıza göre düzenleyin:

```env
# Sunucu Ayarları
PORT=3000
ADDRESS=http://localhost

# Elasticsearch Ayarları
ELASTICSEARCH_NODE=http://localhost:9200
```

### 2. Frontend Yapılandırması
Frontend API bağlantı ayarları `frontend/src/environments/` klasöründedir.
- Eğer backend farklı bir portta çalışıyorsa, `environment.ts` ve `environment.development.ts` dosyalarındaki `apiUrl` değerini güncelleyin.

## Elasticsearch Kurulumu ve Kontrolü

Projenin çalışması için Elasticsearch'ün aktif olması gerekir.

Docker ile hızlı kurulum:
```bash
docker run -d --name elasticsearch -p 9200:9200 -e "discovery.type=single-node" -e "xpack.security.enabled=false" elasticsearch:8.11.1
```

Kurulumun başarılı olduğunu test etmek için:
```bash
curl http://localhost:9200
```

## 📂 Backend Dosya Yapısı ve İşlevleri

Scriptlerin arka planda kullandığı temel dosyalar şunlardır:

*   **`backend/index.js`**: Express sunucusunu ayağa kaldırır, API rotalarını tanımlar ve statik dosyaları sunar.
*   **`backend/elasticsearch.js`**: Elasticsearch bağlantısını yönetir. İndeksleme, silme ve karmaşık arama sorgularını (fuzzy, prefix, phrase matching) burada oluşturur.
*   **`backend/textExtractor.js`**: Yüklenen dosyaların (PDF, Word, Excel) içeriğini metne dönüştüren servistir.
*   **`backend/reindex.js`**: `npm run reindex` komutu ile çalışan scripttir. İndeksleri sıfırlayıp tüm dosyaları yeniden indeksler.
    > **Olası Kullanım Nedenleri:**
    > *   Elasticsearch arama algoritması veya analizörleri (`elasticsearch.js`) değiştiğinde.
    > *   Metin ayıklama mantığı (`textExtractor.js`) güncellendiğinde.
    > *   `uploads` klasörüne sistem dışından manuel dosya eklendiğinde veya silindiğinde veritabanını senkronize etmek için.

## ▶ Çalıştırma

Elasticsearch'ün çalıştığından emin olduktan sonra:

```bash
# Backend (http://localhost:3000)
cd backend
npm run dev
# Veya: npm start

# Frontend (http://localhost:4200)
cd frontend
ng serve
```