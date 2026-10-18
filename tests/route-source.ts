import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export interface Route {
  body: string;
  calls: string[];
  method: string;
  file: string;
  line: number;
  path: string;
}

function literals(
  expression: ts.Expression,
  at: ts.Node,
): string[] | undefined {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (
    ts.isAsExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  )
    return literals(expression.expression, at);
  if (ts.isArrayLiteralExpression(expression)) {
    const values = expression.elements.map((entry) => literals(entry, at));
    return values.every((value) => value !== undefined)
      ? (values.flat() as string[])
      : undefined;
  }
  if (ts.isIdentifier(expression)) {
    for (
      let scope: ts.Node | undefined = at.parent;
      scope;
      scope = scope.parent
    ) {
      if (
        ts.isForOfStatement(scope) &&
        ts.isVariableDeclarationList(scope.initializer) &&
        scope.initializer.flags & ts.NodeFlags.Const &&
        scope.initializer.declarations.some(
          (declaration) =>
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === expression.text,
        )
      )
        return literals(scope.expression, scope);
      if (
        ts.isForOfStatement(scope) &&
        ts.isVariableDeclarationList(scope.initializer) &&
        scope.initializer.flags & ts.NodeFlags.Const
      ) {
        const binding = scope.initializer.declarations[0]?.name;
        if (binding && ts.isArrayBindingPattern(binding)) {
          const index = binding.elements.findIndex(
            (entry) =>
              ts.isBindingElement(entry) &&
              ts.isIdentifier(entry.name) &&
              entry.name.text === expression.text,
          );
          let values = scope.expression;
          while (
            ts.isAsExpression(values) ||
            ts.isParenthesizedExpression(values)
          )
            values = values.expression;
          if (index >= 0 && ts.isArrayLiteralExpression(values)) {
            const parts = values.elements.map((entry) =>
              ts.isArrayLiteralExpression(entry) && entry.elements[index]
                ? literals(entry.elements[index]!, scope)
                : undefined,
            );
            return parts.every((part) => part !== undefined)
              ? (parts.flat() as string[])
              : undefined;
          }
        }
      }
      if (!ts.isSourceFile(scope) && !ts.isBlock(scope)) continue;
      for (const statement of scope.statements) {
        if (
          !ts.isVariableStatement(statement) ||
          !(statement.declarationList.flags & ts.NodeFlags.Const)
        )
          continue;
        for (const declaration of statement.declarationList.declarations)
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === expression.text &&
            declaration.initializer &&
            declaration.pos < at.pos
          )
            return literals(declaration.initializer, declaration);
      }
    }
  }
  if (ts.isTemplateExpression(expression)) {
    let paths = [expression.head.text];
    for (const span of expression.templateSpans) {
      const value = literals(span.expression, at);
      if (value === undefined) return undefined;
      if (paths.length * value.length > 100)
        throw new Error("Excessive static route variants");
      paths = paths.flatMap((path) =>
        value.map((part) => path + part + span.literal.text),
      );
    }
    return paths;
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const a = literals(expression.left, at),
      b = literals(expression.right, at);
    if (a !== undefined && b !== undefined)
      return a.flatMap((left) => b.map((right) => left + right));
  }
  return undefined;
}

export function sourceRoutes(source: string, file: string): Route[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Route[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "app" &&
      /^(get|post|put|patch|delete)$/u.test(node.expression.name.text)
    ) {
      const target = node.arguments[0],
        handler = node.arguments.at(-1);
      if (!target || !handler)
        throw new Error(`Missing route contract in ${file}`);
      const paths = literals(target, node);
      if (paths === undefined)
        throw new Error(
          `Unresolved route path in ${file}:${tree.getLineAndCharacterOfPosition(node.pos).line + 1}`,
        );
      const calls: string[] = [];
      function collect(child: ts.Node) {
        if (ts.isCallExpression(child))
          calls.push(child.expression.getText(tree));
        ts.forEachChild(child, collect);
      }
      collect(handler);
      for (const path of paths)
        found.push({
          path,
          file,
          method: node.expression.name.text.toUpperCase(),
          line:
            tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
          body: handler.getText(tree),
          calls,
        });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

export function routes() {
  const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
  return readdirSync(src)
    .filter((name) => name.endsWith(".ts"))
    .flatMap((file) =>
      sourceRoutes(readFileSync(join(src, file), "utf8"), file),
    );
}
