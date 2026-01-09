import {type StaticAssetExtension, type Extension, type Cache, type HintLink, type ImplementedAction, joinPaths, type Registry, type StaticAsset} from '@occultist/occultist';
import {createHash} from "crypto";
import {createReadStream} from "fs";
import {opendir, readFile} from "fs/promises";
import {join} from "path";
import {Readable} from "stream";
import {DependancyGraph, DependancyMap} from './dependancy-graph.ts';
import {type FileInfo, WorkingFileInfo} from './file-info.ts';
import type {StaticDirectory, StaticFile, ReferenceParser, ReferencePreprocessor} from './types.ts';
import {CSSReferenceParser} from './css-parser.ts';
import {JSReferenceParser} from './js-parser.ts';
import {HTMLParser} from './html-parser.ts';
import {TSReferencePreprocessor} from './ts-preprocessor.ts';


type ExtensionMap = Map<string, string>;

type FilesByAlias = Map<string, FileInfo>;

type FilesByURL = Map<string, FileInfo>;

type HashMap = Map<string, string>;

type ActionMap = Map<string, ImplementedAction>;

export const defaultExtensions = {
  txt: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  xhtml: 'application/xhtml+xml',
  xht: 'application/xhtml+xml',
  xml: 'application/xml',
  json: 'application/json',
  js: 'application/javascript',
  ts: 'application/javascript',
  jpg: 'image/jpeg',
  png: 'image/png',
  woff: 'font/woff',
  woff2: 'font/woff2',
} as const;

export const defaultParsers: ReferenceParser[] = [
  new HTMLParser(),
  new CSSReferenceParser(),
  new JSReferenceParser(),
];

export const defaultPreprocessors: ReferencePreprocessor[] = [
  new TSReferencePreprocessor(),
];

export const defaultCSPTypes = [
  'text/html',
  'application/xhtml+xml',
];

export type StaticExtensionArgs = {

  /**
   * An occultist registry.
   */
  registry: Registry;

  /**
   * A cache instance
   */
  cache?: Cache;

  /**
   * Files to serve as static content.
   */
  files?: StaticFile[];

  /**
   * Directories to serve as static content.
   */ 
  directories?: StaticDirectory[];

  /**
   * A javascript object mapping file extensions
   * to their content types.
   */
  extensions?: Record<string, string>;

  /**
   *
   */
  parsers?: ReferenceParser[];

  /**
   *
   */
  preprocessors?: ReferencePreprocessor[];

  /**
   * A path prefix where static assets should be served.
   */
  prefix?: string;
};

/**
 * Serves a directory of files up as static assets using hashed urls
 * and immutable cache headers.
 *
 * Other endpoints can use the hint method to register early hints linking
 * to hashed actions.
 */
export class StaticExtension implements Extension, StaticAssetExtension {
  name = 'static';
  #loaded: boolean = false;
  #registry: Registry;
  #cache: Cache | undefined;
  #files: StaticFile[];
  #directories: StaticDirectory[];
  #staticAliases: string[] = [];
  #extensions: ExtensionMap;
  #parsers: Map<string, ReferenceParser> = new Map();
  #preprocessors: Map<string, ReferencePreprocessor> = new Map();
  #prefix: string;
  #filesByAlias: FilesByAlias = new Map();
  #filesByURL: FilesByURL = new Map();
  #filesByExtension: Map<string, FileInfo[]> = new Map();
  #filesByContentType: Map<string, FileInfo[]> = new Map();
  #hashes: HashMap = new Map();
  #actions: ActionMap = new Map();
  #dependancies: DependancyGraph | undefined;

  constructor(args: StaticExtensionArgs) {
    this.#registry = args.registry;
    this.#cache = args.cache;
    this.#files = args.files ?? [];
    this.#directories = args.directories ?? [];
    this.#extensions = new Map(Object.entries(args.extensions ?? defaultExtensions)) as ExtensionMap;
    this.#prefix = args.prefix ?? '/';

    this.#registry.registerExtension(this);
    this.#registry.addEventListener('afterfinalize', this.onAfterFinalize);

    for (let i = 0; i < this.#directories.length; i++) {
      this.#staticAliases.push(this.#directories[i].alias);
    }

    Object.freeze(this.#staticAliases);

    for (const parser of args.parsers ?? defaultParsers) {
      for (const contentType of parser.supports.values()) {
        this.#parsers.set(contentType, parser);
      }
    }

    for (const preprocessor of args.preprocessors ?? defaultPreprocessors) {
      for (const extension of preprocessor.supports.values()) {
        this.#preprocessors.set(extension, preprocessor);
      }
    }
  }

  /**
   * Promise the action cache for all static actions.
   */
  onAfterFinalize = async () => {
    const promises: Array<Promise<string>> = [];

    for (const action of this.#actions.values()) {
      promises.push(
        this.#registry.primeCache(
          new Request(action.url())
        )
      );
    }

    await Promise.all(promises);
  }

