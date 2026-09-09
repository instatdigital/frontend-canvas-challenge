import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildApp } from '../dist/app.js';
import { sampleGraph } from './fixtures.mjs';

async function harness(t, options = {}) {
  let now = Date.now();
  const app = await buildApp({ now: () => now, ...options });
  t.after(() => app.close());
  const spec = await SwaggerParser.dereference(structuredClone(app.swagger()));
  const ajv = addFormats(new Ajv({ strict: false }));
  const seen = new Set();
  async function call(method, url, payload, status = 200, extraHeaders = {}) {
    const response = await app.inject({ method, url, payload, headers: extraHeaders });
    assert.equal(response.statusCode, status, `${method} ${url}: ${response.body}`);
    const template = Object.keys(spec.paths).find((path) =>
      new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(url),
    );
    const operation = spec.paths[template]?.[method.toLowerCase()];
    assert.ok(operation, `${method} ${url} is not documented`);
    seen.add(`${method} ${template}`);
    const contract = operation.responses[status];
    assert.ok(contract, `${status} is not documented`);
    assert.match(response.headers['x-request-id'], /^[a-f0-9-]{36}$/);
    if (method === 'HEAD' || [204, 304].includes(status)) {
      assert.equal(response.body, '');
      assert.ok(!contract.content);
    } else {
      const media = response.headers['content-type'].split(';')[0];
      const value = media === 'application/json' ? response.json() : response.body;
      assert.ok(ajv.validate(contract.content[media].schema, value), JSON.stringify(ajv.errors));
    }
    if ([201, 202].includes(status))
      assert.ok(app.findRoute({ method: 'GET', url: response.headers.location }));
    return response;
  }
  const space = (await call('POST', '/api/spaces', { title: 'Тестовый канвас' }, 201)).json();
  const graphUrl = space.links.graph.href;
  const initial = await call('GET', graphUrl);
  const graph = sampleGraph();
  const saved = await call('PUT', graphUrl, graph, 200, { 'if-match': initial.headers.etag });
  const jobsUrl = space.links.generations.href;
  const body = { nodeId: graph.nodes[1].id, graphETag: saved.headers.etag, scenario: 'success' };
  return {
    app,
    call,
    spec,
    seen,
    space,
    graph,
    graphUrl,
    saved,
    jobsUrl,
    body,
    advance: (ms) => {
      now += ms;
    },
  };
}

test('all 11 operations, eight HEAD/OPTIONS routes and unsupported methods match the contract', async (t) => {
  const h = await harness(t);
  const started = await h.call('POST', h.jobsUrl, h.body, 202, { 'idempotency-key': randomUUID() });
  assert.equal(started.headers['retry-after'], '1');
  const paths = {
    '/api': ['GET'],
    '/api/config': ['GET'],
    '/api/spaces': ['GET', 'POST'],
    [h.space.links.self.href]: ['GET'],
    [h.graphUrl]: ['GET', 'PUT'],
    [h.jobsUrl]: ['GET', 'POST'],
    [started.headers.location]: ['GET'],
    '/assets/demo.svg': ['GET'],
  };
  for (const [url, methods] of Object.entries(paths)) {
    const get = await h.call('GET', url);
    const head = await h.call('HEAD', url);
    const conditionalGet = await h.call('GET', url, undefined, 304, { 'if-none-match': '*' });
    assert.equal(conditionalGet.headers['content-length'], get.headers['content-length']);
    const conditionalHead = await h.call('HEAD', url, undefined, 304, { 'if-none-match': '*' });
    assert.equal(conditionalHead.headers['content-length'], get.headers['content-length']);
    await h.call('GET', url, undefined, 412, { 'if-match': '"missing"' });
    assert.equal(head.headers['content-type'], get.headers['content-type']);
    assert.equal(head.headers['content-length'], get.headers['content-length']);
    const options = await h.call('OPTIONS', url, undefined, 204);
    assert.deepEqual(
      options.headers.allow.split(', ').sort(),
      [...methods, 'HEAD', 'OPTIONS'].sort(),
    );
    const wrong = await h.app.inject({ method: 'DELETE', url });
    assert.equal(wrong.statusCode, 405);
    assert.equal(wrong.headers.allow, options.headers.allow);
    assert.equal(wrong.json().error.code, 'METHOD_NOT_ALLOWED');
    await h.call('GET', url, {}, 400);
  }
  assert.equal(h.seen.size, 27);
  assert.equal(
    new Set(
      Object.values(h.spec.paths)
        .flatMap((path) => Object.values(path))
        .map((op) => op.operationId),
    ).size,
    27,
  );
});

