# Raggy

**Work in progress** — local document **retrieval** (PDF/TXT): embeddings, LanceDB, optional hybrid keyword search. Raggy does **not** generate answers; it returns **`context`** + **`sources`** for your LLM (e.g. in OpenCode).

### Recent direction (short)

- **Bun** for install/run (`node_modules` stays in the repo).
- **LanceDB** + **MiniSearch** + **RRF** instead of a single big JSON scan — better scale and keyword + vector mix.
- **Chunking** uses real **PDF page** numbers where possible.
- **OpenCode** tool is named **`raggy`** (`raggy status`, `raggy upload`, …) so slash `/raggy` matches the tool id.

---

## Install & run

```bash
git clone https://github.com/chironsb/raggy.git
cd raggy
bun install
cp .env.example .env
bun run dev
```

Server: `http://localhost:3001`. Needs [Bun](https://bun.sh) 1.1+.

Optional first-time helper (install, `.env`, dirs, `tsc`): `bun run setup:full`.

---

## Examples (HTTP API)

With the server running (`bun run dev`):

```bash
node examples/upload-pdf.js ./paper.pdf mycollection
node examples/query.js "What does the paper say about X?" mycollection
```

Scripts expect **`{ success, data, timestamp }`** from the API (`data` holds upload stats or query `context` / `sources`). See `examples/` and `opencode-integration/tool/rag-github.ts` (source for the OpenCode tool).

---

## OpenCode (to match a working setup)

1. Put the repo path in your shell config (persistent):

   `export RAGGY_PATH="/absolute/path/to/raggy"`

2. From the repo root:

   ```bash
   chmod +x scripts/setup-opencode.sh
   ./scripts/setup-opencode.sh
   ```

   This installs `~/.config/opencode/tool/raggy.ts`, `agent/RAG.md`, and **`raggy-root.txt`** (path to this clone so the tool works even when OpenCode does not inherit `RAGGY_PATH`). Removes an old `tool/rag.ts` if present.

3. Restart **OpenCode**, pick the **RAG** agent (Tab).

### Chat commands

Use the same **collection** name for upload and query.

```text
/raggy status   # starts the server if it was down, then shows status
/raggy upload /path/to/file.pdf mycollection
/raggy query "Your question here?" mycollection
/raggy list
/raggy stop
```

You can also type `raggy …` without the slash if your UI sends it the same way.

### Agent “personality” (tone, rules, `/raggy` parsing)

Instructions for the **RAG** chat agent live in Markdown:

| Where | What |
|-------|------|
| **`opencode-integration/agent/RAG.md`** (this repo) | Source you edit and version in git. |
| **`~/.config/opencode/agent/RAG.md`** | What OpenCode actually loads after setup. |

Change things like: how strictly to parse `raggy …` commands, whether to avoid explaining chunk scores/RRF after a query, citation style, etc. After editing the repo file, run `./scripts/setup-opencode.sh` again **or** copy `RAG.md` by hand, then **restart OpenCode**.

### Models (two different roles)

| What | Where to change | Notes |
|------|-----------------|--------|
| **Chat model** (writes the answer in OpenCode) | Top of **`RAG.md`**: YAML field **`model:`** (e.g. `ollama/qwen3:1.7b`). | OpenCode UI may override the active model; provider / model list is often in **`~/.config/opencode/opencode.json`**. |
| **Embedding model** (Raggy: vectors for search) | **`.env`**: **`EMBEDDING_MODEL`** (see `.env.example`). | Changing it usually means **re-uploading** documents so vectors match the new model. |

---

## API (optional)

JSON responses use a common envelope: **`{ success, data?, error?, timestamp }`** (query results live under **`data`**).

```bash
curl -s http://localhost:3001/api/status
curl -s -X POST http://localhost:3001/api/query \
  -H "Content-Type: application/json" \
  -d '{"question":"…","collection":"mycollection"}'
# e.g. jq '.data.context' if you pipe through jq
```

More detail: `opencode-integration/README.md`, knobs in `.env.example`.

---

## Upgrade from old Raggy

Older **`data/vectors/*.json`** indexes are **not** read by the current engine (LanceDB + optional lexical). Safe approach: delete or archive `./data`, then **upload documents again**. The OpenCode tool’s `raggy list` can still **name** files from a legacy JSON only if the `data/documents/<collection>/` folder is empty.

---

## Tests

```bash
bun run test
```
