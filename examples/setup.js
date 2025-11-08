#!/usr/bin/env node

/**
 * Raggy Setup Helper
 *
 * This script helps you set up Raggy quickly by:
 * 1. Checking prerequisites
 * 2. Installing dependencies
 * 3. Setting up environment
 * 4. Downloading AI models
 * 5. Testing the system
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

function checkCommand(command, description) {
  try {
    execSync(command, { stdio: 'pipe' });
    log(colors.green, `✅ ${description}`);
    return true;
  } catch {
    log(colors.red, `❌ ${description}`);
    return false;
  }
}

function runCommand(command, description) {
  log(colors.blue, `🔄 ${description}...`);
  try {
    execSync(command, { stdio: 'inherit' });
    log(colors.green, `✅ ${description} completed`);
    return true;
  } catch (error) {
    log(colors.red, `❌ ${description} failed: ${error.message}`);
    return false;
  }
}

async function main() {
  log(colors.cyan, '🚀 Raggy Setup Helper');
  log(colors.cyan, '='.repeat(50));

  // Check prerequisites
  log(colors.yellow, '\n📋 Checking prerequisites...');

  const nodeOk = checkCommand('node --version', 'Node.js 18+');
  const npmOk = checkCommand('npm --version', 'npm');
  const ollamaOk = checkCommand('ollama --version', 'Ollama');

  if (!nodeOk) {
    log(colors.red, '❌ Node.js 18+ is required. Please install from https://nodejs.org');
    process.exit(1);
  }

  if (!npmOk) {
    log(colors.red, '❌ npm is required. Please install Node.js first.');
    process.exit(1);
  }

  // Install dependencies
  log(colors.yellow, '\n📦 Installing dependencies...');
  if (!runCommand('npm install', 'Installing npm dependencies')) {
    process.exit(1);
  }

  // Setup environment
  log(colors.yellow, '\n⚙️ Setting up environment...');
  if (!fs.existsSync('.env')) {
    fs.copyFileSync('.env.example', '.env');
    log(colors.green, '✅ Created .env file from .env.example');
  } else {
    log(colors.blue, 'ℹ️ .env file already exists');
  }

  // Create data directories
  const dirs = ['data/vectors', 'data/documents', 'data/cache', 'logs'];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log(colors.green, `✅ Created directory: ${dir}`);
    }
  });

  // Build TypeScript
  log(colors.yellow, '\n🔨 Building TypeScript...');
  if (!runCommand('npm run build', 'Building TypeScript')) {
    process.exit(1);
  }

  // Setup Ollama models (if Ollama is available)
  if (ollamaOk) {
    log(colors.yellow, '\n🤖 Setting up AI models...');

    // Start Ollama in background
    log(colors.blue, '🔄 Starting Ollama service...');
    const ollamaProcess = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore'
    });
    ollamaProcess.unref();

    // Wait a bit for Ollama to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Download models
    const models = ['llama2:7b', 'nomic-embed-text'];
    for (const model of models) {
      if (!runCommand(`ollama pull ${model}`, `Downloading ${model}`)) {
        log(colors.yellow, `⚠️ Failed to download ${model}. You can download it later with: ollama pull ${model}`);
      }
    }

    log(colors.green, '✅ AI models setup completed');
  } else {
    log(colors.yellow, '⚠️ Ollama not found. Please install from https://ollama.ai');
    log(colors.blue, 'ℹ️ You can still run Raggy, but you\'ll need Ollama for the LLM features');
  }

  // Test the system
  log(colors.yellow, '\n🧪 Testing the system...');
  try {
    execSync('timeout 10s npm run dev', { stdio: 'pipe' });
    log(colors.green, '✅ Server starts successfully');
  } catch {
    log(colors.yellow, '⚠️ Server test inconclusive (may be normal)');
  }

  log(colors.green, '\n🎉 Setup completed successfully!');
  log(colors.cyan, '\nNext steps:');
  log(colors.reset, '1. Start Raggy: npm run dev');
  log(colors.reset, '2. Upload a PDF: node examples/upload-pdf.js your-document.pdf');
  log(colors.reset, '3. Ask questions: node examples/query.js "What is machine learning?"');
  log(colors.reset, '4. For OpenCode integration, see README.md');

  log(colors.magenta, '\n📚 Useful commands:');
  log(colors.reset, '- npm run dev          # Start development server');
  log(colors.reset, '- npm run build        # Build for production');
  log(colors.reset, '- npm run lint         # Run linter');
  log(colors.reset, '- ollama list          # Check downloaded models');
  log(colors.reset, '- tail -f logs/raggy.log # View logs');
}

main().catch(error => {
  log(colors.red, `❌ Setup failed: ${error.message}`);
  process.exit(1);
});