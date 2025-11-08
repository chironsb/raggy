import { tool } from '@opencode-ai/plugin';
import { ragService } from '../core/rag-service';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

// Project root path
const PROJECT_ROOT = '/home/chiron/CodexScriptus/codingprojects/raggy/raggy-github';

async function ensureServerRunning(): Promise<void> {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3001/api/status', (res) => {
      if (res.statusCode === 200) {
        resolve();
      } else {
        resolve();
      }
    });

    req.on('error', async () => {
      try {
        const { spawn } = require('child_process');
        const serverProcess = spawn('npm', ['run', 'dev'], {
          cwd: PROJECT_ROOT,
          detached: true,
          stdio: 'ignore'
        });

        serverProcess.unref();
        setTimeout(() => resolve(), 5000);
      } catch (startError) {
        resolve();
      }
    });

    req.setTimeout(2000, () => {
      req.destroy();
      resolve();
    });
  });
}

export default tool({
  description: 'Interact with the local RAG (Retrieval-Augmented Generation) system for document Q&A. Use this tool to start/stop the server, upload documents, query documents, and manage collections.',
  args: {
    action: tool.schema.enum(['start', 'stop', 'status', 'upload', 'query', 'list', 'create_collection', 'delete_collection'])
      .describe('Action to perform: start (start server), stop (stop server), status (check status), upload (upload documents), query (ask questions), list (list collections), create_collection, delete_collection'),
    filePath: tool.schema.string().optional()
      .describe('Path to PDF/TXT file or folder containing PDFs (required for upload action)'),
    collection: tool.schema.string().optional()
      .describe('Collection name (defaults to "default")'),
    question: tool.schema.string().optional()
      .describe('Question to ask about documents (required for query action)'),
    limit: tool.schema.number().optional()
      .describe('Maximum number of results to return (for query, default: 5)')
  },
  async execute(args: any, context?: any) {
    try {
      // Ensure server is running for actions that need it
      if (args.action !== 'status' && args.action !== 'stop') {
        await ensureServerRunning();
      }

      switch (args.action) {
        case 'start':
          await ensureServerRunning();
          const status = await ragService.getStatus();
          return JSON.stringify({
            success: true,
            message: 'RAG server is running',
            status: {
              initialized: status.initialized,
              embeddingModel: status.embeddingModel,
              collectionsCount: status.collections.length,
              collections: status.collections
            }
          }, null, 2);

        case 'stop':
           try {
             const { execSync } = require('child_process');
             execSync('pkill -f "src/index.ts"', { stdio: 'pipe' });
             execSync('pkill -f "dist/index.js"', { stdio: 'pipe' });
             return JSON.stringify({
               success: true,
               message: 'RAG server stopped'
             }, null, 2);
           } catch (error) {
             return JSON.stringify({
               success: false,
               error: 'Failed to stop RAG server'
             }, null, 2);
           }

        case 'status':
          // Check if server is running without starting it
          const isRunning = await new Promise<boolean>((resolve) => {
            const req = http.get('http://localhost:3001/api/status', (res) => {
              resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.setTimeout(2000, () => {
              req.destroy();
              resolve(false);
            });
          });

          if (!isRunning) {
            return JSON.stringify({
              success: true,
              message: 'RAG server is not running',
              status: {
                running: false
              }
            }, null, 2);
          }

          const statusResult = await ragService.getStatus();
          return JSON.stringify({
            success: true,
            status: {
              running: true,
              initialized: statusResult.initialized,
              embeddingModel: statusResult.embeddingModel,
              collectionsCount: statusResult.collections.length,
              collections: statusResult.collections,
              cacheStats: statusResult.cacheStats
            }
          }, null, 2);

        case 'upload':
          await ensureServerRunning();
          if (!args.filePath) {
            return JSON.stringify({
              success: false,
              error: 'filePath is required for upload action'
            }, null, 2);
          }

          if (!fs.existsSync(args.filePath)) {
            return JSON.stringify({
              success: false,
              error: `Path does not exist: ${args.filePath}`
            }, null, 2);
          }

          const stats = fs.statSync(args.filePath);
          let pdfFiles: string[] = [];

          if (stats.isDirectory()) {
            // Find all PDF files recursively
            function findPdfFiles(dirPath: string): string[] {
              const files: string[] = [];
              const items = fs.readdirSync(dirPath);
              for (const item of items) {
                const fullPath = path.join(dirPath, item);
                const itemStats = fs.statSync(fullPath);
                if (itemStats.isDirectory()) {
                  files.push(...findPdfFiles(fullPath));
                } else if (item.toLowerCase().endsWith('.pdf') || item.toLowerCase().endsWith('.txt')) {
                  files.push(fullPath);
                }
              }
              return files;
            }
            pdfFiles = findPdfFiles(args.filePath);
            if (pdfFiles.length === 0) {
              return JSON.stringify({
                success: false,
                error: `No PDF/TXT files found in directory: ${args.filePath}`
              }, null, 2);
            }
          } else {
            if (!args.filePath.toLowerCase().endsWith('.pdf') && !args.filePath.toLowerCase().endsWith('.txt')) {
              return JSON.stringify({
                success: false,
                error: 'Only PDF and TXT files are supported for upload'
              }, null, 2);
            }
            pdfFiles = [args.filePath];
          }

          const results = [];
          let totalChunks = 0;
          let totalProcessingTime = 0;

          for (const pdfFile of pdfFiles) {
            try {
              const result = await ragService.indexDocument(
                pdfFile,
                args.collection || 'default',
                undefined,
                path.basename(pdfFile)
              );
              results.push({
                file: path.basename(pdfFile),
                documentId: result.documentId,
                chunksCount: result.chunksCount,
                processingTime: result.processingTime
              });
              totalChunks += result.chunksCount;
              totalProcessingTime += result.processingTime;
            } catch (error: any) {
              results.push({
                file: path.basename(pdfFile),
                error: error.message || 'Unknown error'
              });
            }
          }

          const successCount = results.filter(r => !r.error).length;
          const errorCount = results.filter(r => r.error).length;

          return JSON.stringify({
            success: successCount > 0,
            result: {
              message: `Processed ${pdfFiles.length} files: ${successCount} successful, ${errorCount} failed`,
              collection: args.collection || 'default',
              totalChunks,
              totalProcessingTime: `${totalProcessingTime}ms`,
              results
            }
          }, null, 2);

        case 'query':
          await ensureServerRunning();
          if (!args.question) {
            return JSON.stringify({
              success: false,
              error: 'question is required for query action'
            }, null, 2);
          }

          const queryResult = await ragService.query({
            question: args.question,
            collection: args.collection || 'default',
            limit: args.limit || 5
          });

          return JSON.stringify({
            success: true,
            answer: queryResult.answer,
            sources: queryResult.sources.map(source => ({
              content: source.content.substring(0, 500) + (source.content.length > 500 ? '...' : ''),
              score: Math.round(source.score * 100) / 100,
              source: source.metadata.source,
              page: source.metadata.page
            })),
            totalSources: queryResult.sources.length,
            processingTime: `${queryResult.processingTime}ms`
          }, null, 2);

        case 'list':
          await ensureServerRunning();
          const collections = await ragService.listCollections();
          const collectionDetails = [];
          for (const collectionName of collections) {
            const info = await ragService.getCollectionInfo(collectionName);
            if (info) {
              collectionDetails.push(info);
            }
          }

          return JSON.stringify({
            success: true,
            collections: collectionDetails,
            count: collections.length
          }, null, 2);

        case 'create_collection':
          await ensureServerRunning();
          if (!args.collection) {
            return JSON.stringify({
              success: false,
              error: 'collection name is required for create_collection action'
            }, null, 2);
          }

          return JSON.stringify({
            success: true,
            message: `Collection '${args.collection}' is ready for use. Upload documents to create it.`
          }, null, 2);

        case 'delete_collection':
          await ensureServerRunning();
          if (!args.collection) {
            return JSON.stringify({
              success: false,
              error: 'collection name is required for delete_collection action'
            }, null, 2);
          }

          await ragService.deleteCollection(args.collection);
          return JSON.stringify({
            success: true,
            message: `Collection '${args.collection}' deleted successfully`
          }, null, 2);

        default:
          return JSON.stringify({
            success: false,
            error: `Unknown action: ${args.action}`
          }, null, 2);
       }
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message || 'Unknown error occurred'
      }, null, 2);
    }
  }
});

