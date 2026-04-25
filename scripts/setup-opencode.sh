#!/usr/bin/env bash
# Install Raggy's OpenCode tool + RAG agent into ~/.config/opencode/
set -euo pipefail

RAGGY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

mkdir -p "$CONFIG_DIR/tool" "$CONFIG_DIR/agent"

# So OpenCode can start Raggy even when RAGGY_PATH is not in the tool process env
printf '%s\n' "$RAGGY_ROOT" > "$CONFIG_DIR/raggy-root.txt"

# Tool must be raggy.ts so OpenCode registers the tool as "raggy" (chat: raggy status, raggy upload, …)
rm -f "$CONFIG_DIR/tool/rag.ts"
cp "$RAGGY_ROOT/opencode-integration/tool/rag-github.ts" "$CONFIG_DIR/tool/raggy.ts"
cp "$RAGGY_ROOT/opencode-integration/agent/RAG.md" "$CONFIG_DIR/agent/RAG.md"

echo "Installed:"
echo "  $CONFIG_DIR/tool/raggy.ts"
echo "  $CONFIG_DIR/agent/RAG.md"
echo "  $CONFIG_DIR/raggy-root.txt (path for tools without shell env)"
echo ""
echo "Optional — shell / terminal:"
echo "  export RAGGY_PATH=\"$RAGGY_ROOT\""
echo ""
echo "Restart OpenCode. On the RAG agent, use:"
echo "  raggy status | raggy upload <path> [collection] | raggy query \"…\" [collection] | raggy list | raggy stop"