  get dependancies(): DependancyGraph | undefined {
    return this.#dependancies;
  }

  get staticAliases(): string[] {
    return this.#staticAliases;
  }

  get(name: string): ImplementedAction | undefined {
    return this.#actions.get(name);
  }

  getFile(alias: string): FileInfo | undefined {
    return this.#filesByAlias.get(alias);
  }

  getAsset(assetAlias: string): StaticAsset | undefined {
    return this.#filesByAlias.get(assetAlias);
  }
  
  hint(name: string, args: Omit<HintLink, 'href' | 'contentType'>): HintLink | null {
    const file = this.#filesByAlias.get(name);
    const action = this.#actions.get(name);

    if (file == null || action == null) return null;

    const href = action.url();

    if (href == null) return null;

    return {
      ...args,
      href,
      type: file.contentType,
    };
  }

  /**
   * Called when registered with Occultist to
   * run any async tasks and hook into Occultist's
   * extension event system.
   */
  setup = (): ReadableStream & Promise<void> => {
    if (this.#loaded) throw new Error('Static extension already loaded');

    const { writable, readable } = new TransformStream();
    
    (readable as unknown as Promise<void>).then = async (resolve, reject) => {
      try {
        for await (const _ of readable) {}
      } catch (err) {
        return reject(err);
      }

      resolve();
    }

    this.#load(writable.getWriter());

    return readable as ReadableStream & Promise<void>;
  }

  async #load(writer: WritableStreamDefaultWriter): Promise<void> {
    writer.write('Gathering files');

    let file: WorkingFileInfo;
    
    for (let i = 0; i < this.#files.length; i++) {
      file = this.#staticFileToFileInfo(this.#files[i]);

      this.#filesByAlias.set(file.alias, file);
    }

    for await (const file of this.#traverse(this.#directories)) {
      this.#filesByAlias.set(file.alias, file);
    }

    const files = Array.from(this.#filesByAlias.values());

    writer.write('Generating hashes');
    for (let i = 0; i < files.length; i++) {
      file = files[i] as WorkingFileInfo;

      const content = await readFile(file.absolutePath);
      const hash = createHash('sha1').update(content).digest('hex');
      const parts = file.name.split('/');
      const friendly = parts[parts.length - 1].split('.')[0];
      const rootURL = this.#registry.rootIRI;
      const aliasURL = joinPaths(rootURL, this.#prefix, file.alias);
      const url = joinPaths(rootURL, this.#prefix, `${friendly}-${hash}.${file.extension}`);
      
      file.finalize(hash, url, aliasURL);
      this.#hashes.set(file.alias, hash);
      this.#filesByAlias.set(file.alias, file);
      this.#filesByURL.set(aliasURL, file);
      
      if (!this.#filesByExtension.has(file.extension)) {
        this.#filesByExtension.set(file.extension, []);
      }
      
      if (!this.#filesByContentType.has(file.contentType)) {
        this.#filesByContentType.set(file.contentType, []);
      }

      this.#filesByExtension.get(file.extension).push(file);
      this.#filesByContentType.get(file.contentType).push(file);
    }
    
    const dependancyMaps: Array<Map<string, DependancyMap>> = [];

    writer.write('Building dependancy tree');

    for (const [extension, contentType] of this.#extensions.entries()) {
      const preprocessor = this.#preprocessors.get(extension);

      if (preprocessor != null) {
        const files = this.#filesByExtension.get(extension);

        if (files == null) continue;

        const dependancies: Map<string, DependancyMap> = new Map();

        for (let i = 0; i < files.length; i++) {
          let file = files[i];

          const content = await readFile(file.absolutePath);
          const references = await preprocessor.parse(new Blob([content]), file, this.#filesByURL, this.#filesByAlias);

          dependancies.set(file.alias, new DependancyMap(file, references));
        }

        dependancyMaps.push(dependancies);
        continue;
      }

      const parser = this.#parsers.get(contentType);

      if (parser == null) continue;

      const files = this.#filesByContentType.get(contentType);

      if (files == null) continue;

      const dependancies: Map<string, DependancyMap> = new Map();

      for (let i = 0; i < files.length; i++) {
        let file = files[i];

        const content = await readFile(file.absolutePath);
        const references = await parser.parse(new Blob([content]), file, this.#filesByURL, this.#filesByAlias);
        dependancies.set(file.alias, new DependancyMap(file, references));
      }

      dependancyMaps.push(dependancies);
    }

    this.#dependancies = new DependancyGraph(
      new Map(dependancyMaps.flatMap((map => Array.from(map.entries())))),
    );

    writer.write('Registering actions');
    for (const [name, file] of this.#filesByAlias.entries()) {
      const preprocessor = this.#preprocessors.get(file.extension);
      const parser = this.#parsers.get(file.contentType);
      const parts = name.split('/');
      const friendly = parts[parts.length - 1].split('.')[0];
      const hash = this.#hashes.get(name) as string;
      let action = this.#registry.http.get(joinPaths(this.#prefix, `${friendly}-${hash}`), {
          autoFileExtensions: true,
        })
        .public()

      if (this.#cache) {
        action = action.cache(this.#cache.store({ immutable: true }));
      }

      const implemented = action.handle(file.contentType, async (ctx) => {
        if (preprocessor != null) {
          const content = await readFile(file.absolutePath);

          ctx.body = await preprocessor.process(new Blob([content]), file, this.#filesByURL, this.#filesByAlias);
        } else if (parser != null) {
          const content = await readFile(file.absolutePath);

          ctx.body = await parser.update(new Blob([content]), file, this.#filesByURL, this.#filesByAlias);
        } else {
          ctx.body = Readable.toWeb(createReadStream(file.absolutePath)) as ReadableStream;
        }
      });

      this.#actions.set(name, implemented);
    }

    writer.write('Finished');
    writer.close();

    this.#loaded = true;
  }

  #traverseRe = /.(?:\.(?<lang>[a-zA-Z0-9\-]+))?(?:\.(?<extension>[a-zA-Z0-9\-]+))$/;

  #staticFileToFileInfo(file: StaticFile): WorkingFileInfo {
    const parts = file.path.split('/');
    const alias = file.alias;
    const absolutePath = file.path;
    const name = parts[parts.length - 1];
    const relativePath = name;
    const match = this.#traverseRe.exec(name);
    const { lang, extension } = match?.groups ?? {};
    const contentType = this.#extensions.get(extension);

    return new WorkingFileInfo(
      true,
      name,
      alias,
      relativePath,
      absolutePath,
      extension,
      contentType,
      lang,
    );
  }

  /**
   * Traverses into a list of directories outputting a file info object for every file
   * of a configured file extension.
   *
   * @param directories The directories to traverse into.
   */
  async* #traverse(directories: StaticDirectory[], root: string = ''): AsyncGenerator<WorkingFileInfo, void, unknown> {
    for (let i = 0; i < directories.length; i++) {
      const dir = await opendir(directories[i].path);

      for await (const entry of dir) {
        const name = entry.name;
        const alias = directories[i].alias;
        const match = this.#traverseRe.exec(entry.name);
        const absolutePath = join(directories[i].path, entry.name);
        const directory = root === '' ? directories[i].path : root;
        const relativePath = absolutePath.replace(directory, '');
        const { lang, extension } = match?.groups ?? {};
        const contentType = this.#extensions.get(extension);

        if (contentType == null || extension == null) {
          console.warn(`File ${joinPaths(alias, relativePath)} extension not known, skipping...`);

          continue;
        }

        if (entry.isDirectory()) {
          yield* this.#traverse([{ alias, path: absolutePath }], root === '' ? directories[i].path : root);
        } else {
          yield new WorkingFileInfo(
            false,
            name,
            alias,
            relativePath,
            absolutePath,
            extension,
            contentType,
            lang,
          );
        }
      }
    }
  }
}
