import {
  createAxiomClient,
  ALL_DATASETS,
  MAX_SAMPLES_PER_ENDPOINT,
  QUERY_BATCH_DAYS,
  DEFAULT_QUERY_DAYS,
  QUERY_DELAY_MS,
  sleep,
  getConfiguredDatasets,
  resolveDatasets,
  discoverAccessibleDatasets,
  type DatasetInfo,
} from './config';
import type {
  BridgeErrorPattern,
  BridgeSummary,
  DbQueryPattern,
  DbQuerySummary,
  EndpointAxiomData,
  ErrorPattern,
  ErrorSummary,
  HttpLogSample,
  HttpLogSummary,
  ProviderInteraction,
  ProviderSummary,
  DatasetAccessReport,
} from './types';
import type { Axiom } from '@axiomhq/js';

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): { endpoint: string; days: number; datasets: string[]; discover: boolean } {
  const args = process.argv.slice(2);
  let endpoint = '';
  let days = DEFAULT_QUERY_DAYS;
  let datasets: string[] = [];
  let discover = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--endpoint':
        endpoint = args[++i] || '';
        break;
      case '--days':
        days = parseInt(args[++i] || String(QUERY_DAYS), 10);
        break;
      case '--datasets':
        datasets = (args[++i] || '').split(',').map(d => d.trim()).filter(Boolean);
        break;
      case '--discover':
        discover = true;
        break;
    }
  }

  // Fix MSYS/Git Bash path mangling
  endpoint = endpoint
    .replace(/^[A-Z]:\/Program Files\/Git\//i, '/')
    .replace(/^\//, '');

  if (!endpoint && !discover) {
    console.error('Usage: npx tsx extract-axiom.ts --endpoint auth/login [--days 30] [--datasets bemovil2,errors]');
    console.error('       npx tsx extract-axiom.ts --discover');
    process.exit(1);
  }

  return { endpoint, days, datasets, discover };
}

// ---------------------------------------------------------------------------
// Time-window helpers
// ---------------------------------------------------------------------------

interface TimeWindow {
  start: string;
  end: string;
}

function buildTimeWindows(days: number): TimeWindow[] {
  const windows: TimeWindow[] = [];
  const now = new Date();
  let cursor = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  while (cursor < now) {
    const windowEnd = new Date(
      Math.min(cursor.getTime() + QUERY_BATCH_DAYS * 24 * 60 * 60 * 1000, now.getTime()),
    );
    windows.push({
      start: cursor.toISOString(),
      end: windowEnd.toISOString(),
    });
    cursor = windowEnd;
  }

  return windows;
}

// ---------------------------------------------------------------------------
// Generic query helper
// ---------------------------------------------------------------------------

async function runQuery(axiom: Axiom, apl: string): Promise<Record<string, unknown>[]> {
  const result = await axiom.query(apl);
  if (!result.tables || result.tables.length === 0) return [];

  const table = result.tables[0];
  const fields = table.fields ?? [];
  if (fields.length === 0) return [];

  const rowCount = fields[0].data?.length ?? 0;
  const rows: Record<string, unknown>[] = [];

  for (let r = 0; r < rowCount; r++) {
    const row: Record<string, unknown> = {};
    for (const field of fields) {
      row[field.name] = field.data?.[r] ?? null;
    }
    rows.push(row);
  }

  return rows;
}

async function paginatedQuery(
  axiom: Axiom,
  windows: TimeWindow[],
  buildApl: (start: string, end: string) => string,
): Promise<Record<string, unknown>[]> {
  const allRows: Record<string, unknown>[] = [];

  for (const { start, end } of windows) {
    const rows = await runQuery(axiom, buildApl(start, end));
    allRows.push(...rows);
    await sleep(QUERY_DELAY_MS);
  }

  return allRows;
}

// ---------------------------------------------------------------------------
// Dataset extractors
// ---------------------------------------------------------------------------

async function extractHttpLogs(
  axiom: Axiom,
  endpoint: string,
  windows: TimeWindow[],
  datasetName: string,
): Promise<HttpLogSummary> {
  const empty: HttpLogSummary = {
    totalRequests: 0, statusCodes: {}, avgResponseTime: 0,
    p95ResponseTime: 0, errorRate: 0, samples: [],
  };

  try {
    console.error(`[${datasetName}] Querying aggregates...`);
    const aggRows = await paginatedQuery(axiom, windows, (start, end) =>
      `['${datasetName}'] | where _time >= datetime("${start}") and _time <= datetime("${end}") | where rawUrl contains "${endpoint}" | summarize total=count(), avg_rt=avg(response_time), p95_rt=percentile(response_time, 95), errors=countif(status == "FAIL") by status_code`,
    );

    const statusCodes: Record<string, number> = {};
    let totalRequests = 0;
    let weightedRt = 0;
    let maxP95 = 0;
    let totalErrors = 0;

    for (const row of aggRows) {
      const code = String(row.status_code ?? 'unknown');
      const count = Number(row.total ?? 0);
      statusCodes[code] = (statusCodes[code] ?? 0) + count;
      totalRequests += count;
      weightedRt += Number(row.avg_rt ?? 0) * count;
      maxP95 = Math.max(maxP95, Number(row.p95_rt ?? 0));
      totalErrors += Number(row.errors ?? 0);
    }

    console.error(`[${datasetName}] Querying samples...`);
    const sampleRows = await paginatedQuery(axiom, windows, (start, end) =>
      `['${datasetName}'] | where _time >= datetime("${start}") and _time <= datetime("${end}") | where rawUrl contains "${endpoint}" | take ${MAX_SAMPLES_PER_ENDPOINT}`,
    );

    const samples: HttpLogSample[] = sampleRows.slice(0, MAX_SAMPLES_PER_ENDPOINT).map((r) => ({
      timestamp: String(r._time ?? ''),
      statusCode: Number(r.status_code ?? 0),
      status: String(r.status ?? ''),
      body: String(r.body ?? ''),
      response: String(r.response ?? ''),
      responseTime: Number(r.response_time ?? 0),
    }));

    return {
      totalRequests, statusCodes,
      avgResponseTime: totalRequests > 0 ? weightedRt / totalRequests : 0,
      p95ResponseTime: maxP95,
      errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
      samples,
    };
  } catch (err) {
    console.error(`[${datasetName}] Error: ${err instanceof Error ? err.message : err}`);
    return empty;
  }
}

async function extractErrors(
  axiom: Axiom,
  endpoint: string,
  windows: TimeWindow[],
  datasetName: string,
): Promise<ErrorSummary> {
  const empty: ErrorSummary = { count: 0, topErrors: [], sampleStacks: [] };

  try {
    console.error(`[${datasetName}] Querying aggregates...`);
    const aggRows = await paginatedQuery(axiom, windows, (start, end) =>
      `['${datasetName}'] | where _time >= datetime("${start}") and _time <= datetime("${end}") | where path contains "${endpoint}" | summarize total=count(), unique_errors=dcount(error) by path, method`,
    );

    let totalCount = 0;
    const topErrors: ErrorPattern[] = [];

    for (const row of aggRows) {
      const count = Number(row.total ?? 0);
      totalCount += count;
      topErrors.push({
        errorCode: String(row.path ?? ''),
        method: String(row.method ?? ''),
        count,
        sampleError: '',
      });
    }

    console.error(`[${datasetName}] Querying samples...`);
    const sampleRows = await paginatedQuery(axiom, windows, (start, end) =>
      `['${datasetName}'] | where _time >= datetime("${start}") and _time <= datetime("${end}") | where path contains "${endpoint}" | take_any error, stack by path, method`,
    );

    for (const row of sampleRows) {
      const match = topErrors.find(
        (e) => e.errorCode === String(row.path ?? '') && e.method === String(row.method ?? ''),
      );
      if (match) match.sampleError = String(row.error ?? '');
    }

    const sampleStacks = sampleRows
      .map((r) => String(r.stack ?? ''))
      .filter((s) => s && s !== 'null');

    return { count: totalCount, topErrors, sampleStacks };
  } catch (err) {
    console.error(`[${datasetName}] Error: ${err instanceof Error ? err.message : err}`);
    return empty;
  }
}

async function extractProviders(
  axiom: Axiom,
  endpoint: string,
  windows: TimeWindow[],
  datasetName: string,
): Promise<ProviderSummary> {
  const empty: ProviderSummary = { interactions: [], totalCalls: 0, failureRate: 0 };

  try {
    console.error(`[${datasetName}] Querying aggregates...`);
    const aggRows = await paginatedQuery(axiom, windows, (start, end) =>
      `['${datasetName}'] | where _time >= datetime("${start}") and _time <= datetime("${end}") | where rawUrl contains "${endpoint}" | summarize total=count(), avg_rt=avg(response_time), p95_rt=percentile(response_time, 95), failures=countif(response_time < 0 or response == "") by provider`,
    );

    let totalCalls = 0;
    let totalFailures = 0;
    const interactions: ProviderInteraction[] = [];

    for (const row of aggRows) {
      const calls = Number(row.total ?? 0);
      const failures = Number(row.failures ?? 0);
      totalCalls += calls;
      totalFailures += failures;
      interactions.push({
        provider: String(row.provider ?? 'unknown'),
        totalCalls: calls,
        avgResponseTime: Number(row.avg_rt ?? 0),
        p95ResponseTime: Number(row.p95_rt ?? 0),
        failureCount: failures,
      });
    }

    return { interactions, totalCalls, failureRate: totalCalls > 0 ? totalFailures / totalCalls : 0 };
  } catch (err) {
    console.error(`[${datasetName}] Error: ${err instanceof Error ? err.message : err}`);
    return empty;
  }
}

async function extractDbQueries(
  axiom: Axiom,
  endpoint: string,
  windows: TimeWindow[],
  datasetName: string,
): Promise<DbQuerySummary> {
  const empty: DbQuerySummary = {
    slowQueries: [], errorQueries: [], totalSlowCount: 0, totalErrorCount: 0,
  };

  try {
    console.error(`[${datasetName}] Querying aggregates...`);
    const aggRows = await paginatedQuery(axiom, windows, (start, end) =>
      `['${datasetName}'] | where _time >= datetime("${start}") and _time <= datetime("${end}") | where path contains "${endpoint}" | summarize total=count(), avg_ms=avg(ms), max_ms=max(ms) by type, functionName`,
    );

    const slowQueries: DbQueryPattern[] = [];
    const errorQueries: DbQueryPattern[] = [];
    let totalSlowCount = 0;
    let totalErrorCount = 0;

    for (const row of aggRows) {
      const type = String(row.type ?? '');
      const count = Number(row.total ?? 0);
      const pattern: DbQueryPattern = {
        functionName: String(row.functionName ?? ''),
        type, count,
        avgMs: Number(row.avg_ms ?? 0),
        maxMs: Number(row.max_ms ?? 0),
        sampleSql: '',
      };

      if (type === 'ErrorQuery') {
        errorQueries.push(pattern);
        totalErrorCount += count;
      } else if (type === 'LowQuery' || type === 'metaDataBlocking') {
        slowQueries.push(pattern);
        totalSlowCount += count;
      }
    }

    console.error(`[${datasetName}] Querying samples...`);
    const sampleRows = await paginatedQuery(axiom, windows, (start, end) =>
      `['${datasetName}'] | where _time >= datetime("${start}") and _time <= datetime("${end}") | where path contains "${endpoint}" | take_any sql by type, functionName`,
    );

    for (const row of sampleRows) {
      const fn = String(row.functionName ?? '');
      const type = String(row.type ?? '');
      const target = type === 'ErrorQuery'
        ? errorQueries.find((q) => q.functionName === fn)
        : slowQueries.find((q) => q.functionName === fn);
      if (target) target.sampleSql = String(row.sql ?? '');
    }

    return { slowQueries, errorQueries, totalSlowCount, totalErrorCount };
  } catch (err) {
    console.error(`[${datasetName}] Error: ${err instanceof Error ? err.message : err}`);
    return empty;
  }
}

async function extractBridge(
  axiom: Axiom,
  endpoint: string,
  windows: TimeWindow[],
  datasetName: string,
): Promise<BridgeSummary> {
  const empty: BridgeSummary = {
    total: 0, successCount: 0, errorCount: 0, successRate: 0, errorPatterns: [],
  };

  try {
    console.error(`[${datasetName}] Querying aggregates...`);
    const aggRows = await paginatedQuery(axiom, windows, (start, end) =>
      `['${datasetName}'] | where _time >= datetime("${start}") and _time <= datetime("${end}") | where path contains "${endpoint}" | summarize total=count(), successes=countif(status == "SUCCESS"), errors=countif(status == "ERROR") by providerName`,
    );

    let total = 0;
    let successCount = 0;
    let errorCount = 0;

    for (const row of aggRows) {
      total += Number(row.total ?? 0);
      successCount += Number(row.successes ?? 0);
      errorCount += Number(row.errors ?? 0);
    }

    console.error(`[${datasetName}] Querying error samples...`);
    const errorRows = await paginatedQuery(axiom, windows, (start, end) =>
      `['${datasetName}'] | where _time >= datetime("${start}") and _time <= datetime("${end}") | where path contains "${endpoint}" | where status == "ERROR" | summarize count=count(), sample_response=take_any(response) by providerName, productId`,
    );

    const errorPatterns: BridgeErrorPattern[] = errorRows.map((r) => ({
      providerName: String(r.providerName ?? 'unknown'),
      productId: r.productId != null ? Number(r.productId) : null,
      count: Number(r.count ?? 0),
      sampleResponse: String(r.sample_response ?? ''),
    }));

    return {
      total, successCount, errorCount,
      successRate: total > 0 ? successCount / total : 0,
      errorPatterns,
    };
  } catch (err) {
    console.error(`[${datasetName}] Error: ${err instanceof Error ? err.message : err}`);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Dataset routing — decides which extractor to use for each dataset
// ---------------------------------------------------------------------------

type ExtractorKey = 'httpLogs' | 'errors' | 'providers' | 'dbQueries' | 'bridge';

const DATASET_EXTRACTORS: Record<string, ExtractorKey> = {
  'bemovil2': 'httpLogs',
  'errors': 'errors',
  'bemovil2-providers': 'providers',
  'bemovil2-providers-sandbox': 'providers',
  'bemovil2-queries': 'dbQueries',
  'bemovil2-bridge': 'bridge',
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { endpoint, days, datasets: cliDatasets, discover } = parseArgs();
  const axiom = createAxiomClient();

  // Discovery mode — just report accessible datasets
  if (discover) {
    console.error('[discover] Testing access to all known datasets...');
    const { accessible, denied } = await discoverAccessibleDatasets(axiom);

    const report: DatasetAccessReport = {
      accessible: accessible.map(d => ({ name: d.name, description: d.description })),
      denied: denied.map(d => ({ name: d.name, description: d.description })),
      timestamp: new Date().toISOString(),
    };

    process.stdout.write(JSON.stringify(report, null, 2));
    return;
  }

  // Determine which datasets to query
  const envDatasets = getConfiguredDatasets();
  const targetDatasets = cliDatasets.length > 0
    ? resolveDatasets(cliDatasets)
    : envDatasets.length > 0
      ? resolveDatasets(envDatasets)
      : Object.values(ALL_DATASETS);

  const windows = buildTimeWindows(days);

  console.error(`Extracting Axiom data for endpoint: ${endpoint}`);
  console.error(`Time range: ${days} days in ${windows.length} batch(es) of ${QUERY_BATCH_DAYS} days`);
  console.error(`Datasets to query: ${targetDatasets.map(d => d.name).join(', ')}`);

  const data: EndpointAxiomData = {
    endpoint,
    extractedAt: new Date().toISOString(),
    daysQueried: days,
    datasetsQueried: [],
    datasetsDenied: [],
    httpLogs: { totalRequests: 0, statusCodes: {}, avgResponseTime: 0, p95ResponseTime: 0, errorRate: 0, samples: [] },
    errors: { count: 0, topErrors: [], sampleStacks: [] },
    providers: { interactions: [], totalCalls: 0, failureRate: 0 },
    dbQueries: { slowQueries: [], errorQueries: [], totalSlowCount: 0, totalErrorCount: 0 },
    bridge: { total: 0, successCount: 0, errorCount: 0, successRate: 0, errorPatterns: [] },
  };

  for (const dataset of targetDatasets) {
    const extractorKey = DATASET_EXTRACTORS[dataset.name];
    if (!extractorKey) {
      console.error(`[${dataset.name}] No extractor available, skipping.`);
      continue;
    }

    try {
      switch (extractorKey) {
        case 'httpLogs':
          data.httpLogs = await extractHttpLogs(axiom, endpoint, windows, dataset.name);
          break;
        case 'errors':
          data.errors = await extractErrors(axiom, endpoint, windows, dataset.name);
          break;
        case 'providers':
          data.providers = await extractProviders(axiom, endpoint, windows, dataset.name);
          break;
        case 'dbQueries':
          data.dbQueries = await extractDbQueries(axiom, endpoint, windows, dataset.name);
          break;
        case 'bridge':
          data.bridge = await extractBridge(axiom, endpoint, windows, dataset.name);
          break;
      }
      data.datasetsQueried.push(dataset.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('forbidden') || msg.includes('unauthorized') || msg.includes('403') || msg.includes('401')) {
        console.error(`[${dataset.name}] ACCESS DENIED — token lacks query permissions for this dataset.`);
        data.datasetsDenied.push(dataset.name);
      } else {
        console.error(`[${dataset.name}] Error: ${msg}`);
        data.datasetsDenied.push(dataset.name);
      }
    }
  }

  console.error(`\nResults: ${data.datasetsQueried.length} datasets queried, ${data.datasetsDenied.length} denied.`);
  if (data.datasetsDenied.length > 0) {
    console.error(`Denied datasets: ${data.datasetsDenied.join(', ')}`);
  }

  process.stdout.write(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(`Fatal error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
