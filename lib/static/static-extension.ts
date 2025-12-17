import {type Cache, type HintLink, type ImplementedAction, joinPaths, Registry} from '@occultist/occultist';
import {createHash} from "crypto";
import {createReadStream} from "fs";
import {opendir, readFile} from "fs/promises";
import {join} from "path";
import {Readable} from "stream";


export type ExtensionMap = Map<string, string>;

export type FileInfo = {
  /**
   * The name of the file.
   */
  name: string;

  /**
   * Path of the file relative to the configured directory.
   */
  path: string;

  /**
   * Directoy the file is located in.
   */
  directory: string;

  /**
   * The file's extension.
   */
  extension: string;

  /**
   * The file's language if detected.
   */
  lang?: string;

  /**
   * The file's content type.
   */
  contentType: string;
};

export type FileInfoMap = Map<string, FileInfo>;

export type ContentMap = Map<string, Blob>;

export type HashMap = Map<string, string>;

export type ActionMap = Map<string, ImplementedAction>;

export const defaultExtensions = {
  txt: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
} as const;


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
  directories: string[];

  /**
   * A javascript object mapping file extensions
   * to their content types.
   */
  extensions?: Record<string, string>;

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
  #directories: string[];
  #extensions: ExtensionMap;
  #prefix: string;
  #files: FileInfoMap = new Map();
  #content: ContentMap = new Map();
  #hashes: HashMap = new Map();
  #actions: ActionMap = new Map();

  constructor(args: StaticExtensionArgs) {
    this.#registry = args.registry;
    this.#cache = args.cache;
    this.#directories = args.directories;
    this.#extensions = new Map(Object.entries(args.extensions ?? defaultExtensions)) as ExtensionMap;
    this.#prefix = args.prefix ?? '/';
  }

  get(name: string): ImplementedAction | null {
    return this.#actions.get(name) ?? null;
  }
  
  hint(name: string, args: Omit<HintLink, 'href'>): HintLink | null {
    const action = this.#actions.get(name);

    if (action == null) return null;

    return {
      ...args,
      href: action.url(),
    };
  }

  /**
   * Called when registered with Occultist to
   * run any async tasks and hook into Occultist's
   * extension event system.
   */
  load = (): ReadableStream => {
    if (this.#loaded) throw new Error('Static extension already loaded');

    const { writable, readable } = new TransformStream();

    this.#load(writable.getWriter());

    return readable;
  }

  async #load(writer: WritableStreamDefaultWriter): Promise<void> {
    writer.write('Gathering files');

    for await (const file of this.#traverse(this.#directories)) {
      this.#files.set(file.path, file);
    }

    writer.write('Generating hashes');
    for (const [name, file] of this.#files.entries()) {
      const content = await readFile(file.path);
      const hash = createHash('sha256').update(content).digest('hex');

      this.#hashes.set(name, hash);
    }

    writer.write('Registering actions');
    for (const [name, file] of this.#files.entries()) {
      const hash = this.#hashes.get(name) as string;
      let action = this.#registry.http.get(name, joinPaths(this.#prefix, hash))
        .public()

      if (this.#cache) {
        action = action.cache(this.#cache.store());
      }

      const implemented = action.handle(file.contentType, (ctx) => {
        ctx.headers.set('Cache-Control', 'immutable');
        ctx.body = Readable.toWeb(createReadStream(join(file.directory, file.path))) as ReadableStream;
      });

      this.#actions.set(name, implemented);
    }

    writer.write('Finished');
    writer.close();

    this.#loaded = true;
  }

  async* #traverse(directories: string[], root: string = ''): AsyncGenerator<FileInfo, void, unknown> {
    for (let i = 0; i < directories.length; i++) {
      const dir = await opendir(directories[i]);

      for await (const entry of dir) {
        const fullPath = join(directories[i], entry.name);
        const match = /.(?:\.(?<lang>[a-zA-Z\-]+))?(?:\.(?<extension>[a-zA-Z\-]+))$/.exec(entry.name);
        const { lang, extension } = match?.groups ?? {};
        const contentType = this.#extensions.get(extension);

        if (contentType == null || extension == null) {
          console.warn(`File ${fullPath.replace(root, '')} extension not known, skipping...`);

          continue;
        }

        if (entry.isDirectory()) {
          yield* this.#traverse([fullPath], root === '' ? directories[i] : root);
        } else {
          yield {
            name: entry.name,
            path: fullPath.replace(root, ''),
            directory: root,
            contentType,
            extension,
            lang,
          };
        }
      }
    }
  }
}
