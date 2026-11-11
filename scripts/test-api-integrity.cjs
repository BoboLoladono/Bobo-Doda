/** Isolated adapter regression tests. No HTTP, cookies, filesystem user data or providers. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');

function adapter(handler, initialSession = null, stored = {}, fetchHandler = async () => { throw new Error("Unexpected fetch"); }) {
  const calls = [], writes = [], cache = new Map();
  let session = initialSession;
  const storage = new Map(Object.entries(stored));
  const http = {
    http: async (url, options) => { calls.push({ url, options }); return handler(url, options); },
    toQuery: (query) => `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined))}`,
    sessionStore: { read: () => session, write: (value) => { writes.push(value); session = value; }, clear: () => { session = null; } },
    setAccessToken: () => {}, decodeJwtSub: () => 'server-user', refreshSession: async () => null,
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const compiledModule = { exports: {} }; cache.set(filename, compiledModule.exports);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const resolve = (name) => {
      if (name === './http') return http;
      if (name === '@/lib/mock-api') return {};
      if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
      const target = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      return load(`${target}.ts`);
    };
    const window = { location: { pathname:"/xaridor/yordam" }, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) }, dispatchEvent: () => {} };
    vm.runInNewContext(`(function(require,module,exports,window,localStorage,CustomEvent){${source}\n})`, { console, URLSearchParams, fetch: fetchHandler, crypto: require('node:crypto').webcrypto, setTimeout })(resolve, compiledModule, compiledModule.exports, window, window.localStorage, class CustomEvent {});
    return compiledModule.exports;
  }
  return { api: load(path.join(root, 'lib/api/client.ts')), errors: load(path.join(root, 'lib/api/errors.ts')), calls, writes, storage };
}

for (const status of [401, 403, 429, 500]) {
  test(`role selection rejects server ${status} without inventing a session`, async () => {
    let failure;
    const { api, errors, writes, calls } = adapter(async () => { throw failure; });
    failure = new errors.ApiError({code: status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 429 ? 'RATE_LIMITED' : 'UNKNOWN', status, message:'server rejected', retryable:false});
    await assert.rejects(api.authService.chooseRole('mutaxassis'));
    assert.equal(writes.length, 0); assert.equal(calls.length, 1);
  });
}
test('role selection saves only the server-issued identity', async () => {
  const { api, writes } = adapter(async () => ({ accessToken: 'jwt', activeRole: 'SELLER', profileDone: false }));
  await api.authService.chooseRole('mutaxassis');
  assert.equal(writes[0].userId, 'server-user'); assert.equal(writes[0].profileDone, false);
});
test('service creation preserves draft and requires explicit submit', async () => {
  const { api, calls } = adapter(async url => url === '/categories' ? [] : ({ id: 's1', sellerId:'seller', categoryId:'x', status:'DRAFT', price:1000 }));
  const service = await api.servicesService.create({ category:'dizayn', title:'Service', description:'Desc', price:1000, deliveryDays:1 });
  assert.equal(service.status, 'draft'); assert.equal(calls.filter(c => c.url.endsWith('/submit')).length, 0);
});
for (const operation of ['create', 'update', 'submit', 'remove', 'pause', 'resume']) {
  test(`service ${operation} propagates rejection despite forged local cache`, async () => {
    const { api } = adapter(async url => { if (url === '/categories') return []; throw new Error('rejected'); }, { userId:'u', role:'mutaxassis' }, { bbd_custom_services: JSON.stringify([{id:'s1',status:'active'}]) });
    const input = { category:'dizayn', title:'Service', description:'Desc', price:1000, deliveryDays:1 };
    await assert.rejects(operation === 'create' ? api.servicesService.create(input) : api.servicesService[operation]('s1', input));
  });
}
test('job and proposal writes fail instead of fabricating local successes', async () => {
  const { api } = adapter(async () => { throw new Error('rejected'); });
  await assert.rejects(api.jobsService.create({budgetMin:100000,budgetMax:200000,title:'Job',description:'Desc',category:'dizayn',skillsRequired:[],screeningQuestions:[]}));
  await assert.rejects(api.proposalsService.create({ jobId:'j', bidAmount:100000, coverLetter:'Letter', screeningAnswers:[], attachedImages:[] }));
  await assert.rejects(api.proposalsService.withdraw('p'));
});
test('unsupported operations fail closed and verified workflows route to authoritative backend', async () => {
  const { api, calls } = adapter(async () => { throw new Error('server rejected'); });
  // Truly unsupported operations fail closed immediately without remote calls
  await assert.rejects(api.proposalsService.setStatus('p', 'suhbat'));
  await assert.rejects(api.usersService.deleteAccount());
  assert.equal(calls.length, 0);

  // Authoritative hiring and KYC verification route to backend endpoints rather than fabricating local success
  await assert.rejects(api.proposalsService.hire('p', []));
  await assert.rejects(api.verificationService.submit({ documents: ['secret'] }));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/jobs/proposals/p/hire');
  assert.equal(calls[1].url, '/kyc/submit');
});
test('payout totals include every page and preserve a true zero', async () => {
  const { api, calls } = adapter(async url => ({ items: [{amount: url.includes('page=2') ? 200 : 100, status:'SUCCEEDED'}], totalPages:2 }), {role:'mutaxassis'});
  assert.equal(await api.paymentsService.getWithdrawnTotal(), 300); assert.equal(calls.length, 2);
});
test('financial reads reject outages rather than displaying zero or no disputes', async () => {
  const { api } = adapter(async () => { throw new Error('offline'); }, {role:'mutaxassis'});
  await assert.rejects(api.paymentsService.getWithdrawnTotal());
  await assert.rejects(api.paymentsService.getContractPayment('c'));
  await assert.rejects(api.disputesService.listMine());
});
test('profile PATCH failures are visible and never persisted as success', async () => {
  const { api, storage } = adapter(async () => { throw new Error('forbidden'); });
  await assert.rejects(api.usersService.updateUserProfile({fullName:'Changed'}));
  await assert.rejects(api.usersService.updateSellerProfile({fullName:'Changed'}));
  assert.equal(storage.size, 0);
});
test('cards from another account never appear via shared fallback', async () => {
  const { api } = adapter(async () => {}, {userId:'other'}, {bbd_cards_me:JSON.stringify([{last4:'1234'}])});
  assert.equal((await api.paymentsService.getCards()).length, 0);
});

test('unbound cards and payouts fail closed without contacting providers', async () => {
  const { api, calls } = adapter(async () => { throw new Error('must not call'); });
  await assert.rejects(api.paymentsService.addCard({number:'8600123412341234',expiry:'12/30',holderName:'Test'}));
  await assert.rejects(api.paymentsService.removeCard('local-card'));
  await assert.rejects(api.paymentsService.withdrawEarnings('local-card', 100.7));
  assert.equal(calls.length, 0);
});

test('support rejects failed delivery before persisting a success ticket', async () => {
  const { api, storage } = adapter(async () => {}, {userId:'user'}, {}, async () => ({ok:false,json:async () => ({error:'SERVER_MISCONFIGURED'})}));
  await assert.rejects(api.supportService.create({topic:'texnik',subject:'Help',message:'Description'}));
  assert.equal(storage.size, 0);
});
test('support persists history only after acknowledged delivery', async () => {
  let delivered = false;
  const { api, storage } = adapter(async () => {}, {userId:'user'}, {}, async () => {delivered = true; return {ok:true};});
  const ticket = await api.supportService.create({topic:'texnik',subject:'Help',message:'Description'});
  assert.equal(delivered, true); assert.equal(ticket.userId,'user');
  assert.equal(JSON.parse(storage.get('bbd_support_user'))[0].id,ticket.id);
});

test('browser payment snapshots cannot turn an unfunded contract into funded', async () => {
  const contract = {id:'c',buyerId:'b',sellerId:'s',status:'ACTIVE',isFunded:false,fundedAt:null,agreedAmount:1000,milestones:[]};
  const { api } = adapter(async () => contract, {role:'mutaxassis'}, {bbd_custom_contracts:JSON.stringify([{id:'c',fundedAt:'2026-01-01'}]),bbd_custom_payments:JSON.stringify([{contractId:'c',status:'SUCCEEDED'}])});
  const result = await api.contractsService.get('c');
  assert.equal(result.status,'imzolangan'); assert.equal(result.fundedAt,undefined);
});
test('seller can view another seller public service after owned endpoint NOT_FOUND', async () => {
  let missing;
  const { api, errors, calls } = adapter(async url => {
    if (url === '/categories') return [];
    if (url === '/seller/services/public') throw missing;
    return {id:'public',sellerId:'other',categoryId:'x',status:'ACTIVE',price:1000};
  }, {role:'mutaxassis'});
  missing = new errors.ApiError({code:'NOT_FOUND',status:404,message:'not found',retryable:false});
  assert.equal((await api.servicesService.get('public')).id,'public');
  assert.equal(calls[calls.length-1].url,'/services/public');
});
