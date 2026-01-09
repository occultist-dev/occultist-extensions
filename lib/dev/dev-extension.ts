import {longform, type ParsedResult} from '@longform/longform';
import {ActionSpec, AuthState, ImplementedAction, type Context, type ContextState, type Extension, type HandlerArgs, type Registry, type StaticAssetExtension} from "@occultist/occultist";
import {JSONLDHandler, JSONObject, longformHandler, octiron, StoreArgs, type Fetcher, type ResponseHook} from '@octiron/octiron';
import {readFile} from 'fs/promises';
import jsonld from 'jsonld';
import {type RemoteDocument} from 'jsonld/jsonld-spec.js';
import m from 'mithril';
import render from 'mithril-node-render';
import {resolve} from 'path';
import {CommonOctironArgs, SSRModule, type SSRView} from './types.ts';
import {register} from 'module';



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
  
}

export type DotDevExtensionArgs<
  GroupName extends string = string,
> = {
  vocab?: StoreArgs['vocab'];
  aliases?: StoreArgs['aliases'];
  acceptMap?: StoreArgs['acceptMap'];
  registry: Registry;
  staticExtension: StaticAssetExtension;
  scripts?: string[];
  styles?: string[];
  layout?: string;
  groups?: RenderGroup<GroupName>[];
  layoutsDir: string;
  pagesDir: string;
};

export class DotDevExtension<
  GroupName extends string = string,
> implements Extension {

  name: string = 'dev';
  
  #registry: Registry;
  #staticExtension: StaticAssetExtension;
  #octironArgs: CommonOctironArgs;
  #layout?: string;
  #groups: RenderGroup<GroupName>[];
  #groupByName: Map<string, RenderGroup<GroupName>> = new Map();
  #layoutsDir: string;
  #pagesDir: string;
  #defaultLayout?: ParsedResult;
  #layouts: Map<string, ParsedResult>;
  #headContent: string;
  #headContents: Map<string, string> = new Map();
  #styles: Map<string, ImplementedAction>;
  #scripts: Map<string, ImplementedAction>;

  constructor(args: DotDevExtensionArgs<GroupName>) {
    this.#registry = args.registry;
    this.#staticExtension = args.staticExtension;

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
    const defaultLayout = longform(layout);

    console.log('DEF LAY', defaultLayout);

    this.#defaultLayout = defaultLayout;
                                      
    for (let i = 0; i < this.#groups  .length; i++) {
      if (this.#groups[i].layout == null) {
        this.#layouts.set(this.#groups[i].name, defaultLayout);

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
    const tsFile = resolve(this.#pagesDir, pagePath + '.ts');
    const jsFile = resolve(this.#pagesDir, pagePath + '.js');

    console.log(tsFile);

    const [jsMod, tsMod] = await Promise.allSettled([
      import(resolve(this.#pagesDir, pagePath + '.ts')),
      import(resolve(this.#pagesDir, pagePath + '.js')),
    ]);

    const mod: SSRModule = tsMod.status === 'fulfilled'
      ? tsMod.value
      : jsMod.status === 'fulfilled'
      ? jsMod.value
      : undefined;
      
    console.log('MOD', mod);

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

      console.log('LAYOUT', layout);

    if (layout == null || !layout.mountable) return;

    const mod = await this.loadModule(pagePath);
    
    await this.#renderPage(
      ctx,
      layout,
      mod,
      '',
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
    const cache: Record<string, RemoteDocument> = {};

    return {
      contentType: 'application/ld+json',
      integrationType: 'jsonld',
      handler: async ({ res }) => {
        const json = await res.json();
        const expanded = await jsonld.expand(
          json,
          {
            documentLoader: async (url: string) => {
              if (Object.hasOwn(cache, url)) {
                return {
                  document: cache[url],
                  documentUrl: url,
                };
              }

              if (typeof url === 'string') {
                const req = new Request(url, {
                  headers: {
                    'Accept': 'application/ld+json',
                  },
                });
                const res = await this.#registry.handleRequest(req);
                const document = await res.json();

                cache[url] = document;

                return {
                  document,
                  documentUrl: url,
                };
              }

              throw new Error('Could not find @context "' + url + '"');
            },
          },
        );

        const compacted = await jsonld.compact(expanded) as JSONObject;

        return { jsonld: compacted };
      },
    };
  }

}
