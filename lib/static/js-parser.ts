import {type Literal, parse, type ImportDeclaration, type ImportExpression, type Node, type Options} from 'acorn';
import {readFile} from "fs/promises";
import {walk} from 'zimmerframe';
import {DependancyMap} from "./dependancy-graph.ts";
import {type FileInfo} from "./file-info.ts";
import {type ReferenceDetails, type ReferenceParser} from "./types.ts";
import {generate} from 'astring';


export type JSReferenceParserArgs = {
  contentType?: string | string[];
  acornOptions?: Options;
};

export class JSReferenceParser implements ReferenceParser {
  
  contentTypes: string[] = ['application/javascript'];

  #acornOptions: Options;

  constructor(args: JSReferenceParserArgs = {}) {
    if (Array.isArray(args?.contentType)) {
      this.contentTypes = args.contentType;
    } else if (args?.contentType != null) {
      this.contentTypes = [args.contentType];
    }

    this.#acornOptions = args.acornOptions ?? {
      ecmaVersion: 'latest',
      sourceType: 'module',
    };
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
    let url: string;
    const ast = parse(content, this.#acornOptions);
    
    walk(ast as Node, {}, {
      ImportDeclaration(node: ImportDeclaration, { next }) {
        url = new URL((node.source as Literal).value as string, base).toString();
        
        references.push({
          url,
          directive: 'script-src',
          file: filesByURL.get(url),
        });

        next();
      },
      ImportExpression(node: ImportExpression, { next }) {
        url = new URL((node.source as Literal).value as string, base).toString();
        
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
    base: string,
    content: Blob,
    filesByURL: Map<string, FileInfo>,
  ): Promise<Blob> {
    let url: string | undefined;
    let file: FileInfo | undefined;
    const text = await content.text();
    const ast = parse(text, this.#acornOptions);
    const updated = walk(ast as Node, {}, {
      ImportDeclaration(node: ImportDeclaration, { next }) {
        url = new URL((node.source as Literal).value as string, base).toString();
        file = filesByURL.get(url);

        if (file == null) return;

        const source = node.source as Literal;
        source.raw = '"' + encodeURI(file.url) + '"';

        next();
      },
      ImportExpression(node: ImportExpression, { next }) {
        url = new URL((node.source as Literal).value as string, base).toString();
        file = filesByURL.get(url);

        if (file == null) return;

        const source = node.source as Literal;
        source.raw = '"' + encodeURI(file.url) + '"';

        next();
      },
    });
    const serialized = generate(updated);

    return new Blob([serialized], { type: 'application/javascript' });
  }
}
