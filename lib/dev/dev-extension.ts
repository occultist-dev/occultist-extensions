import { longform, type ParsedResult } from '@longform/longform';
import m from 'mithril';
import render from 'mithril-node-render';
import {type StaticExtension, type Extension, type Registry, type HandlerArgs, type ContextState, type Context} from "@occultist/occultist";
import {readFile} from 'fs/promises';
import {resolve} from 'path';
import {CommonOctironArgs, type SSRView} from './types.ts';
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

export type RenderStyle =
  | 'empty'
  | 'ssr'
  | 'minimal'
  | 'jit'
;

export type RenderGroup = {
  name: string;
  layout?: string;
  renderStyle: RenderStyle;
}

export type DevExtensionArgs = {
  registry: Registry;
  staticExtension: StaticExtension;
  layout?: string;
  renderStyle?: RenderStyle;
  configFile: string;
  groups: RenderGroup[];
  layoutsDir: string;
  pagesDir: string;
};

export class DevExtension<
  State extends ContextState = ContextState,
> implements Extension {

  name: string = 'dev';
  
  #registry: Registry;
  #configFile: string;
  #octironArgs: CommonOctironArgs;
  #renderStyle: RenderStyle;
  #layout?: string;
  #groups: RenderGroup[];
  #groupByName: Map<string, RenderGroup> = new Map();
  #layoutsDir: string;
  #pagesDir: string;
  #defaultLayout?: ParsedResult;
  #layouts: Map<string, ParsedResult>;

  constructor(args: DevExtensionArgs) {
    this.#configFile = args.configFile;
    this.#registry = args.registry;
    this.#renderStyle = args.renderStyle ?? 'ssr';

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

  handlePage(pagePath: string, renderGroup?: string): HandlerArgs<State> {
    let layout

    return {
      contentType: 'text/html',
      meta: {
        [pagePathSym]: pagePath,
        [renderGroupSym]: renderGroup,
      },
      handler: (ctx) => this.renderPage(pagePath, renderGroup, ctx),
    };
  }

  onBeforeFinalize = () => {
    
  };

  async renderPage(ctx: Context, pagePath: string, renderGroup?: string): Promise<void> {
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
