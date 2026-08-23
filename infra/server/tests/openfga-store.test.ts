/**
 * Unit tests for the OpenFGA store (D-017).
 *
 * The store talks to OpenFGA over HTTP via the official SDK. These tests run a
 * tiny in-process fake OpenFGA server implementing just the endpoints the SDK
 * uses (listStores, createStore, writeAuthorizationModel, write, check,
 * list-objects) so the store's provisioning + tuple + check logic is exercised
 * without a real OpenFGA instance.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http, { IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { OpenFgaStore, OPENFGA_MODEL } from '../src/openfga-store.js';

// ---- Fake OpenFGA server --------------------------------------------------

// ULIDs are 26 chars from Crockford's base32; the first char encodes the top
// bits of the 48-bit timestamp and must be 0-7. The SDK validates storeId and
// modelId are well-formed ULIDs, so the fake must mint real-looking ones.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // pragma: allowlist secret (Crockford base32 alphabet, not a credential)
function ulid(): string {
  let out = CROCKFORD[Math.floor(Math.random() * 8)]; // timestamp prefix: 0-7
  for (let i = 0; i < 25; i++) out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  return out;
}

interface Tuple {
  user: string;
  relation: string;
  object: string;
}

class FakeOpenFga {
  stores: Array<{ id: string; name: string }> = [];
  models: Map<string, unknown> = new Map(); // storeId -> model
  tuples: Tuple[] = [];

  createStore(name: string): { id: string; name: string } {
    const store = { id: ulid(), name };
    this.stores.push(store);
    return store;
  }

  writeModel(storeId: string): string {
    const modelId = ulid();
    this.models.set(storeId, OPENFGA_MODEL);
    return modelId;
  }

  check(user: string, relation: string, object: string): boolean {
    // owner -> operator -> viewer inheritance, matching the model.
    const has = (rel: string): boolean =>
      this.tuples.some((t) => t.user === user && t.relation === rel && t.object === object);
    if (relation === 'owner') return has('owner');
    if (relation === 'operator') return has('operator') || has('owner');
    if (relation === 'viewer') return has('viewer') || has('operator') || has('owner');
    return false;
  }

  listObjects(user: string, relation: string, type: string): string[] {
    // Real OpenFGA computes the closure (owner -> operator -> viewer). The
    // fake mirrors that: a tuple on a stronger relation also grants the weaker
    // ones, so listObjects(viewer) includes owner/operator tuples.
    const direct = (rel: string): Set<string> =>
      new Set(
        this.tuples
          .filter((t) => t.user === user && t.relation === rel && t.object.startsWith(`${type}:`))
          .map((t) => t.object),
      );
    const owner = direct('owner');
    const operator = new Set([...direct('operator'), ...owner]);
    const viewer = new Set([...direct('viewer'), ...operator]);
    if (relation === 'owner') return Array.from(owner);
    if (relation === 'operator') return Array.from(operator);
    return Array.from(viewer);
  }
}

function startFake(): Promise<{ server: http.Server; port: number; fake: FakeOpenFga }> {
  const fake = new FakeOpenFga();
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const json = (code: number, obj: unknown): void => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };

      // POST /stores
      if (req.method === 'POST' && url.pathname === '/stores') {
        const { name } = JSON.parse(body) as { name: string };
        return json(201, fake.createStore(name));
      }
      // GET /stores
      if (req.method === 'GET' && url.pathname === '/stores') {
        return json(200, { stores: fake.stores, continuation_token: '' });
      }
      // POST /stores/{store_id}/authorization-models
      const authModelMatch = url.pathname.match(/^\/stores\/([^/]+)\/authorization-models$/);
      if (req.method === 'POST' && authModelMatch) {
        return json(201, { authorization_model_id: fake.writeModel(authModelMatch[1]) });
      }
      // POST /stores/{store_id}/write
      const writeMatch = url.pathname.match(/^\/stores\/([^/]+)\/write$/);
      if (req.method === 'POST' && writeMatch) {
        const { writes, deletes } = JSON.parse(body) as {
          writes?: { tuple_keys?: Tuple[] };
          deletes?: { tuple_keys?: Tuple[] };
        };
        for (const t of writes?.tuple_keys ?? []) fake.tuples.push(t);
        if (deletes?.tuple_keys) {
          fake.tuples = fake.tuples.filter(
            (t) => !deletes.tuple_keys!.some(
              (d) => d.object === t.object && (d.user === t.user || d.user === 'user:*') && d.relation === t.relation,
            ),
          );
        }
        return json(200, {});
      }
      // POST /stores/{store_id}/check
      const checkMatch = url.pathname.match(/^\/stores\/([^/]+)\/check$/);
      if (req.method === 'POST' && checkMatch) {
        const { tuple_key } = JSON.parse(body) as { tuple_key: Tuple };
        return json(200, { allowed: fake.check(tuple_key.user, tuple_key.relation, tuple_key.object) });
      }
      // POST /stores/{store_id}/list-objects
      const listMatch = url.pathname.match(/^\/stores\/([^/]+)\/list-objects$/);
      if (req.method === 'POST' && listMatch) {
        const { user, relation, type } = JSON.parse(body) as { user: string; relation: string; type: string };
        return json(200, { objects: fake.listObjects(user, relation, type) });
      }
      return json(404, { code: 'not_found' });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port, fake });
    });
  });
}

// ---- Tests ----------------------------------------------------------------

test('provision creates a store and writes the authorization model', async () => {
  const { server, port, fake } = await startFake();
  try {
    const store = new OpenFgaStore({ enabled: true, endpoint: `http://127.0.0.1:${port}` });
    const { storeId, modelId } = await store.provision();
    assert.ok(storeId.length === 26);
    assert.ok(modelId.length === 26);
    assert.equal(fake.stores.length, 1);
    assert.equal(fake.models.has(storeId), true);
    // Second provision reuses the existing store (no duplicate).
    const again = await store.provision();
    assert.equal(again.storeId, storeId);
    assert.equal(fake.stores.length, 1);
  } finally {
    server.close();
  }
});

test('writeOwner creates an owner tuple and check() answers it', async () => {
  const { server, port, fake } = await startFake();
  try {
    const store = new OpenFgaStore({ enabled: true, endpoint: `http://127.0.0.1:${port}` });
    await store.provision();
    await store.writeOwner('user-1', 'conn-1');
    assert.equal(fake.tuples.length, 1);
    assert.deepEqual(fake.tuples[0], { user: 'user:user-1', relation: 'owner', object: 'connection:conn-1' });

    assert.equal(await store.check('user-1', 'owner', 'conn-1'), true);
    assert.equal(await store.check('user-1', 'operator', 'conn-1'), true); // owner implies operator
    assert.equal(await store.check('user-1', 'viewer', 'conn-1'), true); // owner implies viewer
    assert.equal(await store.check('user-2', 'viewer', 'conn-1'), false);
  } finally {
    server.close();
  }
});

test('deleteTuplesForConnection removes tuples so check() denies', async () => {
  const { server, port, fake } = await startFake();
  try {
    const store = new OpenFgaStore({ enabled: true, endpoint: `http://127.0.0.1:${port}` });
    await store.provision();
    await store.writeOwner('user-1', 'conn-1');
    assert.equal(await store.check('user-1', 'viewer', 'conn-1'), true);
    await store.deleteTuplesForConnection('conn-1');
    assert.equal(fake.tuples.length, 0);
    assert.equal(await store.check('user-1', 'viewer', 'conn-1'), false);
  } finally {
    server.close();
  }
});

test('listViewableConnectionIds returns only granted connections', async () => {
  const { server, port, fake } = await startFake();
  try {
    const store = new OpenFgaStore({ enabled: true, endpoint: `http://127.0.0.1:${port}` });
    await store.provision();
    await store.writeOwner('user-1', 'conn-1');
    await store.writeOwner('user-1', 'conn-2');
    // Grant user-2 viewer on conn-2 directly (forward-looking sharing).
    fake.tuples.push({ user: 'user:user-2', relation: 'viewer', object: 'connection:conn-2' });

    const forUser1 = await store.listViewableConnectionIds('user-1');
    assert.deepEqual(forUser1!.sort(), ['conn-1', 'conn-2']);
    const forUser2 = await store.listViewableConnectionIds('user-2');
    assert.deepEqual(forUser2, ['conn-2']);
  } finally {
    server.close();
  }
});

test('disabled store is a no-op passthrough (owner-scoped behavior preserved)', async () => {
  const store = new OpenFgaStore({ enabled: false, endpoint: 'http://127.0.0.1:1' });
  assert.equal(await store.check('user-1', 'viewer', 'conn-1'), true);
  assert.equal(await store.listViewableConnectionIds('user-1'), null);
  assert.equal(await store.ping(), false);
  const provisioned = await store.provision();
  assert.deepEqual(provisioned, { storeId: '', modelId: '' });
  await store.writeOwner('user-1', 'conn-1'); // must not throw
});
