import { longform, type ParsedResult } from '@longform/longform';
import m from 'mithril';
import render from 'mithril-node-render';
import {type StaticExtension, type Extension, type Registry, type HandlerArgs, type ContextState, type Context, ImplementedAction} from "@occultist/occultist";
import {readFile} from 'fs/promises';
import {resolve} from 'path';
import {CommonOctironArgs, SSRModule, type SSRView} from './types.ts';
import {compact, expand} from 'jsonld';
import {type RemoteDocument} from 'jsonld/jsonld-spec.js';
import {JSONLDHandler, JSONObject, JSONValue, longformHandler, octiron, type Fetcher, type ResponseHook} from '@octiron/octiron';
import {Parser} from 'acorn';


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

export type DevExtensionArgs<
  GroupName extends string = string,
> = {
  registry: Registry;
  staticExtension: StaticExtension;
  scripts?: string[];
  styles?: string[];
  layout?: string;
  configFile: string;
  groups: RenderGroup<GroupName>[];
  layoutsDir: string;
  pagesDir: string;
};

export class DevExtension<
  State extends ContextState = ContextState,
  GroupName extends string = string,
> implements Extension {

  name: string = 'dev';
  
  #registry: Registry;
  #staticExtension: StaticExtension;
  #configFile: string;
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

  constructor(args: DevExtensionArgs<GroupName>) {
    this.#configFile = args.configFile;
    this.#registry = args.registry;
    this.#staticExtension = args.staticExtension;

    this.#layout = args.layout;
    this.#layoutsDir = args.layoutsDir;
    this.#pagesDir = args.pagesDir;
    this.#groups = args.groups ?? [];

    for (let i = 0; i < this.#groups.length; i++) {
      this.#groupByName.set(this.#groups[i].name, this.#groups[i]);
    }

    this.#registry.addEventListener('beforefinalize', this.onBeforeFinalize);
  }

  setup(): ReadableStream {
    const { readable, writable } = new TransformStream();

    this.#setup(writable);

    return readable;
  }

  async #setup(writable: WritableStream): Promise<void> {
    const writer = writable.getWriter();

    writer.write('Reading Octiron config file "' + this.#configFile + '"');
    const config = await import(this.#configFile);
    
    this.#octironArgs = config.default;

    writer.write('Compiling longform layouts');
    const path = resolve(this.#layoutsDir, this.#layout);
    const layout = await readFile(path, 'utf-8') ?? defaultLayoutContent;
    const defaultLayout = longform(layout);

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

    writable.close();
  }

  /**
   * Loads module for a page and its render group.
   *
   * Modules can be in javascript or typescript and are located in
   * the pages directory.
   */
  async loadModule(pagePath: string): Promise<SSRModule> {
    const [jsMod, tsMod] = await Promise.allSettled([
      import(resolve(this.#pagesDir, pagePath + '.ts')),
      import(resolve(this.#pagesDir, pagePath + '.js')),
    ]);

    const mod: SSRModule = tsMod.status === 'fulfilled'
      ? tsMod.value
      : jsMod.status === 'fulfilled'
      ? jsMod.value
      : undefined;

    if (mod == null) throw new Error('Module for page "' + pagePath + '" not found');

    return mod;
  }

  /**
   * Uses the framework extension to render a HTML page.
   *
   * @param pagePath Path relating to the pages directory for the
   *   Typescript or Javascript module which exposes the render views.
   * @param renderGroup An optional render group that this page belongs
   *   to, allowing client side navigation and state presivation between
   *   pages in the group.
   */
  handlePage(pagePath: string, renderGroup?: GroupName): HandlerArgs<State> {
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
      : this.#layouts.get(renderGroup);

    if (layout == null || !layout.mountable) return;

    const mod = await import(resolve(this.#pagesDir, pagePath));
    
  }

  async renderLayout(
    ctx: Context,
    layout: ParsedResult,
    mod: Record<string, SSRView>,
    headContent: string = '',
  ): Promise<void> {
    let html: string = '';
    let count = 0;
    let currentLenght = 0;
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
        let loopLength = currentLenght = responses.length;

        await render(m(component, { o, location }));

        while (loopLength !== responses.length) {
          loopLength = responses.length;

          await Promise.all(responses);

          count++;
        }
      } while (responses.length !== currentLenght)

      return render(m(component, { o, location } as any));

    }

    let view: SSRView;
    let mountPoint: ParsedResult['mountPoints'][0];
    for (let i = 0; i < layout.mountPoints.length; i++) {
      html += mountPoint.part;

      mountPoint = layout.mountPoints[i]
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
        const expanded = await expand(
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

        const jsonld = await compact(expanded) as JSONObject;

        return { jsonld };
      },
    };
  }

}
