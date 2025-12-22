const { Client } = require('@elastic/elasticsearch');
const fs = require('fs');
const path = require('path');
const { extractText } = require('./textExtractor');

const client = new Client({
    node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200'
});

const INDEX_NAME = 'documents';

// Elasticsearch indeksini özel analizörler ve mapping ile başlat
async function initElasticsearch() {
    try {
        const indexExists = await client.indices.exists({ index: INDEX_NAME });

        if (!indexExists) {
            await client.indices.create({
                index: INDEX_NAME,
                body: {
                    settings: {
                        analysis: {
                            analyzer: {
                                filename_analyzer: {
                                    type: 'custom',
                                    tokenizer: 'standard',
                                    filter: ['lowercase', 'filename_word_delimiter']
                                }
                            },
                            filter: {
                                filename_word_delimiter: {
                                    type: 'word_delimiter',
                                    generate_word_parts: true,
                                    generate_number_parts: true,
                                    catenate_words: true,
                                    catenate_numbers: true,
                                    catenate_all: true,
                                    split_on_case_change: true,
                                    preserve_original: true,
                                    split_on_numerics: false  // Alfanümerik karakterleri bir arada tut (ör: "abc123")
                                }
                            }
                        }
                    },
                    mappings: {
                        properties: {
                            originalname: { type: 'text', analyzer: 'filename_analyzer' },
                            content: {
                                type: 'text',
                                analyzer: 'standard',
                                fields: {
                                    exact: { type: 'text', analyzer: 'whitespace' }  // Tam ifade eşleşmesi için
                                }
                            },
                            size: { type: 'long' },
                            uploadDate: { type: 'date' }
                        }
                    }
                }
            });
            console.log(`Elasticsearch indeksi '${INDEX_NAME}' oluşturuldu`);
        } else {
            console.log(`Elasticsearch indeksi '${INDEX_NAME}' zaten mevcut`);
        }
    } catch (error) {
        console.error('Elasticsearch başlatma hatası:', error.message);
        throw error;
    }
}

// Belgeyi Elasticsearch dizinine ekle
async function indexDocument(doc) {
    try {
        const response = await client.index({
            index: INDEX_NAME,
            id: doc.filename,  // Dosya adına göre benzersiz ID
            body: {
                filename: doc.filename,
                originalname: doc.originalname,
                content: doc.content || '',
                size: doc.size,
                uploadDate: doc.uploadDate || new Date()
            }
        });

        console.log(`Belge indekslendi: ${doc.filename}`);
        return response;
    } catch (error) {
        console.error('İndeksleme hatası:', error.message);
        throw error;
    }
}

// Gelişmiş 4 Katmanlı Strateji ile belge ara
async function searchDocuments(query) {
    try {
        if (!query || query.trim() === '') {
            const response = await client.search({
                index: INDEX_NAME,
                body: { query: { match_all: {} }, size: 100 }
            });
            return response.hits.hits;
        }

        const q = query.trim();

        const response = await client.search({
            index: INDEX_NAME,
            body: {
                query: {
                    bool: {
                        should: [
                            // 1. Tam Eşleşme (Content.exact ve Filename) - Boost 100
                            { match_phrase: { "content.exact": { query: q, boost: 100, slop: 0 } } },
                            { match_phrase: { filename: { query: q, boost: 100, slop: 0 } } },

                            // 2. VE Eşleşmesi (Content ve Filename) - Boost 50
                            {
                                multi_match: {
                                    query: q,
                                    fields: ['filename^2', 'content'],
                                    operator: 'and',
                                    boost: 50
                                }
                            },

                            // 3. Bulanık Eşleşme (Content ve Filename) - Boost 10
                            {
                                multi_match: {
                                    query: q,
                                    fields: ['filename', 'content'],
                                    fuzziness: 'AUTO',
                                    prefix_length: 1,
                                    boost: 10
                                }
                            },

                            // 4. VEYA Eşleşmesi (Content ve Filename) - Boost 1
                            {
                                multi_match: {
                                    query: q,
                                    fields: ['filename', 'content'],
                                    operator: 'or',
                                    boost: 1
                                }
                            }
                        ],
                        minimum_should_match: 1
                    }
                },
                highlight: {
                    pre_tags: ['<span class="highlight">'],
                    post_tags: ['</span>'],
                    order: 'score',
                    // Önemli: highlight_query bulanık eşleşmeleri de kapsamalı (fuzzy highlighting için)
                    highlight_query: {
                        bool: {
                            should: [
                                { match: { "content.exact": { query: q } } },
                                { match: { content: { query: q, fuzziness: 'AUTO' } } },
                                { match: { filename: { query: q, fuzziness: 'AUTO' } } }
                            ]
                        }
                    },
                    fields: {
                        content: { fragment_size: 150, number_of_fragments: 5, type: 'plain' },
                        "content.exact": { fragment_size: 150, number_of_fragments: 5 },
                        filename: {},
                        originalname: {}
                    }
                },
                size: 100
            }
        });

        return response.hits.hits;

    } catch (error) {
        console.error('Arama hatası:', error.message);
        throw error;
    }
}

// Elasticsearch'ten belge sil
async function deleteDocument(filename) {
    try {
        await client.delete({
            index: INDEX_NAME,
            id: filename
        });
        console.log(`Belge silindi: ${filename}`);
    } catch (error) {
        if (error.meta?.statusCode !== 404) {
            console.error('Silme hatası:', error.message);
        }
    }
}

