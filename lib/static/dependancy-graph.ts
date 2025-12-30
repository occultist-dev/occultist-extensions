import type {FileInfo} from "./file-info.ts";
import type {PolicyDirective, ReferenceDetails} from "./types.ts";


export class DependancyMap {
  file: FileInfo;
  references: ReferenceDetails[];
  polices: Map<PolicyDirective, ReferenceDetails[]> = new Map();

  constructor(file: FileInfo, references: ReferenceDetails[]) {
    this.file = file;
    this.references = references;
  }

  finalize() {
    let reference: ReferenceDetails;
    let policies: ReferenceDetails[];

    for (let i = 0; i < this.references.length; i++) {
      reference = this.references[i];
      policies = this.polices.get(reference.directive);

      if (policies == null) {
        policies = [];
        this.polices.set(reference.directive, policies);
      }

      policies.push(reference);
    }
  }
}

export class DependancyGraph {
  dependancies: Map<string, DependancyMap> = new Map();
  
  constructor(dependancies: Map<string, DependancyMap>) {
    this.dependancies = dependancies;

    for (const dependancyMap of this.dependancies.values()) {
      for (let i = 0; i < dependancyMap.references.length; i++) {
        const reference = dependancyMap.references[i];

        if (reference.file == null) {
          console.warn(`Unknown dependancy reference ${reference.url}`);
          
          continue;
        }

        const other = this.dependancies.get(reference.file.alias);

        if (other == null) {
          continue;
        }
     
        for (let j = 0; j < other.references.length; j++) {
          dependancyMap.references.push(other.references[j]);
        }
      }

      dependancyMap.finalize();
    }
    
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
      debug += dependancy.file.alias + '\n';

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

