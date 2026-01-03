import type {DependancyMap} from "./dependancy-graph.ts";
import type {FileInfo} from "./file-info.ts";


export type FilesByURL = Map<string, FileInfo>;

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

export type StaticFile = {
  alias: string;
  path: string;
};

export type StaticDirectory = {
  alias: string;
  path: string;
};

export type ReferenceDetails = {
  url: string;
  directive?: PolicyDirective;
  file?: FileInfo;
};
  
/**
 * An object with methods for parsing URL references
 * within supporting content types and then embedding
 * URLs generated for the referenced static assets by
 * the framework.
 */
export interface ReferenceParser {

  /**
   * A set of content types supported by this reference parser.
   */
  readonly supports: Set<string>;

  /**
   * Parses URLs referenced in a file's content and
   * returns a dependancy map of all references.
   *
   * @param content The file content to update.
   * @param file File info object relating to the file.
   * @returns A dependancy map of all references.
   */
  parse(
    content: Blob,
    file: FileInfo,
    filesByURL: FilesByURL,
  ): Promise<ReferenceDetails[]>;
  
  /**
   * Updates a file's embedded hyperlinks to point to
   * final URLs of other static content.
   *
   * @param file File info object.
   * @returns content with URLs updated.
   */
  update(
    content: Blob,
    file: FileInfo,
    filesByURL: FilesByURL,
  ): Promise<Blob>;

}

export interface ReferencePreprocessor {

  /**
   * A set of content types supported by this reference parser.
   */
  readonly supports: Set<string>;

  /**
   * Content type the pre-processor outputs.
   */
  readonly output: string;

  /**
   * Parses URLs referenced in a file's content and
   * returns a dependancy map of all references.
   *
   * @param content The file content to update.
   * @param file File info object relating to the file.
   * @returns A dependancy map of all references.
   */
  parse(
    content: Blob,
    file: FileInfo,
    filesByURL: FilesByURL,
  ): Promise<ReferenceDetails[]>;
  
  /**
   * Updates a file's embedded hyperlinks to point to
   * final URLs of other static content.
   *
   * @param file File info object.
   * @returns content with URLs updated.
   */
  process(
    content: Blob,
    file: FileInfo,
    filesByURL: FilesByURL,
  ): Promise<Blob>;

}