// Tüm indeksi sil
async function deleteIndex() {
    try {
        if (await client.indices.exists({ index: INDEX_NAME })) {
            await client.indices.delete({ index: INDEX_NAME });
            console.log(`İndeks '${INDEX_NAME}' silindi`);
        } else {
            console.log(`İndeks '${INDEX_NAME}' mevcut değil`);
        }
    } catch (error) {
        console.error('İndeks silme hatası:', error.message);
        throw error;
    }
}

// Tüm belgeleri getir
async function getAllDocuments() {
    try {
        const response = await client.search({
            index: INDEX_NAME,
            body: {
                query: { match_all: {} },
                size: 10000
            }
        });
        return response.hits.hits;
    } catch (error) {
        if (error.meta?.statusCode === 404) {
            return [];  // İndeks henüz mevcut değil
        }
        console.error('Tüm belgeleri getirme hatası:', error.message);
        throw error;
    }
}

// Elasticsearch bağlantısını kontrol et
async function checkConnection() {
    try {
        await client.ping();
        console.log('Elasticsearch bağlantısı başarılı');
        return true;
    } catch (error) {
        console.error('Elasticsearch bağlantısı başarısız:', error.message);
        return false;
    }
}

// Dosya uzantısından MIME türünü al
const getMimeType = (filename) => {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
        case '.pdf': return 'application/pdf';
        case '.doc': return 'application/msword';
        case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case '.xls': return 'application/vnd.ms-excel';
        case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        default: return null; // Desteklenmeyen tür
    }
};

// Dosya türünün desteklenip desteklenmediğini kontrol et
const isSupportedFileType = (filename) => {
    return getMimeType(filename) !== null;
};

// Uploads dizinini Elasticsearch ile senkronize et
async function syncFilesWithElasticsearch() {
    const uploadsDir = path.join(__dirname, 'uploads');
    try {
        console.log('Dosya senkronizasyonu başlatılıyor...');

        // Uploads dizini yoksa oluştur
        if (!fs.existsSync(uploadsDir)) {
            console.log('Uploads dizini bulunamadı. Oluşturuluyor...');
            fs.mkdirSync(uploadsDir);
            console.log('Senkronizasyon tamamlandı: Senkronize edilecek dosya yok.');
            return;
        }

        // Uploads dizinindeki dosyaları al
        const filesInDirectory = fs.readdirSync(uploadsDir)
            .filter(filename => {
                const filePath = path.join(uploadsDir, filename);
                const stats = fs.statSync(filePath);
                return stats.isFile() && !filename.startsWith('.');
            });

        console.log(`Uploads dizininde ${filesInDirectory.length} dosya bulundu`);

        // Elasticsearch'teki tüm belgeleri al
        const documentsInES = await getAllDocuments();
        const filenamesInES = new Set(documentsInES.map(doc => doc._id));

        console.log(`Elasticsearch'te ${filenamesInES.size} belge bulundu`);

        // Elasticsearch'te olup diskte olmayan (yetim) kayıtları bul
        const orphanedRecords = documentsInES.filter(doc =>
            !filesInDirectory.includes(doc._id)
        );

        // Yetim kayıtları sil
        for (const doc of orphanedRecords) {
            console.log(`Yetim kayıt siliniyor: ${doc._id}`);
            await deleteDocument(doc._id);
        }

        if (orphanedRecords.length > 0) {
            console.log(`${orphanedRecords.length} yetim kayıt Elasticsearch'ten silindi`);
        }

        // Diskte olup Elasticsearch'te olmayan yeni dosyaları bul
        const newFiles = filesInDirectory.filter(filename =>
            !filenamesInES.has(filename) && isSupportedFileType(filename)
        );

        // Yeni dosyaları indeksle
        let indexedCount = 0;
        let skippedCount = 0;

        for (const filename of newFiles) {
            const filePath = path.join(uploadsDir, filename);
            const mimetype = getMimeType(filename);

            if (!mimetype) {
                console.log(`Desteklenmeyen dosya türü atlanıyor: ${filename}`);
                skippedCount++;
                continue;
            }

            try {
                console.log(`Yeni dosya indeksleniyor: ${filename}`);
                const stats = fs.statSync(filePath);

                // Metni çıkar
                const content = await extractText(filePath, mimetype);

                // Belgeyi indeksle
                await indexDocument({
                    filename: filename,
                    originalname: filename,
                    content: content,
                    size: stats.size,
                    uploadDate: stats.mtime
                });

                console.log(`Başarıyla indekslendi: ${filename}`);
                indexedCount++;

            } catch (fileError) {
                console.error(`${filename} indekslenirken hata oluştu:`, fileError.message);
            }
        }

        // Özet
        console.log('Senkronizasyon tamamlandı:');
        console.log(`  - ${orphanedRecords.length} yetim kayıt silindi`);
        console.log(`  - ${indexedCount} yeni dosya indekslendi`);
        if (skippedCount > 0) {
            console.log(`  - ${skippedCount} desteklenmeyen dosya atlandı`);
        }

    } catch (error) {
        console.error('Senkronizasyon başarısız:', error);
        throw error;
    }
}

module.exports = {
    initElasticsearch,
    indexDocument,
    searchDocuments,
    deleteDocument,
    deleteIndex,
    getAllDocuments,
    checkConnection,
    syncFilesWithElasticsearch
};
