import { RagConfig, ServerConfig } from '../types';

export class Config {
  private static instance: Config;
  public readonly rag: RagConfig;
  public readonly server: ServerConfig;

  private constructor() {
    this.rag = {
      chunkSize: parseInt(process.env.RAG_CHUNK_SIZE || '1000'),
      chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP || '200'),
      maxResults: parseInt(process.env.RAG_MAX_RESULTS || '5'),
      similarityThreshold: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || '0.7'),
      embeddingModel: process.env.EMBEDDING_MODEL || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      vectorDbPath: process.env.VECTOR_DB_PATH || './data/vectors',
      documentsPath: process.env.DOCUMENTS_PATH || './data/documents',
      cachePath: process.env.CACHE_PATH || './data/cache'
    };

    this.server = {
      port: parseInt(process.env.PORT || '3001'),
      host: process.env.HOST || 'localhost',
      corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '900000'),
      rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
      maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '50')
    };
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  public validate(): void {
    // Validate chunk settings
    if (this.rag.chunkSize <= 0) {
      throw new Error('RAG_CHUNK_SIZE must be positive');
    }
    if (this.rag.chunkOverlap >= this.rag.chunkSize) {
      throw new Error('RAG_CHUNK_OVERLAP must be less than RAG_CHUNK_SIZE');
    }

    // Validate server settings
    if (this.server.port < 1 || this.server.port > 65535) {
      throw new Error('PORT must be between 1 and 65535');
    }

    // Validate similarity threshold
    if (this.rag.similarityThreshold < 0 || this.rag.similarityThreshold > 1) {
      throw new Error('RAG_SIMILARITY_THRESHOLD must be between 0 and 1');
    }
  }
}

export const config = Config.getInstance();