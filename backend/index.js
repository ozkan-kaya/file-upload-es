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
    checkConnection
} = require('./elasticsearch');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS yapılandırması
app.use(cors());
app.use(express.json());

// Helper to get mimetype from extension
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

// Allowed file types: Word, PDF, Excel
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

// Static files - uploads klasörünü servis et
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// File upload endpoint with text extraction and Elasticsearch indexing
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

            // Extract text from the uploaded file
            console.log(`Extracting text from: ${req.file.originalname}`);
            const content = await extractText(filePath, req.file.mimetype);
            console.log(`Extracted ${content.length} characters`);

            // Index document in Elasticsearch
            const doc = {
                filename: req.file.filename,
                originalname: req.file.originalname,
                content: content,
                mimetype: req.file.mimetype,
                size: req.file.size,
                uploadDate: new Date(),
                path: `/uploads/${req.file.filename}`
            };

            await indexDocument(doc);

            res.json({
                message: 'Dosya başarıyla yüklendi ve indexlendi',
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
            console.error('Upload/Index error:', error);
            res.status(500).json({ error: 'Dosya yüklenirken veya indexlenirken hata oluştu' });
        }
    });
});

// Search endpoint using Elasticsearch
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q || '';
        console.log(`Searching for: "${query}"`);

        const results = await searchDocuments(query);

        const files = results.map(hit => ({
            filename: hit._source.filename,
            originalname: hit._source.originalname,
            size: hit._source.size,
            mimetype: hit._source.mimetype || getMimeType(hit._source.filename),
            uploadDate: hit._source.uploadDate,
            path: hit._source.path,
            score: hit._score,
            highlights: hit.highlight || {}
        }));

        res.json({
            files: files,
            total: results.length,
            query: query
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Arama sırasında hata oluştu' });
    }
});

app.get('/api/files', async (req, res) => {
    try {
        const query = req.query.q || '';

        if (query) {
            // If there's a query, use Elasticsearch
            const results = await searchDocuments(query);
            const files = results.map(hit => ({
                filename: hit._source.filename,
                originalname: hit._source.originalname,
                size: hit._source.size,
                uploadDate: hit._source.uploadDate,
                path: hit._source.path,
                highlights: hit.highlight || {}
            }));
            return res.json({ files: files });
        }

        // Otherwise, return all files from filesystem
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
        console.error('List files error:', error);
        res.status(500).json({ error: 'Dosyalar listelenirken hata oluştu' });
    }
});

// Health check
app.get('/api/health', async (req, res) => {
    const esConnected = await checkConnection();
    res.json({
        status: 'OK',
        message: 'Server is running',
        elasticsearch: esConnected ? 'Connected' : 'Disconnected'
    });
});

// Initialize Elasticsearch and start server
async function startServer() {
    try {
        console.log('Checking Elasticsearch connection...');
        const isConnected = await checkConnection();

        if (isConnected) {
            await initElasticsearch();
        } else {
            console.warn('Elasticsearch is not available. Search functionality will not work.');
        }

        app.listen(PORT, () => {
            const address = process.env.ADDRESS || 'http://localhost';
            console.log(`Server running on ${address}:${PORT}`);
            console.log(`Uploads directory: ${uploadsDir}`);
        });
    } catch (error) {
        console.error('Server startup error:', error);
        process.exit(1);
    }
}

startServer();
