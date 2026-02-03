import {longform, type ParsedResult} from '@longform/longform';
import {expand, JSONLDContextStore, type JSONObject} from '@occultist/mini-jsonld';
import type {HandlerDefinition, StaticAsset, ActionSpec, AuthState, Cache, Context, ContextState, Extension, HandlerArgs, Registry} from "@occultist/occultist";
import {MemoryCache} from "@occultist/occultist";
import {longformHandler, problemDetailsJSONHandler, octiron, type Fetcher, type JSONLDHandler, type ResponseHook, type StoreArgs} from '@octiron/octiron';
import m from 'mithril';
import render from 'mithril-node-render';
import {readdir, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import type {StaticExtensionArgs} from '../static/static-extension.ts';
import {StaticExtension} from '../static/static-extension.ts';
import type {StaticFile} from '../static/types.ts';
import {AsyncImports} from './async-imports.ts';
import {renderPageTemplate, type PageTemplatePage} from './scripts.ts';
import {SSRPageCache} from './ssr-page-cache.ts';
import {SSRRenderGroupCache} from './ssr-render-group-cache.ts';
import type {CommonOctironArgs, SSRView} from './types.ts';
import {escapeScript} from './escape-script.ts';

/**
 * Symbol used for locating action handlers created via this extension.
 */
const devExtensionSym = Symbol('https://extensions.occultist.dev/dev-extension');

/**
 * Used for adding meta information of the page's
 * javascript / typescript file.
 */
const pagePathSym = Symbol('https://extensions.occultist.dev/dev-extension#page-path');

/**
 * Used for adding meta information of the page's
 * render group.
 */
const renderGroupSym = Symbol('https://extensions.occultist.dev/dev-extension#render-group');


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
};

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
  groups?: RenderGroup<GroupName>[];
  files?: StaticExtensionArgs['files'];
  directories?: StaticExtensionArgs['directories'];
  nodeModulesDir: string;
  appDir: string;
  deps?: Partial<DevExtensionDeps>;
};

/**
 * Manages SSR of Mithril, Octiron and Longform applications.
 */
export class DevExtension<
  GroupName extends string = string,
