import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Axiom } from '@axiomhq/js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Auto-bootstrap: install deps if missing ──────────────────────
if (!existsSync(join(__dirname, 'node_modules', '@axiomhq', 'js'))) {
  console.error('[e2e-forge] Dependencies not found. Auto-installing...');
  try {
    execSync('npm install --no-audit --no-fund --loglevel=error', {
      cwd: __dirname,
      stdio: 'inherit',
    });
  } catch {
    console.error('[e2e-forge] Auto-install failed. Run manually: cd "' + __dirname + '" && npm install');
    process.exit(1);
  }
}

// ─── Load .env from CWD (project directory) ───────────────────────
function loadEnvFromCwd(): void {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes (double or single)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFromCwd();

// ─── Lazy import of @axiomhq/js (after bootstrap) ────────────────
let _axiomModule: typeof import('@axiomhq/js') | undefined;

async function getAxiomModule(): Promise<typeof import('@axiomhq/js')> {
  if (!_axiomModule) {
    _axiomModule = await import('@axiomhq/js');
  }
  return _axiomModule;
}

// ─── Configuration ────────────────────────────────────────────────
export const AXIOM_TOKEN = process.env.AXIOM_QUERY_TOKEN;
export const DEFAULT_QUERY_DAYS = 30;
export const QUERY_BATCH_DAYS = 10;
export const QUERY_DELAY_MS = 1000;
export const MAX_SAMPLES_PER_ENDPOINT = 20;

export interface DatasetInfo {
  key: string;
  name: string;
  description: string;
  relevance: string;
  filterField: string;
}

export const ALL_DATASETS: Record<string, DatasetInfo> = {
  BEMOVIL2: {
    key: 'BEMOVIL2',
    name: 'bemovil2',
    description: 'Primary HTTP logs — all requests/responses to every backend endpoint via the proxy',
    relevance: 'ALWAYS relevant. Contains status codes, response times, request/response bodies for every API call.',
    filterField: 'rawUrl',
  },
  ERRORS: {
    key: 'ERRORS',
    name: 'errors',
    description: 'Application errors with stack traces, error codes, and request context',
    relevance: 'Relevant when the endpoint has error paths (400, 401, 403, 500). Contains error messages, stack traces, and business/user context.',
    filterField: 'path',
  },
  PROVIDERS: {
    key: 'PROVIDERS',
    name: 'bemovil2-providers',
    description: 'External provider/API interactions — requests and responses to third-party services',
    relevance: 'Only relevant when the endpoint calls external providers (payment gateways, SMS, Bemovil SOAP, etc.).',
    filterField: 'rawUrl',
  },
  PROVIDERS_SANDBOX: {
    key: 'PROVIDERS_SANDBOX',
    name: 'bemovil2-providers-sandbox',
    description: 'Same as bemovil2-providers but for sandbox/staging environment',
    relevance: 'Only relevant when testing sandbox-specific provider behavior.',
    filterField: 'rawUrl',
  },
  QUERIES: {
    key: 'QUERIES',
    name: 'bemovil2-queries',
    description: 'Database query performance — slow queries, blocking metadata, error queries with SQL',
    relevance: 'Relevant when the endpoint has complex DB operations or performance concerns.',
    filterField: 'path',
  },
  BRIDGE: {
    key: 'BRIDGE',
    name: 'bemovil2-bridge',
    description: 'External provider bridge calls with success/error status and transaction tracking',
    relevance: 'Only relevant when the endpoint uses useBridge=true for Bemovil provider calls.',
    filterField: 'path',
  },
  FRONTEND: {
    key: 'FRONTEND',
    name: 'bemovil2-frontend',
    description: 'Frontend application metrics and events',
    relevance: 'Relevant for understanding how the frontend consumes the endpoint (errors, latency from client perspective).',
    filterField: 'url',
  },
};

export function getConfiguredDatasets(): string[] {
  const envDatasets = process.env.AXIOM_DATASETS;
  if (envDatasets) {
    return envDatasets.split(',').map(d => d.trim()).filter(Boolean);
  }
  return [];
}

export function resolveDatasets(configured: string[]): DatasetInfo[] {
  if (configured.length > 0) {
    return configured
      .map(name => Object.values(ALL_DATASETS).find(d => d.name === name))
      .filter((d): d is DatasetInfo => d !== undefined);
  }
  return Object.values(ALL_DATASETS);
}

export async function createAxiomClient(): Promise<Axiom> {
  if (!AXIOM_TOKEN) {
    console.error(JSON.stringify({
      error: 'AXIOM_QUERY_TOKEN environment variable is not set',
      help: 'Add AXIOM_QUERY_TOKEN=xaat-xxxxx to your .env file',
    }));
    process.exit(1);
  }
  const { Axiom: AxiomClass } = await getAxiomModule();
  return new AxiomClass({ token: AXIOM_TOKEN });
}

export async function discoverAccessibleDatasets(axiom: Axiom): Promise<{
  accessible: DatasetInfo[];
  denied: DatasetInfo[];
}> {
  const allDatasets = Object.values(ALL_DATASETS);
  const accessible: DatasetInfo[] = [];
  const denied: DatasetInfo[] = [];

  for (const dataset of allDatasets) {
    try {
      await axiom.query(`['${dataset.name}'] | take 1`);
      accessible.push(dataset);
    } catch {
      denied.push(dataset);
    }
  }

  return { accessible, denied };
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getTimeRange(days: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}
