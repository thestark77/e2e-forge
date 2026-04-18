#!/usr/bin/env bash
set -euo pipefail

# E2E Forge — Cross-platform installer (Unix/macOS/Linux/WSL/Git Bash)
# Usage: curl -fsSL <raw-url>/install.sh | bash
#    or: bash install.sh

SKILL_NAME="e2e-forge"
SKILL_DIR="${HOME}/.claude/skills/${SKILL_NAME}"

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

# 3. Clone or copy the skill
if command -v git &>/dev/null; then
  # If running from a cloned repo, copy files
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "${SCRIPT_DIR}/SKILL.md" ]; then
    echo "[info] Installing from local directory: ${SCRIPT_DIR}"
    cp -r "${SCRIPT_DIR}" "${SKILL_DIR}"
  else
    echo "[error] SKILL.md not found in ${SCRIPT_DIR}"
    echo "[info]  Clone the repo first, then run install.sh from inside it."
    exit 1
  fi
else
  echo "[error] git not found. Install git first."
  exit 1
fi

# 4. Install script dependencies
echo ""
echo "[info] Installing script dependencies..."
if command -v pnpm &>/dev/null; then
  (cd "${SKILL_DIR}/scripts" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install)
elif command -v npm &>/dev/null; then
  (cd "${SKILL_DIR}/scripts" && npm install)
else
  echo "[warn] No package manager found (pnpm/npm). Install dependencies manually:"
  echo "       cd ${SKILL_DIR}/scripts && npm install"
fi

# 5. Check for tsx
if ! command -v tsx &>/dev/null && ! npx tsx --version &>/dev/null 2>&1; then
  echo ""
  echo "[warn] tsx not found globally. Scripts will use npx tsx (slower first run)."
  echo "       For faster execution: npm install -g tsx"
fi

# 6. Verify installation
echo ""
if [ -f "${SKILL_DIR}/SKILL.md" ] && [ -f "${SKILL_DIR}/scripts/config.ts" ]; then
  echo "[ok] e2e-forge installed successfully at: ${SKILL_DIR}"
else
  echo "[error] Installation verification failed."
  exit 1
fi

# 7. Remind about env setup
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
echo "3. Install @axiomhq/js in your backend (if not already):"
echo "   cd your-backend && pnpm add -D @axiomhq/js"
echo ""
echo "4. Use the skill in Claude Code:"
echo "   /e2e-forge"
echo ""
echo "=========================="