> implements Extension {

  name: string = 'dev';
  
  #registry: Registry;
  #octironArgs: CommonOctironArgs;
  #groups: RenderGroup<GroupName>[];

  /**
   * Location of file defining the global default type handlers.
   */
  #defaultsDir: string;
  #globalsDir: string;
  #layoutsDir: string;
  #pagesDir: string;
  #typeHandlersDir: string;
  #componentsDir: string;
  #asyncImports = new AsyncImports();

  /**
   * Cache of all page info for faster SSR rendering.
   */
  #ssrPages: Map<string, SSRPageCache> = new Map();

  constructor(args: DevExtensionArgs<GroupName>) {
    this.#registry = args.registry;
    this.#defaultsDir = resolve(args.appDir, 'defaults');
    this.#globalsDir = resolve(args.appDir, 'globals');
    this.#layoutsDir = resolve(args.appDir, 'layouts');
    this.#pagesDir = resolve(args.appDir, 'pages'),
    this.#typeHandlersDir = resolve(args.appDir, 'type-handlers'),
    this.#componentsDir = resolve(args.appDir, 'components'),

    this.#groups = args.groups ?? [];
    this.#octironArgs = {
      rootIRI: args.registry.rootIRI,
      vocab: args.vocab,
      aliases: args.aliases,
      acceptMap: args.acceptMap,
    };
    
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

    new StaticExtension({
      registry: args.registry,
      cache: args.cache ?? new MemoryCache(args.registry),
      files: [
        ...(args.files ?? []),
        ...staticFiles
      ],
      directories: [
        ...(args.directories ?? []),
        {
          alias: 'globals',
          path: this.#globalsDir,
        },
        {
          alias: 'defaults',
          path: this.#defaultsDir,
        },
        {
          alias: 'layouts',
          path: this.#layoutsDir,
        },
        {
          alias: 'pages',
          path: this.#pagesDir,
        },
        {
          alias: 'type-handlers',
          path: this.#typeHandlersDir,
        },
        {
          alias: 'components',
          path: this.#componentsDir,
        },
      ],
    });

    // important to register this before the static extension.
    this.#registry.registerExtension(this);
    this.#registry.addEventListener('afterfinalize', this.#preloadPages);
  }

  setup(): ReadableStream {
    const { readable, writable } = new TransformStream();

    this.#setup(writable);

    return readable;
  }

  async #setup(writable: WritableStream): Promise<void> {
    const writer = writable.getWriter();
    const asyncImports = new AsyncImports();

    // global
    try {
      try {
        const path = join(this.#defaultsDir, 'type-handlers.ts');
        console.info(`Trying type handlers '${path}'`);

        const mod = await import(path);
        
        asyncImports.typeHandlers = mod.typeHandlers;
      } catch {}

      if (asyncImports.typeHandlers == null) {
        const path = join(this.#defaultsDir, 'type-handlers.js');

        console.info(`Trying type handlers '${path}'`);

        const mod = await import(path);
 
        asyncImports.typeHandlers = mod.typeHandlers;
      }

      console.info(`Imported "default/type-handlers.ts"`);
    } catch {
      console.warn(`No default type handlers found at "defaults/type-handlers.ts"`);
      asyncImports.typeHandlers = [];
    }

    // groups
    console.log(`Opening default layout at 'defaults/layout.lf'`);
    
    try {
      asyncImports.defaultLayout = await readFile(join(this.#defaultsDir, 'layout.lf'), 'utf-8');
    } catch {
      asyncImports.defaultLayout = defaultLayoutContent;
    }

    for (const fileName of await readdir(this.#layoutsDir)) {
      if (fileName.endsWith('.lf')) {
        const path = join(this.#layoutsDir, fileName);

        console.info(`Opening layout '${path}'`);

        const contents = await readFile(path, 'utf-8');

        asyncImports.groupLayouts.set(path, contents);
      }
    }

    // pages
    for (const fileName of await readdir(this.#pagesDir)) {
      if (fileName.endsWith('.ts') || fileName.endsWith('.js')) {
        const path = join(this.#pagesDir, fileName);

        console.info(`Importing page module '${path}'`);

        const mod = await import(path);
        const views: Map<string, SSRView> = new Map();

        for (const [key, value] of Object.entries(mod)) {
          if (typeof value === 'function') views.set(key, value as SSRView);
        }

        asyncImports.pageViews.set(path, views);
      }
    }

    this.#asyncImports = asyncImports;

    writer.write('Done');
    writer.releaseLock();
    writable.close();
  }

  /**
   * Fetches page info for all pages and related content created via
   * the registry and pre-caches their content for faster SSR rendering.
   */
  #preloadPages = () => {
    let typeHandlersJSAsset: StaticAsset | undefined;
    let resetCSSAsset: StaticAsset | undefined;
    let appCSSStaticAsset: StaticAsset | undefined;
    let defaultCSSStaticAsset: StaticAsset | undefined;
    const layoutCSSAssets: Map<string, StaticAsset> = new Map();
    const pageCSSAssets: Map<string, StaticAsset> = new Map();
    const asyncImports = this.#asyncImports;

    for (const staticAsset of this.#registry.queryStaticDirectories(['globals'])) {
      if (staticAsset.contentType === 'text/css') {
        if (staticAsset.alias === 'globals/reset.css') {
          resetCSSAsset = staticAsset;
        } else if (staticAsset.alias === 'globals/app.css') {
          appCSSStaticAsset = staticAsset;
        }
      }
    }

    for (const staticAsset of this.#registry.queryStaticDirectories(['defaults'])) {
      if (staticAsset.contentType === 'text/css' && staticAsset.alias === 'defaults/default.css') {
        defaultCSSStaticAsset = staticAsset;
      } else if (staticAsset.contentType === 'application/javascript' &&
                 typeHandlersJSAsset == null && (
                 staticAsset.alias === 'defaults/type-handlers.ts' ||
                 staticAsset.alias === 'defaults/type-handlers.js')) {
        typeHandlersJSAsset = staticAsset;
      }
    }

    // Query the registry for all css files located in the layouts directory.
    for (const staticAsset of this.#registry.queryStaticDirectories(['layouts'])) {
      if (staticAsset.contentType === 'text/css') {
        layoutCSSAssets.set(staticAsset.alias, staticAsset);
      }
    }

    // Query the registry for all css files located in the layouts directory.
    for (const staticAsset of this.#registry.queryStaticDirectories(['pages'])) {
      if (staticAsset.contentType === 'text/css') {
        pageCSSAssets.set(staticAsset.alias, staticAsset);
      }
    }

    let globalHead = '';

    for (const staticAsset of this.#registry.queryStaticAssets(styleNames)) {
      globalHead += `<link class=ssr rel=stylesheet href=${staticAsset.url} />`;
    }

    if (resetCSSAsset != null) {
      globalHead += `<link class=ssr rel="stylesheet" href="${resetCSSAsset.url}" />`;
    }

    if (appCSSStaticAsset != null) {
      globalHead += `<link class=ssr rel="stylesheet" href="${appCSSStaticAsset.url}" />`;
    }

    let mithrilURL: string;
    let octironURL: string;
    const imports = {};
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

    globalHead += `<script class=ssr type="importmap">${JSON.stringify({ imports })}</script>`;

    let defaultSSRRenderGroup: SSRRenderGroupCache | undefined;
    const ssrRenderGroups: Map<string, SSRRenderGroupCache> = new Map();

    // get the default page group
    let defaultCSS: string = '';
    const layout: ParsedResult = longform(asyncImports.defaultLayout);
    const layoutCSSStaticAsset = layoutCSSAssets.get(`defaults/layout.css`);

    if (layoutCSSStaticAsset != null) {
      defaultCSS = `<link class=ssr rel="stylesheet" href="${layoutCSSStaticAsset.url}" />`;
    } else if (defaultCSSStaticAsset != null) {
      defaultCSS = `<link class=ssr rel="stylesheet" href="${defaultCSSStaticAsset.url}" />`;
    }
    
    defaultSSRRenderGroup = new SSRRenderGroupCache(
      'default',
      globalHead,
      defaultCSS,
      layout,
    );

    // fetch all named page groups
    for (let i = 0, length = this.#groups.length; i < length; i++) {
      const { name, layout: layoutPath } = this.#groups[i];

      // if the layout is null the default page group will be used.
      if (layoutPath == null) continue;

      let defaultCSS: string = '';
      const contents = asyncImports.groupLayouts.get(join(this.#layoutsDir, layoutPath + '.lf'));
      const layout = longform(contents);
      const layoutCSSStaticAsset = layoutCSSAssets.get(`layouts/${layoutPath}.css`);

      if (layoutCSSStaticAsset != null) {
        defaultCSS = `<link class=ssr rel="stylesheet" href="${layoutCSSStaticAsset.url}" />`;
      } else if (defaultCSSStaticAsset != null) {
        defaultCSS = `<link class=ssr rel="stylesheet" href="${defaultCSSStaticAsset.url}" />`;
      }
      
      ssrRenderGroups.set(name, new SSRRenderGroupCache(
        name,
        globalHead,
        defaultCSS,
        layout,
      ));
    }

    // Need info on each Javascript file to configure the client side router.
    const pageStaticAssets = new Map<string, StaticAsset>();

    for (const staticAsset of this.#registry.queryStaticDirectories(['pages'])) {
      if (staticAsset.contentType === 'application/javascript') {
        pageStaticAssets.set(staticAsset.alias, staticAsset);
      }
    }

    // get all handlers for html endpoints managed by the dev extension.
    const handlers = this.#registry.query({
      contentType: 'text/html',
      meta: devExtensionSym,
    });

    const defaultModHandlers: HandlerDefinition[] = [];
    const modHandlersByGroup: Map<string, HandlerDefinition[]> = new Map();
    for (let i = 0, length = handlers.length; i < length; i++) {
      const handler = handlers[i];
      const groupName = handler.meta[renderGroupSym];

      if (typeof groupName === 'string') {
        if (modHandlersByGroup.has(groupName)) {
          modHandlersByGroup.get(groupName).push(handler);
        } else {
          modHandlersByGroup.set(groupName, [handler]);
        }
      } else {
        defaultModHandlers.push(handler);
      }
    }

    const ssrPages: Map<string, SSRPageCache> = new Map();

    for (let i = 0, length = handlers.length; i < length; i++) {
      let ssrRenderGroup: SSRRenderGroupCache;
      const handler = handlers[i];
      const groupName = handler.meta[renderGroupSym];
      const pagePath = handler.meta[pagePathSym];

      if (typeof pagePath !== 'string')
        throw new Error(`Handler '${handler.action.route.template}' not created via Dev Extension`);

      if (typeof groupName === 'string') {
        ssrRenderGroup = ssrRenderGroups.get(groupName) ?? defaultSSRRenderGroup;
      } else {
        ssrRenderGroup = defaultSSRRenderGroup;
      }

      let head: string = ssrRenderGroup.globalHead;
      let views: Map<string, SSRView>;

      try {
        views = asyncImports.pageViews.get(join(this.#pagesDir, `${pagePath}.ts`));
      } catch { }

      if (views == null) {
        try {
          views = asyncImports.pageViews.get(join(this.#pagesDir, `${pagePath}.js`));
        } catch (err) {
          throw new Error(`Module for page '${handler.action.route.template} not found`);
        }
      }

      const pageCSSStaticAsset = pageCSSAssets.get(`layouts/${pagePath}.css`);

      if (pageCSSStaticAsset != null) {
        head += `<link class=ssr rel="stylesheet" href="${pageCSSStaticAsset.url}" />`;
      } else {
        head += ssrRenderGroup.defaultCSS ?? '';
      }

      let modHandlers: HandlerDefinition[];
      
      if (typeof groupName === 'string') {
        modHandlers = modHandlersByGroup.get(groupName);
      } else {
        modHandlers = defaultModHandlers;
      }

      let staticAsset: StaticAsset;
      const pages: PageTemplatePage[] = [];

      for (let i = 0, length = modHandlers.length; i < length; i++) {
        const pagePath = modHandlers[i].meta[pagePathSym];
        staticAsset = pageStaticAssets.get(`pages/${pagePath}.ts`)
          ?? pageStaticAssets.get(`pages/${pagePath}.js`);

        pages.push({
          re: modHandlers[i].action.route.regexpRaw,
          importPath: staticAsset.url,
        });
      }

      head += renderPageTemplate({
        mithrilURL,
        octironURL,
        typeHandlersURL: typeHandlersJSAsset?.url,
        octironArgs: this.#octironArgs,
        pages,
      });

      ssrPages.set(pagePath, new SSRPageCache(
        pagePath,
        escapeScript(head),
        ssrRenderGroup.layout,
        views,
        asyncImports.typeHandlers,
      ));
    }

    this.#ssrPages = ssrPages;
    this.#asyncImports = null;
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
      handler: (ctx) => this.renderPage(ctx, pagePath),
    };
  }

  /**
   * Renderers a SSR page, adding the result and any returned HTTP status
   * to the request handler's context.
   *
   * @param ctx The handler's request context.
   * @param pagePath Absolute path to the page.
   */
  async renderPage(ctx: Context, pagePath: string): Promise<void> {
    const page = this.#ssrPages.get(pagePath);
    
    await this.#renderPage(
      ctx,
      page,
    );
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
   *
   * @param ctx The request context.
   * @param page The SSR Page object.
   */
  async #renderPage(
    ctx: Context,
    page: SSRPageCache,
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
      typeHandlers: page.typeHandlers,
      handlers: [
        this.jsonLDHandler(),
        longformHandler,
        problemDetailsJSONHandler,
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

    for (let i = 0; i < page.layout.mountPoints.length; i++) {
      // A longform layout can set multiple mountpoints.
      // This behaviour has similar results to the server
      // islands architecture and uses Mithril's mounting
      // behaviour which can mount more than one DOM node
      // and be targeted by `m.redraw()` globally.
      const mountPoint = page.layout.mountPoints[i];
      const view = page.views.get(mountPoint.id);

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

    html += page.layout.tail ?? '';
    html = html.replace(/<\/head>/, page.head + '</head>');

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
