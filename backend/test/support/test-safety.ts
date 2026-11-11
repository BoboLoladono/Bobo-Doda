/** Destructive DB reset and Redis FLUSHALL require dedicated local test services. */
export function assertIsolatedTestInfra(pgUrl: string, redisUrl: string, database?: string): void {
  if (process.env.E2E_ISOLATED_INFRA !== 'true') {
    throw new Error('Set E2E_ISOLATED_INFRA=true only for disposable local PostgreSQL and Redis; tests reset databases and FLUSHALL Redis.');
  }
  for (const raw of [pgUrl, redisUrl]) {
    const host = new URL(raw).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      throw new Error('Destructive integration tests require loopback test services.');
    }
  }
  if (database !== undefined && !/^[a-z_][a-z0-9_]*_e2e$/.test(database)) {
    throw new Error('Destructive integration database names must end in _e2e.');
  }
}
