import {readFile} from "fs/promises";
import {DependancyMap} from "./dependancy-graph.ts";
import {type FileInfo} from "./file-info.ts";
import type {PolicyDirective, ReferenceDetails, ReferenceParser} from "./types.ts";
import { JSDOM } from 'jsdom';


const asMap: Record<string, PolicyDirective> = {
  audio: 'media-src',
  document: 'frame-src',
  embed: 'object-src',
  fetch: 'connect-src',
  font: 'font-src',
  image: 'img-src',
  object: 'object-src',
  script: 'script-src',
  style: 'style-src',
  track: 'media-src',
  video: 'media-src',
  worker: 'worker-src',
};

export type HTMLParserArgs = {
  contentType?: string | string[];
};

export class HTMLParser implements ReferenceParser {
  contentTypes: string[] = [
    'text/html',
    'application/xhtml+xml',
  ];

  constructor(args: HTMLParserArgs = {}) {
    if (Array.isArray(args?.contentType)) {
      this.contentTypes = args.contentType;
    } else if (args?.contentType != null) {
      this.contentTypes = [args.contentType];
    }
  }

  async parse(filesByURL: Map<string, FileInfo>): Promise<Map<string, DependancyMap>> {
    let data: string;
    let references: ReferenceDetails[];
    let dependancyMap: Map<string, DependancyMap> = new Map();
    
    for (const [url, file] of filesByURL.entries()) {
      if (!this.contentTypes.includes(file.contentType)) continue;

      data = await readFile(file.absolutePath, 'utf-8');
      references = this.parseReferences(url, data, filesByURL);
      dependancyMap.set(file.alias, new DependancyMap(file, references));
    }

    return dependancyMap;
  }

  parseReferences(
    base: string,
    content: string,
    filesByURL: Map<string, FileInfo>,
  ): ReferenceDetails[] {
    let references: ReferenceDetails[] = [];
    let src: string;
    let rel: string;
    let as: string;
    let url: string;
    const dom = new JSDOM(content);
    const document = dom.window.document;

    for (const element of document.querySelectorAll('link')) {
      src = element.getAttribute('src');
      rel = element.getAttribute('rel');
      as = element.getAttribute('as');
      url = new URL(src, base).toString();

      if (rel === 'stylesheet') {
        references.push({
          url,
          directive: 'style-src',
          file: filesByURL.get(url),
        });

        continue;
      }

      if (Object.hasOwn(asMap, as)) {
        references.push({
          url,
          directive: asMap[as],
          file: filesByURL.get(url),
        });

        continue;
      }
        
      references.push({
        url,
        file: filesByURL.get(url),
      });
    }

    for (const element of [
      ...document.querySelectorAll('img'),
      ...document.querySelectorAll('picture source'),
    ]) {
      src = element.tagName.toLowerCase() === 'source'
        ? element.getAttribute('srcset')
        : element.getAttribute('src')

      if (src == null) {
        continue;
      }

      url = new URL(src, base).toString();

      references.push({
        url,
        directive: 'img-src',
        file: filesByURL.get(url),
      });
    }

    for (const element of [
      ...document.querySelectorAll('track'),
      ...document.querySelectorAll('audio'),
      ...document.querySelectorAll('video'),
      ...document.querySelectorAll('video source'),
    ]) {
      src = element.getAttribute('src');

      if (src == null) {
        continue;
      }

      url = new URL(src, base).toString();

      references.push({
        url,
        directive: 'media-src',
        file: filesByURL.get(url),
      });
    }

    for (const element of [
      ...document.querySelectorAll('iframe'),
      ...document.querySelectorAll('fencedframe'),
    ]) {
      src = element.getAttribute('src');

      if (src == null) {
        continue;
      }

      url = new URL(src, base).toString();

      references.push({
        url,
        directive: 'child-src',
        file: filesByURL.get(url),
      });
    }

    for (const element of document.querySelectorAll('script')) {
      src = element.getAttribute('src');

      if (src == null) {
        continue;
      }

      url = new URL(src, base).toString();

      references.push({
        url,
        directive: 'script-src',
        file: filesByURL.get(url),
      });
    }

    return references;
  }

  async update(base: string, content: Blob, filesByURL: Map<string, FileInfo>): Promise<Blob> {
    let url: string | undefined;
    let file: FileInfo | undefined;
    let text = await content.text();
    const dom = new JSDOM(text);
    const document = dom.window.document;

    for (const element of [
      ...document.querySelectorAll('link'),
      ...document.querySelectorAll('img'),
      ...document.querySelectorAll('track'),
      ...document.querySelectorAll('audio'),
      ...document.querySelectorAll('video'),
      ...document.querySelectorAll('video source'),
      ...document.querySelectorAll('iframe'),
      ...document.querySelectorAll('fencedframe'),
      ...document.querySelectorAll('script'),
    ]) {
      const src = element.getAttribute('src');

      if (src == null) {
        continue;
      }

      url = new URL(src, base).toString();
      file = filesByURL.get(url);

      if (file == null) continue;

      element.setAttribute('src', file.url);
    }

    for (const element of document.querySelectorAll('picture source')) {
      const src = element.getAttribute('srcset');

      if (src == null) {
        continue;
      }

      url = new URL(src, base).toString();
      file = filesByURL.get(url);

      if (file == null) continue;

      element.setAttribute('srcset', file.url);
    }

    return new Blob([dom.serialize()], { type: 'text/html' });
  }

}
