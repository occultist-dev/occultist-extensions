import type {FilesByURL, PolicyDirective, ReferenceDetails, ReferenceParser} from "./types.js";
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
  supports = new Set(['text/css']);
  directives: PolicyDirectiveMap = defaultDirectives;

  constructor(args?: CSSReferenceParserArgs) {
    if (Array.isArray(args?.contentType)) {
      this.supports = new Set(args.contentType);
    } else if (args?.contentType != null) {
      this.supports = new Set([args.contentType]);
    }
  }

  /**
   * Parses all references within a css document.
   *
   * @param content Content of a css file.
   */
  async parse(
    content: Blob,
    file: FileInfo,
    filesByURL: FilesByURL,
  ): Promise<ReferenceDetails[]> {
    let m1: RegExpExecArray | null;
    let m2: RegExpExecArray | null;
    let property: string;
    let url: string;
    let directive: PolicyDirective;
    const references: ReferenceDetails[] = [];
    const text = await content.text();

    this.ruleRe.lastIndex = 0;
    while ((m1 = this.ruleRe.exec(text))) {
      property = m1[1] ?? m1[2];
      directive = this.directives[property];

      if (directive == null) continue;

      this.urlRe.lastIndex = 0;
      while ((m2 = this.urlRe.exec(m1[3]))) {
        url = new URL(m2[1] ?? m2[2] ?? m2[3], file.aliasURL).toString();
        
        references.push({
          url,
          directive,
          file: filesByURL.get(url),
        });
      }
    }

    return references;
  }

  async update(
    content: Blob, 
    file: FileInfo,
    filesByURL: FilesByURL,
  ): Promise<Blob> {
    const text = await content.text();
    const updated = text.replace(ruleRe, (match) => {
      return match.replace(urlRe, (...matches) => {
        const src = matches[1] ?? matches[2] ?? matches[3];
        const url = new URL(src, file.aliasURL).toString();
        const ref = filesByURL.get(url);

        if (ref == null) return matches[0];

        return `url(${ref.url})`;
      })
    })

    return new Blob([updated], { type: file.contentType });
  }
}


