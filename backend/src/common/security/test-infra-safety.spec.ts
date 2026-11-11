import { assertIsolatedTestInfra } from '../../../test/support/test-safety';

describe('destructive integration safety', () => {
  const pg = 'postgresql://test:test@127.0.0.1:55439/postgres';
  const redis = 'redis://127.0.0.1:56389';
  const previous = process.env.E2E_ISOLATED_INFRA;
  afterEach(() => { if (previous === undefined) delete process.env.E2E_ISOLATED_INFRA; else process.env.E2E_ISOLATED_INFRA = previous; });
  it('requires an explicit disposable infrastructure declaration', () => {
    delete process.env.E2E_ISOLATED_INFRA;
    expect(() => assertIsolatedTestInfra(pg, redis)).toThrow('E2E_ISOLATED_INFRA');
  });
  it('rejects remote database and Redis endpoints even with opt-in', () => {
    process.env.E2E_ISOLATED_INFRA = 'true';
    expect(() => assertIsolatedTestInfra(pg.replace('127.0.0.1', 'database.example'), redis)).toThrow('loopback');
    expect(() => assertIsolatedTestInfra(pg, 'redis://cache.example')).toThrow('loopback');
  });
  it('refuses database injection or names without the test suffix', () => {
    process.env.E2E_ISOLATED_INFRA = 'true';
    for (const name of ['production', 'postgres', 'health_e2e"; DROP DATABASE postgres;--']) {
      expect(() => assertIsolatedTestInfra(pg, redis, name)).toThrow('_e2e');
    }
    expect(() => assertIsolatedTestInfra(pg, redis, 'health_e2e')).not.toThrow();
  });
});