test('graph validators protect replacement and preserve exact UTF-8 representation', async (t) => {
  const h = await harness(t);
  const raw =
    JSON.stringify({ ...h.graph, viewport: { x: 32, y: 18, zoom: 0.75 } }, null, 2) + '\n';
  const saved = await h.call('PUT', h.graphUrl, raw, 200, {
    'content-type': 'application/json',
    'if-match': h.saved.headers.etag,
  });
  assert.equal(saved.body, raw);
  const read = await h.call('GET', h.graphUrl);
  assert.equal(read.body, raw);
  assert.equal(read.headers.etag, saved.headers.etag);
  await h.call('GET', h.graphUrl, undefined, 304, { 'if-none-match': `W/${read.headers.etag}` });
  await h.call('HEAD', h.graphUrl, undefined, 304, { 'if-none-match': '*' });
  await h.call('PUT', h.graphUrl, h.graph, 428);
  await h.call('PUT', h.graphUrl, h.graph, 412, { 'if-match': h.saved.headers.etag });
  await h.call('PUT', h.graphUrl, h.graph, 412, { 'if-match': `W/${read.headers.etag}` });
  const replay = await h.call('PUT', h.graphUrl, raw, 200, {
    'content-type': 'application/json',
    'if-match': `"other,tag", ${read.headers.etag}`,
  });
  assert.equal(replay.headers.etag, read.headers.etag);
  await h.call('PUT', h.graphUrl, h.graph, 400, { 'if-match': 'invalid' });
  await h.call('GET', h.graphUrl, undefined, 412, { 'if-match': '"stale"' });
  await h.call('PUT', h.graphUrl, h.graph, 412, { 'if-match': '*', 'if-none-match': '*' });
  assert.equal((await h.call('GET', h.graphUrl)).body, raw);
});

test('invalid graphs cannot introduce dangling links, cycles, duplicate IDs or multiple inputs', async (t) => {
  const h = await harness(t);
  const variants = [
    (g) => {
      g.nodes.push(g.nodes[0]);
    },
    (g) => {
      g.edges[0].source = randomUUID();
    },
    (g) => {
      g.edges[0].source = g.nodes[2].id;
    },
    (g) => {
      g.edges[0].target = g.nodes[0].id;
    },
    (g) => {
      g.edges.push({ ...g.edges[0], id: randomUUID() });
    },
    (g) => {
      g.nodes.pop();
    },
  ];
  for (const mutate of variants) {
    const graph = structuredClone(h.graph);
    mutate(graph);
    assert.equal(
      (await h.call('PUT', h.graphUrl, graph, 422, { 'if-match': h.saved.headers.etag })).json()
        .error.code,
      'INVALID_GRAPH',
    );
  }
  const graph = structuredClone(h.graph);
  graph.nodes[0].selected = true;
  await h.call('PUT', h.graphUrl, graph, 400, { 'if-match': h.saved.headers.etag });
  assert.equal((await h.call('GET', h.graphUrl)).headers.etag, h.saved.headers.etag);
  const removed = {
    ...h.graph,
    nodes: h.graph.nodes.slice(0, 2),
    edges: h.graph.edges.slice(0, 1),
  };
  const saved = await h.call('PUT', h.graphUrl, removed, 200, { 'if-match': h.saved.headers.etag });
  await h.call('POST', h.jobsUrl, { ...h.body, graphETag: saved.headers.etag }, 422, {
    'idempotency-key': randomUUID(),
  });
});

