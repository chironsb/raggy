#!/usr/bin/env node

/**
 * Example: Upload PDF documents to Raggy
 *
 * Usage:
 *   node examples/upload-pdf.js path/to/document.pdf [collection-name]
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

const RAGGY_URL = process.env.RAGGY_URL || 'http://localhost:3001';

async function uploadPDF(pdfPath, collection = 'default') {
  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ PDF file not found: ${pdfPath}`);
    process.exit(1);
  }

  const fileName = path.basename(pdfPath);
  console.log(`📤 Uploading ${fileName} to collection "${collection}"...`);

  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(pdfPath));
    form.append('collection', collection);

    const response = await axios.post(`${RAGGY_URL}/api/documents/upload`, form, {
      headers: form.getHeaders(),
      timeout: 300000, // 5 minutes timeout
    });

    console.log('✅ Upload successful!');
    console.log(`📊 Document ID: ${response.data.documentId}`);
    console.log(`📄 Pages processed: ${response.data.pagesProcessed}`);
    console.log(`🔢 Chunks created: ${response.data.chunksCreated}`);

  } catch (error) {
    console.error('❌ Upload failed:', error.response?.data?.error || error.message);
    process.exit(1);
  }
}

// CLI interface
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node examples/upload-pdf.js <pdf-file> [collection]');
  console.log('Example: node examples/upload-pdf.js my-book.pdf tech-books');
  process.exit(1);
}

const pdfPath = args[0];
const collection = args[1] || 'default';

uploadPDF(pdfPath, collection);