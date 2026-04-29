---
name: e2e-forge
description: >
  Automated e2e test creation, update, and improvement for API endpoints using real production logs from Axiom,
  prompt engineering (CREA framework), and TDD-driven iteration.
  Trigger: When creating, updating, or improving e2e tests. When user says /e2e-forge.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Monitor, AskUserQuestion, Agent
---

# E2E Forge

Automated e2e test creation and improvement using real production logs, prompt engineering, and TDD iteration loops.

## Model Requirements (MANDATORY — READ FIRST)

This skill is engineered for a very specific model split. **Do not run it with other models** — the orchestration, context handling, and code reasoning are calibrated to this split and will degrade noticeably outside of it.

- **Orchestrator (main session): Opus 4.6** — required. The main agent drives mode selection, context gathering, quality gates, and TDD loops. It needs Opus 4.6's reasoning and long-context handling.
- **Sub-agents (Agent tool): Sonnet 4.6** — required. Every spawned sub-agent (Explore, Plan, research, parallel extraction, code-reviewer, etc.) MUST be launched on Sonnet 4.6. Pass `model: "sonnet"` (or the explicit `claude-sonnet-4-6` id) in every Agent tool call.

**Before doing anything else**, the agent MUST:

1. Verify the active model is Opus 4.6. If it is not, STOP and instruct the user:
   > ⚠️ This skill requires Opus 4.6 as the orchestrator. Please switch with `/model opus-4-6` inside Claude Code and re-run the skill.
2. Refuse to proceed until the user confirms Opus 4.6 is active.
3. For every Agent tool invocation, explicitly set `model: "sonnet"` so sub-agents run on Sonnet 4.6 — never let sub-agents inherit Opus.

Rationale: Opus 4.6 on the orchestrator preserves coherence across long TDD loops and multi-endpoint batches; Sonnet 4.6 on sub-agents keeps per-spawn cost and latency tractable for the heavy parallel work (Axiom extraction, LSP traces, frontend tracing, coverage analysis).

## When to Use

- Creating a new e2e test for an API endpoint
- Updating an existing e2e test after endpoint modifications
- Batch creating/updating tests for multiple endpoints
- Auditing test coverage gaps across the project
- Detecting code smells or errors in endpoint implementations
- **Generating or updating endpoint documentation** (`doc.md`) without modifying tests or code

## Codebase Architecture: Modern vs Legacy Endpoints (CRITICAL)

The agent MUST understand the difference between modern and legacy endpoint patterns:

### Modern Pattern (preferred)

Modern endpoints use **helpers** — typed functions with explicit input/output interfaces that `throw` on controlled errors. No middleware folder involved.

```typescript
// Modern route.ts example (like auth/login)
import { validateLogin } from '@/helpers/auth/validateLogin';
import { response } from '@/helpers/response';

export const validators = [checkAuth]; // only auth middleware, no validation middleware

export default async function (req: Request, res: Response, next: Next) {
  const { cellphone, password } = req.body.data;
  const result = await validateLogin({ cellphone, password }); // typed helper with throw
  return response(res, req, next).success(result);
}
```

### Legacy Pattern (deprecated)

Legacy endpoints use **middleware from `middleware/`** for validation — the `middleware/` folder is DEPRECATED.

```typescript
// Legacy route.ts example (like auth/register)
import { checkAuth } from '@/middleware/check-auth';
import { validateRegister } from '@/middleware/validators/register'; // LEGACY
export const validators = [checkAuth, validateRegister]; // middleware-based validation
```

### Detection Rule

When analyzing an endpoint, the agent checks:
- If `validators` array imports from `@/middleware/validators/` → **LEGACY** endpoint
- If validation logic lives in `@/helpers/` with typed interfaces → **MODERN** endpoint
- If the endpoint uses `middleware/` folder (except `check-auth`) → **LEGACY**

### What to do with legacy endpoints

When the agent encounters a legacy endpoint:
1. **Flag it** in `doc.md` under a `## Legacy Notice` section
2. **Add a `// TODO:` comment** in the code (see TODO Protocol below)
3. **Still generate tests and docs** — don't skip legacy endpoints
4. **Note in the report**: "This endpoint uses the legacy middleware pattern. Consider migrating to typed helpers."

---

## TODO Comment Protocol (MANDATORY)

Whenever the agent detects a potential problem during ANY mode (CREATE, UPDATE, BATCH, DOCUMENT), it MUST insert a `// TODO:` comment directly in the source code at the exact location of the issue.

### Format

```typescript
// TODO: [CATEGORY] Short, actionable description
```

### Categories

| Category | When to use | Example |
|----------|------------|---------|
| `CODE_SMELL` | Bad practice, duplication, unclear logic | `// TODO: [CODE_SMELL] Extract repeated DB query into helper` |
| `BUG` | Likely bug or incorrect behavior | `// TODO: [BUG] Returns 200 but data is undefined when user has no orders` |
| `MISSING_VALIDATION` | Input not validated before use | `// TODO: [MISSING_VALIDATION] field 'amount' used without checking type or range` |
| `SECURITY` | Potential security vulnerability | `// TODO: [SECURITY] SQL injection risk — use parameterized query` |
| `LEGACY` | Uses deprecated pattern | `// TODO: [LEGACY] Migrate from middleware validators to typed helpers` |
| `PERFORMANCE` | N+1 queries, missing indexes, etc. | `// TODO: [PERFORMANCE] N+1 query — fetching user inside loop` |
| `MISSING_ERROR_HANDLING` | Unhandled error path | `// TODO: [MISSING_ERROR_HANDLING] Provider call has no try/catch` |
| `DEAD_CODE` | Code that is never reached | `// TODO: [DEAD_CODE] This branch is never hit (Axiom logs show 0 occurrences)` |