test('generation uses the saved snapshot; failure and retry keep their own results', async (t) => {
  const h = await harness(t);
  const failBody = { ...h.body, scenario: 'failure' };
  const key = randomUUID();
  const first = await h.call('POST', h.jobsUrl, failBody, 202, { 'idempotency-key': key });
  const duplicate = await h.call('POST', h.jobsUrl, failBody, 202, { 'idempotency-key': key });
  assert.equal(first.json().id, duplicate.json().id);
  await h.call('POST', h.jobsUrl, h.body, 409, { 'idempotency-key': key });
  await h.call('POST', h.jobsUrl, h.body, 409, { 'idempotency-key': randomUUID() });
  const changed = structuredClone(h.graph);
  changed.nodes[0].data.text = 'Новое описание';
  const saved = await h.call('PUT', h.graphUrl, changed, 200, { 'if-match': h.saved.headers.etag });
  h.advance(1600);
  const failure = await h.call('GET', first.headers.location);
  assert.equal(failure.json().status, 'failed');
  assert.equal(failure.json().imageUrl, null);
  assert.equal(failure.json().prompt, h.graph.nodes[0].data.text);
  assert.equal(
    (await h.call('POST', h.jobsUrl, failBody, 200, { 'idempotency-key': key })).json().id,
    first.json().id,
  );
  assert.equal(
    (await h.call('POST', h.jobsUrl, h.body, 409, { 'idempotency-key': randomUUID() })).json().error
      .code,
    'GRAPH_CHANGED',
  );
  const success = await h.call(
    'POST',
    h.jobsUrl,
    { ...h.body, graphETag: saved.headers.etag },
    202,
    { 'idempotency-key': randomUUID() },
  );
  h.advance(1600);
  const result = (await h.call('GET', success.headers.location)).json();
  assert.equal(result.status, 'succeeded');
  assert.equal(result.prompt, 'Новое описание');
  assert.equal(result.resultNodeId, h.graph.nodes[2].id);
  assert.equal((await h.call('GET', result.imageUrl)).headers['content-type'], 'image/svg+xml');
  assert.equal((await h.call('GET', h.jobsUrl)).json().length, 2);
});

test('concurrent duplicate starts create one generation and reject another active job', async (t) => {
  const h = await harness(t);
  const key = randomUUID();
  const replies = await Promise.all([
    h.call('POST', h.jobsUrl, h.body, 202, { 'idempotency-key': key }),
    h.call('POST', h.jobsUrl, h.body, 202, { 'idempotency-key': key }),
  ]);
  assert.equal(replies[0].json().id, replies[1].json().id);
  assert.equal((await h.call('GET', h.jobsUrl)).json().length, 1);
});

test('restart retains graph, ETag, jobs and idempotency; reading completion never writes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'store.json');
  const h = await harness(t, { dataFile: file });
  const key = randomUUID();
  const job = await h.call('POST', h.jobsUrl, h.body, 202, { 'idempotency-key': key });
  const before = await readFile(file);
  const meta = await stat(file, { bigint: true });
  h.advance(2000);
  assert.equal((await h.call('GET', h.jobsUrl)).json()[0].status, 'succeeded');
  await h.call('HEAD', job.headers.location);
  await h.call('OPTIONS', job.headers.location, undefined, 204);
  assert.deepEqual(await readFile(file), before);
  assert.equal((await stat(file, { bigint: true })).mtimeNs, meta.mtimeNs);
  assert.equal((await stat(file, { bigint: true })).ino, meta.ino);
  await h.app.close();
  const reopened = await buildApp({ dataFile: file, now: () => Date.now() + 10000 });
  t.after(() => reopened.close());
  const graph = await reopened.inject({ method: 'GET', url: h.graphUrl });
  assert.equal(graph.headers.etag, h.saved.headers.etag);
  const replay = await reopened.inject({
    method: 'POST',
    url: h.jobsUrl,
    payload: h.body,
    headers: { 'idempotency-key': key },
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().id, job.json().id);
  assert.equal(replay.json().status, 'succeeded');
});

