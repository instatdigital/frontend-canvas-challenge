import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const env = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(env)) process.loadEnvFile(env);
const port = Number(process.env.PORT ?? 4001);
const delay = Number(process.env.GENERATION_DELAY_MS ?? 1500);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
if (!Number.isInteger(delay) || delay < 0 || delay > 30000)
  throw new Error('Invalid GENERATION_DELAY_MS.');
const app = await buildApp({
  dataFile:
    process.env.DATA_FILE ?? fileURLToPath(new URL('../../../.data/store.json', import.meta.url)),
  generationDelayMs: delay,
  logger: true,
  corsOrigins: process.env.CORS_ORIGINS?.split(',')
    .map((value) => value.trim())
    .filter(Boolean),
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port });
