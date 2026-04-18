import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface BatchArgs {
  all: boolean;
  endpoints: string[];
  days: number;
  outputDir: string;
}

interface EndpointResult {
  endpoint: string;
  success: boolean;
  outputFile?: string;
  error?: string;
}

interface BatchSummary {
  totalProcessed: number;
  successful: number;
  failed: number;
  outputDir: string;
  results: EndpointResult[];
}

function parseArgs(): BatchArgs {
  const args = process.argv.slice(2);
  let all = false;
  let endpoints: string[] = [];
  let days = 60;
  let outputDir = './scripts/axiom-e2e/output';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--all':
        all = true;
        break;
      case '--endpoints':
        if (args[i + 1]) {
          endpoints = args[i + 1].split(',').map((e) => e.trim());
          i++;
        }
        break;
      case '--days':
        if (args[i + 1]) {
          days = parseInt(args[i + 1], 10);
          i++;
        }
        break;
      case '--output-dir':
        if (args[i + 1]) {
          outputDir = args[i + 1];
          i++;
        }
        break;
    }
  }

  if (!all && endpoints.length === 0) {
    console.error(
      JSON.stringify({
        error: 'Must specify --all or --endpoints <comma-separated>',
        usage: [
          'npx tsx batch-extract.ts --all --days 60',
          'npx tsx batch-extract.ts --endpoints auth/login,auth/logout --days 30',
        ],
      }),
    );
    process.exit(1);
  }

  return { all, endpoints, days, outputDir: path.resolve(outputDir) };
}

function discoverAllEndpoints(scriptDir: string): string[] {
  try {
    const routeMapperPath = path.join(scriptDir, 'route-mapper.ts');
    const result = execSync(`npx tsx "${routeMapperPath}"`, {
      encoding: 'utf-8',
      timeout: 60000,
      env: process.env,
    });

    const data = JSON.parse(result.trim());

    // route-mapper may return an array of endpoint objects or strings
    if (Array.isArray(data)) {
      return data.map((item: { urlPath?: string } | string) =>
        typeof item === 'string' ? item : item.urlPath ?? '',
      ).filter(Boolean);
    }

    // Or it may return an object with an endpoints field
    if (data.endpoints && Array.isArray(data.endpoints)) {
      return data.endpoints.map((item: { urlPath?: string } | string) =>
        typeof item === 'string' ? item : item.urlPath ?? '',
      ).filter(Boolean);
    }

    console.error(
      JSON.stringify({ error: 'Unexpected route-mapper output format' }),
    );
    process.exit(1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        error: 'Failed to run route-mapper',
        details: message,
      }),
    );
    process.exit(1);
  }

  return [];
}

function endpointToSlug(endpoint: string): string {
  // Remove leading /api/v1/ prefix if present, then replace / with __
  const cleaned = endpoint.replace(/^\/api\/v1\//, '');
  return cleaned.replace(/\//g, '__');
}

function sleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy-wait for synchronous delay
  }
}

function extractEndpoint(
  endpoint: string,
  days: number,
  scriptDir: string,
): string {
  const extractScript = path.join(scriptDir, 'extract-axiom.ts');
  const result = execSync(
    `npx tsx "${extractScript}" --endpoint ${endpoint} --days ${days}`,
    {
      encoding: 'utf-8',
      env: process.env,
      timeout: 120000,
    },
  );
  return result.trim();
}

function main(): void {
  const { all, endpoints, days, outputDir } = parseArgs();
  const scriptDir = path.dirname(path.resolve(process.argv[1]));

  // Resolve endpoint list
  let endpointList: string[];
  if (all) {
    console.error('[*] Discovering all endpoints via route-mapper...');
    endpointList = discoverAllEndpoints(scriptDir);
    console.error(`[*] Found ${endpointList.length} endpoints`);
  } else {
    endpointList = endpoints;
  }

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

  const results: EndpointResult[] = [];
  const axiomSummary: Record<string, unknown> = {};

  for (let i = 0; i < endpointList.length; i++) {
    const endpoint = endpointList[i];
    const current = i + 1;
    const total = endpointList.length;

    console.error(`[${current}/${total}] Extracting ${endpoint}...`);

    try {
      const rawOutput = extractEndpoint(endpoint, days, scriptDir);
      const data = JSON.parse(rawOutput);

      const slug = endpointToSlug(endpoint);
      const outputFile = path.join(outputDir, `${slug}.json`);
      fs.writeFileSync(outputFile, JSON.stringify(data, null, 2), 'utf-8');

      // Collect for summary
      axiomSummary[endpoint] = {
        httpLogs: data.httpLogs ?? null,
        errors: data.errors
          ? { count: data.errors.count ?? 0 }
          : null,
        providers: data.providers
          ? { totalCalls: data.providers.totalCalls ?? 0 }
          : null,
      };

      results.push({
        endpoint,
        success: true,
        outputFile,
      });

      console.error(`[${current}/${total}] Done: ${slug}.json`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${current}/${total}] FAILED: ${endpoint} — ${message}`);

      results.push({
        endpoint,
        success: false,
        error: message,
      });
    }

    // Delay between requests to avoid rate limits (skip after last)
    if (i < endpointList.length - 1) {
      sleep(1000);
    }
  }

  // Write axiom-summary.json
  const summaryPath = path.join(outputDir, 'axiom-summary.json');
  const summaryData = {
    extractedAt: new Date().toISOString(),
    daysQueried: days,
    totalEndpoints: endpointList.length,
    endpoints: axiomSummary,
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summaryData, null, 2), 'utf-8');

  // Write endpoint-catalog.json
  const catalogPath = path.join(outputDir, 'endpoint-catalog.json');
  const catalogData = {
    extractedAt: new Date().toISOString(),
    totalEndpoints: endpointList.length,
    endpoints: endpointList,
  };
  fs.writeFileSync(catalogPath, JSON.stringify(catalogData, null, 2), 'utf-8');

  // Final summary to stdout
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  const summary: BatchSummary = {
    totalProcessed: endpointList.length,
    successful,
    failed,
    outputDir,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
