# E2E Forge

Automated e2e test creation, update, and improvement for API endpoints using real production logs from [Axiom](https://axiom.co), prompt engineering (CREA framework), and TDD-driven iteration.

A [Claude Code Skill](https://docs.anthropic.com/en/docs/claude-code/skills) that turns your AI assistant into a senior QA engineer with deep knowledge of your codebase and production behavior.

## How It Works

```
┌──────────────────────────────────────────────────────┐
│                  SKILL: e2e-forge                    │
│                                                      │
│  ┌───────────┐   ┌──────────┐   ┌────────────────┐   │
│  │ Scripts   │   │ Context  │   │ Test Generator │   │
│  │ (pre-     │   │ Gatherer │   │ (AI + CREA     │   │
│  │  built)   │   │ (asks    │   │  framework)    │   │
│  │           │   │  user)   │   │                │   │
│  └─────┬─────┘   └────┬─────┘   └───────┬────────┘   │
│        │              │                 │            │
│        ▼              ▼                 ▼            │
│  ┌──────────────────────────────────────────────┐    │
│  │             TDD Monitor Loop                 │    │
│  │  Run test → fail → fix → re-run → pass       │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

**Scripts do the HEAVY LIFTING, AI does the THINKING.**

| Layer | What it does | Token cost |
|-------|-------------|------------|
| Pre-built scripts | Extract Axiom logs, map routes, trace frontend usage, analyze gaps | Zero |
| Context gatherer | Ask user for business logic, edge cases, considerations | Minimal |
| AI test generator | Analyze context + logs + code → generate/improve tests | Justified |
| TDD Monitor loop | Run tests, watch for failures, iterate until green | Minimal |

## Features

- **4 Modes**: CREATE (new endpoints), UPDATE (modified endpoints), BATCH (multiple endpoints), DOCUMENT (auto-generate docs only)
- **Auto-Documentation**: Generates comprehensive `doc.md` with technical reference, JSON examples, request/response schemas, and dependency maps — all extracted from code and tests
- **TypeScript LSP Integration**: Uses the TypeScript LSP plugin for deep reference analysis — traces validators, middleware, models, and cross-endpoint dependencies
- **Smart Dataset Selection**: Intelligently decides which Axiom datasets to query based on endpoint analysis
- **Auto-Discovery**: Detects which datasets your token can access and caches for the session
- **Proactive Warnings**: Alerts you when logs are incomplete, stale, or missing error scenarios
- **CREA Framework**: Uses structured prompt engineering for high-quality test generation
- **TDD Loop**: Iterates automatically until all tests pass
- **Code Smell Detection**: Proactively analyzes endpoint code for issues
- **Context-First**: Gathers business context BEFORE writing any test code
- **Doc Generation**: Creates `doc.md` documentation for every endpoint processed
- **Benchmarks**: Tracks and reports metrics for every execution

---

## ⚠️ Required Model Setup (read before installing)

This skill is engineered for a **specific Claude model split**. Using other models will degrade results.

- **Orchestrator (main session): Opus 4.6** — REQUIRED.
- **Sub-agents: Sonnet 4.6** — the skill launches every Agent tool call with `model: "sonnet"` automatically.

**Before running `/e2e-forge`, switch the active model to Opus 4.6:**

```
/model opus-4-6
```

If you are not on Opus 4.6, the skill will refuse to proceed.

---

## Quick Install

### Unix / macOS / Linux / WSL

```bash
git clone https://github.com/thestark77/e2e-forge.git
cd e2e-forge
bash install.sh
```

### Windows (PowerShell)

```powershell
git clone https://github.com/thestark77/e2e-forge.git
cd e2e-forge
.\install.ps1
```

### Manual Install

```bash
# 1. Copy the skill to your Claude skills directory
mkdir -p ~/.claude/skills
cp -r . ~/.claude/skills/e2e-forge

# 2. Install script dependencies
cd ~/.claude/skills/e2e-forge/scripts
npm install
```

After installation, the skill appears as `/e2e-forge` in Claude Code.

---

## Prerequisites

### 1. Axiom API Token (read-only)

Create a new API token at [app.axiom.co](https://app.axiom.co) > Settings > API Tokens:

- **Name**: `your-project-e2e-extraction-readonly`
- **Permissions**: **Query** on the datasets you need (see Dataset Reference below)
- **Expiration**: 90 days recommended

> **Important**: Existing ingest tokens (`xait-...`) can NOT query data. You need an API token (`xaat-...`) with query permissions.

### 2. Backend Dependency

```bash
# In your backend directory
pnpm add -D @axiomhq/js
# or
npm install -D @axiomhq/js
```

### 3. Test Framework

Your project needs **Vitest + Supertest** configured (or equivalent). The skill reads your existing test patterns and follows them.

### 4. tsx (TypeScript executor)

```bash
# Globally (recommended for speed)
npm install -g tsx

# Or as devDependency (works via npx)
pnpm add -D tsx
```

### 5. TypeScript LSP Plugin (auto-installed)

The installer automatically installs the [TypeScript LSP plugin](https://claude.com/plugins/typescript-lsp) for Claude Code. This enables deep reference analysis in Mode 4 (DOCUMENT):

- Find all references to functions, models, middleware
- Go to definition to trace validator logic
- Symbol search across the entire project

If it wasn't auto-installed (requires a marketplace that provides the plugin to be registered first):
```bash
claude plugin install typescript-lsp
```

---

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `AXIOM_QUERY_TOKEN` | Axiom API token with query permissions | `xaat-02e094c2-dc07-...` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `AXIOM_DATASETS` | Comma-separated list of datasets to query. If not set, the skill auto-discovers accessible datasets. | *(all known datasets)* |

> **Log lookback**: The skill defaults to **30 days**. You can override per-request by saying e.g. "con los logs de hace 60 días". Axiom retains logs for at least 90 days. No env var needed.

Add these to your backend `.env` file:

```env
# Required — Axiom read-only API token
AXIOM_QUERY_TOKEN=xaat-your-token-here

# Optional — Restrict to specific datasets (saves queries if you don't have access to all)
AXIOM_DATASETS=bemovil2,errors,bemovil2-providers
```

---

## Axiom Dataset Reference

The skill knows about the following datasets and intelligently decides which to query based on endpoint analysis:

| Dataset | Contents | When the skill queries it |
|---------|----------|--------------------------|
| `bemovil2` | **PRIMARY** — All HTTP request/response logs for every endpoint. Status codes, response times, request/response bodies. | **Always** — queried for every endpoint |
| `errors` | Application errors with stack traces, error codes, user/business context | When the endpoint has error paths (400, 401, 403, 500) |
| `bemovil2-providers` | External provider API interactions (payment gateways, SMS, SOAP) | When `route.ts` imports provider services |
| `bemovil2-providers-sandbox` | Same as providers but for sandbox/staging | When testing sandbox-specific behavior |
| `bemovil2-queries` | Database query performance — slow queries, error queries with SQL | When the endpoint has complex DB operations |
| `bemovil2-bridge` | External provider bridge calls with success/error tracking | When the endpoint uses `useBridge=true` |
| `bemovil2-frontend` | Frontend application metrics and events | When investigating client-side behavior |

### How dataset selection works

1. The skill **always queries `bemovil2`** (the primary HTTP logs dataset)
2. It **reads the endpoint's `route.ts`** to detect imports → adds relevant datasets
3. It **checks user context** → if you mention providers, DB issues, etc. → adds those datasets
4. If a needed dataset is **inaccessible**, the agent tells you and asks for alternative input

### What happens when you don't have access?

The skill is **proactive**. If it needs a dataset your token can't access:

1. It tells you which dataset is needed and why
2. It offers alternatives: ask a teammate, paste logs manually, or describe the behavior
3. If you provide manual logs, it validates them — warns about missing error scenarios, stale data, or truncated bodies
4. It **never proceeds silently** with incomplete data

---

## Usage

### Invoke the skill

In Claude Code, type:

```
/e2e-forge
```

Or describe your need naturally:

```
Create e2e tests for POST /api/v1/auth/login
```

```
Update the test for transactions/approve — I changed the validation logic
```

```
Create tests for all untested endpoints
```

---

## Real-World Example: Modifying the Login Endpoint

Here's a complete walkthrough of using e2e-forge when you modify an existing endpoint.

### Scenario

You've just modified `app/auth/login/route.ts` to add MFA (Multi-Factor Authentication) support. The endpoint now:
- Returns a new status code `202` when MFA is required (previously only 200 or error)
- Accepts a new optional field `mfaCode` in the request body
- Returns a new error code `auth.user.invalidMFA` for wrong MFA codes

### Prompt

```
I just modified the login endpoint to add MFA support. Here's what changed:

- New field in request: `mfaCode` (string, 6 digits, optional)
- New response 202: `{ statusCode: 202, message: "MFA required", data: { mfaToken: "...", expiresIn: 300 } }`
- New error: `auth.user.invalidMFA` (400) when the MFA code is wrong
- New error: `auth.user.expiredMFA` (400) when the MFA code has expired
- Existing behavior unchanged for users without MFA enabled

Please update the e2e test.
```

### What e2e-forge does (step by step)

**1. Dataset Discovery** (first time in session)

```
[discover] Testing access to all known datasets...
You have access to: bemovil2, errors, bemovil2-providers
You do NOT have access to: bemovil2-queries, bemovil2-bridge, bemovil2-frontend, bemovil2-providers-sandbox
```

**2. Axiom Log Extraction**

The skill reads `route.ts`, sees it's a pure auth endpoint (no provider imports, no bridge), so it queries only `bemovil2` + `errors`:

```
[bemovil2] Querying aggregates... 45,230 requests in last 30 days
[bemovil2] Status codes: { "200": 44100, "401": 980, "400": 150 }
[errors] Querying aggregates... 42 errors found
[errors] Top errors: auth.user.invalidPassword (28), auth.user.blocked (14)
```

**3. Proactive Analysis**

```
I found production logs but they DON'T include the new MFA behavior (status 202,
auth.user.invalidMFA, auth.user.expiredMFA) since it hasn't been deployed yet.
I'll generate tests based on:
- Your description of the new behavior
- Existing production patterns for the unchanged flows
- Code analysis of the updated route.ts
```

**4. Context Questions** (only what's missing)

```
Two things I need to confirm:
1. Does the `mfaCode` field have a specific format validation (exactly 6 digits)?
   Or does it accept any string?
2. When MFA is required but no `mfaCode` is provided, does it return 202 (MFA required)
   or 400 (missing field)?
```

**5. Doc Update** → Updates `app/auth/login/doc.md` with new status codes and error codes

**6. Test Generation** → Adds new test cases to existing `e2e.test.ts`:

```typescript
// New MFA tests added to existing describe block:

it('returns 202 when MFA is required and no code provided', async () => {
  // ... setup MFA-enabled user ...
  const res = await request(global.app)
    .post('/api/v1/auth/login')
    .send({ _deviceId: global.deviceId, data: { cellphone, password, country } });
  expect(res.status).toBe(202);
  expect(res.body.message).toBe('MFA required');
  expect(res.body.data).toHaveProperty('mfaToken');
  expect(res.body.data).toHaveProperty('expiresIn');
});

it('returns 400 with auth.user.invalidMFA when MFA code is wrong', async () => {
  const res = await request(global.app)
    .post('/api/v1/auth/login')
    .send({ _deviceId: global.deviceId, data: { cellphone, password, country, mfaCode: '000000' } });
  expect(res.status).toBe(400);
  expect(res.body?.errorCode).toBe('auth.user.invalidMFA');
});

it('returns 400 with auth.user.expiredMFA when MFA code has expired', async () => {
  // ... setup expired MFA token ...
  const res = await request(global.app)
    .post('/api/v1/auth/login')
    .send({ _deviceId: global.deviceId, data: { cellphone, password, country, mfaCode: '123456' } });
  expect(res.status).toBe(400);
  expect(res.body?.errorCode).toBe('auth.user.expiredMFA');
});

it('returns 200 on successful login with valid MFA code', async () => {
  // ... setup valid MFA ...
  const res = await request(global.app)
    .post('/api/v1/auth/login')
    .send({ _deviceId: global.deviceId, data: { cellphone, password, country, mfaCode: '123456' } });
  expect(res.status).toBe(200);
  expect(res.body.statusCode).toBe(200);
});
```

**7. TDD Loop** → Runs `vitest run app/auth/login/e2e.test.ts`, iterates until all pass

**8. Report**

```
=== E2E Forge Report ===
Endpoint: POST /api/v1/auth/login
Mode: UPDATE

Tests:     12 total (8 existing + 4 new), 12 passing, 0 failing
Coverage:  5/5 status codes (200, 202, 400, 401, 500), 4/4 error codes
TDD Loops: 2 iterations
Duration:  45s

Code Smells:
  CRITICAL: 0
  HIGH:     0
  MEDIUM:   1 (mfaCode not validated for format in validators array)
  LOW:      0

Axiom Data:
  Logs analyzed: 45,272
  Datasets queried: bemovil2, errors
  Datasets denied: 0
  Production alignment: 87% (new MFA paths not yet in production)

Quality Gate: PASS
========================
```

---

## Pre-built Scripts

The skill includes scripts that the AI agent executes automatically. You don't need to run them manually.

| Script | Purpose | Command |
|--------|---------|---------|
| `extract-axiom.ts` | Extract production logs from Axiom | `npx tsx extract-axiom.ts --endpoint auth/login --days 30` |
| `extract-axiom.ts --discover` | Discover which datasets your token can access | `npx tsx extract-axiom.ts --discover` |
| `batch-extract.ts` | Bulk extraction for multiple endpoints | `npx tsx batch-extract.ts --all --days 60` |
| `route-mapper.ts` | Map all route.ts files to URL paths | `npx tsx route-mapper.ts --routes-dir ./routes` |
| `frontend-tracer.ts` | Find frontend files that call each endpoint | `npx tsx frontend-tracer.ts --endpoint auth/login` |
| `coverage-analyzer.ts` | Identify untested endpoints and coverage gaps | `npx tsx coverage-analyzer.ts --app-dir ./app` |

### Extract with specific datasets

```bash
# Only query bemovil2 and errors datasets
npx tsx extract-axiom.ts --endpoint auth/login --datasets bemovil2,errors --days 30
```

---

## Modes

### Mode 1: CREATE

For new endpoints without tests. The skill:

1. Asks about the endpoint's purpose, inputs, outputs, edge cases
2. Reads `route.ts` and traces dependencies
3. Discovers which Axiom datasets are accessible
4. Finds frontend files that call the endpoint
5. Generates `doc.md` with full context
6. Creates the e2e test following your project's patterns
7. Runs a TDD loop until all tests pass
8. Reports code smells found in the endpoint

### Mode 2: UPDATE

For modified endpoints. The skill:

1. Extracts production logs from Axiom (intelligently selecting datasets)
2. Analyzes git diff to see what changed
3. Compares production behavior with new expected behavior
4. Warns about gaps between logs and new code
5. Updates `doc.md` and the test with new scenarios
6. Runs a TDD loop until all tests pass

### Mode 3: BATCH

For processing multiple endpoints. The skill:

1. Runs coverage analysis to identify untested endpoints
2. Gathers context for ALL endpoints before starting
3. Processes each sequentially through Mode 1 or 2
4. Produces a summary report

### Mode 4: DOCUMENT (no test changes)

For generating or updating `doc.md` **without** touching tests or source code. The skill:

1. Reads `route.ts` — extracts method, validators, middleware, error codes, response shapes
2. Reads `e2e.test.ts` (if exists) — extracts validated request/response JSON examples
3. Uses **TypeScript LSP** to trace all references: validators, models, helpers, middleware
4. Runs `frontend-tracer.ts` to find all frontend callers
5. Searches backend for cross-endpoint references
6. Generates comprehensive `doc.md` with technical reference, JSON examples, and dependency map

**Example prompts**:

```
Actualiza la documentación del login
```

```
Generate docs for auth/login
```

```
Documenta todos los endpoints sin doc.md
```

```
Update doc.md for transactions/approve — I added a new validation
```

The generated `doc.md` includes:
- Business purpose (inferred from code and tests)
- Full request/response schema with types and validations
- JSON examples for every scenario (happy path + errors)
- Validator and middleware documentation
- Internal and external dependency maps
- Frontend consumer list
- Edge cases

This mode also supports batch: "documenta todos los endpoints sin doc.md"

---

## Modern vs Legacy Endpoints

The skill automatically detects whether an endpoint follows the **modern** or **legacy** pattern:

| Aspect | Modern | Legacy |
|--------|--------|--------|
| Validation | Typed helpers in `@/helpers/` with interfaces and `throw` | `export const validators` importing from `@/middleware/validators/` |
| Error handling | `throw` with typed error objects | Middleware chain with `next(err)` |
| Example | `app/auth/login/route.ts` | `app/auth/register/route.ts` |

**Detection rule**: If the `validators` array imports from `@/middleware/validators/` → **LEGACY**. If validation uses `@/helpers/` with typed interfaces → **MODERN**.

The `middleware/` folder is **deprecated**. When the skill detects a legacy endpoint, it flags it with a `// TODO: [LEGACY]` comment and documents the pattern in `doc.md`.

---

## TODO Comment Protocol

Every time the skill analyzes an endpoint (in any mode), it inserts `// TODO:` comments directly in the source code for every detected issue:

```typescript
// TODO: [CODE_SMELL] Function exceeds 50 lines — extract validation logic
// TODO: [BUG] Missing null check on user.mfaSecret before comparison
// TODO: [MISSING_VALIDATION] cellphone field accepts any string — add regex
// TODO: [SECURITY] Password compared with == instead of timing-safe comparison
// TODO: [LEGACY] Validators use deprecated middleware/ pattern — migrate to helpers/
// TODO: [PERFORMANCE] N+1 query inside loop — use batch fetch
// TODO: [MISSING_ERROR_HANDLING] Provider call has no try/catch
// TODO: [DEAD_CODE] Branch unreachable — status is always 'active' at this point
```

**Categories**: `CODE_SMELL`, `BUG`, `MISSING_VALIDATION`, `SECURITY`, `LEGACY`, `PERFORMANCE`, `MISSING_ERROR_HANDLING`, `DEAD_CODE`

TODOs are inserted in `route.ts` (and related files) — **never** in `e2e.test.ts`.

---

## Quality Gate

A test is considered COMPLETE only when ALL of these pass:

- [ ] All `it()` blocks pass (zero failures)
- [ ] Every documented status code has at least one test
- [ ] Every documented error code has at least one assertion
- [ ] Auth test exists (401 without token)
- [ ] Validation test exists (400 with missing required field)
- [ ] Happy path test exists (200 with valid payload)
- [ ] DB cleanup verified (no orphaned records)
- [ ] `doc.md` is up to date
- [ ] Code smell report generated

---

## File Structure

```
e2e-forge/
  SKILL.md              # Skill definition (read by Claude Code)
  README.md             # This file
  install.sh            # Unix installer
  install.ps1           # Windows installer
  .gitignore
  scripts/
    package.json        # Script dependencies (@axiomhq/js, tsx)
    config.ts           # Axiom client, dataset definitions, auto-discovery
    types.ts            # TypeScript interfaces
    extract-axiom.ts    # Axiom log extraction with smart dataset routing
    batch-extract.ts    # Bulk extraction orchestrator
    route-mapper.ts     # Express route discovery
    frontend-tracer.ts  # Frontend usage tracer
    coverage-analyzer.ts # Coverage gap analysis
```

---

## Customization

The skill is designed for **Express + Vitest + Supertest** projects, but the core patterns apply to any stack.

To adapt for your project:

1. Update the canonical test patterns in `SKILL.md`
2. Update the globals section with your test setup globals
3. Adjust the route-mapper regex if your route registration differs
4. Add or modify datasets in `scripts/config.ts` if your Axiom setup differs

---

## Troubleshooting

### "AXIOM_QUERY_TOKEN is not set"

Add the token to your backend `.env` file. Make sure it starts with `xaat-` (not `xait-` which is ingest-only).

### "Access denied on dataset X"

Your token doesn't have query permissions for that dataset. Either:
- Ask your Axiom admin to add permissions
- Set `AXIOM_DATASETS` to only the datasets you have access to
- The skill will work with whatever datasets are available and ask for manual input when needed

### Scripts fail on Windows (Git Bash)

The scripts handle MSYS/Git Bash path mangling automatically. If you still get path issues, use PowerShell or CMD instead of Git Bash.

### "tsx not found"

Install it: `npm install -g tsx` or ensure it's in your project's devDependencies.

---

## License

Apache-2.0

## Author

[Gentleman Programming](https://github.com/gentleman-programming)