test('body errors, resource isolation, CORS and Swagger assets return correct HTTP responses', async (t) => {
  const h = await harness(t);
  for (const [payload, contentType, status] of [
    ['{}', 'text/plain', 415],
    ['{', 'application/json', 400],
    [JSON.stringify({ title: 'x'.repeat(70000) }), 'application/json', 413],
    [Buffer.from([0xff]), 'application/json', 400],
  ]) {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/spaces',
      payload,
      headers: { 'content-type': contentType },
    });
    assert.equal(response.statusCode, status);
  }
  const badRead = await h.app.inject({ method: 'GET', url: h.graphUrl, payload: {} });
  assert.equal(badRead.statusCode, 400);
  const other = (await h.call('POST', '/api/spaces', { title: 'Другое пространство' }, 201)).json();
  const job = (
    await h.call('POST', h.jobsUrl, h.body, 202, { 'idempotency-key': randomUUID() })
  ).json();
  await h.call('GET', `${other.links.generations.href}/${job.id}`, undefined, 404);
  const preflight = await h.app.inject({
    method: 'OPTIONS',
    url: h.graphUrl,
    headers: {
      origin: 'http://localhost:5173',
      'access-control-request-method': 'PUT',
      'access-control-request-headers': 'if-match,content-type',
    },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.match(preflight.headers['access-control-allow-headers'], /If-Match/i);
  assert.match((await h.call('GET', h.graphUrl)).headers['access-control-expose-headers'], /ETag/);
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'DELETE'])
    assert.equal((await h.app.inject({ method, url: '/unknown' })).statusCode, 404);
  for (const url of ['/docs/', '/docs/static/swagger-ui-bundle.js', '/openapi.json', '/health']) {
    assert.equal((await h.app.inject({ method: 'GET', url })).statusCode, 200);
    assert.equal((await h.app.inject({ method: 'HEAD', url })).body, '');
    assert.equal((await h.app.inject({ method: 'POST', url })).statusCode, 405);
  }
});

test('a zero-delay generation returns 201 with Location, then 200 for a completed replay', async (t) => {
  const h = await harness(t, { generationDelayMs: 0 });
  const key = randomUUID();
  const created = await h.call('POST', h.jobsUrl, h.body, 201, { 'idempotency-key': key });
  assert.equal(created.json().status, 'succeeded');
  assert.equal(created.headers['retry-after'], undefined);
  const replay = await h.call('POST', h.jobsUrl, h.body, 200, { 'idempotency-key': key });
  assert.equal(replay.json().id, created.json().id);
});

test('conditional creation does not write; missing parents remain 404', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-conditions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'store.json');
  const h = await harness(t, { dataFile: file });
  const before = await readFile(file, 'utf8');
  await h.call('POST', '/api/spaces', { title: 'Blocked' }, 412, { 'if-none-match': '*' });
  await h.call('POST', h.jobsUrl, h.body, 412, {
    'if-none-match': '*',
    'idempotency-key': randomUUID(),
  });
  assert.equal(await readFile(file, 'utf8'), before);
  const missing = `/api/spaces/${randomUUID()}`;
  await h.call('GET', missing, undefined, 404, { 'if-none-match': '*' });
  await h.call('POST', `${missing}/generations`, h.body, 404, {
    'if-none-match': '*',
    'idempotency-key': randomUUID(),
  });
  const rejected = await h.call('GET', h.graphUrl, undefined, 412, { 'if-match': '"missing"' });
  assert.equal(rejected.headers.etag, undefined);
  assert.equal(rejected.headers['cache-control'], 'no-store');
});

test('request coding and empty ETag list members follow HTTP semantics', async (t) => {
  const h = await harness(t);
  for (const [method, url, body] of [
    ['POST', '/api/spaces', { title: 'Blocked' }],
    ['PUT', h.graphUrl, h.graph],
  ]) {
    const rejected = await h.call(method, url, body, 415, {
      'content-encoding': 'gzip',
      'if-match': h.saved.headers.etag,
    });
    assert.equal(rejected.json().error.code, 'UNSUPPORTED_CONTENT_ENCODING');
    assert.equal(rejected.headers['accept-encoding'], 'identity');
  }
  await h.call('GET', h.graphUrl, undefined, 304, {
    'if-none-match': `, W/${h.saved.headers.etag},,`,
  });
  await h.call('PUT', h.graphUrl, h.graph, 200, {
    'if-match': `, "other,tag", ${h.saved.headers.etag},,`,
  });
  await h.call('GET', h.graphUrl, undefined, 200, { 'if-none-match': '' });
  await h.call('GET', h.graphUrl, undefined, 412, { 'if-match': '' });
  await h.call('GET', h.graphUrl, undefined, 400, { 'if-match': '*, "other"' });
});
