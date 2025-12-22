const fs = require('fs').promises;
const pdfParse = require('pdf-parse'); // PDF
const mammoth = require('mammoth'); // Word (.docx)
const XLSX = require('xlsx'); // Excel (.xls, .xlsx)
const textract = require('textract'); // Eski Word (.doc)

// PDF dosyasından metin çıkar
async function extractTextFromPDF(filePath) {
    try {
        const dataBuffer = await fs.readFile(filePath);
        const data = await pdfParse(dataBuffer);
        return data.text || '';
    } catch (error) {
        console.error('PDF çıkarma hatası:', error);
        return '';
    }
}

// Word dosyasından metin çıkar
async function extractTextFromWord(filePath) {
    try {
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value || '';
    } catch (error) {
        console.error('Word (.docx) çıkarma hatası:', error);
        return '';
    }
}

// Eski Word dosyasından metin çıkar
async function extractTextFromDoc(filePath) {
    return new Promise((resolve) => {
        textract.fromFileWithPath(filePath, { preserveLineBreaks: true }, (error, text) => {
            if (error) {
                console.error('Eski Word (.doc) çıkarma hatası:', error);
                resolve('');
            } else {
                resolve(text || '');
            }
        });
    });
}

// Excel dosyasından metin çıkar
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
        console.error('Excel çıkarma hatası:', error);
        return '';
    }
}

// Dosyadan metin çıkar (Ana Fonksiyon)
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
                console.warn(`Desteklenmeyen dosya türü: ${mimetype}`);
                return '';
        }
    } catch (error) {
        console.error('Bir hata oluştu, metin çıkarma hatası:', error);
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
