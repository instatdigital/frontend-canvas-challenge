import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import { buildApp } from '../apps/api/dist/app.js';

const app = await buildApp();
try {
  const spec = app.swagger();
  await SwaggerParser.validate(structuredClone(spec));
  const operations = Object.values(spec.paths).flatMap((path) => Object.values(path));
  assert.equal(operations.length, 27);
  assert.equal(new Set(operations.map((op) => op.operationId)).size, operations.length);
  for (const path of Object.values(spec.paths)) {
    assert.ok(path.options.responses['204']);
    if (path.get)
      for (const response of Object.values(path.head.responses)) assert.ok(!response.content);
  }
  const graph = spec.paths['/api/spaces/{spaceId}/graph'];
  assert.ok(graph.get.responses['200'].headers.ETag);
  assert.ok(graph.put.responses['200'].headers.ETag);
  assert.ok(graph.put.responses['412'] && graph.put.responses['428']);
  assert.ok(!graph.get.responses['304'].content);
  assert.ok(spec.paths['/assets/demo.svg'].get.responses['200'].content['image/svg+xml']);
  const out = JSON.stringify(spec, null, 2) + '\n';
  const file = new URL('../docs/openapi.json', import.meta.url);
  if (process.argv.includes('--write')) await writeFile(file, out);
  else assert.equal(await readFile(file, 'utf8'), out, 'Run npm run docs:generate.');
  console.log(
    'OpenAPI valid: 11 business operations, 8 HEAD, 8 OPTIONS; graph validators and asynchronous job documented.',
  );
} finally {
  await app.close();
}
