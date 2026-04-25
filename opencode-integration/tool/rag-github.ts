import { tool } from '@opencode-ai/plugin';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Raggy repo root. OpenCode often runs tools without your shell env — then RAGGY_PATH is empty.
 * Fallback: one-line file written by scripts/setup-opencode.sh → ~/.config/opencode/raggy-root.txt
 */
function getRaggyRoot(): string {
  const fromEnv = process.env.RAGGY_PATH?.trim();
  if (fromEnv) return fromEnv;
  try {
    const marker = path.join(process.env.HOME || '', '.config/opencode/raggy-root.txt');
    if (fs.existsSync(marker)) {
      const line = fs.readFileSync(marker, 'utf-8').trim().split(/\r?\n/)[0]?.trim();
      if (line) return line;
    }
  } catch {
    /* ignore */
  }
  return '/path/to/raggy';
}

async function ensureServerRunning(): Promise<void> {
  const root = getRaggyRoot();
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
        if (!fs.existsSync(path.join(root, 'package.json'))) {
          resolve();
          return;
        }
        const { spawn } = require('child_process');
        const serverProcess = spawn('bun', ['run', 'dev'], {
          cwd: root,
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, RAGGY_PATH: root }
        });

        serverProcess.unref();
        setTimeout(() => resolve(), 8000);
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

