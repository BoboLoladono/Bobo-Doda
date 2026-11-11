import { buildStaffAwareCorsDelegate } from './cors';

describe('staff CORS isolation', () => {
  it('uses only the configured staff allowlist, never implicit public apex domains', () => {
    const delegate = buildStaffAwareCorsDelegate({
      corsOrigins: ['https://bobododa.uz'], staffCorsOrigins: ['https://admin.example.test'],
    }, '/api/v1/staff');
    const callback = jest.fn();
    delegate({ url: '/API/V1/STAFF/users' }, callback);
    expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ origin: ['https://admin.example.test'] }));
  });
  it('preserves the separate marketplace allowlist', () => {
    const delegate = buildStaffAwareCorsDelegate({
      corsOrigins: ['https://app.example.test'], staffCorsOrigins: ['https://admin.example.test'],
    }, '/api/v1/staff');
    const callback = jest.fn();
    delegate({ url: '/api/v1/jobs' }, callback);
    expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ origin: ['https://app.example.test'] }));
  });
});
