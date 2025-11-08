import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { config } from '../config';

// Use legacy build for Node.js compatibility
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Set worker source for PDF.js (legacy build for Node.js)
const pdfjsPath = path.dirname(require.resolve('pdfjs-dist/package.json'));
GlobalWorkerOptions.workerSrc = path.join(pdfjsPath, 'legacy/build/pdf.worker.mjs');

export class PDFProcessor {
  /**
   * Extract text from a PDF or TXT file
   */
  async extractText(filePath: string, originalFilename?: string): Promise<string> {
    const startTime = Date.now();

    try {
      logger.info(`Starting document extraction: ${filePath}`);

      // Validate file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Validate file size
      const stats = fs.statSync(filePath);
      const maxSizeBytes = config.server.maxFileSizeMb * 1024 * 1024;
      if (stats.size > maxSizeBytes) {
        throw new Error(`File too large: ${stats.size} bytes (max: ${maxSizeBytes})`);
      }

      // Check if it's a text file for testing
      const isTextFile = originalFilename ? originalFilename.toLowerCase().endsWith('.txt') : filePath.toLowerCase().endsWith('.txt');
      if (isTextFile) {
        logger.info('Processing as text file');
        const text = fs.readFileSync(filePath, 'utf-8');
        const processingTime = Date.now() - startTime;
        logger.performance('Text extraction', processingTime, { file: filePath });
        return text;
      }

      // Load PDF document
      const data = new Uint8Array(fs.readFileSync(filePath));
      let pdf;
      try {
        pdf = await getDocument({ data }).promise;
      } catch (pdfError) {
        logger.warn('Failed to load PDF document, it may be corrupted or invalid:', pdfError);
        return 'This PDF document could not be loaded. It may be corrupted, password-protected, or not a valid PDF file. Please try with a different PDF or use OCR to extract text from image-based PDFs.';
      }

      logger.info(`PDF loaded: ${pdf.numPages} pages`);

      let fullText = '';

      // Extract text from each page
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();

          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ')
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

          if (pageText) {
            fullText += pageText + '\n\n';
          }

          // Log progress for large PDFs
          if (pageNum % 10 === 0) {
            logger.debug(`Processed ${pageNum}/${pdf.numPages} pages`);
          }
        } catch (pageError) {
          logger.warn(`Failed to extract text from page ${pageNum}:`, pageError);
          // Continue with other pages
        }
      }

      if (!fullText.trim()) {
        logger.warn('No text content found in PDF - it may be image-based or corrupted');
        // Return a message instead of throwing error
        return `This PDF document appears to be image-based or corrupted. It contains ${pdf.numPages} pages but no extractable text content. You may need to use OCR (Optical Character Recognition) to extract text from this document.`;
      }

      const processingTime = Date.now() - startTime;
      logger.performance('PDF extraction', processingTime, {
        file: path.basename(filePath),
        pages: pdf.numPages,
        textLength: fullText.length
      });

      return fullText.trim();

    } catch (error) {
      logger.error('PDF extraction failed', error as Error);
      throw new Error(`Failed to extract text from PDF: ${(error as Error).message}`);
    }
  }

  /**
   * Get PDF metadata
   */
  async getMetadata(filePath: string): Promise<any> {
    try {
      const data = new Uint8Array(fs.readFileSync(filePath));
      const pdf = await getDocument({ data }).promise;

      const metadata = await pdf.getMetadata();
      const stats = fs.statSync(filePath);

      const info = metadata.info as any;
      return {
        pages: pdf.numPages,
        title: info?.Title || path.basename(filePath, '.pdf'),
        author: info?.Author,
        subject: info?.Subject,
        creator: info?.Creator,
        producer: info?.Producer,
        creationDate: info?.CreationDate,
        modificationDate: info?.ModDate,
        fileSize: stats.size,
        fileName: path.basename(filePath)
      };
    } catch (error) {
      logger.warn(`Could not get PDF metadata: ${filePath}`, error as Error);
      return null;
    }
  }

  /**
   * Validate PDF file by checking magic bytes (more secure than just extension)
   */
  private validatePDFFile(filePath: string): boolean {
    try {
      const buffer = fs.readFileSync(filePath);
      // PDF files start with %PDF-
      return buffer.toString('ascii', 0, 4) === '%PDF';
    } catch (error) {
      logger.warn('Failed to validate PDF file', error);
      return false;
    }
  }

  /**
   * Validate document file (PDF or TXT)
   */
  validateFile(filePath: string, originalFilename?: string): boolean {
    try {
      logger.debug(`Validating file: ${filePath}`);

      // Check file extension (PDF or TXT) - use original filename if provided, otherwise temp path
      const filenameToCheck = originalFilename || filePath;
      const isPdf = filenameToCheck.toLowerCase().endsWith('.pdf');
      const isTxt = filenameToCheck.toLowerCase().endsWith('.txt');
      const isValidType = isPdf || isTxt;
      
      logger.debug(`File extension check: ${isValidType ? 'PASS' : 'FAIL'} (.pdf or .txt required) - checked: ${filenameToCheck}`);
      if (!isValidType) {
        return false;
      }

      // Check file exists
      const exists = fs.existsSync(filePath);
      logger.debug(`File exists check: ${exists ? 'PASS' : 'FAIL'}`);
      if (!exists) {
        return false;
      }

      // Check file size
      const stats = fs.statSync(filePath);
      const maxSizeBytes = config.server.maxFileSizeMb * 1024 * 1024;
      const sizeOk = stats.size <= maxSizeBytes;
      logger.debug(`File size check: ${stats.size} bytes <= ${maxSizeBytes} bytes = ${sizeOk ? 'PASS' : 'FAIL'}`);
      if (!sizeOk) {
        return false;
      }

      // For PDF files, validate magic bytes for security
      if (isPdf && !this.validatePDFFile(filePath)) {
        logger.warn(`Invalid PDF file format (magic bytes check failed): ${filePath}`);
        return false;
      }

      logger.debug('Document validation passed');
      return true;
    } catch (error) {
      logger.error('Document validation failed', error);
      return false;
    }
  }
}