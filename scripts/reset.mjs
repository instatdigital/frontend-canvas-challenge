import { rm } from 'node:fs/promises';

await rm(new URL('../.data/', import.meta.url), { recursive: true, force: true });
console.log('Local data removed.');
