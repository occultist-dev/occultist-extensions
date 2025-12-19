import {join} from "node:path";


/**
 * Contains information about a static file.
 */
export class FileInfo {

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

  constructor(
    name: string,
    directoryAlias: string,
    relativePath: string,
    absolutePath: string,
    extension: string,
    contentType: string,
    lang?: string,
  ) {
    this.name = name;
    this.directoryAlias = directoryAlias
    this.relativePath = relativePath;
    this.absolutePath = absolutePath;
    this.extension = extension;
    this.contentType = contentType;
    this.lang = lang;
    this.alias = join(directoryAlias, relativePath);

    Object.freeze(this);
  }

}
