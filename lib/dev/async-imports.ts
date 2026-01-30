import type {TypeHandler} from "@octiron/octiron";
import type {SSRView} from "./types.ts";


export class AsyncImports {
  typeHandlers!: TypeHandler<any>[];
  defaultLayout!: string;
  groupLayouts: Map<string, string> = new Map();
  pageViews: Map<string, Map<string, SSRView>> = new Map();
}
