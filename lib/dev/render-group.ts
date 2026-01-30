import type {ParsedResult} from "@longform/longform";
import type {SSRView} from "./types.ts";


/**
 * Holds all info / cached values for a render group
 * to be used when SSR rendering a page.
 */
export class SSRRenderGroupCache {

  /**
   * The render group's name
   */
  name: string;

  /**
   * Global head elements rendered as HTML.
   */
  globalHead: string;

  /** 
   * Default css rendered to HTML if present and not overwritten.
   */
  defaultCSS: string;

  /**
   * The longform template to render.
   */
  layout: ParsedResult;

  /**
   * The default views to use when rendering.
   * TODO: Requires method for fetching layout from client.
   */
  defaultViews: Map<string, SSRView> = new Map();

  constructor(
    name: string,
    globalHead: string,
    defaultCSS: string,
    layout: ParsedResult,
  ) {
    this.name = name;
    this.globalHead = globalHead;
    this.defaultCSS = defaultCSS;
    this.layout = layout;
  }

};


