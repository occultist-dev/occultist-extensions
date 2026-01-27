import {longform, type ParsedResult} from '@longform/longform';
import {expand, JSONLDContextStore, type JSONObject} from '@occultist/mini-jsonld';
import {MemoryCache, type ActionSpec, type AuthState, type Cache, type Context, type ContextState, type Extension, type HandlerArgs, type Registry} from "@occultist/occultist";
import {type JSONLDHandler, longformHandler, octiron, type StoreArgs, type Fetcher, type ResponseHook} from '@octiron/octiron';
import m from 'mithril';
import render from 'mithril-node-render';
import {readFile, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {StaticExtension} from '../static/static-extension.ts';
import type {StaticFile} from '../static/types.ts';
import type {CommonOctironArgs, SSRModule, SSRView} from './types.ts';
import {type PageTemplatePage, renderPageTemplate} from './scripts.ts';


const devExtensionSym = Symbol('DevExtension');

/**
 * Used for adding meta information of the page's
 * javascript / typescript file.
 */
const pagePathSym = Symbol('PagePath');

/**
 * Used for adding meta information of the page's
 * render group.
 */
const renderGroupSym = Symbol('RenderGroup');


const defaultLayoutContent = `\
@doctype:: html
html::
  @mount:: head
  head::
  @mount:: body
  body::
`;


export type RenderGroup<
  Name extends string = string,
> = {
  name: Name;
  layout?: string;
};

export type DevExtensionScripts = {
  'json-ptr': string;
  'uri-templates': string;
  'mithril': string;
  '@longform/longform': string;
  '@octiron/octiron': string;
  '@occultist/mini-jsonld': string;
};

export type DevExtensionStyles = {
  'octiron.css': string;
}

export type DevExtensionDeps = {
  scripts: Partial<DevExtensionScripts>;
  styles: Partial<DevExtensionStyles>;
};

const defaultDevExtensionScripts: DevExtensionScripts = {
  'json-ptr': 'json-ptr/dist/esm/index.js',
  'uri-templates': 'uri-templates/uri-templates.min.js',
  'mithril': 'mithril/mithril.js',
  '@longform/longform': '@longform/longform/dist/longform.js',
  '@octiron/octiron': '@octiron/octiron/dist/octiron.js',
  '@occultist/mini-jsonld': '@occultist/mini-jsonld/dist/expand.js',
} as const;
const scriptNames = Object.keys(defaultDevExtensionScripts);

const defaultDevExtensionStyles = {
  'octiron.css': '@octiron/octiron/dist/octiron.css',
} as const;
const styleNames = Object.keys(defaultDevExtensionStyles);


export type DevExtensionArgs<
  GroupName extends string = string,
> = {
  vocab?: StoreArgs['vocab'];
  aliases?: StoreArgs['aliases'];
  acceptMap?: StoreArgs['acceptMap'];
  registry: Registry;
  cache?: Cache;
  scripts?: string[];
  styles?: string[];
  layout?: string;
  groups?: RenderGroup<GroupName>[];
  nodeModulesDir: string;
  layoutsDir: string;
  pagesDir: string;
  deps?: Partial<DevExtensionDeps>;
};

export class DevExtension<
  GroupName extends string = string,
> implements Extension {

  name: string = 'dev';
  
  #registry: Registry;
  #octironArgs: CommonOctironArgs;
  #layout?: string;
  #styles: string[];
  #groups: RenderGroup<GroupName>[];
  #groupByName: Map<string, RenderGroup<GroupName>> = new Map();
  #layoutsDir: string;
  #pagesDir: string;
  #defaultLayout?: ParsedResult;
  #layouts: Map<string, ParsedResult>;
  #static: StaticExtension;
  #defaultPages: PageTemplatePage[] = [];
  #groupPages: Map<GroupName, PageTemplatePage[]> = new Map();

  constructor(args: DevExtensionArgs<GroupName>) {
    this.#registry = args.registry;
    this.#styles = args.styles ?? [];
    this.#layout = args.layout;
    this.#layoutsDir = args.layoutsDir;
    this.#pagesDir = args.pagesDir;
    this.#groups = args.groups ?? [];
    this.#octironArgs = {
      rootIRI: args.registry.rootIRI,
      vocab: args.vocab,
      aliases: args.aliases,
      acceptMap: args.acceptMap,
    };

    for (let i = 0; i < this.#groups.length; i++) {
      this.#groupByName.set(this.#groups[i].name, this.#groups[i]);
    }
    
    const scriptDeps: DevExtensionScripts = args.deps?.scripts != null
      ? { ...defaultDevExtensionScripts, ...args.deps.scripts }
      : defaultDevExtensionScripts;
    const styleDeps: DevExtensionStyles = args.deps?.styles != null
      ? { ...defaultDevExtensionStyles, ...args.deps.styles }
      : defaultDevExtensionStyles;

    const staticFiles: StaticFile[] = [];

    for (const [key, file] of Object.entries(scriptDeps)) {
      staticFiles.push({
        alias: key,
        path: resolve(args.nodeModulesDir, file),
      });
    }

    for (const [key, file] of Object.entries(styleDeps)) {
      staticFiles.push({
        alias: key,
        path: resolve(args.nodeModulesDir, file),
      });
    }

    this.#static = new StaticExtension({
      registry: args.registry,
      cache: args.cache ?? new MemoryCache(args.registry),
      files: staticFiles,
      directories: [
        {
          alias: 'layouts',
          path: args.layoutsDir,
        },
        {
          alias: 'pages',
          path: args.pagesDir,
        },
      ],
    });

    this.#registry.registerExtension(this);
    this.#registry.addEventListener('afterfinalize', this.#preloadRenderGroups);
  }

  setup(): ReadableStream {
    const { readable, writable } = new TransformStream();

    this.#setup(writable);

    return readable;
  }

  async #setup(writable: WritableStream): Promise<void> {
    const writer = writable.getWriter();

    writer.write('Compiling longform layouts');
    let layout: string;

    if (this.#layoutsDir != null && this.#layout != null) {
      const path = resolve(this.#layoutsDir, this.#layout);
      layout = await readFile(path, 'utf-8');
    } else {
      layout = defaultLayoutContent;
    }
    this.#defaultLayout = longform(layout);
                                      
    for (let i = 0; i < this.#groups  .length; i++) {
      if (this.#groups[i].layout == null) {
        this.#layouts.set(this.#groups[i].name, this.#defaultLayout);

        continue;
      };

      const path = resolve(this.#layoutsDir, this.#groups[i].layout);
      const layout = await readFile(path, 'utf-8');
      const output = longform(layout);

      this.#layouts.set(this.#groups[i].name, output);
    }

    writer.write('Done');
    writer.releaseLock();
    writable.close();
  }

  #preloadRenderGroups = () => {
    const handlers = this.#registry.query({
      contentType: 'text/html',
      meta: devExtensionSym,
    });

    for (let i = 0, length = handlers.length; i < length; i++) {
      const handler = handlers[i];
      const renderGroup: GroupName | undefined = handler.meta[renderGroupSym] as GroupName
      const pagePath: string = handler.meta[pagePathSym] as string;
      const staticAsset = this.#registry.getStaticAsset(`pages/${pagePath}.ts`);

      if (renderGroup != null && this.#groupPages.has(renderGroup)) {
        this.#groupPages.get(renderGroup).push({
          importPath: staticAsset.url,
          re: handler.action.route.regexpRaw,
        });
      } else if (renderGroup != null) {
        this.#groupPages.set(renderGroup, [{
          importPath: staticAsset.url,
          re: handler.action.route.regexpRaw,
        }]);
      } else {
        this.#defaultPages.push({
          importPath: staticAsset.url,
          re: handler.action.route.regexpRaw,
        });
      }
    }
  }

  /**
   * Loads module for a page and its render group.
   *
   * Modules can be in javascript or typescript and are located in
   * the pages directory.
   */
  async loadModule(pagePath: string): Promise<SSRModule> {
    let isTypescript: boolean = true;
    let mod: SSRModule | undefined;
    const tsFile = resolve(this.#pagesDir, pagePath + '.ts');
    const jsFile = resolve(this.#pagesDir, pagePath + '.js');

    try {
      await stat(tsFile);
    } catch (err) {
      isTypescript = false;
    }

    if (isTypescript) {
      mod = await import(tsFile);
    } else {
      await stat(jsFile);
      mod = await import(jsFile);
    }
    
    if (mod == null) throw new Error('Module for page "' + pagePath + '" not found');

    return mod;
  }

  /**
   * Uses the DotDev extension to render a HTML page.
   *
   * @param pagePath Path relating to the pages directory for the
   *   Typescript or Javascript module which exposes the render views.
   * @param renderGroup An optional render group that this page belongs
   *   to, allowing client side navigation and state presivation between
   *   pages in the group.
   */
  handlePage<
    State extends ContextState = ContextState,
    Auth extends AuthState = AuthState,
    Spec extends ActionSpec = ActionSpec,
  >(pagePath: string, renderGroup?: GroupName): HandlerArgs<
    State,
    Auth,
    Spec
  > {
    return {
      contentType: 'text/html',
      meta: {
        [devExtensionSym]: true,
        [pagePathSym]: pagePath,
        [renderGroupSym]: renderGroup,
      },
      handler: (ctx) => this.renderPage(ctx, pagePath, renderGroup),
    };
  }

  /**
   * Renderers a SSR page, adding the result and any returned HTTP status
   * to the request handler's context.
   *
   * @param ctx The handler's request context.
   * @param pagePath Absolute path to the 
   */
  async renderPage(ctx: Context, pagePath: string, renderGroup?: GroupName): Promise<void> {
    const layout = renderGroup == null
      ? this.#defaultLayout
      : this.#layouts.get(renderGroup) ?? this.#defaultLayout;

    if (layout == null || !layout.mountable) return;

    const [mod, head] = await Promise.all([
      this.loadModule(pagePath),
      this.#renderHead(renderGroup),
    ]);
    
    await this.#renderPage(
      ctx,
      layout,
      mod,
      head,
    );
  }

  async #renderHead(renderGroup?: GroupName): Promise<string> {
    let head: string = '';
    let imports = {};
    let mithrilURL: string;
    let octironURL: string;
    let pages: PageTemplatePage[];
    let styles: string = '';

    for (const staticAsset of this.#registry.queryStaticAssets([...styleNames, ...this.#styles])) {
      head += `<link class=ssr rel=stylesheet href=${staticAsset.url} />`;
    }

    const staticAssets = this.#registry.queryStaticAssets(scriptNames);
    for (let i = 0, length = staticAssets.length; i < length; i++) {
      const staticAsset = staticAssets[i];

      imports[staticAsset.alias] = staticAsset.url;

      if (staticAsset.alias === 'mithril') {
        mithrilURL = staticAsset.url;
      } else if (staticAsset.alias === '@octiron/octiron') {
        octironURL = staticAsset.url;
      }
    }

    head += `<script class=ssr type="importmap">${JSON.stringify({ imports })}</script>`;

    if (renderGroup == null) {
      pages = this.#defaultPages;
    } else {
      pages = this.#groupPages.get(renderGroup) ?? [];
    }

    head += renderPageTemplate({
      mithrilURL,
      octironURL,
      octironArgs: this.#octironArgs,
      pages,
    });

    return head;
  }

  /**
   * This is a basic SSR rendering loop. Because all requests, or at least
   * those managed by the Occultist framework are performed via the Occultist
   * store the Occultist.dev extension can perform these requests and render
   * a complete page in the response.
   *
   * To allow a full page to be rendered with dependencies requiring fetching
   * a hook is added to the store so the SSR loop can await the resolution of
   * the fetch call.
   *
   * The fetch behaviour is also patched so Request objects are passed directly
   * to the Occultist registry for handling instead of going over the network.
   * This keeps the call on the process, reducing overheads.
   *
   * The store's initial state is defined and the loop renders the page. If Octiron
   * triggers one / many fetch requests those are allowed to complete, 
   * populating the Octiron's store's state. Octiron selections can in theory
   * trigger further requests and these are resolved without another render.
   * A second loop allows these deeper requests to complete.
   *
   * Each time a set of selectors causes fetch requests to be made Octiron might
   * encounter further selectors on the next render requiring requests to be made.
   * The main SSR render loop keeps going until Octiron has populated the store
   * with all fetchable entities and the final render is performed.
   *
   * This render loop is simple and has obvious performance downsides compared to 
   * solution which streams rendered HTML as the mithril code is unblocked and can
   * render in a single streaming pass. The Occultist.dev solution has various
   * mitigations to these issues and if the project is successful, improving the
   * SSR render strategy would be something to consider.
   */
  async #renderPage(
    ctx: Context,
    layout: ParsedResult,
    mod: Record<string, SSRView>,
    headContent: string = '',
  ): Promise<void> {
    let html = '';
    let count = 0;
    let currentLength = 0;
    const location = new URL(ctx.url);
    const responses: Array<Promise<Response>> = [];
    const renderedMountPoints: string[] = [];
    const primary: StoreArgs['primary'] = {};
    const alternatives: StoreArgs['alternatives'] = new Map();
    const fetcher: Fetcher = (url, args) => {
      return ctx.registry.handleRequest(new Request(url, args));
    };
    const responseHook: ResponseHook = (res) => {
      responses.push(res);
    };
    const headers = Object.fromEntries(ctx.headers.entries());
    const o = octiron({
      ...this.#octironArgs,
      headers,
      fetcher,
      responseHook,
      primary,
      alternatives,
      handlers: [
        this.jsonLDHandler(),
        longformHandler,
      ],
    });

    /**
     * SSR Render loop.
     *
     * TODO This likely has the potential for infinite loops or getting stuck.
     */
    async function renderLoop(component: m.ComponentTypes): Promise<string> {
      // render Mithril view, triggering requests via Occultist selectors
      do {
        let loopLength = currentLength = responses.length;

        await render(m(component, { o, location } as m.Attributes));

        // fetch all entities required by Occultist selector
        while (loopLength !== responses.length) {
          loopLength = responses.length;

          await Promise.all(responses);

          count++;
        }
      } while (responses.length !== currentLength)

      // final render with populated store.
      return render(m(component, { o, location } as any));
    }

    const state = {};
    const renders: Array<Promise<[
      mountpoint: ParsedResult['mountPoints'][0],
      fragment: string,
    ]>> = [];
    for (let i = 0; i < layout.mountPoints.length; i++) {
      // A longform layout can set multiple mountpoints.
      // This behaviour has similar results to the server
      // islands architecture and uses Mithril's mounting
      // behaviour which can mount more than one DOM node
      // and be targeted by `m.redraw()` globally.
      const mountPoint = layout.mountPoints[i];
      const view = mod[mountPoint.id];

      if (typeof view !== 'function') continue;
 
      // each mountpoint has a simple Mithril component
      // defined for it, calling the module's view fn using
      // the same name. a nice aspect of this is in client
      // side navigation the view function changes without
      // requiring the mountpoint's component to be re-initialized.
      const component = {
        view() {
          return view({ o, location, state });
        },
      };

      renders.push(new Promise(async (resolve) => {
        resolve([
          mountPoint,
          await renderLoop(component),
        ]);
      }));
    }

    const rendered = await Promise.all(renders);

    for (let i = 0; i < rendered.length; i++) {
      const [mountPoint, fragment] = rendered[i];

      html += mountPoint.part;
      html += fragment;
      renderedMountPoints.push(mountPoint.id);
    }

    const initialState = o.store.toInitialState();
    const mountPointState = `<script id="mount-points" types="application/json">${JSON.stringify(renderedMountPoints)}</script>`;

    html += layout.tail ?? '';
    html = html.replace(/<\/head>/, headContent + '</head>');
    html = html.replace(/<\/body><\/html>$/, mountPointState + initialState + '</body></html>');

    // The store can have a http status set if an octiron selection has `{ mainEntity: true }` in
    // its args.
    ctx.status = o.store.httpStatus ?? 200;
    ctx.body = html;
  }

  jsonLDHandler(): JSONLDHandler {
    const store = new JSONLDContextStore({
      fetcher: async (url: string, init: RequestInit) => {
        const res = await this.#registry.handleRequest(
          new Request(url, init),
        );

        const res2 = res.clone();
        const body = await res2.json();

        return res;
      }
    });

    return {
      contentType: 'application/ld+json',
      integrationType: 'jsonld',
      handler: async ({ res }) => {
        const json = await res.json();
        const jsonld: JSONObject = await expand(json, { store }) as JSONObject;

        return { jsonld };
      },
    } satisfies JSONLDHandler;
  }

}
