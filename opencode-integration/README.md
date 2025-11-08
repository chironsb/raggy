# OpenCode Integration

This folder contains files for integrating Raggy with [OpenCode](https://opencode.ai).

## What's included

```
opencode-integration/
├── tool/
│   ├── rag.ts              # Main RAG tool (recommended)
│   └── rag-github.ts       # Alternative tool implementation
└── agent/
    └── RAG.md              # RAG agent configuration
```

## Installation

### 1. Install the RAG tool

Copy the tool file to OpenCode's tool directory:

```bash
cp tool/rag.ts ~/.config/opencode/tool/
```

**Important:** Update the project path in the tool file. You have two options:

**Option 1 - Set environment variable (recommended):**
```bash
echo 'export RAGGY_PATH="/path/to/your/raggy"' >> ~/.zshrc
source ~/.zshrc
```

**Option 2 - Edit the file directly:**
Edit `~/.config/opencode/tool/rag.ts` line 7:
```typescript
const PROJECT_ROOT = process.env.RAGGY_PATH || '/path/to/your/raggy';
```

### 2. Install the RAG agent (optional)

If you want a dedicated agent for RAG operations:

```bash
cp agent/RAG.md ~/.config/opencode/agent/
```

The agent is configured to use:
- **Model**: `ollama/llama3.2:1b` (local via Ollama)
- **Tools**: `rag` tool enabled
- **System prompt**: Optimized for document Q&A

## Usage

### With any OpenCode agent

Once the tool is installed, you can use it from any agent (Build, Plan, etc.):

```bash
status                                    # Check RAG server status
upload /path/to/file.pdf collection       # Upload a document
query "your question" collection          # Ask questions
list                                      # List collections
```

### With RAG agent

Switch to RAG agent (Tab or agent selector) for a dedicated RAG experience:

```bash
raggy status
raggy upload /home/user/docs/paper.pdf research
raggy query "What are the main findings?" research
raggy stop
```

The agent understands natural language too:

```bash
What does the document say about X?
Summarize the key points
```

## Tool features

- **Auto-start**: Server starts automatically when you use RAG commands
- **Graceful stop**: `stop` command shuts down the server cleanly
- **Structured output**: Clean, formatted responses with emoji indicators
- **Error handling**: Helpful error messages if something goes wrong

## Configuration

### Changing the LLM model

Edit `agent/llm-config.json` or `~/.config/opencode/agent/RAGagent/llm-config.json`:

```json
{
  "provider": "ollama",
  "baseUrl": "http://localhost:11434",
  "model": "llama3.2:1b"
}
```

Available models (if you have them in Ollama):
- `llama3.2:1b` - Fast, lightweight (1GB RAM)
- `llama3.2:3b` - Balanced (3GB RAM)
- `qwen2.5:7b` - More capable (8GB RAM)

### Adjusting RAG settings

Edit your Raggy `.env` file (not these OpenCode files):

```bash
RAG_SIMILARITY_THRESHOLD=0.3    # Lower = more results
RAG_CHUNK_SIZE=1000             # Chunk size in characters
RAG_MAX_RESULTS=5               # Max results per query
```

## Troubleshooting

**Tool not found:**
- Make sure `rag.ts` is in `~/.config/opencode/tool/`
- Check that `PROJECT_ROOT` points to the correct path
- Restart OpenCode

**Server won't start:**
- Check that Raggy dependencies are installed: `npm install`
- Verify port 3001 is available: `lsof -i :3001`
- Check Raggy logs: `tail -f logs/raggy.log`

**"Connection refused" errors:**
- The tool auto-starts the server, wait a few seconds
- Manually start: `cd /path/to/raggy && npm run dev`

**Agent uses wrong model:**
- OpenCode agents use the model selected in the UI by default
- RAGagent config specifies Ollama, but UI selection may override
- The RAG *server* always uses the model in Raggy's `.env`

## Notes

- The RAG tool and agent are independent - you can use the tool without the agent
- The agent provides a better UX with optimized prompts for document Q&A
- Both use the same Raggy server backend (localhost:3001)
- Server state persists - uploaded documents remain after restarts

