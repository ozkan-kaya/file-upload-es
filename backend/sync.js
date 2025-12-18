const fs = require('fs');
const path = require('path');
require('dotenv').config();
const {
    getAllDocuments,
    indexDocument,
    deleteDocument
} = require('./elasticsearch');
const { extractText } = require('./textExtractor');

const uploadsDir = path.join(__dirname, 'uploads');

// Helper to get mimetype from extension
const getMimeType = (filename) => {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
        case '.pdf': return 'application/pdf';
        case '.doc': return 'application/msword';
        case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case '.xls': return 'application/vnd.ms-excel';
        case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        default: return null; // Unsupported type
    }
};

// Check if file type is supported
const isSupportedFileType = (filename) => {
    return getMimeType(filename) !== null;
};

// Synchronize uploads directory with Elasticsearch
async function syncFilesWithElasticsearch() {
    try {
        console.log('Starting file synchronization...');

        // Ensure uploads directory exists
        if (!fs.existsSync(uploadsDir)) {
            console.log('Uploads directory does not exist. Creating it...');
            fs.mkdirSync(uploadsDir);
            console.log('Synchronization complete: No files to sync.');
            return;
        }

        // Get all files from uploads directory
        const filesInDirectory = fs.readdirSync(uploadsDir)
            .filter(filename => {
                const filePath = path.join(uploadsDir, filename);
                const stats = fs.statSync(filePath);
                return stats.isFile() && !filename.startsWith('.');
            });

        console.log(`Found ${filesInDirectory.length} files in uploads directory`);

        // Get all documents from Elasticsearch
        const documentsInES = await getAllDocuments();
        const filenamesInES = new Set(documentsInES.map(doc => doc._id));

        console.log(`Found ${filenamesInES.size} documents in Elasticsearch`);

        // Find orphaned records in Elasticsearch (files deleted from disk)
        const orphanedRecords = documentsInES.filter(doc =>
            !filesInDirectory.includes(doc._id)
        );

        // Remove orphaned records
        for (const doc of orphanedRecords) {
            console.log(`Removing orphaned record: ${doc._id}`);
            await deleteDocument(doc._id);
        }

        if (orphanedRecords.length > 0) {
            console.log(`Removed ${orphanedRecords.length} orphaned records from Elasticsearch`);
        }

        // Find new files in directory (not in Elasticsearch)
        const newFiles = filesInDirectory.filter(filename =>
            !filenamesInES.has(filename) && isSupportedFileType(filename)
        );

        // Index new files
        let indexedCount = 0;
        let skippedCount = 0;

        for (const filename of newFiles) {
            const filePath = path.join(uploadsDir, filename);
            const mimetype = getMimeType(filename);

            if (!mimetype) {
                console.log(`Skipping unsupported file type: ${filename}`);
                skippedCount++;
                continue;
            }

            try {
                console.log(`Indexing new file: ${filename}`);
                const stats = fs.statSync(filePath);

                // Extract text
                const content = await extractText(filePath, mimetype);

                // Index document
                await indexDocument({
                    filename: filename,
                    originalname: filename,
                    content: content,
                    mimetype: mimetype,
                    size: stats.size,
                    uploadDate: stats.mtime,
                    path: `/uploads/${filename}`
                });

                console.log(`Successfully indexed: ${filename}`);
                indexedCount++;

            } catch (fileError) {
                console.error(`Failed to index ${filename}:`, fileError.message);
            }
        }

        // Summary
        console.log('Synchronization complete:');
        console.log(`  - Removed ${orphanedRecords.length} orphaned records`);
        console.log(`  - Indexed ${indexedCount} new files`);
        if (skippedCount > 0) {
            console.log(`  - Skipped ${skippedCount} unsupported files`);
        }

    } catch (error) {
        console.error('Synchronization failed:', error);
        throw error;
    }
}

module.exports = {
    syncFilesWithElasticsearch
};
