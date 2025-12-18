const { Client } = require('@elastic/elasticsearch');

const client = new Client({
    node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200'
});

const INDEX_NAME = 'documents';

// Initialize Elasticsearch - create index if not exists
async function initElasticsearch() {
    try {
        // Check if index exists
        const indexExists = await client.indices.exists({ index: INDEX_NAME });

        if (!indexExists) {
            // Create index with mapping and custom analyzer
            await client.indices.create({
                index: INDEX_NAME,
                body: {
                    settings: {
                        analysis: {
                            analyzer: {
                                filename_analyzer: {
                                    type: 'custom',
                                    tokenizer: 'standard',
                                    filter: ['lowercase', 'word_delimiter']
                                }
                            }
                        }
                    },
                    mappings: {
                        properties: {
                            filename: {
                                type: 'text',
                                analyzer: 'filename_analyzer'
                            },
                            originalname: {
                                type: 'text',
                                analyzer: 'filename_analyzer'
                            },
                            content: {
                                type: 'text',
                                analyzer: 'standard'
                            },
                            mimetype: { type: 'keyword' },
                            size: { type: 'long' },
                            uploadDate: { type: 'date' },
                            path: { type: 'keyword' }
                        }
                    }
                }
            });
            console.log(`Elasticsearch index '${INDEX_NAME}' created`);
        } else {
            console.log(`Elasticsearch index '${INDEX_NAME}' already exists`);
        }
    } catch (error) {
        console.error('Elasticsearch init error:', error.message);
        throw error;
    }
}

// Index a document in Elasticsearch
async function indexDocument(doc) {
    try {
        const response = await client.index({
            index: INDEX_NAME,
            id: doc.filename, // Use filename as document ID (filenames are unique)
            body: {
                filename: doc.filename,
                originalname: doc.originalname,
                content: doc.content || '',
                mimetype: doc.mimetype,
                size: doc.size,
                uploadDate: doc.uploadDate || new Date(),
                path: doc.path
            }
        });

        console.log(`Document indexed: ${doc.filename}`);
        return response;
    } catch (error) {
        console.error('Indexing error:', error.message);
        throw error;
    }
}

// Search documents in Elasticsearch
async function searchDocuments(query) {
    try {
        if (!query || query.trim() === '') {
            // If no query, return all documents
            const response = await client.search({
                index: INDEX_NAME,
                body: {
                    query: {
                        match_all: {}
                    },
                    size: 100
                }
            });
            return response.hits.hits;
        }

        // 5 katmanlı arama stratejisi: Tam eşleşme > Prefix > Fuzzy > Geniş arama > Daha Geniş arama
        const response = await client.search({
            index: INDEX_NAME,
            body: {
                query: {
                    bool: {
                        should: [
                            // 1. Tam cümle eşleşmesi (en yüksek öncelik)
                            {
                                multi_match: {
                                    query: query,
                                    fields: ['filename^20', 'originalname^20', 'content^10'],
                                    type: 'phrase',
                                    boost: 100
                                }
                            },
                            // 2. Kelime başlangıcı eşleşmesi
                            {
                                multi_match: {
                                    query: query,
                                    fields: ['filename^10', 'originalname^10', 'content^5'],
                                    type: 'phrase_prefix',
                                    boost: 50
                                }
                            },
                            // 3. Bulanık eşleşme (yazım hatası toleransı)
                            {
                                multi_match: {
                                    query: query,
                                    fields: ['filename^5', 'originalname^5', 'content^2'],
                                    fuzziness: 'AUTO',
                                    prefix_length: 1,
                                    max_expansions: 50,
                                    boost: 20
                                }
                            },
                            // 4. Tüm terimlerin varlığı (veya mantığı)
                            {
                                multi_match: {
                                    query: query,
                                    fields: ['filename^3', 'originalname^3', 'content'],
                                    operator: 'and',
                                    boost: 5
                                }
                            },
                            // 5. En az bir terimin varlığı (veya mantığı)
                            {
                                multi_match: {
                                    query: query,
                                    fields: ['filename^2', 'originalname^2', 'content'],
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
                    fields: {
                        content: {
                            fragment_size: 150,
                            number_of_fragments: 3
                        },
                        filename: {},
                        originalname: {}
                    }
                },
                size: 100
            }
        });

        return response.hits.hits;
    } catch (error) {
        console.error('Search error:', error.message);
        throw error;
    }
}

// Delete document from Elasticsearch
async function deleteDocument(filename) {
    try {
        await client.delete({
            index: INDEX_NAME,
            id: filename
        });
        console.log(`Document deleted: ${filename}`);
    } catch (error) {
        if (error.meta?.statusCode !== 404) {
            console.error('Delete error:', error.message);
        }
    }
}

// Delete the entire index
async function deleteIndex() {
    try {
        if (await client.indices.exists({ index: INDEX_NAME })) {
            await client.indices.delete({ index: INDEX_NAME });
            console.log(`Index '${INDEX_NAME}' deleted`);
        } else {
            console.log(`Index '${INDEX_NAME}' does not exist`);
        }
    } catch (error) {
        console.error('Delete index error:', error.message);
        throw error;
    }
}

async function checkConnection() {
    try {
        await client.ping();
        console.log('Elasticsearch is connected');
        return true;
    } catch (error) {
        console.error('Elasticsearch is not connected:', error.message);
        return false;
    }
}

module.exports = {
    initElasticsearch,
    indexDocument,
    searchDocuments,
    deleteDocument,
    deleteIndex,
    checkConnection
};
