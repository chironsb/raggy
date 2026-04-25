# OpenCode Integration

This folder contains files for integrating Raggy with [OpenCode](https://opencode.ai).

## What's included

```
opencode-integration/
├── tool/
│   └── rag-github.ts       # Source for ~/.config/opencode/tool/raggy.ts (via setup-opencode.sh)
└── agent/
    └── RAG.md              # RAG agent configuration
```

## Installation

### Quick path (from repo root)

```bash
export RAGGY_PATH="/absolute/path/to/raggy"   # persist in ~/.zshrc
chmod +x scripts/setup-opencode.sh
./scripts/setup-opencode.sh
```

This copies `tool/rag-github.ts` → `~/.config/opencode/tool/raggy.ts` (tool name **`raggy`**) and `agent/RAG.md` → `~/.config/opencode/agent/RAG.md`. Any old `tool/rag.ts` is removed to avoid duplicates.

### Manual copy

```bash
cp tool/rag-github.ts ~/.config/opencode/tool/raggy.ts
rm -f ~/.config/opencode/tool/rag.ts
cp agent/RAG.md ~/.config/opencode/agent/
```

Set **`RAGGY_PATH`** to your Raggy clone so the tool can run `bun run dev` there.

The RAG agent uses the **`raggy`** tool. In chat, use: `raggy status`, `raggy upload …`, `raggy query "…"`, `raggy list`, `raggy stop`. Answers come from your OpenCode model using Raggy’s **context + sources**.

## Usage

### With any OpenCode agent

Once the tool is installed, any agent with **`raggy: true`** (or that can call tools) can use:

```text
raggy status
raggy upload /path/to/file.pdf [collection]
raggy query "your question" [collection]
raggy list
raggy stop
```

### With RAG agent

Switch to RAG agent (Tab or agent selector) for a dedicated RAG experience:

```text
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

### Chat model (OpenCode)

The `model:` field in `agent/RAG.md` is the **OpenCode / Ollama** model that **writes answers** after tool calls. Change it to any model you have installed. This is separate from **embeddings**, which Raggy loads from `EMBEDDING_MODEL` in Raggy’s `.env`.

### Adjusting RAG settings

Edit your Raggy `.env` file (not these OpenCode files):

```bash
RAG_SIMILARITY_THRESHOLD=0.35   # Lower = more results (try 0.25–0.5)
RAG_CHUNK_SIZE=1000             # Chunk size in characters
RAG_MAX_RESULTS=5               # Max results per query
```

## Troubleshooting

**Tool not found:**
- Make sure `raggy.ts` is in `~/.config/opencode/tool/` and `RAG.md` has `tools: raggy: true`
- Run `./scripts/setup-opencode.sh` from the Raggy repo so **`~/.config/opencode/raggy-root.txt`** exists (or set **`RAGGY_PATH`** so the tool can spawn `bun run dev`)
- Restart OpenCode

**Server won't start:**
- Check that Raggy dependencies are installed: `bun install`
- Verify port 3001 is available: `lsof -i :3001`
- Check Raggy logs: `tail -f logs/raggy.log`

**"Connection refused" errors:**
- The tool auto-starts the server, wait a few seconds
- Manually start: `cd /path/to/raggy && bun run dev`

**Agent / model:**
- OpenCode chooses the **chat** model (answers). Raggy only runs **embeddings + search**; configure `EMBEDDING_MODEL` in Raggy’s `.env`.

## Notes

- The RAG tool and agent are independent - you can use the tool without the agent
- The agent provides a better UX with optimized prompts for document Q&A
- Both use the same Raggy server backend (localhost:3001)
- Server state persists - uploaded documents remain after restarts (under `data/lancedb`, `data/lexical`, `data/documents`)

