import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { config } from '../config';
import { DocumentChunk, SearchResult } from '../types';

// Simple persistent vector database using JSON files
interface StoredDocument {
  id: string;
  content: string;
  embedding: number[];
  metadata: any;
}

export class PersistentVectorDB {
  private collections: Map<string, StoredDocument[]> = new Map();
  private initialized = false;

  constructor() {
    logger.info(`Persistent Vector DB initialized (JSON-based)`);
  }

  /**
   * Initialize the database
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load existing collections from disk
      await this.loadCollectionsFromDisk();
      this.initialized = true;
      logger.info(`Persistent Vector DB loaded ${this.collections.size} collections`);
    } catch (error) {
      logger.error('Failed to initialize Persistent Vector DB', error as Error);
      throw new Error(`Vector DB initialization failed: ${(error as Error).message}`);
    }
  }

  /**
   * Ensure database is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Save collection to disk
   */
  private async saveCollectionToDisk(collectionName: string): Promise<void> {
    try {
      const collection = this.collections.get(collectionName);
      if (!collection) return;

      const vectorsPath = config.rag.vectorDbPath;
      if (!fs.existsSync(vectorsPath)) {
        fs.mkdirSync(vectorsPath, { recursive: true });
      }

      const filePath = path.join(vectorsPath, `${collectionName}.json`);
      fs.writeFileSync(filePath, JSON.stringify(collection, null, 2));
      logger.debug(`Saved collection ${collectionName} to disk`);
    } catch (error) {
      logger.error(`Failed to save collection ${collectionName}:`, error);
    }
  }

  /**
   * Load collections from JSON files
   */
  private async loadCollectionsFromDisk(): Promise<void> {
    try {
      const vectorsPath = config.rag.vectorDbPath;
      if (!fs.existsSync(vectorsPath)) {
        fs.mkdirSync(vectorsPath, { recursive: true });
        return;
      }

      const files = fs.readdirSync(vectorsPath).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const collectionName = path.basename(file, '.json');
        const filePath = path.join(vectorsPath, file);

        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          this.collections.set(collectionName, data);
          logger.debug(`Loaded collection ${collectionName} with ${data.length} documents`);
        } catch (error) {
          logger.warn(`Failed to load collection ${collectionName}:`, error);
        }
      }
    } catch (error) {
      logger.error('Failed to load collections from disk:', error);
    }
  }

  /**
   * Cosine similarity calculation
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Add documents to a collection
   */
  async addDocuments(
    collectionName: string,
    chunks: DocumentChunk[],
    embeddings: number[][]
  ): Promise<void> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      // Ensure collection exists
      if (!this.collections.has(collectionName)) {
        this.collections.set(collectionName, []);
      }

      const collection = this.collections.get(collectionName)!;

      // Add documents
      for (let i = 0; i < chunks.length; i++) {
        const doc: StoredDocument = {
          id: chunks[i].id,
          content: chunks[i].content,
          embedding: embeddings[i],
          metadata: {
            source: chunks[i].metadata.source,
            page: chunks[i].metadata.page || 0,
            chunkIndex: chunks[i].metadata.chunkIndex,
            totalChunks: chunks[i].metadata.totalChunks,
            documentType: (chunks[i].metadata as any).documentType,
            title: (chunks[i].metadata as any).title,
            fileSize: (chunks[i].metadata as any).fileSize,
            fileName: (chunks[i].metadata as any).fileName
          }
        };
        collection.push(doc);
      }

      // Save to disk
      await this.saveCollectionToDisk(collectionName);

      const processingTime = Date.now() - startTime;
      logger.performance('Persistent DB add documents', processingTime, {
        collection: collectionName,
        documentsCount: chunks.length
      });

    } catch (error) {
      logger.error(`Failed to add documents to collection: ${collectionName}`, error as Error);
      throw new Error(`Add documents failed: ${(error as Error).message}`);
    }
  }

  /**
   * Search for similar documents
   */
  async search(
    collectionName: string,
    queryEmbedding: number[],
    limit: number = config.rag.maxResults
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      if (!this.collections.has(collectionName)) {
        return [];
      }

      const collection = this.collections.get(collectionName)!;

      if (collection.length === 0) {
        return [];
      }

      // Calculate similarities
      const similarities = collection.map(doc => ({
        doc,
        score: this.cosineSimilarity(queryEmbedding, doc.embedding)
      }));

      // Sort by similarity (descending) and take top results
      similarities.sort((a, b) => b.score - a.score);
      const topResults = similarities.slice(0, limit);

      const searchResults: SearchResult[] = topResults.map(item => ({
        content: item.doc.content,
        score: item.score,
        metadata: item.doc.metadata
      }));

      const processingTime = Date.now() - startTime;
      logger.performance('Persistent DB search', processingTime, {
        collection: collectionName,
        resultsCount: searchResults.length
      });

      return searchResults;

    } catch (error) {
      const err = error as Error;
      logger.error(`Search failed in collection: ${collectionName}`, err);
      throw new Error(`Search failed: ${err.message}`);
    }
  }

  /**
   * Delete a collection
   */
  async deleteCollection(name: string): Promise<void> {
    await this.ensureInitialized();

    try {
      this.collections.delete(name);

      // Delete from disk
      const filePath = path.join(config.rag.vectorDbPath, `${name}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      logger.info(`Deleted collection: ${name}`);
    } catch (error) {
      logger.error(`Failed to delete collection: ${name}`, error as Error);
      throw new Error(`Delete collection failed: ${(error as Error).message}`);
    }
  }

  /**
   * List all collections
   */
  async listCollections(): Promise<string[]> {
    await this.ensureInitialized();

    try {
      return Array.from(this.collections.keys());
    } catch (error) {
      logger.error('Failed to list collections', error as Error);
      return [];
    }
  }

  /**
   * Get collection statistics
   */
  async getCollectionStats(name: string): Promise<{
    name: string;
    count: number;
  } | null> {
    await this.ensureInitialized();

    try {
      if (!this.collections.has(name)) {
        return null;
      }

      const collection = this.collections.get(name)!;
      return {
        name,
        count: collection.length
      };
    } catch (error) {
      logger.error(`Failed to get stats for collection: ${name}`, error as Error);
      return null;
    }
  }
}

// Singleton instance
export const vectorDb = new PersistentVectorDB();