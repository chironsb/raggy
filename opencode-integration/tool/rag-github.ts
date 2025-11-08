import { tool } from '@opencode-ai/plugin';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

// Project root path - UPDATE THIS to your Raggy installation directory
const PROJECT_ROOT = process.env.RAGGY_PATH || '/path/to/raggy';

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
      await ensureServerRunning();

      switch (args.action) {
        case 'start':
          await ensureServerRunning();
          const status = await makeApiRequest('status');
          const statusData = status.data || status;
          return JSON.stringify({
            success: true,
            message: 'RAG server is running',
            status: statusData
          }, null, 2);

        case 'stop':
          try {
            const { execSync } = require('child_process');
            execSync('pkill -f "tsx src/index.ts"', { stdio: 'pipe' });
            execSync('pkill -f "node dist/index.js"', { stdio: 'pipe' });
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
          const statusResult = await makeApiRequest('status');
          const statusResultData = statusResult.data || statusResult;
          return JSON.stringify({
            success: true,
            status: statusResultData
          }, null, 2);

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

          // Use API for upload via filePath (JSON)
          const uploadResult = await makeApiRequest('upload', 'POST', {
            filePath: args.filePath,
            collection: args.collection || 'default'
          });

          return JSON.stringify({
            success: true,
            result: uploadResult.data || uploadResult
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

          return JSON.stringify({
            success: true,
            answer: queryResult.data?.answer || 'No answer available',
            sources: queryResult.data?.sources || [],
            processingTime: queryResult.data?.processingTime || 'unknown'
          }, null, 2);

        case 'list':
          const listResult = await makeApiRequest('collections');
          return JSON.stringify({
            success: true,
            collections: listResult.data || listResult
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

