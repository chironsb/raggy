import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { cache } from '../utils/cache';
import { config } from '../config';
import { PDFProcessor } from './pdf-processor';
import { TextChunker } from './chunker';
import { LocalEmbeddingService } from './embeddings';
import { PersistentVectorDB } from './vector-db';
import {
  DocumentChunk,
  QueryRequest,
  QueryResponse,
  UploadResponse,
  CollectionInfo
} from '../types';

export class RAGService {
  private pdfProcessor: PDFProcessor;
  private chunker: TextChunker;
  private embeddings: LocalEmbeddingService;
  private vectorDb: PersistentVectorDB;
  private initialized = false;

  constructor() {
    this.pdfProcessor = new PDFProcessor();
    this.chunker = new TextChunker();
    this.embeddings = new LocalEmbeddingService();
    this.vectorDb = new PersistentVectorDB();
  }

  /**
   * Initialize all components
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const startTime = Date.now();

    try {
      logger.info('Initializing RAG Service...');

      // Initialize embeddings (this takes time on first run)
      await this.embeddings.initialize();

      // Ensure data directories exist
      this.ensureDirectories();

      this.initialized = true;

      const initTime = Date.now() - startTime;
      logger.performance('RAG Service initialization', initTime);

    } catch (error) {
      logger.error('RAG Service initialization failed', error as Error);
      throw new Error(`Initialization failed: ${(error as Error).message}`);
    }
  }

  /**
   * Index a document (PDF or TXT)
   */
  async indexDocument(
    filePath: string,
    collectionName: string,
    metadata?: Record<string, any>,
    originalFilename?: string
  ): Promise<UploadResponse> {
    await this.ensureInitialized();

    const startTime = Date.now();
    const documentId = uuidv4();
    const isPdf = filePath.toLowerCase().endsWith('.pdf');

    try {
      logger.info(`Indexing document: ${filePath} into collection: ${collectionName}`);

      // Validate document file
      if (!this.pdfProcessor.validateFile(filePath, originalFilename)) {
        throw new Error('Invalid document file');
      }

      // Extract text
      const text = await this.pdfProcessor.extractText(filePath, originalFilename);

      if (!text.trim()) {
        throw new Error('No text could be extracted from document');
      }

      // Get document metadata
      let docMetadata = {};
      if (isPdf) {
        docMetadata = await this.pdfProcessor.getMetadata(filePath) || {};
      } else {
        // For text files, create basic metadata
        const stats = fs.statSync(filePath);
        docMetadata = {
          pages: 1,
          title: path.basename(filePath, '.txt'),
          fileSize: stats.size,
          fileName: path.basename(filePath)
        };
      }

      // Chunk the text
      const textChunks = this.chunker.chunkText(text);
      logger.debug(`Created ${textChunks.length} chunks`);

      // Create document chunks with metadata
      const chunks: DocumentChunk[] = textChunks.map((content, index) => ({
        id: `${documentId}_chunk_${index}`,
        content,
        metadata: {
          source: path.basename(filePath),
          page: isPdf ? Math.floor(index / 10) + 1 : 1, // Rough page estimation for PDFs
          chunkIndex: index,
          totalChunks: textChunks.length,
          documentType: isPdf ? 'pdf' : 'txt',
          ...metadata,
          ...docMetadata
        }
      }));

      // Generate embeddings
      const embeddings = await this.embeddings.generateEmbeddings(
        chunks.map(chunk => chunk.content)
      );

      // Store in vector database
      await this.vectorDb.addDocuments(collectionName, chunks, embeddings);

      // Copy file to documents directory for persistence
      const extension = isPdf ? '.pdf' : '.txt';
      const destPath = path.join(config.rag.documentsPath, collectionName, `${documentId}${extension}`);
      this.ensureDirectory(path.dirname(destPath));
      fs.copyFileSync(filePath, destPath);

      const processingTime = Date.now() - startTime;

      logger.info(`Document indexed successfully`, {
        documentId,
        collection: collectionName,
        chunks: chunks.length,
        processingTime: `${processingTime}ms`
      });

      return {
        documentId,
        chunksCount: chunks.length,
        processingTime
      };

    } catch (error) {
      logger.error(`Document indexing failed: ${filePath}`, error as Error);
      throw new Error(`Indexing failed: ${(error as Error).message}`);
    }
  }

