const fs = require('fs').promises;
const pdfParse = require('pdf-parse'); // PDF
const mammoth = require('mammoth'); // Word (.docx)
const XLSX = require('xlsx'); // Excel (.xls, .xlsx)
const textract = require('textract'); // Old word (.doc)

// Extract text from PDF file
async function extractTextFromPDF(filePath) {
    try {
        const dataBuffer = await fs.readFile(filePath);
        const data = await pdfParse(dataBuffer);
        return data.text || '';
    } catch (error) {
        console.error('PDF extraction error:', error);
        return '';
    }
}

// Extract text from Word file
async function extractTextFromWord(filePath) {
    try {
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value || '';
    } catch (error) {
        console.error('Word (.docx) extraction error:', error);
        return '';
    }
}

// Extract text from Old Word file
async function extractTextFromDoc(filePath) {
    return new Promise((resolve) => {
        textract.fromFileWithPath(filePath, { preserveLineBreaks: true }, (error, text) => {
            if (error) {
                console.error('Old Word (.doc) extraction error:', error);
                resolve('');
            } else {
                resolve(text || '');
            }
        });
    });
}

// Extract text from Excel file
async function extractTextFromExcel(filePath) {
    try {
        const workbook = XLSX.readFile(filePath);
        let text = '';

        workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            sheetData.forEach(row => {
                if (row && row.length > 0) {
                    text += row.join(' ') + ' ';
                }
            });
        });

        return text.trim();
    } catch (error) {
        console.error('Excel extraction error:', error);
        return '';
    }
}

// Extract text from file
async function extractText(filePath, mimetype) {
    try {
        switch (mimetype) {
            case 'application/pdf':
                return await extractTextFromPDF(filePath);

            case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                return await extractTextFromWord(filePath);

            case 'application/msword':
                return await extractTextFromDoc(filePath);

            case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
            case 'application/vnd.ms-excel':
                return await extractTextFromExcel(filePath);

            default:
                console.warn(`Unsupported mimetype: ${mimetype}`);
                return '';
        }
    } catch (error) {
        console.error('Something went wrong, text extraction error:', error);
        return '';
    }
}

module.exports = {
    extractText,
    extractTextFromPDF,
    extractTextFromWord,
    extractTextFromExcel,
    extractTextFromDoc
};
