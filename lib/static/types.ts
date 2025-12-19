import type {DependancyMap} from "./dependancy-graph.ts";
import type {FileInfo} from "./file-info.ts";


export type PolicyDirective =
  | 'child-src'
  | 'connect-src'
  | 'default-src'
  | 'fenced-frame-src'
  | 'font-src'
  | 'frame-src'
  | 'img-src'
  | 'manifest-src'
  | 'media-src'
  | 'object-src'
  | 'script-src'
  | 'script-src-elm'
  | 'script-src-attr'
  | 'style-src'
  | 'style-src-elm'
  | 'style-src-attr'
  | 'worker-src'
;

export type Directory = {
  alias: string;
  path: string;
};

export type ReferenceDetails = {
  url: string;
  directive: PolicyDirective;
  file?: FileInfo;
};

export interface ReferenceParser {

  /**
   * List of content types this parser can handle.
   */
  contentTypes: string[];

  /**
   * Method to parse matching files to a dependancy graph.
   */
  parse(files: FileInfo[]): Promise<Map<string, DependancyMap>>;

}
