import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { sampleGraph } from '../apps/api/test/fixtures.mjs';

const base = (process.env.BASE_URL ?? 'http://localhost:4001').replace(/\/$/, '');
const spec = await SwaggerParser.validate(await (await fetch(`${base}/openapi.json`)).json());
const ajv = addFormats(new Ajv({ strict: false }));
async function call(method, path, body, expected = 200, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, expected, `${method} ${path}`);
  const data = await response.json();
  const template = Object.keys(spec.paths).find((route) =>
    new RegExp(`^${route.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path),
  );
  assert.ok(
    ajv.validate(
      spec.paths[template][method.toLowerCase()].responses[expected].content['application/json']
        .schema,
      data,
    ),
    JSON.stringify(ajv.errors),
  );
  return { data, response };
}
const config = (await call('GET', '/api/config')).data;
const space = (await call('POST', '/api/spaces', { title: 'Проверка HTTP' }, 201)).data;
const graphUrl = space.links.graph.href;
const initial = await call('GET', graphUrl);
const graph = sampleGraph();
const saved = await call('PUT', graphUrl, graph, 200, {
  'If-Match': initial.response.headers.get('etag'),
});
const graphETag = saved.response.headers.get('etag');
assert.deepEqual((await call('GET', graphUrl)).data, graph);
await call('PUT', graphUrl, graph, 412, { 'If-Match': initial.response.headers.get('etag') });
await call('PUT', graphUrl, graph, 428);
for (const [scenario, expected] of [
  ['failure', 'failed'],
  ['success', 'succeeded'],
]) {
  const body = { nodeId: graph.nodes[1].id, graphETag, scenario };
  const key = randomUUID();
  const first = await call(
    'POST',
    space.links.generations.href,
    body,
    config.generationDelayMs === 0 ? 201 : 202,
    { 'Idempotency-Key': key },
  );
  const statusUrl = first.response.headers.get('location');
  const deadline = Date.now() + config.generationDelayMs + 5000;
  let job = first.data;
  while (job.status === 'processing' && Date.now() < deadline) {
    await pause(config.pollIntervalMs);
    job = (await call('GET', statusUrl)).data;
  }
  assert.equal(job.status, expected);
  assert.equal(job.prompt, graph.nodes[0].data.text);
  assert.equal(job.resultNodeId, graph.nodes[2].id);
  const duplicate = (
    await call('POST', space.links.generations.href, body, 200, { 'Idempotency-Key': key })
  ).data;
  assert.equal(duplicate.id, first.data.id);
  if (job.imageUrl) {
    const image = await fetch(`${base}${job.imageUrl}`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type'), /^image\/svg\+xml/);
    assert.match(await image.text(), /<svg/);
  }
}
assert.equal((await call('GET', space.links.generations.href)).data.length, 2);
console.log(
  'PASS: real HTTP graph save/restore, stale and missing preconditions, failed generation, successful retry, image fetch and idempotency; JSON responses match live OpenAPI.',
);
