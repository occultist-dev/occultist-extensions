import {parse, type ImportDeclaration, type ImportExpression, type Literal, type Node, type Options} from 'acorn';
import {generate} from 'astring';
import {walk} from 'zimmerframe';
import {type FileInfo} from "./file-info.ts";
import type {FilesByAlias, FilesByURL, ReferenceDetails, ReferenceParser} from "./types.ts";
import {referencedDependency} from './referenceURL.ts';
import {referencedFile} from './referenced-file.ts';
import {minify} from 'terser';


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
    filesByAlias: FilesByAlias,
  ): Promise<ReferenceDetails[]> {
    let references: ReferenceDetails[] = [];
    let reference: string;
    const text = await content.text();
    const ast = parse(text, this.#acornOptions);
    
    walk(ast as Node, {}, {
      ImportDeclaration(node: ImportDeclaration, { next }) {
        reference = node.source.value as string;
        references.push(referencedDependency(
          reference,
          file,
          filesByURL,
          filesByAlias,
          'script-src',
        ));

        next();
      },
      ImportExpression(node: ImportExpression, { next }) {
        reference = (node.source as Literal).value as string;
        references.push(referencedDependency(
          reference,
          file,
          filesByURL,
          filesByAlias,
          'script-src',
        ));

        next();
      },
    });

    return references;
  }

  async update(
    content: Blob,
    file: FileInfo,
    filesByURL: FilesByURL,
    filesByAlias: FilesByAlias,
  ): Promise<Blob> {
    let ref: FileInfo | undefined;
    let reference: string;
    const text = await content.text();
    const ast = parse(text, this.#acornOptions);
    const updated = walk(ast as Node, {}, {
      ImportDeclaration(node: ImportDeclaration, { next }) {
        reference = node.source.value as string;
        ref = referencedFile(
          reference,
          file,
          filesByURL,
          filesByAlias,
        );

        if (ref == null) return;

        const source = node.source as Literal;
        source.raw = '"' + encodeURI(ref.url) + '"';

        next();
      },
      ImportExpression(node: ImportExpression, { next }) {
        reference = (node.source as Literal).value as string;
        ref = referencedFile(
          reference,
          file,
          filesByURL,
          filesByAlias,
        );

        if (ref == null) return;

        const source = node.source as Literal;
        source.raw = '"' + encodeURI(ref.url) + '"';

        next();
      },
    });
    const serialized = generate(updated);
    const minified = await minify(serialized);

    return new Blob([minified.code], { type: file.contentType });
  }
}