### Rules

1. **One TODO per issue** — don't combine multiple issues in one comment
2. **Place at the exact line** — not at the top of the file, at the actual problematic line
3. **Be specific** — "missing validation" is bad, "field 'amount' used without checking type or range" is good
4. **Include evidence** — if you know from Axiom logs, say so: "Axiom shows 0 hits on this branch in 30 days"
5. **Report to user** — after inserting TODOs, summarize them in the final report with file:line references
6. **Don't duplicate** — if a TODO already exists at that line, don't add another one for the same issue

---

## Test Idempotency Protocol (MANDATORY)

Tests run against a REAL sandbox database shared by the team. The goal is **idempotency**: every test MUST be able to run N times consecutively and produce the same result. Not every DB side effect needs reversal — only those that would break the next run.

### Decision Criteria

When the endpoint modifies the database, the agent asks: **"Will this prevent the test from passing on the next run?"**

| Situation | Action | Why |
|-----------|--------|-----|
| Endpoint **modifies shared state** (password, email, phone, balance, permissions of the test user) | **REVERT in `afterEach`** | Next run would fail (wrong credentials, insufficient balance, etc.) |
| Endpoint **creates a record with a unique constraint** (unique email, unique phone, unique code) | **Use dynamic/random data** so each run creates a different record | Next run would get a uniqueness violation |
| Endpoint **creates a record WITHOUT unique constraints** (transaction log, audit entry, notification) | **No cleanup needed** — leave it | Harmless; doesn't affect next run |
| Endpoint **deletes a record** needed by the test | **Restore in `afterEach`** | Next run would fail (record not found) |
| Endpoint **deletes a record** NOT needed by any test | **No cleanup needed** | Harmless |

### Pattern 1: Revert shared state (credentials, balances, status)

Use when the endpoint modifies data that the test (or other tests) depends on for setup.

```typescript
describe('POST /api/v1/auth/change-password', () => {
  let originalPassword: string;

  beforeEach(async () => {
    const user = await db.User.findByPk(global.testUserId);
    originalPassword = user!.password;
  });

  afterEach(async () => {
    await db.User.update(
      { password: originalPassword },
      { where: { id: global.testUserId } }
    );
  });

  it('changes password successfully', async () => {
    // ...endpoint changes the password in the DB...
    // afterEach restores it so the next run can log in again
  });
});
```

### Pattern 2: Dynamic data for unique constraints

Use when the endpoint creates records that have unique columns (email, phone, code, etc.).

```typescript
describe('POST /api/v1/users/invite', () => {
  it('invites a new user', async () => {
    const uniqueEmail = `test-${Date.now()}@example.com`;

    const res = await request(global.app)
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${global.authToken}`)
      .send({
        _deviceId: global.deviceId,
        data: { email: uniqueEmail, role: 'viewer' },
      });

    expect(res.status).toBe(200);
    // No cleanup needed — each run uses a different email
  });
});
```

### Pattern 3: Restore deleted records

Use when the endpoint deletes a record that the test needs to exist.

```typescript
describe('DELETE /api/v1/user/device/:id', () => {
  let deviceSnapshot: Record<string, unknown>;

  beforeEach(async () => {
    const device = await db.Device.findByPk(targetDeviceId);
    deviceSnapshot = device!.toJSON();
  });

  afterEach(async () => {
    await db.Device.upsert(deviceSnapshot);
  });

  it('deletes the device', async () => {
    // ...endpoint deletes the device...
    // afterEach re-creates it so the next run finds it
  });
});
```

### Rules

1. **Use `afterEach` for reversals** — never inline cleanup that could be skipped if the test fails
2. **Only revert what breaks idempotency** — don't clean up harmless records (logs, transactions without unique constraints)
3. **Dynamic data over cleanup** — prefer `Date.now()` or `crypto.randomUUID()` suffixes for unique fields instead of creating and then deleting
4. **Shared test credentials are sacred** — if the test changes the test user's password, email, phone, or auth state, reversal is MANDATORY
5. **Use `force: true`** on destroy to bypass paranoid/soft-delete
6. **If the endpoint calls external providers** with irreversible side effects, document in `doc.md` under `## External Side Effects`
7. **The agent MUST analyze `route.ts`** to identify DB operations that affect idempotency (`update` on shared records, `create` with unique constraints, `destroy` of test fixtures)

---

## Pre-requisites

Before using this skill, the project MUST have:

1. **Axiom API token** with query permissions in env var `AXIOM_QUERY_TOKEN`
2. **`@axiomhq/js`** — bundled with e2e-forge scripts (auto-installed on first run)
3. **Vitest + Supertest** configured (or equivalent test framework)
4. **`tsx`** — bundled with e2e-forge scripts (auto-installed on first run)
5. **TypeScript LSP MCP plugin** installed at project level for deep reference analysis (Mode 4: DOCUMENT)

If any prerequisite is missing, inform the user with the exact install command.

### TypeScript LSP Plugin (auto-installed)

