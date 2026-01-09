import {join} from "node:path";

export type FileInfo = {

  /**
   * The name of the file.
   */
  name: string;

  /**
   * Path of the file relative to the configured directory.
   */
  relativePath: string;

  /**
   * Full path to the file.
   */
  absolutePath: string;

  /**
   * The alias to the directory where the file is located in.
   */
  directoryAlias: string;

  /**
   * The file's extension.
   */
  extension: string;

  /**
   * The file's language if detected.
   */
  lang?: string;

  /**
   * The file's content type.
   */
  contentType: string;

  /**
   * This files directory + relative path + name.
   */
  alias: string;

  /**
   * The hash of the original file contents.
   */
  hash: string;

  /**
   * The URL of the file.
   */
  url: string;

  /**
   * alias url for this resource.
   */
  aliasURL: string;

}

/**
 * Contains information about a static file.
 */
export class WorkingFileInfo {

  /**
   * The name of the file.
   */
  name: string;

  /**
   * Path of the file relative to the configured directory.
   */
  relativePath: string;

  /**
   * Full path to the file.
   */
  absolutePath: string;

  /**
   * The alias to the directory where the file is located in.
   */
  directoryAlias: string;

  /**
   * The file's extension.
   */
  extension: string;

  /**
   * The file's language if detected.
   */
  lang?: string;

  /**
   * The file's content type.
   */
  contentType: string;

  /**
   * This files directory + relative path + name.
   */
  alias: string;

  /**
   * The hash of the original file contents.
   */
  hash: string | null = null;

  /**
   * The URL of the file.
   */
  url: string | null = null;

  /**
   * alias url for this resource.
   */
  aliasURL: string | null = null;

  constructor(
    solo: boolean,
    name: string,
    alias: string,
    relativePath: string,
    absolutePath: string,
    extension: string,
    contentType: string,
    lang?: string,
  ) {
    this.name = name;
    this.directoryAlias = alias
    this.relativePath = relativePath;
    this.absolutePath = absolutePath;
    this.extension = extension;
    this.contentType = contentType;
    this.lang = lang;

    if (solo) {
      this.alias = alias;
    } else {
      this.alias = join(alias, relativePath);
    }
  }

  finalize(
    hash: string,
    url: string,
    aliasURL: string,
  ) {
    this.hash = hash;
    this.url = url;
    this.aliasURL = aliasURL;

    Object.freeze(this);
  }

}
