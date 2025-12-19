import {Registry} from '@occultist/occultist';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CSSReferenceParser} from '../lib/static/css-parser.ts';
import {StaticExtension} from '../lib/static/static-extension.ts';
import type {Directory} from '../lib/static/types.ts';


const sampleDir: Directory = {
  alias: 'sample',
  path:  resolve(import.meta.dirname, 'sample'),
};


test('It collects dependencies for css files', { only: true }, async () => {
  const registry = new Registry({
    rootIRI: 'https://example.com',
  });
  const extension = new StaticExtension({
    registry,
    directories: [sampleDir],
    prefix: '/static',
  });
  
  await extension.load();

  const parser = new CSSReferenceParser();
  const file = extension.getFile('sample/fee.css');
  const deps = await parser.parse([file]);

  console.log(extension.dependancies.debug());
});

test('It registers static files', async () => {
  const registry = new Registry({
    rootIRI: 'https://example.com',
  });
  const extension = new StaticExtension({
    registry,
    directories: [sampleDir],
    prefix: '/static',
  });
  
  await extension.load();

  registry.finalize();

  const hint = extension.hint('sample/fee.css', { as: 'stylesheet' });
  const hash = await hashFile(resolve(sampleDir.path, 'fee.css'));
  const href = `https://example.com/static/fee-${hash}.css`;

  assert.equal(href, hint.href);
});


async function hashFile(file: string): Promise<string> {
  const content = await readFile(file);
  return createHash('sha256').update(content).digest('hex');
}
