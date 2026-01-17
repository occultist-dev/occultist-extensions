import {longform, type ParsedResult} from '@longform/longform';
import {expand, JSONLDContextStore} from '@occultist/mini-jsonld';
import {MemoryCache, type ActionSpec, type AuthState, type Cache, type Context, type ContextState, type Extension, type HandlerArgs, type Registry} from "@occultist/occultist";
import {JSONLDHandler, longformHandler, octiron, StoreArgs, type Fetcher, type ResponseHook} from '@octiron/octiron';
import m from 'mithril';
import render from 'mithril-node-render';
import {readFile, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {StaticExtension} from '../mod.ts';
import {StaticFile} from '../static/types.ts';
import {CommonOctironArgs, SSRModule, type SSRView} from './types.ts';



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
  #groups: RenderGroup<GroupName>[];
  #groupByName: Map<string, RenderGroup<GroupName>> = new Map();
  #layoutsDir: string;
  #pagesDir: string;
  #defaultLayout?: ParsedResult;
  #layouts: Map<string, ParsedResult>;
  #static: StaticExtension;

  constructor(args: DevExtensionArgs<GroupName>) {
    this.#registry = args.registry;
    //this.#staticExtension = args.staticExtension;

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
    });

    this.#registry.registerExtension(this);
    //this.#registry.addEventListener('beforefinalize', this.onBeforeFinalize);
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

  /**
   * Loads module for a page and its render group.
   *
   * Modules can be in javascript or typescript and are located in
   * the pages directory.
   */
  async loadModule(pagePath: string): Promise<SSRModule> {
    let mod: SSRModule | undefined;
    const tsFile = resolve(this.#pagesDir, pagePath + '.ts');
    const jsFile = resolve(this.#pagesDir, pagePath + '.js');
    try {
      await stat(tsFile);
      mod = await import(tsFile);
    } catch {
      try {
        await stat(jsFile);
        mod = await import(jsFile);
      } catch {}
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

    const mod = await this.loadModule(pagePath);

    let head: string = '';
    
    for (const staticAsset of this.#static.queryStaticAssets(scriptNames)) {
      console.log(staticAsset.alias);
      console.log(staticAsset.url);

      head += `<script type="module" src="${staticAsset.url}"></script>`;
    }

    //console.log(this.#static.dependancies);
    
    await this.#renderPage(
      ctx,
      layout,
      mod,
      head,
    );
  }

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
      handlers: [
        this.jsonLDHandler(),
        longformHandler,
      ],
    });

    async function renderDOM(component: m.ComponentTypes): Promise<string> {
      do {
        let loopLength = currentLength = responses.length;

        await render(m(component, { o, location } as m.Attributes));

        while (loopLength !== responses.length) {
          loopLength = responses.length;

          await Promise.all(responses);

          count++;
        }
      } while (responses.length !== currentLength)

      return render(m(component, { o, location } as any));

    }

    let view: SSRView;
    let mountPoint: ParsedResult['mountPoints'][0];
    for (let i = 0; i < layout.mountPoints.length; i++) {
      mountPoint = layout.mountPoints[i];
      
      html += mountPoint.part;
      view = mod[mountPoint.id];

      if (view == null) continue;

      const component = {
        view() {
          return view({ o, location, state: {} });
        },
      };
      const fragment = await renderDOM(component);
      
      html += fragment;
      renderedMountPoints.push(mountPoint.id);
    }

    const initialState = o.store.toInitialState();
    const mountPointState = `<script id="mount-points" types="application/json">${JSON.stringify(renderedMountPoints)}</script>`;

    html += layout.tail ?? '';
    html = html.replace(/<\/head>/, headContent + '</head>');
    html = html.replace(/<\/body><\/html>$/, mountPointState + initialState + '</body></html>');

    ctx.status = o.store.httpStatus ?? 200;
    ctx.body = html;
  }

  jsonLDHandler(): JSONLDHandler {
    const cache: Record<string, any> = {};
    const store = new JSONLDContextStore({
      fetcher: (url: string, init: RequestInit) => this.#registry.handleRequest(
        new Request(url, init),
      ),
    });

    return {
      contentType: 'application/ld+json',
      integrationType: 'jsonld',
      handler: async ({ res }) => {
        const json = await res.json();

        return { jsonld: await expand(json) };
      },
    };
  }

}
