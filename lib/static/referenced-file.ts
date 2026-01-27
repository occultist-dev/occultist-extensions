import {type FileInfo} from "./file-info.ts";
import type {FilesByAlias, FilesByURL} from "./types.ts";


export function referencedFile(
  reference: string,
  containingFile: FileInfo,
  filesByURL: FilesByURL,
  filesByAlias: FilesByAlias,
): FileInfo | undefined {
  if (reference.startsWith('@') || !reference.includes('/')) {
    const ref = filesByAlias.get(reference);

    return ref;
  } else if (reference.startsWith('#')) {
    const alias = reference.replace(/^\#/, '/');
    const ref = filesByAlias.get(alias);

    return ref;
  }

  const url = new URL(reference, containingFile.aliasURL).toString();
  const ref = filesByURL.get(url);

  return ref;
}
