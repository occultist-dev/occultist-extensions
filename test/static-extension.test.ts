import {Registry} from '@occultist/occultist';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {StaticExtension} from '../lib/static/static-extension.ts';
import type {Directory} from '../lib/static/types.ts';


const sampleDir: Directory = {
  alias: 'sample',
  path:  resolve(import.meta.dirname, 'sample'),
};

test('It preprocesses typescript files', {only: true}, async () => {
  const registry = new Registry({
    rootIRI: 'https://example.com',
  });

  const extension = new StaticExtension({
    registry,
    directories: [sampleDir],
    prefix: '/static',
  });
  
  await registry.setupExtensions();
  const main = extension.getFile('sample/main.ts');
  const foo = extension.getFile('sample/foo.js');
  const fee = extension.getFile('sample/fee.js');

  const res = await registry.handleRequest(
    new Request(main.url)
  );
});

test('It parses HTML files', async () => {
  const registry = new Registry({
    rootIRI: 'https://example.com',
  });

  const extension = new StaticExtension({
    registry,
    directories: [sampleDir],
    prefix: '/static',
  });
  
  await registry.setupExtensions();
  const html = extension.getFile('sample/index.en.html');
  const foo = extension.getFile('sample/foo.js');
  const fee = extension.getFile('sample/fee.js');

  const res = await registry.handleRequest(
    new Request(html.url)
  );
});

test('It parses javascript files', async () => {
  const registry = new Registry({
    rootIRI: 'https://example.com',
  });

  const extension = new StaticExtension({
    registry,
    directories: [sampleDir],
    prefix: '/static',
  });
  
  await registry.setupExtensions();
  const foo = extension.getFile('sample/foo.js');
  const fee = extension.getFile('sample/fee.js');

  const res = await registry.handleRequest(
    new Request(foo.url)
  );

  const text = await res.text();
  const parts = text.split(encodeURI(fee.url));

  assert.equal(parts.length, 3);

});


test('It updates hyperlinks to their static immutable form', async () => {
  const registry = new Registry({
    rootIRI: 'https://example.com',
  });

  const extension = new StaticExtension({
    registry,
    directories: [sampleDir],
    prefix: '/static',
  });
  
  await registry.setupExtensions();

  const fee = extension.getFile('sample/fee.css');
  const fie = extension.getFile('sample/fie.css');
  const foo = extension.getFile('sample/foo.png');

  const res = await registry.handleRequest(new Request(fee.url));
  const text = await res.text();

  assert(text.includes(fie.url));
  assert(text.includes(foo.url));
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
  
  await registry.setupExtensions();

  const hint = extension.hint('sample/fee.css', { as: 'stylesheet' });
  const hash = await hashFile(resolve(sampleDir.path, 'fee.css'));
  const href = `https://example.com/static/fee-${hash}`;

  assert.equal(href, hint.href);
});


async function hashFile(file: string): Promise<string> {
  const content = await readFile(file);
  return createHash('sha1').update(content).digest('hex');
}
