// Core types for RAG system
export interface DocumentChunk {
  id: string;
  content: string;
  metadata: {
    source: string;
    page?: number;
    chunkIndex: number;
    totalChunks: number;
  };
}

export interface SearchResult {
  content: string;
  score: number;
  metadata: DocumentChunk['metadata'];
}

export interface QueryRequest {
  question: string;
  collection: string;
  limit?: number;
  threshold?: number;
}

export interface QueryResponse {
  answer: string;
  sources: SearchResult[];
  processingTime: number;
}

export interface UploadRequest {
  collection: string;
  metadata?: Record<string, any>;
}

export interface UploadResponse {
  documentId: string;
  chunksCount: number;
  processingTime: number;
}

export interface CollectionInfo {
  name: string;
  documentCount: number;
  chunkCount: number;
  createdAt: Date;
  lastModified: Date;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
}

// Configuration types
export interface RagConfig {
  chunkSize: number;
  chunkOverlap: number;
  maxResults: number;
  similarityThreshold: number;
  embeddingModel: string;
  vectorDbPath: string;
  documentsPath: string;
  cachePath: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  corsOrigin: string;
  rateLimitWindow: number;
  rateLimitMaxRequests: number;
  maxFileSizeMb: number;
}