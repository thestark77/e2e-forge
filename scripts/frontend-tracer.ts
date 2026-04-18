import * as fs from 'fs';
import * as path from 'path';
import type { FrontendUsage } from './types';

function parseArgs(): { endpoint: string; frontendDir: string; adminDir: string } {
  const args = process.argv.slice(2);
  let endpoint = '';
  let frontendDir = '../frontend/src';
  let adminDir = '../admin/src';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--endpoint':
        endpoint = args[++i] || '';
        break;
      case '--frontend-dir':
        frontendDir = args[++i] || frontendDir;
        break;
      case '--admin-dir':
        adminDir = args[++i] || adminDir;
        break;
    }
  }

  if (!endpoint) {
    console.error('Usage: npx tsx frontend-tracer.ts --endpoint auth/login [--frontend-dir PATH] [--admin-dir PATH]');
    process.exit(1);
  }

  // Fix MSYS/Git Bash path mangling: /auth/login -> C:/Program Files/Git/auth/login
  // Also normalize by stripping leading slash if present
  endpoint = endpoint
    .replace(/^[A-Z]:\/Program Files\/Git\//i, '/')
    .replace(/^\//, '');

  return {
    endpoint,
    frontendDir: path.resolve(frontendDir),
    adminDir: path.resolve(adminDir),
  };
}

const EXTENSIONS = new Set(['.ts', '.vue', '.js']);

function collectFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(fullPath);
      } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

function searchFile(filePath: string, searchPattern: string): FrontendUsage[] {
  const usages: FrontendUsage[] = [];
  let content: string;

  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return usages;
  }

  // Build regex to find postRequest('auth/login' ...) calls
  const escapedPattern = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`postRequest\\(['"]${escapedPattern}['"][^)]*\\)`, 'g');

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;
    // Reset regex for each line
    regex.lastIndex = 0;

    while ((match = regex.exec(line)) !== null) {
      usages.push({
        file: filePath,
        line: i + 1,
        callExpression: match[0].trim(),
      });
    }
  }

  return usages;
}

function main(): void {
  const { endpoint, frontendDir, adminDir } = parseArgs();

  // endpoint already has leading slash stripped by parseArgs
  const searchPattern = endpoint;

  console.error(`[frontend-tracer] Searching for: postRequest('${searchPattern}', ...)`);

  const allUsages: FrontendUsage[] = [];
  const dirs = [
    { label: 'frontend', path: frontendDir },
    { label: 'admin', path: adminDir },
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir.path)) {
      console.error(`[frontend-tracer] WARN: ${dir.label} directory not found: ${dir.path} (skipping)`);
      continue;
    }

    console.error(`[frontend-tracer] Scanning ${dir.label}: ${dir.path}`);
    const files = collectFiles(dir.path);
    console.error(`[frontend-tracer]   Found ${files.length} source files`);

    for (const file of files) {
      const usages = searchFile(file, searchPattern);
      allUsages.push(...usages);
    }
  }

  console.error(`[frontend-tracer] Total usages found: ${allUsages.length}`);

  // Output JSON to stdout
  process.stdout.write(JSON.stringify(allUsages, null, 2));
}

main();
