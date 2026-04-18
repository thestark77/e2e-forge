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

## When to Use

- Creating a new e2e test for an API endpoint
- Updating an existing e2e test after endpoint modifications
- Batch creating/updating tests for multiple endpoints
- Auditing test coverage gaps across the project
- Detecting code smells or errors in endpoint implementations

## Pre-requisites

Before using this skill, the project MUST have:

1. **Axiom API token** with query permissions in env var `AXIOM_QUERY_TOKEN`
2. **`@axiomhq/js`** installed as a devDependency
3. **Vitest + Supertest** configured (or equivalent test framework)
4. **`tsx`** available globally or as devDependency (for running extraction scripts)

If any prerequisite is missing, inform the user with the exact install command.

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
2. Code Analysis — read `route.ts`, trace validators, imports, services
3. Frontend Tracing — run `frontend-tracer.ts` script
4. Doc Generation — create `doc.md` in the endpoint folder
5. Test Generation — apply CREA framework to generate the e2e test
6. TDD Loop — create failing scaffold, iterate until green (see TDD Protocol)
7. Code Smell Detection — analyze endpoint for issues (see Smell Checklist)

### Mode 2: UPDATE (existing endpoint modified)

Use when the endpoint already has an `e2e.test.ts` and has been modified.

**Flow:**
1. Context Gathering (MANDATORY)
2. Axiom Log Extraction — run `extract-axiom.ts --endpoint {path} --days 30`
3. Diff Analysis — `git diff` on the route.ts to see changes
4. Log vs New Behavior — compare production logs with new expected I/O
5. Doc Update — update `doc.md` with new context
6. Test Update — improve existing test with new scenarios
7. TDD Loop — run existing test, iterate until all new assertions pass
8. Code Smell Detection

### Mode 3: BATCH (multiple endpoints)

Use when processing multiple endpoints at once.

**Flow:**
1. Bulk Discovery — run `coverage-analyzer.ts` to identify targets
2. Context Gathering PER ENDPOINT — ask for context for EACH one
3. Sequential Processing — process each through Mode 1 or 2
4. Batch Report — summary of all tests created/updated and smells found

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
| DB records created that need cleanup? | If route creates/modifies records |
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

For every endpoint processed, create or update `app/<domain>/<feature>/doc.md`:

```markdown
# POST /api/v1/{path}

## Purpose
{Business logic description from user context}

## Input
{Request body schema with field descriptions, types, and validations}

## Output

### 200 - Success
{Response body schema}

### 400 - Bad Request
{When and why, error codes}

### 401 - Unauthorized
{When and why, error codes}

### 403 - Forbidden
{When and why, error codes}

## Error Codes
| Code | HTTP Status | When |
|------|-------------|------|

## Edge Cases
- {List from user context + AI-detected ones}

## Dependencies
- **Frontend**: {files that call this endpoint via postRequest()}
- **Services**: {backend services/models imported}
- **Providers**: {external providers if any}

## Production Insights (from Axiom)
- Requests/day: {avg}
- Error rate: {%}
- Avg response time: {ms}
- Top errors: {list}

## Assumptions
{Only if user said "infer" — document what was assumed}
```

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
- Include cleanup for any DB records created
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

  // === CLEANUP (if mocks used) ===
  afterEach(() => {
    vi.restoreAllMocks();
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

    // Cleanup BEFORE assertions
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
- DB cleanup is present for any created records

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
| Uncleaned test data | Test creates DB records but doesn't destroy them | HIGH |

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
- [ ] DB cleanup verified (no orphaned records after test run)
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
