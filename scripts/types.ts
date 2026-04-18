export interface EndpointRoute {
  urlPath: string;
  routeFile: string;
  hasTest: boolean;
  testFile: string | null;
  domain: string;
  feature: string;
}

export interface HttpLogSummary {
  totalRequests: number;
  statusCodes: Record<string, number>;
  avgResponseTime: number;
  p95ResponseTime: number;
  errorRate: number;
  samples: HttpLogSample[];
}

export interface HttpLogSample {
  timestamp: string;
  statusCode: number;
  status: string;
  body: string;
  response: string;
  responseTime: number;
}

export interface ErrorSummary {
  count: number;
  topErrors: ErrorPattern[];
  sampleStacks: string[];
}

export interface ErrorPattern {
  errorCode: string;
  method: string;
  count: number;
  sampleError: string;
}

export interface ProviderSummary {
  interactions: ProviderInteraction[];
  totalCalls: number;
  failureRate: number;
}

export interface ProviderInteraction {
  provider: string;
  totalCalls: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  failureCount: number;
}

export interface DbQuerySummary {
  slowQueries: DbQueryPattern[];
  errorQueries: DbQueryPattern[];
  totalSlowCount: number;
  totalErrorCount: number;
}

export interface DbQueryPattern {
  functionName: string;
  type: string;
  count: number;
  avgMs: number;
  maxMs: number;
  sampleSql: string;
}

export interface BridgeSummary {
  total: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  errorPatterns: BridgeErrorPattern[];
}

export interface BridgeErrorPattern {
  providerName: string;
  productId: number | null;
  count: number;
  sampleResponse: string;
}

export interface DatasetAccessReport {
  accessible: { name: string; description: string }[];
  denied: { name: string; description: string }[];
  timestamp: string;
}

export interface EndpointAxiomData {
  endpoint: string;
  extractedAt: string;
  daysQueried: number;
  datasetsQueried: string[];
  datasetsDenied: string[];
  httpLogs: HttpLogSummary;
  errors: ErrorSummary;
  providers: ProviderSummary;
  dbQueries: DbQuerySummary;
  bridge: BridgeSummary;
}

export interface FrontendUsage {
  file: string;
  line: number;
  callExpression: string;
}

export interface CoverageGap {
  endpoint: string;
  routeFile: string;
  traffic: number;
  errorRate: number;
  priority: number;
  reason: string;
}

export interface CoverageReport {
  total: number;
  tested: number;
  untested: number;
  coveragePercent: number;
  gaps: CoverageGap[];
}
