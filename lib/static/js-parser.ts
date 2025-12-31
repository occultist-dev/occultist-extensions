import {parse, type ImportDeclaration, type ImportExpression, type Literal, type Node, type Options} from 'acorn';
import {generate} from 'astring';
import {walk} from 'zimmerframe';
import {type FileInfo} from "./file-info.ts";
import type {FilesByURL, ReferenceDetails, ReferenceParser} from "./types.ts";


export type JSReferenceParserArgs = {
  contentType?: string | string[];
  acornOptions?: Options;
};

export class JSReferenceParser implements ReferenceParser {
  
  supports: Set<string> = new Set(['application/javascript']);

  #acornOptions: Options;

  constructor(args: JSReferenceParserArgs = {}) {
    if (Array.isArray(args?.contentType)) {
      this.supports = new Set(args.contentType);
    } else if (args?.contentType != null) {
      this.supports = new Set([args.contentType]);
    }

    this.#acornOptions = args.acornOptions ?? {
      ecmaVersion: 'latest',
      sourceType: 'module',
    };
  }

  async parse(
    content: Blob,
    file: FileInfo,
    filesByURL: FilesByURL,
  ): Promise<ReferenceDetails[]> {
    let references: ReferenceDetails[] = [];
    let url: string;
    const text = await content.text();
    const ast = parse(text, this.#acornOptions);
    
    walk(ast as Node, {}, {
      ImportDeclaration(node: ImportDeclaration, { next }) {
        url = new URL((node.source as Literal).value as string, file.aliasURL).toString();
        
        references.push({
          url,
          directive: 'script-src',
          file: filesByURL.get(url),
        });

        next();
      },
      ImportExpression(node: ImportExpression, { next }) {
        url = new URL((node.source as Literal).value as string, file.aliasURL).toString();
        
        references.push({
          url,
          directive: 'script-src',
          file: filesByURL.get(url),
        });

        next();
      },
    });

    return references;
  }

  async update(
    content: Blob,
    file: FileInfo,
    filesByURL: Map<string, FileInfo>,
  ): Promise<Blob> {
    let url: string | undefined;
    let ref: FileInfo | undefined;
    const text = await content.text();
    const ast = parse(text, this.#acornOptions);
    const updated = walk(ast as Node, {}, {
      ImportDeclaration(node: ImportDeclaration, { next }) {
        url = new URL((node.source as Literal).value as string, file.aliasURL).toString();
        ref = filesByURL.get(url);

        if (ref == null) return;

        const source = node.source as Literal;
        source.raw = '"' + encodeURI(ref.url) + '"';

        next();
      },
      ImportExpression(node: ImportExpression, { next }) {
        url = new URL((node.source as Literal).value as string, file.aliasURL).toString();
        ref = filesByURL.get(url);

        if (ref == null) return;

        const source = node.source as Literal;
        source.raw = '"' + encodeURI(ref.url) + '"';

        next();
      },
    });
    const serialized = generate(updated);

    return new Blob([serialized], { type: file.contentType });
  }
}
