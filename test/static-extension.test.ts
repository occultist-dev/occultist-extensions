import {Registry} from '@occultist/occultist';
import {resolve} from 'node:path';
import test from 'node:test';
import {StaticExtension} from '../lib/static/static-extension.ts';

const samplesDir = resolve(import.meta.dirname, 'sample');

test('It registers static files', async () => {
  const registry = new Registry({
    rootIRI: 'https://example.com',
  });
  const extension = new StaticExtension({
    registry,
    directories: [samplesDir],
    prefix: '/cache',
  });
  
  const stream = extension.load();

  for await (const message of stream) {
    console.log(message);
  }

  registry.finalize();

  console.log(registry.handlers);
});
