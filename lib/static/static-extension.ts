import {type Cache, type HintLink, type ImplementedAction, joinPaths, Registry} from '@occultist/occultist';
import {createHash} from "crypto";
import {createReadStream} from "fs";
import {opendir, readFile} from "fs/promises";
import {join} from "path";
import {Readable} from "stream";
import {DependancyGraph, DependancyMap} from './dependancy-graph.ts';
import {FileInfo} from './file-info.ts';
import type {Directory, ReferenceParser} from './types.ts';
import {CSSReferenceParser} from './css-parser.ts';


type ExtensionMap = Map<string, string>;

type FileInfoMap = Map<string, FileInfo>;

type HashMap = Map<string, string>;

type ActionMap = Map<string, ImplementedAction>;

export const defaultExtensions = {
  txt: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
} as const;

export const defaultParsers: ReferenceParser[] = [
  new CSSReferenceParser(),
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
   * Directories to serve as static content.
   */ 
  directories: Directory[];

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
export class StaticExtension {
  #loaded: boolean = false;
  #registry: Registry;
  #cache: Cache | undefined;
  #directories: Directory[];
  #extensions: ExtensionMap;
  #parsers: ReferenceParser[];
  #prefix: string;
  #files: FileInfoMap = new Map();
  #hashes: HashMap = new Map();
  #actions: ActionMap = new Map();
  #dependancies: DependancyGraph | undefined;

  constructor(args: StaticExtensionArgs) {
    this.#registry = args.registry;
    this.#cache = args.cache;
    this.#directories = args.directories;
    this.#extensions = new Map(Object.entries(args.extensions ?? defaultExtensions)) as ExtensionMap;
    this.#parsers = args.parsers ?? defaultParsers;
    this.#prefix = args.prefix ?? '/';
  }

  get dependancies(): DependancyGraph | undefined {
    return this.#dependancies;
  }

  get(name: string): ImplementedAction | undefined {
    return this.#actions.get(name);
  }

  getFile(name: string): FileInfo | undefined {
    return this.#files.get(name);
  }
  
  hint(name: string, args: Omit<HintLink, 'href' | 'contentType'>): HintLink | null {
    const file = this.#files.get(name);
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
  load = (): ReadableStream & Promise<void> => {
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

    for await (const file of this.#traverse(this.#directories)) {
      this.#files.set(file.alias, file);
    }

    const files = Array.from(this.#files.values());

    writer.write('Generating hashes');
    for (let i = 0; i < files.length; i++) {
      const content = await readFile(files[i].absolutePath);
      const hash = createHash('sha256').update(content).digest('hex');

      this.#hashes.set(files[i].alias, hash);
    }
    
    let dependancyMap: Map<string, DependancyMap>;
    const dependancyMaps: Array<Map<string, DependancyMap>> = [];

    writer.write('Building dependancy tree');
    for (let i = 0; i < this.#parsers.length; i++) {
      dependancyMap = await this.#parsers[i].parse(files);

      if (dependancyMap.size !== 0) dependancyMaps.push(dependancyMap);
    }
    
    this.#dependancies = new DependancyGraph(
      new Map(dependancyMaps.flatMap((map => Array.from(map.entries()))))
    );

    writer.write('Registering actions');
    for (const [name, file] of this.#files.entries()) {
      const parts = name.split('/');
      const friendly = parts[parts.length - 1].split('.')[0];
      const hash = this.#hashes.get(name) as string;
      let action = this.#registry.http.get(name, joinPaths(this.#prefix, `${friendly}-${hash}.${file.extension}`))
        .public()

      if (this.#cache) {
        action = action.cache(this.#cache.store());
      }

      const implemented = action.handle(file.contentType, (ctx) => {
        ctx.headers.set('Cache-Control', 'immutable');
        ctx.body = Readable.toWeb(createReadStream(file.absolutePath)) as ReadableStream;
      });

      this.#actions.set(name, implemented);
    }

    writer.write('Finished');
    writer.close();

    this.#loaded = true;
  }

  #traverseRe = /.(?:\.(?<lang>[a-zA-Z\-]+))?(?:\.(?<extension>[a-zA-Z0-9]+))$/;

  /**
   * Traverses into a list of directories outputting a file info object for every file
   * of a configured file extension.
   *
   * @param directories The directories to traverse into.
   */
  async* #traverse(directories: Directory[], root: string = ''): AsyncGenerator<FileInfo, void, unknown> {
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
          yield new FileInfo(
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
