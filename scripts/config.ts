import { Axiom } from '@axiomhq/js';

export const AXIOM_TOKEN = process.env.AXIOM_QUERY_TOKEN;
export const QUERY_DAYS = parseInt(process.env.AXIOM_QUERY_DAYS || '30');
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

export function createAxiomClient(): Axiom {
  if (!AXIOM_TOKEN) {
    console.error(JSON.stringify({
      error: 'AXIOM_QUERY_TOKEN environment variable is not set',
      help: 'Add AXIOM_QUERY_TOKEN=xaat-xxxxx to your .env file',
    }));
    process.exit(1);
  }
  return new Axiom({ token: AXIOM_TOKEN });
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
