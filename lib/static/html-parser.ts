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
  supports: Set<string> = new Set([
    'text/html',
    'application/xhtml+xml',
  ]);

  constructor(args: HTMLParserArgs = {}) {
    if (Array.isArray(args?.contentType)) {
      this.supports = new Set(args.contentType);
    } else if (args?.contentType != null) {
      this.supports = new Set([args.contentType]);
    }
  }

  async parse(
    content: Blob,
    file: FileInfo,
    filesByURL: Map<string, FileInfo>,
  ): Promise<ReferenceDetails[]> {
    let references: ReferenceDetails[] = [];
    let src: string;
    let rel: string;
    let as: string;
    let url: string;
    const text = await content.text();
    const dom = new JSDOM(text, {
      contentType: file.contentType,
    });
    const document = dom.window.document;

    for (const element of document.querySelectorAll('link')) {
      src = element.getAttribute('src');
      rel = element.getAttribute('rel');
      as = element.getAttribute('as');
      url = new URL(src, file.aliasURL).toString();

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

      url = new URL(src, file.aliasURL).toString();

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

      url = new URL(src, file.aliasURL).toString();

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

      url = new URL(src, file.aliasURL).toString();

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

      url = new URL(src, file.aliasURL).toString();

      references.push({
        url,
        directive: 'script-src',
        file: filesByURL.get(url),
      });
    }

    return references;
  }

  async update(
    content: Blob,
    file: FileInfo,
    filesByURL: Map<string, FileInfo>,
  ): Promise<Blob> {
    let url: string | undefined;
    let ref: FileInfo | undefined;
    let text = await content.text();
    const dom = new JSDOM(text, {
      contentType: file.contentType,
    });
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

      url = new URL(src, file.aliasURL).toString();
      ref = filesByURL.get(url);

      if (ref == null) continue;

      element.setAttribute('src', ref.url);
    }

    for (const element of document.querySelectorAll('picture source')) {
      const src = element.getAttribute('srcset');

      if (src == null) {
        continue;
      }

      url = new URL(src, file.aliasURL).toString();
      ref = filesByURL.get(url);

      if (ref == null) continue;

      element.setAttribute('srcset', ref.url);
    }

    return new Blob([dom.serialize()], { type: file.contentType });
  }

}
