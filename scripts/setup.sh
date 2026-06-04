#!/usr/bin/env bash
# Install + pin the harness CLIs and the security scanner, and install Pi's provider config.
# Reproducible & supply-chain-safe: exact versions only, https only, NO pipe-to-shell.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- pinned harness versions (must match config/harness-manifest.toml) ---
CODEX_VER="0.136.0"
OPENCODE_VER="1.0.163"
PI_VER="0.73.0"

echo ">> installing pinned harnesses (global)"
npm install -g "@openai/codex@${CODEX_VER}" "opencode-ai@${OPENCODE_VER}" "@mariozechner/pi-coding-agent@${PI_VER}"

echo ">> installing osv-scanner (security gate)"
if ! command -v osv-scanner >/dev/null 2>&1; then
  brew install osv-scanner
fi

echo ">> installing Pi provider config -> ~/.pi/agent/models.json"
mkdir -p "${HOME}/.pi/agent"
cp "${ROOT}/config/providers/pi.models.json" "${HOME}/.pi/agent/models.json"

echo ">> enabling the secretlint pre-commit hook"
git config core.hooksPath .githooks

echo ">> verifying installed versions match pins"
codex --version
opencode --version
pi --version

echo "OK. Harnesses point at the metering proxy (http://127.0.0.1:8077) with a dummy key."
