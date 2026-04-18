import * as fs from 'fs';
import * as path from 'path';
import type { CoverageGap, CoverageReport } from './types';

interface AxiomEndpointSummary {
  endpoint: string;
  httpLogs?: {
    totalRequests: number;
    errorRate: number;
  };
}

interface AxiomSummaryFile {
  endpoints: Record<string, AxiomEndpointSummary>;
}

function parseArgs(): { appDir: string } {
  const args = process.argv.slice(2);
  let appDir = './app';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--app-dir' && args[i + 1]) {
      appDir = args[i + 1];
      i++;
    }
  }

  return { appDir: path.resolve(appDir) };
}

function findRouteFiles(dir: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...findRouteFiles(fullPath));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      results.push(fullPath);
    }
  }

  return results;
}

function extractDomainAndFeature(
  routeFile: string,
  appDir: string,
): { domain: string; feature: string } | null {
  const relative = path.relative(appDir, routeFile);
  // Normalize to forward slashes for consistent parsing
  const parts = relative.split(/[\\/]/);

  // Expect at least: {domain}/{feature}/route.ts
  if (parts.length < 3) {
    return null;
  }

  // Strip route groups like (authenticated) — folders wrapped in parens
  const meaningful = parts
    .slice(0, -1) // remove route.ts
    .filter((p) => !p.startsWith('(') || !p.endsWith(')'));

  if (meaningful.length < 2) {
    return null;
  }

  return {
    domain: meaningful[0],
    feature: meaningful.slice(1).join('/'),
  };
}

function buildUrlPath(domain: string, feature: string): string {
  return `/api/v1/${domain}/${feature}`;
}

function checkSiblingTest(routeFile: string): string | null {
  const dir = path.dirname(routeFile);
  const testFile = path.join(dir, 'e2e.test.ts');
  return fs.existsSync(testFile) ? testFile : null;
}

function loadAxiomSummary(): Record<
  string,
  { traffic: number; errorRate: number }
> {
  const summaryPath = path.resolve(
    './scripts/axiom-e2e/output/axiom-summary.json',
  );
  const lookup: Record<string, { traffic: number; errorRate: number }> = {};

  if (!fs.existsSync(summaryPath)) {
    return lookup;
  }

  try {
    const raw = fs.readFileSync(summaryPath, 'utf-8');
    const data: AxiomSummaryFile = JSON.parse(raw);

    if (data.endpoints) {
      for (const [key, entry] of Object.entries(data.endpoints)) {
        lookup[key] = {
          traffic: entry.httpLogs?.totalRequests ?? 0,
          errorRate: entry.httpLogs?.errorRate ?? 0,
        };
      }
    }
  } catch {
    // If file is malformed, proceed without Axiom data
  }

  return lookup;
}

function main(): void {
  const { appDir } = parseArgs();

  if (!fs.existsSync(appDir)) {
    console.error(
      JSON.stringify({ error: `App directory not found: ${appDir}` }),
    );
    process.exit(1);
  }

  const routeFiles = findRouteFiles(appDir);
  const axiomData = loadAxiomSummary();

  const gaps: CoverageGap[] = [];
  let tested = 0;

  for (const routeFile of routeFiles) {
    const extracted = extractDomainAndFeature(routeFile, appDir);
    if (!extracted) continue;

    const { domain, feature } = extracted;
    const endpoint = buildUrlPath(domain, feature);
    const testFile = checkSiblingTest(routeFile);

    if (testFile) {
      tested++;
      continue;
    }

    const axiom = axiomData[endpoint] ?? { traffic: 0, errorRate: 0 };
    const priority = axiom.traffic * axiom.errorRate * 100;

    let reason = 'No sibling e2e.test.ts found';
    if (axiom.traffic > 0 && axiom.errorRate > 0) {
      reason += ` | traffic=${axiom.traffic}, errorRate=${(axiom.errorRate * 100).toFixed(1)}%`;
    } else if (axiom.traffic > 0) {
      reason += ` | traffic=${axiom.traffic}, no errors detected`;
    } else {
      reason += ' | no Axiom data available';
    }

    gaps.push({
      endpoint,
      routeFile,
      traffic: axiom.traffic,
      errorRate: axiom.errorRate,
      priority: Math.round(priority * 100) / 100,
      reason,
    });
  }

  // Sort by priority descending
  gaps.sort((a, b) => b.priority - a.priority);

  const total = routeFiles.length;
  const untested = gaps.length;
  const coveragePercent =
    total > 0 ? Math.round((tested / total) * 10000) / 100 : 0;

  const report: CoverageReport = {
    total,
    tested,
    untested,
    coveragePercent,
    gaps,
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
