import {type FileInfo} from "./file-info.ts";
import type {FilesByAlias, FilesByURL, PolicyDirective, ReferenceDetails} from "./types.ts";


export function referencedFile(
  reference: string,
  containingFile: FileInfo,
  filesByURL: FilesByURL,
  filesByAlias: FilesByAlias,
): FileInfo | undefined {
  if (reference.startsWith('@') || !reference.includes('/')) {
    const ref = filesByAlias.get(reference);

    return ref;
  }

  const url = new URL(reference, containingFile.aliasURL).toString();
  const ref = filesByURL.get(url);

  return ref;
}

export function referencedDependancy(
  reference: string,
  containingFile: FileInfo,
  filesByURL: FilesByURL,
  filesByAlias: FilesByAlias,
  directive?: PolicyDirective,
): ReferenceDetails {
  const file = referencedFile(
    reference,
    containingFile,
    filesByURL,
    filesByAlias,
  );

  if (file == null) {
    return {
      url: new URL(reference, containingFile.aliasURL).toString(),
      directive,
    };
  }

  return {
    url: file.url,
    directive,
    file,
  };
}