async function makeApiRequest(endpoint: string, method = 'GET', data?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: `/api/${endpoint}`,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

export default tool({
  description: 'Interact with the local RAG (Retrieval-Augmented Generation) system for document Q&A. Use this tool to start/stop the server, upload documents, query documents, and manage collections.',
  args: {
    action: tool.schema.enum(['start', 'stop', 'status', 'upload', 'query', 'list', 'create_collection', 'delete_collection'])
      .describe('Action to perform: start (start server), stop (stop server), status (start if needed, then check status), upload (upload documents), query (ask questions), list (list collections), create_collection, delete_collection'),
    filePath: tool.schema.string().optional()
      .describe('Path to PDF/TXT file or folder containing PDFs (required for upload action)'),
    collection: tool.schema.string().optional()
      .describe('Collection name (defaults to "default")'),
    question: tool.schema.string().optional()
      .describe('Question to ask about documents (required for query action)'),
    limit: tool.schema.number().optional()
      .describe('Maximum number of results to return (for query, default: 5)')
  },
  async execute(args, context) {
    try {
      // Auto-start if down for every action except stop (status wakes the server too)
      if (args.action !== 'stop') {
        await ensureServerRunning();
      }

      switch (args.action) {
        case 'start':
          await ensureServerRunning();
          const startStatus = await makeApiRequest('status');
          const startStatusData = startStatus.data || startStatus;
          const startEmbModel = startStatusData.embeddingModel || {};
          const startRetrieval = startStatusData.retrieval || {};
          const startCollectionsCount = (startStatusData.collections || []).length;
          const startCacheKeys = startStatusData.cacheStats?.keys ?? 0;
          
          return JSON.stringify({
            success: true,
            message: [
              'Status: ✅ Online',
              `Retrieval: ${startRetrieval.backend || 'lancedb'} (hybrid: ${startRetrieval.hybridSearch !== false ? 'on' : 'off'})`,
              `Embeddings: ${startEmbModel.name || 'N/A'} (local, Xenova/transformers)`,
              `Collections: ${startCollectionsCount}`,
              `Cache keys: ${startCacheKeys} (embeddings + query cache)`
            ].join('\n')
          }, null, 2);

        case 'stop':
          try {
            const { execSync } = require('child_process');
            // Stop gracefully by finding Node.js process running raggy
            try {
              // Find PID of process running in raggy directory
              const pid = execSync(`ps aux | grep -E "bun.*raggy/.*index|node.*raggy/.*index" | grep -v grep | awk '{print $2}' | head -1`, { encoding: 'utf8' }).trim();
              if (pid) {
                execSync(`kill ${pid}`, { stdio: 'pipe' }); // SIGTERM (graceful)
              }
            } catch (e) {
              // Fallback: try killing by port (most reliable)
              try {
                execSync('lsof -ti:3001 | xargs kill 2>/dev/null', { stdio: 'pipe' });
              } catch (e2) {
                // Last resort: generic raggy pattern
                execSync('pkill -f "raggy.*index"', { stdio: 'pipe' });
              }
            }
            return JSON.stringify({
              success: true,
              message: '✅ RAG server stopped'
            }, null, 2);
          } catch (error) {
            return JSON.stringify({
              success: false,
              error: 'Failed to stop RAG server (might not be running)'
            }, null, 2);
          }

        case 'status': {
          let statusResult: any;
          let lastError: unknown;
          for (let attempt = 0; attempt < 12; attempt++) {
            try {
              statusResult = await makeApiRequest('status');
              break;
            } catch (e) {
              lastError = e;
              await new Promise((r) => setTimeout(r, 2000));
            }
          }
          if (statusResult === undefined) {
            return JSON.stringify({
              success: false,
              message:
                'Status: ❌ Offline. Fix: run ./scripts/setup-opencode.sh from the Raggy repo (writes ~/.config/opencode/raggy-root.txt), or set RAGGY_PATH, then retry. Also try: cd <raggy> && bun run dev',
              detail: lastError != null ? String(lastError) : undefined
            }, null, 2);
          }
          const statusResultData = statusResult.data || statusResult;
          const embModelStatus = statusResultData.embeddingModel || {};
          const retrievalStatus = statusResultData.retrieval || {};
          const collectionsCount = (statusResultData.collections || []).length;
          const cacheKeys = statusResultData.cacheStats?.keys ?? 0;
          
          return JSON.stringify({
            success: true,
            message: [
              'Status: ✅ Online',
              `Retrieval: ${retrievalStatus.backend || 'lancedb'} (hybrid: ${retrievalStatus.hybridSearch !== false ? 'on' : 'off'})`,
              `Embeddings: ${embModelStatus.name || 'N/A'} (local)`,
              `Collections: ${collectionsCount}`,
              `Cache keys: ${cacheKeys}`
            ].join('\n')
          }, null, 2);
        }

        case 'upload':
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

          const uploadResult = await makeApiRequest('upload', 'POST', {
            filePath: args.filePath,
            collection: args.collection || 'default'
          });

          const uploadData = uploadResult.data || uploadResult;
          const results = uploadData.results || [];
          const successCount = results.filter((r: any) => !r.error).length;
          const chunks = uploadData.totalChunks || 0;
          const time = uploadData.totalProcessingTime || 'N/A';

          return JSON.stringify({
            success: uploadData.success !== false,
            message: `✅ Upload complete | ${successCount} file(s) | ${chunks} chunks | ${time}`
          }, null, 2);

        case 'query':
          if (!args.question) {
            return JSON.stringify({
              success: false,
              error: 'question is required for query action'
            }, null, 2);
          }

          const queryResult = await makeApiRequest('query', 'POST', {
            question: args.question,
            collection: args.collection || 'default',
            limit: args.limit || 5
          });

          const queryData = queryResult.data || {};
          const sources = queryData.sources || [];
          const context = queryData.context ?? queryData.answer ?? '';

          return JSON.stringify({
            success: true,
            message: `🔍 ${sources.length} source(s) | ${queryData.processingTime ?? 'N/A'}ms`,
            context,
            answer: queryData.answer ?? context,
            sources: sources
          }, null, 2);

        case 'list':
          const listResult = await makeApiRequest('collections');
          const collData = listResult.data || listResult;
          const collections = collData.collections || [];
          
          if (collections.length === 0) {
            return JSON.stringify({
              success: true,
              message: '📚 No collections'
            }, null, 2);
          }
          
          // Get details for each collection
          const collectionDetails = [];
          for (const collName of collections) {
            try {
              const info = await makeApiRequest(`collections/${collName}`);
              const collInfo = info.data || info;

              const root = getRaggyRoot();
              const collectionPath = path.join(root, 'data', 'documents', collName);
              let documents: string[] = [];

              if (fs.existsSync(collectionPath)) {
                documents = fs.readdirSync(collectionPath).filter(
                  (file) => file.endsWith('.pdf') || file.endsWith('.txt')
                );
              }

              // Pre-LanceDB JSON indexes only — ignore if you already migrated
              if (documents.length === 0) {
                const legacyJson = path.join(root, 'data', 'vectors', `${collName}.json`);
                if (fs.existsSync(legacyJson)) {
                  try {
                    const vectorData = JSON.parse(fs.readFileSync(legacyJson, 'utf-8'));
                    const names = new Set<string>();
                    for (const chunk of vectorData) {
                      if (chunk.metadata?.source || chunk.metadata?.fileName) {
                        names.add(chunk.metadata.source || chunk.metadata.fileName);
                      }
                    }
                    documents = Array.from(names);
                  } catch {
                    /* ignore corrupt legacy file */
                  }
                }
              }
              
              collectionDetails.push({
                name: collName,
                documentCount: collInfo.documentCount || documents.length,
                documents: documents
              });
            } catch (error) {
              collectionDetails.push({
                name: collName,
                documentCount: 0,
                documents: []
              });
            }
          }
          
          // Format message
          let message = `Collections: ${collections.length}\n\n`;
          for (const coll of collectionDetails) {
            message += `${coll.name}: ${coll.documentCount} document(s)\n`;
            if (coll.documents.length > 0) {
              for (const doc of coll.documents) {
                message += `  - ${doc}\n`;
              }
            }
          }
          
          return JSON.stringify({
            success: true,
            message: message.trim()
          }, null, 2);

        case 'create_collection':
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
          if (!args.collection) {
            return JSON.stringify({
              success: false,
              error: 'collection name is required for delete_collection action'
            }, null, 2);
          }

          await makeApiRequest(`collections/${args.collection}`, 'DELETE');
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
