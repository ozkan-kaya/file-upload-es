const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { extractText } = require('./textExtractor');
const {
    initElasticsearch,
    indexDocument,
    searchDocuments,
    deleteDocument,
    checkConnection,
    syncFilesWithElasticsearch
} = require('./elasticsearch');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS yapılandırması
app.use(cors());
app.use(express.json());

// Uzantıdan MIME türünü al
const getMimeType = (filename) => {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
        case '.pdf': return 'application/pdf';
        case '.doc': return 'application/msword';
        case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case '.xls': return 'application/vnd.ms-excel';
        case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        default: return 'application/octet-stream';
    }
};

// Uploads klasörünü oluştur (yoksa)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Multer yapılandırması
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        // Çakışma olmaması adına benzersiz dosya adları: dosyaadı-timestamp.uzantı
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        cb(null, name + '-' + Date.now() + ext);
    }
});

// İzin verilen dosya türleri: Word, PDF, Excel
const allowedMimeTypes = [
    'application/pdf', // PDF
    'application/msword', // Word (.doc)
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // Word (.docx)
    'application/vnd.ms-excel', // Excel (.xls)
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' // Excel (.xlsx)
];

const fileFilter = (req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Sadece PDF, Word ve Excel dosyaları yüklenebilir!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter
});

// Statik dosyalar - uploads klasörünü servis et
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Dosya yükleme endpoint'i - metin çıkarma ve Elasticsearch indeksleme ile
app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'Dosya seçilmedi' });
        }

        try {
            const filePath = path.join(uploadsDir, req.file.filename);

            // Yüklenen dosyadan metin çıkar
            console.log(`Metin çıkarılıyor: ${req.file.originalname}`);
            const content = await extractText(filePath, req.file.mimetype);
            console.log(`${content.length} karakter çıkarıldı`);

            // Belgeyi Elasticsearch'e indeksle
            const doc = {
                filename: req.file.filename,
                originalname: req.file.originalname,
                content: content,
                size: req.file.size,
                uploadDate: new Date()
            };

            await indexDocument(doc);

            res.json({
                message: 'Dosya başarıyla yüklendi ve indekslendi',
                file: {
                    filename: req.file.filename,
                    originalname: req.file.originalname,
                    size: req.file.size,
                    mimetype: req.file.mimetype,
                    path: `/uploads/${req.file.filename}`,
                    contentLength: content.length
                }
            });
        } catch (error) {
            console.error('Yükleme/İndeksleme hatası:', error);
            res.status(500).json({ error: 'Dosya yüklenirken veya indekslenirken hata oluştu' });
        }
    });
});

// Elasticsearch kullanarak arama endpoint'i
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q || '';
        console.log(`Aranan: "${query}"`);

        const results = await searchDocuments(query);

        const files = results.map(hit => ({
            filename: hit._source.filename,
            originalname: hit._source.originalname,
            size: hit._source.size,
            mimetype: getMimeType(hit._source.filename),
            uploadDate: hit._source.uploadDate,
            path: `/uploads/${hit._source.filename}`,
            score: hit._score,
            highlights: hit.highlight || {}
        }));

        res.json({
            files: files,
            total: results.length,
            query: query
        });
    } catch (error) {
        console.error('Arama hatası:', error);
        res.status(500).json({ error: 'Arama sırasında hata oluştu' });
    }
});

app.get('/api/files', async (req, res) => {
    try {
        const query = req.query.q || '';

        if (query) {
            // Eğer sorgu varsa Elasticsearch kullan
            const results = await searchDocuments(query);
            const files = results.map(hit => ({
                filename: hit._source.filename,
                originalname: hit._source.originalname,
                size: hit._source.size,
                uploadDate: hit._source.uploadDate,
                path: `/uploads/${hit._source.filename}`,
                highlights: hit.highlight || {}
            }));
            return res.json({ files: files });
        }

        // Aksi takdirde, dosya sistemindeki tüm dosyaları getir
        const fileList = fs.readdirSync(uploadsDir).map(filename => {
            const filePath = path.join(uploadsDir, filename);
            const stats = fs.statSync(filePath);

            return {
                filename: filename,
                size: stats.size,
                mimetype: getMimeType(filename),
                uploadDate: stats.mtime,
                path: `/uploads/${filename}`
            };
        });

        res.json({ files: fileList });
    } catch (error) {
        console.error('Dosyaları listeleme hatası:', error);
        res.status(500).json({ error: 'Dosyalar listelenirken hata oluştu' });
    }
});

// Dosya silme endpoint'i
app.delete('/api/files/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(uploadsDir, filename);

        // Dosyanın var olup olmadığını kontrol et
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Dosya bulunamadı' });
        }

        // Dosya sisteminden sil
        fs.unlinkSync(filePath);
        console.log(`Dosya sistemden silindi: ${filename}`);

        // Elasticsearch'ten sil
        await deleteDocument(filename);
        console.log(`Dosya Elasticsearch'ten silindi: ${filename}`);

        res.json({
            message: 'Dosya başarıyla silindi',
            filename: filename
        });
    } catch (error) {
        console.error('Dosya silme hatası:', error);
        res.status(500).json({ error: 'Dosya silinirken hata oluştu' });
    }
});

// Sağlık kontrolü
app.get('/api/health', async (req, res) => {
    const esConnected = await checkConnection();
    res.json({
        status: 'OK',
        message: 'Sunucu çalışıyor',
        elasticsearch: esConnected ? 'Bağlı' : 'Bağlı Değil'
    });
});

// Elasticsearch'ü başlat ve sunucuyu çalıştır
async function startServer() {
    try {
        console.log('Elasticsearch bağlantısı kontrol ediliyor...');
        const isConnected = await checkConnection();

        if (isConnected) {
            await initElasticsearch();

            // Dosyaları Elasticsearch ile senkronize et
            console.log('Dosyalar Elasticsearch ile senkronize ediliyor...');
            await syncFilesWithElasticsearch();
        } else {
            console.warn('Elasticsearch kullanılamıyor. Arama işlevi çalışmayacak.');
        }

        app.listen(PORT, () => {
            const address = process.env.ADDRESS || 'http://localhost';
            console.log(`Sunucu şurada çalışıyor: ${address}:${PORT}`);
            console.log(`Uploads dizini: ${uploadsDir}`);
        });
    } catch (error) {
        console.error('Sunucu başlatma hatası:', error);
        process.exit(1);
    }
}

startServer();
