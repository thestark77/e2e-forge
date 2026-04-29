#!/usr/bin/env bash
set -euo pipefail

# E2E Forge — Cross-platform installer (Unix/macOS/Linux/WSL/Git Bash)
# Usage: curl -fsSL <raw-url>/install.sh | bash
#    or: bash install.sh

SKILL_NAME="e2e-forge"
SKILL_DIR="${HOME}/.claude/skills/${SKILL_NAME}"

WARNINGS=()
warn() {
  local msg="$1"
  WARNINGS+=("${msg}")
  echo "[warn] ${msg}"
}

echo "=== E2E Forge Installer ==="
echo ""

# 1. Ensure ~/.claude/skills/ exists
mkdir -p "${HOME}/.claude/skills"

# 2. Check if already installed
if [ -d "${SKILL_DIR}" ] && [ -f "${SKILL_DIR}/SKILL.md" ]; then
  echo "[info] e2e-forge already installed at ${SKILL_DIR}"
  echo "[info] Updating to latest version..."
  rm -rf "${SKILL_DIR}"
fi

# 3. Copy the skill from the cloned repo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/SKILL.md" ]; then
  echo "[info] Installing from local directory: ${SCRIPT_DIR}"
  cp -r "${SCRIPT_DIR}" "${SKILL_DIR}"
else
  echo "[error] SKILL.md not found in ${SCRIPT_DIR}"
  echo "[info]  Clone the repo first, then run install.sh from inside it."
  exit 1
fi

# 4. Install script dependencies
echo ""
echo "[info] Installing script dependencies..."
if command -v pnpm &>/dev/null; then
  if ! (cd "${SKILL_DIR}/scripts" && pnpm install); then
    warn "pnpm install failed. Run manually: cd ${SKILL_DIR}/scripts && pnpm install"
  fi
elif command -v npm &>/dev/null; then
  if ! (cd "${SKILL_DIR}/scripts" && npm install); then
    warn "npm install failed. Run manually: cd ${SKILL_DIR}/scripts && npm install"
  fi
else
  warn "No package manager found (pnpm/npm). Run manually: cd ${SKILL_DIR}/scripts && npm install"
fi

# Verify dependencies installed
if [ ! -d "${SKILL_DIR}/scripts/node_modules/@axiomhq/js" ]; then
  warn "Dependencies may not have installed correctly. Try: cd ${SKILL_DIR}/scripts && npm install"
fi

# 5. Check for tsx (optional — falls back to npx tsx)
if ! command -v tsx &>/dev/null && ! npx --no tsx --version &>/dev/null 2>&1; then
  warn "tsx not found. Scripts will use 'npx tsx' (slower first run). For faster execution: npm install -g tsx"
fi

# 6. Install TypeScript LSP plugin for Claude Code (optional — Mode 4 DOCUMENT only)
echo ""
echo "[info] Installing TypeScript LSP plugin for Claude Code..."
if command -v claude &>/dev/null; then
  plugin_output="$(claude plugin install typescript-lsp 2>&1 || true)"
  if echo "${plugin_output}" | grep -qiE "installed|success|already"; then
    echo "[ok] TypeScript LSP plugin installed."
  else
    warn "Could not install TypeScript LSP plugin (needed only for Mode 4: DOCUMENT)."
    warn "  Reason: ${plugin_output}"
    warn "  Fix: register a marketplace that provides it, then run: claude plugin install typescript-lsp"
  fi
else
  warn "Claude Code CLI not found. Install the TypeScript LSP plugin manually: claude plugin install typescript-lsp"
fi

# 7. Verify installation
echo ""
if [ -f "${SKILL_DIR}/SKILL.md" ] && [ -f "${SKILL_DIR}/scripts/config.ts" ]; then
  echo "[ok] e2e-forge installed successfully at: ${SKILL_DIR}"
else
  echo "[error] Installation verification failed."
  exit 1
fi

# 8. Warnings summary
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  echo ""
  echo "=== Warnings (${#WARNINGS[@]}) ==="
  for w in "${WARNINGS[@]}"; do
    echo "  - ${w}"
  done
  echo "The skill is installed, but review the warnings above before using it."
fi

# 9. Remind about env setup
echo ""
echo "=== Next Steps ==="
echo ""
echo "1. Create a read-only Axiom API token:"
echo "   - Go to app.axiom.co > Settings > API Tokens > New API Token"
echo "   - Name: bemovil2-e2e-extraction-readonly"
echo "   - Permissions: Query on datasets: http-logs, errors, bemovil2-providers, bemovil2-queries, bemovil2-bridge"
echo ""
echo "2. Add the token to your backend .env:"
echo "   AXIOM_QUERY_TOKEN=xaat-your-token-here"
echo ""
echo "3. Use the skill in Claude Code:"
echo "   /e2e-forge"
echo ""
echo "=========================="
