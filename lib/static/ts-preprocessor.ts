import {createPrinter, createSourceFile, factory, forEachChild, isCallExpression, isImportDeclaration, isStringLiteral, NewLineKind, type Node, ScriptTarget, type SourceFile, type StringLiteral, SyntaxKind, transform, type TransformerFactory, visitEachChild, visitNode} from 'typescript';
import {type FileInfo} from './file-info.ts';
import type {FilesByURL, ReferenceDetails, ReferencePreprocessor} from './types.ts';

export class TSReferencePreprocessor implements ReferencePreprocessor {

  supports: Set<string> = new Set(['ts', 'mts', 'cts']);

  readonly output: 'application/javascript';

  async parse(content: Blob, file: FileInfo, filesByURL: FilesByURL): Promise<ReferenceDetails[]> {
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
        const path = (node.moduleSpecifier as StringLiteral).text;
        const url = new URL(path, file.aliasURL).toString();

        references.push({
          url,
          directive: 'script-src',
          file: filesByURL.get(url),
        });
      } else if (
        isCallExpression(node) &&
        node.expression.kind === SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        isStringLiteral(node.arguments[0])
      ) {
        const path = node.arguments[0].text;
        const url = new URL(path, file.aliasURL).toString();

        references.push({
          url,
          directive: 'script-src',
          file: filesByURL.get(url),
        });
      }

      forEachChild(node, visit);
    }

    visit(source)

    return references;
  }

  async process(content: Blob, file: FileInfo, filesByURL: FilesByURL): Promise<Blob> {
    const sourceText = await content.text();
    const source = createSourceFile(
      file.absolutePath,
      sourceText,
      ScriptTarget.ES2022,
      true,
    );
    const transformerFactory: TransformerFactory<SourceFile> = (context) => {
      function visitor(node: Node) {
        if (isImportDeclaration(node) && node.moduleSpecifier) {
          const path = (node.moduleSpecifier as StringLiteral).text;
          const url = new URL(path, file.aliasURL).toString();
          const ref = filesByURL.get(url);
          const literal = factory.createStringLiteral(ref.url);

          return factory.updateImportDeclaration(
            node,
            node.modifiers,
            node.importClause,
            literal,
            node.attributes,
          );
        } else if (
          isCallExpression(node) &&
          node.expression.kind === SyntaxKind.ImportKeyword &&
          node.arguments.length === 1 &&
          isStringLiteral(node.arguments[0])
        ) {
          const path = node.arguments[0].text;
          const url = new URL(path, file.aliasURL).toString();
          const ref = filesByURL.get(url);
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

    result.dispose();

    return new Blob([code], { type: this.output });
  }

}
