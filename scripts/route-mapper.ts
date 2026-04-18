import * as fs from 'fs';
import * as path from 'path';
import type { EndpointRoute } from './types';

function parseArgs(): { routesDir: string } {
  const args = process.argv.slice(2);
  let routesDir = './routes';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--routes-dir' && args[i + 1]) {
      routesDir = args[i + 1];
      i++;
    }
  }

  return { routesDir: path.resolve(routesDir) };
}

interface RouteGroup {
  prefix: string;
  fileName: string;
}

function parseIndexFile(indexPath: string): RouteGroup[] {
  const content = fs.readFileSync(indexPath, 'utf-8');
  const groups: RouteGroup[] = [];

  // Parse imports: import auth from './auth';
  const importMap = new Map<string, string>();
  const importRegex = /import\s+(\w+)\s+from\s+['"]\.\/([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(content)) !== null) {
    importMap.set(match[1], match[2]);
  }

  // Parse route registrations: r.use('/auth', auth);
  const useRegex = /r\.use\(\s*['"]\/([^'"]+)['"]\s*,\s*(\w+)\)/g;

  while ((match = useRegex.exec(content)) !== null) {
    const prefix = match[1];
    const varName = match[2];
    const fileName = importMap.get(varName) || varName;
    groups.push({ prefix, fileName });
  }

  return groups;
}

interface RouteEntry {
  path: string;
  domain: string;
  feature: string;
}

function parseRouteFile(filePath: string): RouteEntry[] {
  if (!fs.existsSync(filePath)) {
    console.error(`[route-mapper] Route file not found: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const entries: RouteEntry[] = [];

  // Pattern 1: create(r, '/login', import('@/app/auth/login/route')) or create(r, '/list', import('app/feature-flags/list/route'))
  const createRegex = /create\(r,\s*['"]([^'"]+)['"]\s*,\s*import\(['"](?:@\/)?app\/([^'"]+)\/route['"]\)\)/g;
  let match: RegExpExecArray | null;

  while ((match = createRegex.exec(content)) !== null) {
    const routePath = match[1];
    const appPath = match[2];

    const parts = appPath.split('/');
    const feature = parts.pop()!;
    const domain = parts.join('/');

    entries.push({ path: routePath, domain, feature });
  }

  // Pattern 2: r.get('/path', handler) or r.post('/path', handler) with import from '@/app/.../route'
  // Used by webhooks and other non-standard routes
  const directImportRegex = /import\s*\{[^}]*\}\s*from\s*['"](?:@\/)?app\/([^'"]+)\/route['"]/g;
  while ((match = directImportRegex.exec(content)) !== null) {
    const appPath = match[1];
    const parts = appPath.split('/');
    const feature = parts.pop()!;
    const domain = parts.join('/');

    // Check if this route was already captured by create() pattern
    const alreadyExists = entries.some(e => e.domain === domain && e.feature === feature);
    if (!alreadyExists) {
      // Extract the route path from r.get/r.post calls
      const routeCallRegex = /r\.(get|post)\(\s*['"]([^'"]+)['"]/g;
      let routeMatch: RegExpExecArray | null;
      while ((routeMatch = routeCallRegex.exec(content)) !== null) {
        entries.push({ path: routeMatch[2], domain, feature });
      }
      break;
    }
  }

  return entries;
}

function findProjectRoot(routesDir: string): string {
  // Walk up from routesDir to find the project root (where 'app' directory lives)
  let dir = path.dirname(routesDir);
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'app'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume routesDir's parent
  return path.dirname(routesDir);
}

function main(): void {
  const { routesDir } = parseArgs();

  console.error(`[route-mapper] Scanning routes in: ${routesDir}`);

  const indexPath = path.join(routesDir, 'index.ts');
  if (!fs.existsSync(indexPath)) {
    console.error(`[route-mapper] ERROR: index.ts not found at ${indexPath}`);
    process.exit(1);
  }

  const groups = parseIndexFile(indexPath);
  console.error(`[route-mapper] Found ${groups.length} route groups`);

  const projectRoot = findProjectRoot(routesDir);
  const endpoints: EndpointRoute[] = [];

  for (const group of groups) {
    // Strip .js/.ts extension if present (TS ESM uses .js in imports but file is .ts)
    const baseName = group.fileName.replace(/\.[jt]s$/, '');
    // Try .ts first, then .js, then exact name (for edge cases)
    let routeFilePath = path.join(routesDir, `${baseName}.ts`);
    if (!fs.existsSync(routeFilePath)) {
      routeFilePath = path.join(routesDir, `${baseName}.js`);
    }
    if (!fs.existsSync(routeFilePath)) {
      routeFilePath = path.join(routesDir, group.fileName);
    }

    const entries = parseRouteFile(routeFilePath);
    console.error(`[route-mapper]   /${group.prefix}: ${entries.length} routes from ${group.fileName}`);

    for (const entry of entries) {
      const urlPath = `/api/v1/${group.prefix}${entry.path}`;
      const appDir = path.join(projectRoot, 'app', entry.domain, entry.feature);
      const testFile = path.join(appDir, 'e2e.test.ts');
      const hasTest = fs.existsSync(testFile);

      endpoints.push({
        urlPath,
        routeFile: routeFilePath,
        hasTest,
        testFile: hasTest ? testFile : null,
        domain: entry.domain,
        feature: entry.feature,
      });
    }
  }

  console.error(`[route-mapper] Total endpoints found: ${endpoints.length}`);
  console.error(`[route-mapper] With e2e tests: ${endpoints.filter((e) => e.hasTest).length}`);
  console.error(`[route-mapper] Without e2e tests: ${endpoints.filter((e) => !e.hasTest).length}`);

  // Output JSON to stdout
  process.stdout.write(JSON.stringify(endpoints, null, 2));
}

main();
