import {createPrinter, createSourceFile, factory, forEachChild, isCallExpression, isImportDeclaration, isStringLiteral, ModuleKind, NewLineKind, type Node, ScriptTarget, type SourceFile, type StringLiteral, SyntaxKind, transform, type TransformerFactory, transpileModule, visitEachChild, visitNode} from 'typescript';
import {type FileInfo} from './file-info.ts';
import type {FilesByAlias, FilesByURL, ReferenceDetails, ReferencePreprocessor} from './types.ts';
import {referencedFile} from './referenced-file.ts';
import {referencedDependency} from './referenceURL.ts';
import {minify} from 'terser';


export class TSReferencePreprocessor implements ReferencePreprocessor {

  supports: Set<string> = new Set(['ts', 'mts', 'cts']);

  readonly output: 'application/javascript';

  async parse(
    content: Blob,
    file: FileInfo,
    filesByURL: FilesByURL,
    filesByAlias: FilesByAlias,
  ): Promise<ReferenceDetails[]> {
    const sourceText = await content.text();
    const source = createSourceFile(
      file.absolutePath,
      sourceText,
      ScriptTarget.ES2022,
      true,
    );
    const references: ReferenceDetails[] = [];

    function visit(node: Node) {
      if (isImportDeclaration(node) && node.moduleSpecifier) {
        const reference = (node.moduleSpecifier as StringLiteral).text;

        references.push(referencedDependency(
          reference,
          file,
          filesByURL,
          filesByAlias,
          'script-src',
        ));
      } else if (
        isCallExpression(node) &&
        node.expression.kind === SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        isStringLiteral(node.arguments[0])
      ) {
        const reference = node.arguments[0].text;

        references.push(referencedDependency(
          reference,
          file,
          filesByURL,
          filesByAlias,
          'script-src',
        ));
      }

      forEachChild(node, visit);
    }

    visit(source)

    return references;
  }

  async process(
    content: Blob,
    file: FileInfo,
    filesByURL: FilesByURL,
    filesByAlias: FilesByAlias,
  ): Promise<Blob> {
    const sourceText = await content.text();
    const source = createSourceFile(
      file.absolutePath,
      sourceText,
      ScriptTarget.ES2022,
      true,
    );
    const transformerFactory: TransformerFactory<Node> = (context) => {
      function visitor(node: Node) {
        if (isImportDeclaration(node) && node.moduleSpecifier) {
          const path = (node.moduleSpecifier as StringLiteral).text;
          const ref = referencedFile(
            path,
            file,
            filesByURL,
            filesByAlias,
          );

          if (ref != null) {
            const literal = factory.createStringLiteral(ref.url);

            return factory.updateImportDeclaration(
              node,
              node.modifiers,
              node.importClause,
              literal,
              node.attributes,
            );
          }
        } else if (
          isCallExpression(node) &&
          node.expression.kind === SyntaxKind.ImportKeyword &&
          node.arguments.length === 1 &&
          isStringLiteral(node.arguments[0])
        ) {
          const path = node.arguments[0].text;
          const ref = referencedFile(
            path,
            file,
            filesByURL,
            filesByAlias,
          );
          const literal = factory.createStringLiteral(ref.url);

          return factory.updateCallExpression(
            node,
            node.expression,
            node.typeArguments,
            [literal],
          );
        }

        return visitEachChild(node, visitor, context);
      }

      return (node) => visitNode(node, visitor)
    };

    const result = transform(source, [transformerFactory]);
    const printer = createPrinter({ newLine: NewLineKind.LineFeed });
    const transformed = result.transformed[0];
    const code = printer.printFile(transformed as SourceFile);
    const javascript = transpileModule(code, { compilerOptions: { module: ModuleKind.ES2022 }});
    //const minified = await minify(javascript.outputText);

    result.dispose();

    return new Blob([javascript.outputText], { type: this.output });
  }

}
