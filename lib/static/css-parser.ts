import {readFile} from "node:fs/promises";
import type {PolicyDirective, ReferenceDetails, ReferenceParser} from "./types.js";
import {DependancyMap} from "./dependancy-graph.ts";
import {type FileInfo} from "./file-info.ts";


type PolicyDirectiveMap = Record<string, PolicyDirective>;


const ruleRe = /(?:(\@[a-z]+)|(?:([a-z][a-z\-]*\s*):))\s*(.*);/gm;
const urlRe = /url\(\s*(?:(?:\"(.*)\")|(?:\'(.*)\')|(.*))\s*\)/gm;
const defaultDirectives: PolicyDirectiveMap = {
  '@import': 'style-src',
  'background': 'img-src',
  'background-image': 'img-src',
  'src': 'font-src',
} as const;

export type CSSReferenceParserArgs = {
  contentType?: string | string[];
};

export class CSSReferenceParser implements ReferenceParser {

  ruleRe: RegExp = ruleRe;
  urlRe: RegExp = urlRe;
  contentTypes: string[] = ['text/css'];
  directives: PolicyDirectiveMap = defaultDirectives;

  constructor(args?: CSSReferenceParserArgs) {
    if (Array.isArray(args?.contentType)) {
      this.contentTypes = args.contentType;
    } else if (args?.contentType != null) {
      this.contentTypes = [args.contentType];
    }
  }

  /**
   * Reads the content of the given files where the content type is css, and all files referenced by
   */
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

  /**
   * Parses all references within a css document.
   *
   * @param content Content of a css file.
   */
  parseReferences(
    base: string,
    content: string,
    filesByURL: Map<string, FileInfo>,
  ): ReferenceDetails[] {
    let m1: RegExpExecArray | null;
    let m2: RegExpExecArray | null;
    let property: string;
    let url: string;
    let directive: PolicyDirective;
    const references: ReferenceDetails[] = [];

    this.ruleRe.lastIndex = 0;
    while ((m1 = this.ruleRe.exec(content))) {
      property = m1[1] ?? m1[2];
      directive = this.directives[property];

      if (directive == null) continue;

      this.urlRe.lastIndex = 0;
      while ((m2 = this.urlRe.exec(m1[3]))) {
        url = new URL(m2[1] ?? m2[2] ?? m2[3], base).toString();
        
        references.push({
          url,
          directive,
          file: filesByURL.get(url),
        });
      }
    }

    return references;
  }

  async update(base: string, content: Blob, filesByURL: Map<string, FileInfo>): Promise<Blob> {
    const text = await content.text();
    const updated = text.replace(ruleRe, (match) => {
      return match.replace(urlRe, (...matches) => {
        const src = matches[1] ?? matches[2] ?? matches[3];
        const url = new URL(src, base).toString();
        const file = filesByURL.get(url);

        if (file == null) return matches[0];

        return `url(${file.url})`;
      })
    })

    return new Blob([updated], { type: 'text/css' });
  }
}
