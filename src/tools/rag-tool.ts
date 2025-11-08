import { logger } from '../utils/logger';
import { ragService } from '../core/rag-service';
import * as http from 'http';

export interface RagToolRequest {
  action: 'upload' | 'query' | 'list' | 'delete' | 'status' | 'create_collection' | 'delete_collection' | 'stop';
  filePath?: string;
  collection?: string;
  question?: string;
  limit?: number;
  metadata?: Record<string, any>;
}

export interface RagToolResponse {
  success: boolean;
  result: any;
  error?: string;
}

/**
 * RAG Tool for OpenCode integration
 * This tool allows OpenCode agents to interact with the RAG system
 */
export class RagTool {
  static readonly toolDefinition = {
    name: 'rag',
    description: 'Interact with the local RAG (Retrieval-Augmented Generation) system for document Q&A',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['upload', 'query', 'list', 'delete', 'status', 'create_collection', 'delete_collection', 'stop'],
          description: 'Action to perform with the RAG system'
        },
        filePath: {
          type: 'string',
          description: 'Path to PDF file or folder containing PDFs (required for upload action)'
        },
        collection: {
          type: 'string',
          description: 'Collection name (defaults to "default")',
          default: 'default'
        },
        question: {
          type: 'string',
          description: 'Question to ask (required for query action)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (for query)',
          default: 5
        },
        metadata: {
          type: 'object',
          description: 'Additional metadata for uploaded documents'
        }
      },
      required: ['action']
    }
  };

  /**
   * Check if RAG server is running and start it if not
   */
  private static async ensureServerRunning(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = http.get('http://localhost:3001/api/status', (res) => {
        if (res.statusCode === 200) {
          logger.info('RAG server is already running');
          resolve();
        } else {
          logger.warn('RAG server responded with unexpected status:', res.statusCode);
          resolve(); // Still resolve, might be a different issue
        }
      });

      req.on('error', async (_error) => {
        logger.info('RAG server not running, starting it...');

        try {
          // Start the server using child_process
          const { spawn } = require('child_process');
          const path = require('path');

          // Get the project root directory (assuming this file is in src/tools/)
          const projectRoot = path.resolve(__dirname, '../..');

          // Start the server in background
          const serverProcess = spawn('npm', ['run', 'dev'], {
            cwd: projectRoot,
            detached: true,
            stdio: 'ignore'
          });

          serverProcess.unref();

          // Wait a bit for server to start
          setTimeout(() => {
            logger.info('RAG server started successfully');
            resolve();
          }, 3000);

        } catch (startError) {
          logger.error('Failed to start RAG server:', startError);
          reject(new Error('Could not start RAG server automatically'));
        }
      });

      req.setTimeout(2000, () => {
        req.destroy();
        logger.warn('Server check timeout, assuming server is starting...');
        resolve();
      });
    });
  }

  /**
   * Execute the RAG tool
   */
  static async execute(params: RagToolRequest): Promise<RagToolResponse> {
    try {
      // Ensure server is running before executing any action
      await this.ensureServerRunning();

      logger.info(`RAG Tool execution: ${params.action}`, params);

      switch (params.action) {
        case 'upload':
          return await this.handleUpload(params);

        case 'query':
          return await this.handleQuery(params);

        case 'list':
          return await this.handleList(params);

        case 'delete':
          return await this.handleDelete(params);

        case 'status':
          return await this.handleStatus(params);

        case 'create_collection':
          return await this.handleCreateCollection(params);

        case 'delete_collection':
          return await this.handleDeleteCollection(params);

        case 'stop':
          return await this.handleStop(params);

        default:
          throw new Error(`Unknown action: ${params.action}`);
      }

    } catch (error) {
      logger.error('RAG Tool execution failed', error as Error);
      return {
        success: false,
        result: null,
        error: (error as Error).message || 'Unknown error occurred'
      };
    }
  }

  /**
   * Handle document upload (single file or folder)
   */
  private static async handleUpload(params: RagToolRequest): Promise<RagToolResponse> {
    if (!params.filePath) {
      throw new Error('filePath is required for upload action');
    }

    const collection = params.collection || 'default';
    const fs = require('fs');
    const path = require('path');

    // Check if path exists
    if (!fs.existsSync(params.filePath)) {
      throw new Error(`Path does not exist: ${params.filePath}`);
    }

    const stats = fs.statSync(params.filePath);
    let pdfFiles: string[] = [];

    if (stats.isDirectory()) {
      // Find all PDF files recursively
      pdfFiles = this.findPdfFiles(params.filePath);
      if (pdfFiles.length === 0) {
        throw new Error(`No PDF files found in directory: ${params.filePath}`);
      }
    } else {
      // Single file
      if (!params.filePath.toLowerCase().endsWith('.pdf')) {
        throw new Error('Only PDF files are supported for upload');
      }
      pdfFiles = [params.filePath];
    }

    // Process all PDF files
    const results = [];
    let totalChunks = 0;
    let totalProcessingTime = 0;

    for (const pdfFile of pdfFiles) {
      try {
        const result = await ragService.indexDocument(pdfFile, collection, params.metadata);
        results.push({
          file: path.basename(pdfFile),
          documentId: result.documentId,
          chunksCount: result.chunksCount,
          processingTime: result.processingTime
        });
        totalChunks += result.chunksCount;
        totalProcessingTime += result.processingTime;
      } catch (error) {
        logger.warn(`Failed to process ${pdfFile}:`, error);
        results.push({
          file: path.basename(pdfFile),
          error: (error as Error).message
        });
      }
    }

    const successCount = results.filter(r => !r.error).length;
    const errorCount = results.filter(r => r.error).length;

    return {
      success: successCount > 0,
      result: {
        message: `Processed ${pdfFiles.length} files: ${successCount} successful, ${errorCount} failed`,
        collection,
        totalChunks,
        totalProcessingTime: `${totalProcessingTime}ms`,
        results
      }
    };
  }

  /**
   * Find all PDF files recursively in a directory
   */
  private static findPdfFiles(dirPath: string): string[] {
    const fs = require('fs');
    const path = require('path');
    const pdfFiles: string[] = [];

    function scanDir(currentPath: string) {
      const items = fs.readdirSync(currentPath);

      for (const item of items) {
        const fullPath = path.join(currentPath, item);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
          scanDir(fullPath);
        } else if (item.toLowerCase().endsWith('.pdf')) {
          pdfFiles.push(fullPath);
        }
      }
    }

    scanDir(dirPath);
    return pdfFiles;
  }

  /**
   * Handle document query
   */
  private static async handleQuery(params: RagToolRequest): Promise<RagToolResponse> {
    if (!params.question) {
      throw new Error('question is required for query action');
    }

    const collection = params.collection || 'default';
    const result = await ragService.query({
      question: params.question,
      collection,
      limit: params.limit || 5
    });

    // Format response for OpenCode
    const formattedResult = {
      answer: result.answer,
      sources: result.sources.map(source => ({
        content: source.content.substring(0, 500) + (source.content.length > 500 ? '...' : ''),
        score: Math.round(source.score * 100) / 100,
        source: source.metadata.source,
        page: source.metadata.page
      })),
      totalSources: result.sources.length,
      processingTime: `${result.processingTime}ms`
    };

    return {
      success: true,
      result: formattedResult
    };
  }

  /**
   * Handle collection listing
   */
  private static async handleList(_params: RagToolRequest): Promise<RagToolResponse> {
    const collections = await ragService.listCollections();

    // Get detailed info for each collection
    const collectionDetails = [];
    for (const collectionName of collections) {
      const info = await ragService.getCollectionInfo(collectionName);
      if (info) {
        collectionDetails.push(info);
      }
    }

    return {
      success: true,
      result: {
        collections: collectionDetails,
        count: collections.length
      }
    };
  }

  /**
   * Handle collection deletion
   */
  private static async handleDelete(params: RagToolRequest): Promise<RagToolResponse> {
    if (!params.collection) {
      throw new Error('collection is required for delete action');
    }

    await ragService.deleteCollection(params.collection);

    return {
      success: true,
      result: {
        message: `Collection '${params.collection}' deleted successfully`
      }
    };
  }

  /**
   * Handle collection creation
   */
  private static async handleCreateCollection(params: RagToolRequest): Promise<RagToolResponse> {
    if (!params.collection) {
      throw new Error('collection is required for create_collection action');
    }

    // Check if collection already exists
    const collections = await ragService.listCollections();
    if (collections.includes(params.collection)) {
      throw new Error(`Collection '${params.collection}' already exists`);
    }

    // For now, collections are created implicitly when uploading documents
    // We could add explicit collection creation if needed
    return {
      success: true,
      result: {
        message: `Collection '${params.collection}' is ready for use. Upload documents to create it.`
      }
    };
  }

  /**
   * Handle collection deletion
   */
  private static async handleDeleteCollection(params: RagToolRequest): Promise<RagToolResponse> {
    if (!params.collection) {
      throw new Error('collection is required for delete_collection action');
    }

    await ragService.deleteCollection(params.collection);

    return {
      success: true,
      result: {
        message: `Collection '${params.collection}' deleted successfully`
      }
    };
  }

  /**
   * Handle status check
   */
  private static async handleStatus(_params: RagToolRequest): Promise<RagToolResponse> {
    const status = await ragService.getStatus();

    return {
      success: true,
      result: {
        initialized: status.initialized,
        embeddingModel: status.embeddingModel,
        collectionsCount: status.collections.length,
        collections: status.collections,
        cacheStats: status.cacheStats
      }
    };
  }

  /**
   * Handle server stop
   */
  private static async handleStop(_params: RagToolRequest): Promise<RagToolResponse> {
    logger.info('Stopping RAG server...');

    try {
      // Stop the server gracefully
      const { execSync } = require('child_process');

      // Kill all RAG processes
      try {
        execSync('pkill -f "tsx src/index.ts"', { stdio: 'pipe' });
        execSync('pkill -f "node dist/index.js"', { stdio: 'pipe' });
      } catch (killError) {
        // Ignore errors if processes are already stopped
      }

      return {
        success: true,
        result: {
          message: 'RAG server stopped successfully'
        }
      };

    } catch (error) {
      logger.error('Failed to stop RAG server:', error);
      return {
        success: false,
        result: null,
        error: 'Failed to stop RAG server'
      };
    }
  }
}