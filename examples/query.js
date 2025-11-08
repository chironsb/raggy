#!/usr/bin/env node

/**
 * Example: Query Raggy for document Q&A
 *
 * Usage:
 *   node examples/query.js "What is machine learning?" [collection-name]
 */

const axios = require('axios');
const readline = require('readline');

const RAGGY_URL = process.env.RAGGY_URL || 'http://localhost:3001';

async function queryDocuments(question, collection = 'default') {
  console.log(`🤔 Asking: "${question}"`);
  console.log(`📚 Collection: ${collection}`);
  console.log('⏳ Searching documents...\n');

  try {
    const response = await axios.post(`${RAGGY_URL}/api/query`, {
      question,
      collection,
      limit: 5
    }, {
      timeout: 60000, // 1 minute timeout
    });

    const { answer, sources, processingTime } = response.data;

    console.log('💡 Answer:');
    console.log('─'.repeat(50));
    console.log(answer);
    console.log('─'.repeat(50));

    if (sources && sources.length > 0) {
      console.log(`\n📄 Sources (${sources.length}):`);
      sources.forEach((source, i) => {
        console.log(`${i + 1}. Page ${source.page} (similarity: ${(source.score * 100).toFixed(1)}%)`);
        console.log(`   "${source.content.substring(0, 100)}..."`);
      });
    }

    console.log(`\n⚡ Processing time: ${processingTime}ms`);

  } catch (error) {
    console.error('❌ Query failed:', error.response?.data?.error || error.message);
    process.exit(1);
  }
}

// Interactive mode
async function interactiveMode(collection = 'default') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('🤖 Raggy Interactive Q&A');
  console.log(`📚 Collection: ${collection}`);
  console.log('Type your questions (or "exit" to quit):\n');

  const askQuestion = () => {
    rl.question('❓ Question: ', async (question) => {
      if (question.toLowerCase() === 'exit') {
        console.log('👋 Goodbye!');
        rl.close();
        return;
      }

      if (question.trim()) {
        await queryDocuments(question.trim(), collection);
      }

      console.log('\n' + '='.repeat(60) + '\n');
      askQuestion();
    });
  };

  askQuestion();
}

// CLI interface
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage:');
  console.log('  node examples/query.js "your question here" [collection]');
  console.log('  node examples/query.js --interactive [collection]');
  console.log('');
  console.log('Examples:');
  console.log('  node examples/query.js "What is machine learning?"');
  console.log('  node examples/query.js --interactive tech-books');
  process.exit(1);
}

if (args[0] === '--interactive') {
  const collection = args[1] || 'default';
  interactiveMode(collection);
} else {
  const question = args[0];
  const collection = args[1] || 'default';
  queryDocuments(question, collection);
}