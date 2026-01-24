import type {FileInfo} from "./file-info.ts";
import type {PolicyDirective, ReferenceDetails} from "./types.ts";


export class DependencyMap {
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

export class DependencyGraph {
  dependencies: Map<string, DependencyMap> = new Map();
  
  constructor(dependencies: Map<string, DependencyMap>) {
    this.dependencies = dependencies;

    for (const dependencyMap of this.dependencies.values()) {
      for (let i = 0; i < dependencyMap.references.length; i++) {
        const reference = dependencyMap.references[i];

        if (reference.file == null) {
          console.warn(`Unknown dependency reference ${reference.url}`);
          
          continue;
        }

        const other = this.dependencies.get(reference.file.alias);

        if (other == null) {
          continue;
        }
     
        for (let j = 0; j < other.references.length; j++) {
          dependencyMap.references.push(other.references[j]);
        }
      }

      dependencyMap.finalize();
    }
    
    Object.freeze(this.dependencies);
    Object.freeze(this);
  }

  /**
   * Returns a debug string for this dependancy graph.
   */
  debug(): string {
    let debug = 'Dependency Graph\n----------------\n\n';
    let dependency: DependencyMap;
    const dependencies = Array.from(this.dependencies.values());

    for (let i = 0; i < dependencies.length; i++) {
      if (i !== 0) debug += '\n';

      dependency = dependencies[i];
      debug += dependency.file.alias + '\n';

      const polices = Array.from(dependency.polices.entries());
      
      if (polices.length === 0) {
        debug += `  No dependencies\n`;
        continue;
      }
      
      for (const [policy, references] of dependency.polices.entries()) {
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