  /**
   * Query the RAG system
   */
  async query(request: QueryRequest): Promise<QueryResponse> {
    await this.ensureInitialized();

    const startTime = Date.now();

    try {
      const { question, collection, limit, threshold } = request;

      logger.info(`Processing query: "${question}" in collection: ${collection}`);

      // Check cache first
      const cachedResult = cache.getSearchResult(question, collection);
      if (cachedResult) {
        logger.debug('Returning cached query result');
        return {
          ...cachedResult,
          processingTime: Date.now() - startTime
        };
      }

      // Generate query embedding
      const queryEmbedding = await this.embeddings.generateQueryEmbedding(question);

      // Search vector database
      const searchResults = await this.vectorDb.search(
        collection,
        queryEmbedding,
        limit || config.rag.maxResults
      );

      // Filter by similarity threshold
      const similarityThreshold = threshold !== undefined ? threshold : config.rag.similarityThreshold;
      const filteredResults = searchResults.filter(
        result => result.score >= similarityThreshold
      );

      // Format context for LLM
      const context = filteredResults
        .map(result => `[${result.metadata.source}, Page ${result.metadata.page}]\n${result.content}`)
        .join('\n\n---\n\n');

      const processingTime = Date.now() - startTime;

      const response: QueryResponse = {
        answer: context || 'No relevant content found in the documents.', // For now, return context. In production, you'd send to LLM
        sources: filteredResults,
        processingTime
      };

      // Cache the result
      cache.setSearchResult(question, collection, response);

      logger.info(`Query processed successfully`, {
        collection,
        resultsCount: filteredResults.length,
        processingTime: `${processingTime}ms`
      });

      return response;

    } catch (error) {
      logger.error(`Query failed: ${request.question}`, error as Error);
      throw new Error(`Query failed: ${(error as Error).message}`);
    }
  }

  /**
   * List all collections
   */
  async listCollections(): Promise<string[]> {
    await this.ensureInitialized();
    return await this.vectorDb.listCollections();
  }

  /**
   * Get collection information
   */
  async getCollectionInfo(name: string): Promise<CollectionInfo | null> {
    await this.ensureInitialized();

    const stats = await this.vectorDb.getCollectionStats(name);
    if (!stats) {
      return null;
    }

    // Get document count from filesystem
    const collectionPath = path.join(config.rag.documentsPath, name);
    let documentCount = 0;

    try {
      if (fs.existsSync(collectionPath)) {
        const files = fs.readdirSync(collectionPath);
        documentCount = files.filter(file => file.endsWith('.pdf')).length;
      }
    } catch (error) {
      logger.warn(`Could not count documents in collection: ${name}`, error);
    }

    return {
      name,
      documentCount,
      chunkCount: stats.count,
      createdAt: new Date(), // TODO: Store creation time
      lastModified: new Date() // TODO: Store modification time
    };
  }

  /**
   * Delete a collection
   */
  async deleteCollection(name: string): Promise<void> {
    await this.ensureInitialized();

    // Delete from vector DB
    await this.vectorDb.deleteCollection(name);

    // Delete documents from filesystem
    const collectionPath = path.join(config.rag.documentsPath, name);
    try {
      if (fs.existsSync(collectionPath)) {
        fs.rmSync(collectionPath, { recursive: true, force: true });
        logger.info(`Deleted collection documents: ${name}`);
      }
    } catch (error) {
      logger.warn(`Could not delete collection documents: ${name}`, error);
    }
  }

  /**
   * Get system status
   */
  async getStatus(): Promise<{
    initialized: boolean;
    embeddingModel: any;
    collections: string[];
    cacheStats: any;
  }> {
    return {
      initialized: this.initialized,
      embeddingModel: this.embeddings.getModelInfo(),
      collections: await this.listCollections(),
      cacheStats: cache.getStats()
    };
  }

  /**
   * Ensure service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Ensure required directories exist
   */
  private ensureDirectories(): void {
    const dirs = [
      config.rag.vectorDbPath,
      config.rag.documentsPath,
      config.rag.cachePath,
      'logs'
    ];

    for (const dir of dirs) {
      this.ensureDirectory(dir);
    }
  }

  /**
   * Ensure a directory exists
   */
  private ensureDirectory(dirPath: string): void {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        logger.debug(`Created directory: ${dirPath}`);
      }
    } catch (error) {
      logger.error(`Failed to create directory: ${dirPath}`, error);
    }
  }
}

// Singleton instance
export const ragService = new RAGService();