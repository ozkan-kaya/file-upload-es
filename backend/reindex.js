const fs = require('fs');
const path = require('path');
require('dotenv').config();
const {
    initElasticsearch,
    indexDocument,
    deleteIndex,
    checkConnection
} = require('./elasticsearch');
const { extractText } = require('./textExtractor');

const uploadsDir = path.join(__dirname, 'uploads');

// Helper to get mimetype from extension (copied from index.js)
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

async function reindexAll() {
    try {
        console.log('Starting re-indexing process...');

        // 1. Check connection
        const isConnected = await checkConnection();
        if (!isConnected) {
            console.error('Elasticsearch is not connected. Aborting.');
            process.exit(1);
        }

        // 2. Delete existing index
        console.log('Deleting existing index...');
        await deleteIndex();

        // 3. Re-create index
        console.log('Creating new index...');
        await initElasticsearch();

        // 4. Read all files from uploads directory
        if (!fs.existsSync(uploadsDir)) {
            console.error('Uploads directory not found!');
            process.exit(1);
        }

        const files = fs.readdirSync(uploadsDir);
        console.log(`Found ${files.length} files in uploads directory.`);

        for (const filename of files) {
            const filePath = path.join(uploadsDir, filename);
            const stats = fs.statSync(filePath);

            try {
                // Skip directories or hidden files
                if (stats.isDirectory() || filename.startsWith('.')) continue;

                console.log(`Processing: ${filename}`);
                const mimetype = getMimeType(filename);

                // Extract text
                const content = await extractText(filePath, mimetype);

                // Index document
                await indexDocument({
                    filename: filename,
                    originalname: filename, // Original name might be lost if renamed, using filename as fallback
                    content: content,
                    mimetype: mimetype,
                    size: stats.size,
                    uploadDate: stats.mtime,
                    path: `/uploads/${filename}`
                });

                console.log(`Successfully indexed: ${filename}`);

            } catch (fileError) {
                console.error(`Failed to process ${filename}:`, fileError.message);
            }
        }

        console.log('Re-indexing completed successfully.');
        process.exit(0);

    } catch (error) {
        console.error('Re-indexing failed:', error);
        process.exit(1);
    }
}

reindexAll();
