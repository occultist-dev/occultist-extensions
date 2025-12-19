import {FileInfo} from "./file-info.ts";
import type {PolicyDirective, ReferenceDetails} from "./types.ts";


export class DependancyMap {
  file: FileInfo;
  references: ReferenceDetails[];
  polices: Map<PolicyDirective, ReferenceDetails[]> = new Map();

  constructor(file: FileInfo, references: ReferenceDetails[]) {
    this.file = file;
    this.references = references;

    let reference: ReferenceDetails;
    let policies: ReferenceDetails[];
    for (let i = 0; i < references.length; i++) {
      reference = references[i];
      policies = this.polices.get(reference.directive);

      if (policies == null) {
        policies = [];
        this.polices.set(reference.directive, policies);
      }

      policies.push(reference);
    }

    Object.freeze(this.references);
    Object.freeze(this.polices);
    Object.freeze(this);
  }
}

export class DependancyGraph {
  dependancies: Map<string, DependancyMap> = new Map();
  
  constructor(dependancies: Map<string, DependancyMap>) {
    this.dependancies = dependancies;
    
    Object.freeze(this.dependancies);
    Object.freeze(this);
  }

  /**
   * Returns a debug string for this dependancy graph.
   */
  debug(): string {
    let debug = 'Dependancy Graph\n----------------\n\n';
    let dependancy: DependancyMap;

    const dependancies = Array.from(this.dependancies.values());
    for (let i = 0; i < dependancies.length; i++) {
      if (i !== 0) debug += '\n';

      dependancy = dependancies[i];
      debug += `${dependancy.file.alias}\n`;

      const polices = Array.from(dependancy.polices.entries());
      
      if (polices.length === 0) {
        debug += `  No dependancies\n`;
        continue;
      }
      
      for (const [policy, references] of dependancy.polices.entries()) {
        debug += `  ${policy}\n`;

        for (let j = 0; j < references.length; j++) {
          debug += `    ${references[j].url}\n`;
        }
      }
    }

    debug += '----------------\n';
    return debug;
  }
}

