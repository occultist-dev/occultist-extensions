import type {ParsedResult} from "@longform/longform";
import type {SSRView} from "./types.ts";
import type {TypeHandler} from "@octiron/octiron";


/**
 * Holds all info / cached values to be used when
 * SSR rendering a page.
 */
export class SSRPageCache {

  /**
   * The page path.
   */
  path: string;

  /**
   * Content to add to the page's HTML head tag.
   */
  head: string;

  /**
   * The longform template to render.
   */
  layout: ParsedResult;

  /**
   * The views to use when rendering.
   */
  views: Map<string, SSRView>;

  typeHandlers: TypeHandler[];

  constructor(
    path: string,
    head: string,
    layout: ParsedResult,
    views: Map<string, SSRView>,
    typeHandlers: TypeHandler[],
  ) {
    this.path = path;
    this.head = head;
    this.layout = layout;
    this.views = views;
    this.typeHandlers = typeHandlers;
  }
}
