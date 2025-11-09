# 🤖 Raggy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)

Local RAG (Retrieval-Augmented Generation) system with OpenCode integration.

## ✨ What it does

- 📄 Upload PDFs and text files
- 🔍 Search through documents using natural language
- 💬 Get answers with sources and context
- 🏠 Everything runs locally on your machine

## 🚀 Quick start

```bash
git clone https://github.com/chironsb/raggy.git
cd raggy
npm install
cp .env.example .env
npm run dev
```

🌐 Server starts on `http://localhost:3001`

## 📖 Usage

### 🤖 Via OpenCode agent

The easiest way to use Raggy is through the OpenCode RAG agent:

```bash
raggy status                             # 📊 Check server status
raggy upload /path/to/file.pdf [collection]  # ⬆️ Upload a document
raggy query "your question" [collection]     # ❓ Ask questions
raggy list                               # 📋 List all collections
raggy stop                               # 🛑 Stop server
```

### 🌐 Via REST API

```bash
# ⬆️ Upload document
curl -X POST http://localhost:3001/api/upload \
  -H "Content-Type: application/json" \
  -d '{"filePath": "/path/to/file.pdf", "collection": "docs"}'

# ❓ Query documents
curl -X POST http://localhost:3001/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is this about?", "collection": "docs"}'
```

## 🎯 Features

- 📄 **PDF & TXT processing** - Extract text and metadata
- ✂️ **Smart chunking** - Split documents into meaningful pieces
- 🧠 **Local embeddings** - Uses Xenova/transformers (no API calls)
- 🔎 **Vector search** - Fast similarity search with cosine similarity
- 💾 **Persistent storage** - JSON-based vector database
- 📁 **Collection management** - Organize documents into collections
- 🔗 **OpenCode integration** - Full agent support with custom tools

## ⚙️ Configuration

Edit `.env` to customize:

```bash
PORT=3001
RAG_CHUNK_SIZE=1000
RAG_CHUNK_OVERLAP=200
RAG_SIMILARITY_THRESHOLD=0.3
EMBEDDING_MODEL=Xenova/paraphrase-multilingual-MiniLM-L12-v2
```

Lower `RAG_SIMILARITY_THRESHOLD` (0.2-0.4) for more results, higher (0.6-0.8) for stricter matching.

## 📋 Requirements

- 🟢 Node.js 18+
- 🧠 2GB+ RAM (4GB recommended for large documents)

## 🏗️ Project structure

```
src/
├── core/          # 🧠 RAG logic (embeddings, chunking, vector DB)
├── server.ts      # 🌐 Express API server
├── tools/         # 🔧 OpenCode integration
└── index.ts       # 🚪 Entry point

data/              # 📁 Auto-created on first run
├── vectors/       # 📊 Vector database (JSON files)
├── documents/     # 📄 Uploaded PDFs/TXT files
└── cache/         # ⚡ Embedding cache
```

## 🔄 How it works

1. **⬆️ Upload** - PDF/TXT files are processed and text is extracted
2. **✂️ Chunk** - Text is split into overlapping chunks (default 1000 chars)
3. **🧠 Embed** - Each chunk gets a vector embedding (384 dimensions)
4. **💾 Store** - Vectors are saved to JSON files in `data/vectors/`
5. **❓ Query** - Your question is embedded and compared to all chunks
6. **📤 Return** - Most similar chunks are returned with their sources

## ⚡ Performance

The system uses parallel batch processing (50 chunks at a time) for fast uploads:
- 🚀 ~600 chunks in 1-2 seconds
- 💻 Normal CPU usage during processing
- ⚡ Results in milliseconds once indexed

## 🔮 Future Plans

- **GPU Acceleration** - Implement embedding generation on GPU for faster processing
- **More file formats** - Add support for DOCX, HTML, Markdown
- **Advanced chunking** - Semantic chunking based on document structure
- **Web UI** - Simple web interface for document management

## 📄 License

MIT