The TypeScript LSP plugin (`claude.com/plugins/typescript-lsp`) enables deep code analysis:
- **Find all references** to functions, models, middleware
- **Go to definition** to trace validator logic and helper implementations
- **Symbol search** across the entire project

The installer scripts auto-install this plugin. If it's missing, the agent should run:

```bash
claude plugin install typescript-lsp
```

The agent uses this plugin in Mode 4 (DOCUMENT) and during Code Analysis in other modes to:
1. Find all callers of the endpoint's handler function
2. Trace every validator to understand input constraints and error codes
3. Find all usages of shared models/helpers within the endpoint
4. Discover cross-endpoint dependencies (one route calling another's service)

---

## Dataset Intelligence (CRITICAL)

The agent MUST understand which Axiom datasets exist, what each contains, and intelligently decide which to query based on the endpoint being analyzed.

### Known Datasets

| Dataset | What it contains | When to query |
|---------|-----------------|---------------|
| `bemovil2` | **PRIMARY** — All HTTP request/response logs for every backend endpoint. Status codes, response times, request bodies, response bodies. | **ALWAYS** — This is the most important dataset. Query it for every endpoint. |
| `errors` | Application errors with stack traces, error codes, user/business context. | When investigating error paths (400, 401, 403, 500). |
| `bemovil2-providers` | External provider/API interactions — requests and responses to third-party services (payment gateways, SMS, SOAP APIs). | Only when `route.ts` imports provider services or the endpoint interacts with external APIs. |
| `bemovil2-providers-sandbox` | Same as `bemovil2-providers` but for sandbox/staging environment. | Only when testing sandbox-specific provider behavior. |
| `bemovil2-queries` | Database query performance — slow queries, blocking metadata, error queries with full SQL. | When the endpoint has complex DB operations, N+1 risk, or performance concerns. |
| `bemovil2-bridge` | External provider bridge calls with success/error status and transaction tracking. | Only when the endpoint uses `useBridge=true` for Bemovil provider calls. |
| `bemovil2-frontend` | Frontend application metrics and events from the client perspective. | When investigating how the frontend consumes the endpoint (client-side errors, latency). |

**New datasets may be added in the future.** The agent should use the auto-discovery mechanism to detect any new datasets available.

### Dataset Selection Logic

The agent decides which datasets to query using this decision tree:

1. **ALWAYS query `bemovil2`** — it has all HTTP traffic for all endpoints.
2. **Read `route.ts` imports** — if the endpoint imports provider services → add `bemovil2-providers`. If it uses bridge → add `bemovil2-bridge`.
3. **Check for DB operations** — if the endpoint has complex Sequelize queries, transactions, or joins → add `bemovil2-queries`.
4. **Check error handling** — if the endpoint has multiple error paths → add `errors`.
5. **Context from user** — if the user mentions external providers, frontend issues, or sandbox testing → add the relevant dataset.

### Access Resolution Protocol (MANDATORY at session start)

Before querying any dataset, the agent MUST determine which datasets the user has access to. This is done ONCE per session and cached.

**Step 1: Check env var configuration**

```bash
# If AXIOM_DATASETS is set, use only those datasets
# Example: AXIOM_DATASETS=bemovil2,errors,bemovil2-providers
```

**Step 2: If no env var, run auto-discovery**

```bash
npx tsx "${SKILL_DIR}/scripts/extract-axiom.ts" --discover
```

This queries each dataset with a `take 1` command. If it returns data → accessible. If it throws → access denied.

**Step 3: Cache and report results**

Tell the user: "You have access to X datasets: [list]. You do NOT have access to: [list]."

### Access Denied Protocol (PROACTIVE)

When a dataset needed for the task is NOT accessible:

1. **Inform the user immediately**: "I need data from `bemovil2-providers` to understand how this endpoint interacts with the payment gateway, but your token doesn't have access to that dataset."

2. **Offer alternatives** (in this order):
   - "Can you ask someone with access to share the logs? Run: `npx tsx extract-axiom.ts --endpoint auth/login --datasets bemovil2-providers --days 30 > provider-logs.json` and share the output."
   - "Can you paste the relevant log entries directly?"
   - "Can you describe the provider interaction manually? I need: what provider, what request format, what response format, what errors can occur."

3. **If logs are provided manually, validate them**:
   - If the log only shows status 200 → WARN: "These logs only show successful requests. I can't infer error scenarios from them. Can you provide logs with error responses too, or describe what errors the provider can return?"
   - If the log is very old (> 60 days) → WARN: "These logs are from [date]. The endpoint may have changed since then. Can you confirm the current behavior matches?"
   - If the log has truncated bodies → WARN: "The request/response bodies in these logs are truncated. I may miss validation fields. Can you confirm the full request schema?"

4. **Never proceed with incomplete data silently.** Always document what's missing in `doc.md` under `## Assumptions`.

### Proactive Log Analysis

When the agent receives logs (from Axiom or manually), it MUST:

- **Check status code coverage**: If only 200s are present but the endpoint has error validators → WARN the user: "Production logs show 100% success rate, but the code handles [400, 401, 403]. I need examples of error scenarios to write meaningful tests."
- **Check for anomalies**: Unusual response times, unexpected status codes, error spikes → report to user.
- **Check data freshness**: If the most recent log is > 7 days old → WARN: "The most recent log I found is from [date]. Recent behavior may differ."
- **Cross-reference with code**: If the code handles a status code that never appears in logs → WARN: "The endpoint handles status 404 but production logs show zero 404 responses. Is this dead code or an edge case that hasn't been triggered?"

---

## Modes of Operation

### Mode 1: CREATE (new endpoint, no production logs)

Use when the endpoint has no `e2e.test.ts` file yet.

**Flow:**
1. Context Gathering (MANDATORY — see Context Protocol below)
2. Code Analysis — read `route.ts`, trace validators, imports, services. Detect modern vs legacy pattern.
3. Frontend Tracing — run `frontend-tracer.ts` script
4. Doc Generation — create `doc.md` in the endpoint folder
5. Test Generation — apply CREA framework to generate the e2e test
6. TDD Loop — create failing scaffold, iterate until green (see TDD Protocol)
7. Code Smell Detection — analyze endpoint, **insert `// TODO:` comments** in source code for every issue found
8. Report — summarize all TODOs inserted with file:line references

### Mode 2: UPDATE (existing endpoint modified)

Use when the endpoint already has an `e2e.test.ts` and has been modified.

**Flow:**
1. Context Gathering (MANDATORY)
2. Axiom Log Extraction — run `extract-axiom.ts --endpoint {path} --days 30` (default 30 days, user can override e.g. "con los logs de hace 60 días")
3. Diff Analysis — `git diff` on the route.ts to see changes
4. Log vs New Behavior — compare production logs with new expected I/O
5. Doc Update — update `doc.md` with new context
6. Test Update — improve existing test with new scenarios
7. TDD Loop — run existing test, iterate until all new assertions pass
8. Code Smell Detection — **insert `// TODO:` comments** for every issue found
9. Report — summarize all TODOs inserted with file:line references

### Mode 3: BATCH (multiple endpoints)

Use when processing multiple endpoints at once.

**Flow:**
1. Bulk Discovery — run `coverage-analyzer.ts` to identify targets
2. Context Gathering PER ENDPOINT — ask for context for EACH one
3. Sequential Processing — process each through Mode 1 or 2
4. Batch Report — summary of all tests created/updated and smells found

### Mode 4: DOCUMENT (documentation only — NO test changes)

Use when the user says "document", "documentar", "genera la documentación", or any variant that focuses on doc.md without mentioning tests. Also use when `doc.md` needs to be updated after an endpoint change.

**Trigger phrases**: "documenta el endpoint X", "actualiza la doc del login", "genera doc.md para X", "usa e2e-forge para documentar X", "actualiza la documentación del login"

**Example prompts:**
- `"Actualiza la documentación del login"` → runs Mode 4 on `app/auth/login/`
- `"Documenta el endpoint de transactions/approve"` → runs Mode 4 on `app/transactions/approve/`
- `"Genera la documentación para todos los endpoints de auth"` → runs Mode 4 BATCH filtered by `auth` domain
- `"Documenta todos los endpoints sin doc.md"` → runs Mode 4 BATCH on all endpoints missing `doc.md`

**Flow:**
1. **Read `route.ts`** — extract HTTP method, path, validators array, handler logic, imports, error codes, response shapes. Detect modern vs legacy pattern.
2. **Read `e2e.test.ts`** (if exists) — extract tested scenarios, request payloads, expected responses. This provides validated examples of real input/output.
3. **LSP Reference Analysis** (MANDATORY) — use the TypeScript LSP MCP plugin to:
   - Find all references to the route handler function
   - Find all references to imported services, models, middleware
   - Trace validator/helper functions to understand input constraints and error codes
   - Find all callers of shared helpers used by this endpoint
4. **Frontend Tracing** — run `frontend-tracer.ts` to find all `postRequest()` calls in frontend/admin
5. **Backend Tracing** — use `Grep` to find all backend references to this endpoint path (other routes calling it, cron jobs, webhooks, etc.)
6. **Read existing `doc.md`** (if exists) — use as base context, preserve any manual notes or assumptions
7. **Generate/Update `doc.md`** — write the full documentation using the expanded template (see Doc Generation below)
8. **Insert `// TODO:` comments** — if code smells, missing validations, or legacy patterns are detected during analysis, insert TODOs in `route.ts` (this is the ONE exception to "don't modify source" — TODOs are metadata, not logic changes)

**Critical rules for DOCUMENT mode:**
- **NEVER modify `e2e.test.ts`** — read-only access to tests
- **NEVER modify `route.ts` LOGIC** — only insert `// TODO:` comments, never change behavior
- **DO NOT ask the user for business context** — infer everything from code, tests, references, and existing docs. If something is ambiguous, document it as "Inferred: ..." and flag it.
- **DO trace ALL dependencies** — every import, every helper, every model used
- **DO generate real JSON examples** — extract from e2e.test.ts payloads or construct from validator/helper type definitions
- **DO flag legacy endpoints** — if the endpoint uses `middleware/` for validation, add a `## Legacy Notice` section in doc.md

### Mode 4 BATCH: Document multiple endpoints

The user can say "documenta todos los endpoints sin doc.md" or "actualiza la doc de todos los endpoints del dominio auth".

**Flow:**
1. **Discovery** — use `route-mapper.ts` to list endpoints, filter by domain if specified, check which have/lack `doc.md`
2. **Sequential Processing** — run Mode 4 for each endpoint
3. **Batch Report** — summary of docs created/updated

---

## Context Gathering Protocol (CRITICAL)

**The agent MUST NOT write any test code until sufficient context is gathered.**

### Always ask:

| Question | Why |
|----------|-----|
| What does this endpoint do? | Business purpose drives test scenarios |
| What are the expected inputs? | Request body schema with types and validations |
| What are the expected outputs per status code? | 200, 400, 401, 403, 404, 500 response shapes |
| What error codes does it return? | e.g., `auth.user.invalidMFA`, `validators.order.notFound` |
| What are the edge cases? | Boundary conditions, race conditions, limits |

### Ask if relevant:

| Question | When |
|----------|------|
| External provider interactions? | If route.ts imports provider services |
| Required user roles/permissions? | If validators include role checks |
| DB side effects that break re-runs? | ALWAYS — identify operations that modify shared state (credentials, balances) or create records with unique constraints (see Test Idempotency Protocol) |
| Concurrency concerns? | If multiple users can hit simultaneously |
| Rate limiting? | If middleware includes rate limits |

### Missing context protocol:

- If the agent detects a gap (e.g., status code in logs not mentioned by user) → **ASK before proceeding**
- If user says "infer it" or "use your judgment" → proceed with assumptions but **DOCUMENT them in doc.md**
- If working in BATCH mode → gather context for ALL endpoints BEFORE starting any test generation

---

## Pre-built Scripts

These scripts are located at `${SKILL_DIR}/scripts/` and MUST be executed as-is. The agent NEVER recreates or modifies them.

### Resolving SKILL_DIR (MANDATORY before first script execution)

The agent MUST resolve the absolute path to the skill directory BEFORE running any script. Use this strategy:

1. Run `Glob` with pattern `**/e2e-forge/scripts/config.ts` starting from the user's home directory (`~/.claude/skills/`)
2. Extract the parent directory of `scripts/` from the result — that is `SKILL_DIR`
3. Cache the resolved path for the rest of the session

**CRITICAL (Windows/Git Bash):** Always use the platform-native path format returned by `Glob`. On Windows this will be backslash paths like `C:\Users\user\.claude\skills\e2e-forge`. When passing to `npx tsx`, use DOUBLE QUOTES around the full script path to handle spaces and backslashes.

**Auto-bootstrap**: Scripts auto-install their dependencies on first run. If `scripts/node_modules` is missing, the script runs `npm install` automatically. No manual dependency installation is needed beyond the initial skill install.

**Auto .env loading**: Scripts automatically load `.env` from the current working directory (CWD). The agent does NOT need to manually export `AXIOM_QUERY_TOKEN` — just ensure the backend `.env` has the token and run scripts from the backend directory.

### Running scripts

```bash
# Resolve SKILL_DIR first (agent does this automatically via Glob)
# Then use the resolved absolute path in all commands:

# Extract Axiom logs for a single endpoint
npx tsx "${SKILL_DIR}/scripts/extract-axiom.ts" --endpoint /auth/login --days 30

# Extract for all endpoints (bulk)
npx tsx "${SKILL_DIR}/scripts/batch-extract.ts" --all --days 60

# Map all routes to URL paths
npx tsx "${SKILL_DIR}/scripts/route-mapper.ts" --routes-dir ./routes

# Trace frontend usage of an endpoint
npx tsx "${SKILL_DIR}/scripts/frontend-tracer.ts" --endpoint /auth/login --frontend-dir ../frontend/src --admin-dir ../admin/src

# Analyze test coverage gaps
npx tsx "${SKILL_DIR}/scripts/coverage-analyzer.ts" --app-dir ./app
```

### Script outputs

All scripts output JSON to stdout. The agent reads and parses this output to build context.

| Script | Output |
|--------|--------|
| `extract-axiom.ts` | `{ endpoint, httpLogs, errors, providers, dbQueries, bridge }` |
| `route-mapper.ts` | `[{ urlPath, routeFile, hasTest, testFile }]` |
| `frontend-tracer.ts` | `[{ file, line, callExpression }]` |
| `coverage-analyzer.ts` | `{ total, tested, untested, gaps: [{ endpoint, traffic, errorRate }] }` |

---

## Doc Generation (doc.md)

For every endpoint processed, create or update `app/<domain>/<feature>/doc.md`. The doc.md serves as **the single source of truth** for both developers and AI agents. It combines business context with full technical documentation.

**Auto-update rule**: Every time the skill processes an endpoint (any mode), it MUST update `doc.md` if anything changed. In Mode 4 (DOCUMENT), this is the primary output.

### Template

```markdown
# {METHOD} /api/v1/{path}

> Auto-generated by e2e-forge. Last updated: {ISO date}

## Purpose

{Business logic description — what this endpoint does and WHY it exists.
In Mode 4, infer from code + tests + frontend usage. Flag with "Inferred:" if uncertain.}

---

## Technical Reference

### Authentication

- **Required**: {Yes/No}
- **Middleware**: {e.g., `checkAuth`, `checkRole('admin')`}
- **Token type**: {Bearer JWT}

### Request

**Headers**
| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer {token}` |
| `Content-Type` | Yes | `application/json` |

**Body Schema**

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `_deviceId` | `string` | Yes | — | Device identifier |
| `data.{field1}` | `{type}` | {Yes/No} | {e.g., min: 1, max: 50} | {description} |
| `data.{field2}` | `{type}` | {Yes/No} | {validation rules} | {description} |

**Example Request**

```json
{
  "_deviceId": "device-abc-123",
  "data": {
    "{field1}": "{example value}",
    "{field2}": "{example value}"
  }
}
```

### Responses

#### 200 — Success

{When this response is returned}

```json
{
  "statusCode": 200,
  "message": "Successful",
  "data": {
    "{key}": "{example value or shape}"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.{key}` | `{type}` | {description} |

#### 400 — Bad Request

{When this response is returned — e.g., validation failure, business rule violation}

```json
{
  "statusCode": 400,
  "errorCode": "{error.code}",
  "message": "{description}"
}
```

#### 401 — Unauthorized

{When — missing or invalid auth token}

```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

#### 403 — Forbidden

{When — valid token but insufficient permissions}

#### 404 — Not Found

{When — requested resource doesn't exist}

#### 500 — Internal Server Error

{When — unhandled error, provider failure, DB error}

{Add or remove status code sections as needed. Every status code the endpoint can return MUST be documented.}

### Error Codes

| Error Code | HTTP Status | Trigger Condition | Example Scenario |
|------------|-------------|-------------------|------------------|
| `{validators.field.required}` | 400 | `{field}` is missing from request body | Send request without `{field}` |
| `{auth.user.notFound}` | 404 | User with given ID does not exist | Login with unregistered phone |

---

## Validators & Middleware

| Order | Validator/Middleware | Purpose | Source |
|-------|---------------------|---------|--------|
| 1 | `checkAuth` | Verifies JWT token and populates `req.user` | `@/middleware/check-auth` |
| 2 | `{validatorName}` | {what it validates} | `@/middleware/{path}` or inline |

---

## Dependencies

### Internal (Backend)

| Import | Type | Usage |
|--------|------|-------|
| `@/models/{Model}` | Model | {what DB table, what operations} |
| `@/helpers/{helper}` | Helper | {what it does in this context} |
| `@/config/{config}` | Config | {what config values are used} |

### External (Providers)

| Provider | Service | Purpose |
|----------|---------|---------|
| {e.g., Bemovil SOAP} | {service name} | {what interaction} |

### Frontend Consumers

| File | Line | Call |
|------|------|------|
| `frontend/src/{path}` | {line} | `postRequest('{endpoint}', ...)` |
| `admin/src/{path}` | {line} | `postRequest('{endpoint}', ...)` |

### Backend References

| File | Line | Context |
|------|------|---------|
| `routes/{file}.ts` | {line} | Route registration |
| `app/{other}/route.ts` | {line} | {called from another endpoint, if applicable} |

---

## Examples

### Example 1: {Happy path scenario name}

**Request**
```json
{
  "_deviceId": "device-abc-123",
  "data": {
    "{field1}": "{real example value}",
    "{field2}": "{real example value}"
  }
}
```

**Response** (200)
```json
{
  "statusCode": 200,
  "message": "Successful",
  "data": {
    "{key}": "{real example value}"
  }
}
```

### Example 2: {Error scenario name}

**Request**
```json
{
  "_deviceId": "device-abc-123",
  "data": {}
}
```

**Response** (400)
```json
{
  "statusCode": 400,
  "errorCode": "{validators.field.required}",
  "message": "{field} is required"
}
```

{Add as many examples as there are distinct scenarios. Extract from e2e.test.ts payloads when available.
If the endpoint has complex business logic, add examples for each major branch.}

---

## Edge Cases

- {List from user context + AI-detected from code analysis}
- {Boundary conditions: max lengths, empty arrays, null values}
- {Race conditions: concurrent access}
- {Rate limiting: if applicable}

## Production Insights (from Axiom)

{Only include if Axiom data was extracted. Omit section entirely if no data.}

- Requests/day: {avg}
- Error rate: {%}
- Avg response time: {ms}
- Top errors: {list}

## Assumptions

{Only if something was inferred rather than confirmed. Each assumption should be flagged
so a developer can verify and remove the flag.}

- **Inferred**: {description of what was assumed and why}
```

### Doc generation rules

1. **Extract JSON examples from `e2e.test.ts`** — The `.send()` payloads in tests are VALIDATED examples of real input. The `expect()` assertions show real output shapes. Use these as the source of truth for the Examples section.
2. **Trace validators** — Read each validator function imported in the `validators` array. Document every field it checks, what validation rule it applies, and what error code it returns on failure.
3. **Use LSP references** — The TypeScript LSP plugin provides precise "find all references" and "go to definition" capabilities. Use it to trace every function, model, and middleware used by the endpoint.
4. **Multiple examples when warranted** — If the endpoint has 3+ distinct behavior branches (e.g., user with MFA vs without, admin vs regular user), add an example for each.
5. **Preserve manual notes** — If an existing `doc.md` has notes written by a developer (not auto-generated), preserve them in an "## Additional Notes" section at the bottom.

---

## Test Generation — CREA Framework

Apply the CREA framework (Contexto, Rol, Especificidad, Accion) combined with prompt-engineering-patterns skill patterns when generating tests.

### Internal prompt structure (what the agent uses to reason):

**C (Contexto)**:
- Tech stack: Vitest + Supertest + Express
- Project: {project name}
- Endpoint: POST /api/v1/{path}
- Business logic: {from doc.md}
- Production data: {from Axiom extraction}
- Existing test patterns: {from canonical examples}

**R (Rol)**:
- Senior QA Engineer with deep knowledge of the codebase
- Familiar with Vitest, Supertest, and the project's test conventions
- Prioritizes: coverage of real production scenarios, edge cases, error paths

**E (Especificidad)**:
- Follow EXACTLY the canonical test patterns (see below)
- Cover every status code documented in doc.md
- Follow the Test Idempotency Protocol: identify DB side effects that would prevent the test from running again (shared state changes, unique constraint conflicts) and add reversal or dynamic data as needed
- Mock external services, never real providers
- Test validation errors (missing fields, invalid types, max lengths)
- Test auth requirements (no token, invalid token, expired token)

**A (Accion)**:
- Generate a complete `e2e.test.ts` file
- Follow the exact import pattern, request structure, and assertion style
- Include describe block named `POST /api/v1/{path}`
- Order tests: validation errors → auth errors → business logic errors → happy path

### Canonical Test Patterns

```typescript
// === IMPORTS ===
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import db from '@/models/conn';

// === DESCRIBE BLOCK ===
describe('POST /api/v1/{path}', () => {

  // === CLEANUP (mocks + idempotency — see Test Idempotency Protocol) ===
  afterEach(async () => {
    vi.restoreAllMocks();
    // Revert shared state if the endpoint modifies it (credentials, balances, etc.)
    // Only needed when the change would break re-runs — harmless records can stay
  });

  // === VALIDATION TESTS ===
  it('returns 400 when {field} is missing', async () => {
    const res = await request(global.app)
      .post('/api/v1/{path}')
      .set('Authorization', `Bearer ${global.authToken}`)
      .send({
        _deviceId: global.deviceId,
        data: { /* payload WITHOUT the required field */ },
      });
    expect(res.status).toBe(400);
    expect(res.body?.errorCode).toBe('validators.{field}.required');
  });

  // === AUTH TESTS ===
  it('returns 401 when no auth token provided', async () => {
    const res = await request(global.app)
      .post('/api/v1/{path}')
      .send({
        _deviceId: global.deviceId,
        data: { /* valid payload */ },
      });
    expect(res.status).toBe(401);
  });

  // === BUSINESS LOGIC ERROR TESTS ===
  it('returns {status} when {condition}', async () => {
    // Setup: create necessary DB records
    const record = await db.Model.create({ ... });

    const res = await request(global.app)
      .post('/api/v1/{path}')
      .set('Authorization', `Bearer ${global.authToken}`)
      .send({
        _deviceId: global.deviceId,
        data: { /* payload triggering the error */ },
      });

    // Setup records can be cleaned inline; idempotency reversals go in afterEach
    await record.destroy({ force: true });

    expect(res.status).toBe({status});
    expect(res.body?.errorCode).toBe('{errorCode}');
  });

  // === HAPPY PATH ===
  it('returns 200 on successful {operation}', async () => {
    const res = await request(global.app)
      .post('/api/v1/{path}')
      .set('Authorization', `Bearer ${global.authToken}`)
      .send({
        _deviceId: global.deviceId,
        data: { /* valid complete payload */ },
      });

    expect(res.status).toBe(200);
    expect(res.body.statusCode).toBe(200);
    expect(res.body.message).toBe('Successful');
    expect(res.body.data).toHaveProperty('{expectedKey}');
  });
});
```

### Globals available in tests:
- `global.app` — Express app instance
- `global.db` — Sequelize database connection
- `global.authToken` — Valid JWT token
- `global.deviceId` — Test device ID
- `global.userId` — Test user ID
- `global.countryId` — Test user country (default: 5, Colombia)
- `global.VALID_CREDENTIALS` — `{ cellphone, password, country, id }`
- `global.loginLogoutToken` — Separate token for logout testing

---

## TDD Monitor Loop Protocol

### Step 1: Establish baseline

Before writing or modifying any test, run the current state:

```bash
cd {backend_dir} && npx vitest run app/{domain}/{feature}/e2e.test.ts --reporter=verbose --no-coverage --bail=1 2>&1
```

- If Mode CREATE and no test exists → create a minimal failing scaffold first:
  ```typescript
  import { describe, expect, it } from 'vitest';
  describe('POST /api/v1/{path}', () => {
    it('placeholder — test not yet implemented', () => {
      expect(true).toBe(false);
    });
  });
  ```

### Step 2: Generate/update the full test

Write the complete test file based on all gathered context.

### Step 3: Run and iterate

Run the test. For each failure:

1. **Read the error** — understand exactly what failed and why
2. **Classify the failure**:
   - Test bug (wrong assertion, wrong payload) → fix the test
   - Endpoint bug (unexpected behavior) → **STOP and report to user**: "The endpoint returns X but based on the context you gave me, it should return Y. Is this a bug or expected behavior?"
   - Missing context (status code not documented) → **ASK the user** what the expected behavior is
3. **Fix and re-run** — iterate until all tests pass

### Step 4: Coverage verification

After all tests pass, verify:
- Every status code in doc.md has at least one test
- Every error code is tested
- Happy path is tested
- Auth requirements are tested
- Input validation is tested
- Test Idempotency verified: test can run N times consecutively without failure

If coverage is incomplete, add missing tests and re-run.

---

## Code Smell Detection Checklist

After generating/updating the test, proactively analyze the endpoint `route.ts` for:

| Smell | What to check | Severity |
|-------|--------------|----------|
| Missing input validation | Fields used but not validated in `validators` array | HIGH |
| Inconsistent error codes | Same error condition returns different codes | HIGH |
| Missing auth check | No `checkAuth` in validators for protected endpoint | CRITICAL |
| SQL injection risk | Raw queries with string interpolation | CRITICAL |
| Missing try/catch | Async operations without error handling | MEDIUM |
| Hardcoded values | Magic numbers, hardcoded strings that should be config | LOW |
| Dead code | Code paths that Axiom logs show are never reached | MEDIUM |
| N+1 queries | DB queries inside loops | HIGH |
| Missing response format | Not using `helpers/response` for consistent format | MEDIUM |
| Test idempotency violation | Test modifies shared state or creates unique-constrained records without reversal/dynamic data — will fail on re-run | CRITICAL |

Report findings to the user with:
1. What was found
2. Where (file:line)
3. Why it's a problem
4. Suggested fix

---

## Batch Processing Rules

When processing multiple endpoints:

1. **Gather ALL context first** — do not start generating tests until you have context for every endpoint in the batch
2. **Process sequentially** — one endpoint at a time, completing the full cycle before moving to the next
3. **Accumulate findings** — keep a running report of all code smells and issues found
4. **Final report** — at the end, present a summary:
   - Tests created: N
   - Tests updated: N
   - Code smells found: N (with severity breakdown)
   - Endpoints with possible bugs: N (with details)

---

## Benchmarks & Measuring

The agent MUST track and report metrics for every e2e-forge execution.

### Per-Endpoint Metrics (reported after each endpoint)

| Metric | How to measure | Target |
|--------|---------------|--------|
| **Tests generated** | Count of `it()` blocks in the final e2e.test.ts | >= 5 per endpoint |
| **Status codes covered** | Unique HTTP status codes tested vs total in doc.md | 100% |
| **Error codes covered** | Unique errorCode assertions vs total documented | 100% |
| **TDD iterations** | Number of test-run cycles before all green | <= 5 |
| **Code smells found** | Count by severity (CRITICAL/HIGH/MEDIUM/LOW) | Report all |
| **Axiom logs analyzed** | Total log entries processed from all datasets | Report count |
| **Response time** | Time from skill invocation to all tests passing | Report duration |

### Per-Batch Metrics (reported at end of batch)

| Metric | Description |
|--------|-------------|
| **Coverage delta** | % of endpoints with tests before vs after |
| **Total tests created** | New e2e.test.ts files generated |
| **Total tests updated** | Existing e2e.test.ts files improved |
| **Total smells** | Breakdown by severity across all endpoints |
| **Endpoints flagged** | Endpoints with possible bugs found during testing |
| **Production alignment** | % of production error patterns now covered by tests |

### Quality Gate

A test is considered COMPLETE only when ALL of these pass:

- [ ] All `it()` blocks pass (zero failures)
- [ ] Every documented status code has at least one test
- [ ] Every documented error code has at least one assertion
- [ ] Auth test exists (401 without token)
- [ ] Validation test exists (400 with missing required field)
- [ ] Happy path test exists (200 with valid payload)
- [ ] Test Idempotency verified: test can run N times consecutively without failure. Shared state reverted, unique constraints use dynamic data
- [ ] doc.md is up to date with all context
- [ ] Code smell report generated

If ANY gate fails, the test is NOT complete. Report which gates failed.

### Measuring Report Format

At the end of each execution, present:

```
=== E2E Forge Report ===
Endpoint: POST /api/v1/{path}
Mode: CREATE | UPDATE

Tests:     {N} generated, {N} passing, {N} failing
Coverage:  {N}/{N} status codes, {N}/{N} error codes
TDD Loops: {N} iterations
Duration:  {time}

Code Smells:
  CRITICAL: {N}
  HIGH:     {N}
  MEDIUM:   {N}
  LOW:      {N}

Axiom Data:
  Logs analyzed: {N}
  Error patterns found: {N}
  Production alignment: {%}

Quality Gate: PASS | FAIL ({reasons})
========================
```

---

## Commands

```bash
# Install prerequisites
pnpm add -D @axiomhq/js

# Run extraction for single endpoint
npx tsx ${SKILL_DIR}/scripts/extract-axiom.ts --endpoint /auth/login --days 30

# Run extraction for all endpoints
npx tsx ${SKILL_DIR}/scripts/batch-extract.ts --all --days 60

# Map routes
npx tsx ${SKILL_DIR}/scripts/route-mapper.ts --routes-dir ./routes

# Analyze coverage
npx tsx ${SKILL_DIR}/scripts/coverage-analyzer.ts --app-dir ./app

# Run single endpoint test
npx vitest run app/{domain}/{feature}/e2e.test.ts --reporter=verbose --no-coverage --bail=1

# Run all tests
npm test
```

## Resources

- **CREA Framework**: https://platzi.com/blog/ai-prompt-engineer-crea/
- **Axiom APL Reference**: https://axiom.co/docs/apl/introduction
- **Axiom JS SDK**: https://www.npmjs.com/package/@axiomhq/js
- **Vitest Docs**: https://vitest.dev/
- **Supertest Docs**: https://www.npmjs.com/package/supertest
- **Prompt Engineering Patterns**: See `prompt-engineering-patterns` skill
- **Scripts**: See [scripts/](scripts/) for pre-built extraction and analysis tools
