// Usage: node scripts/extract_bundle_inventory.mjs <download-directory> <rea-source-root>
// REA's installed Babel parser is used for syntax evidence; this is not runtime coverage.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [inputDirectory, reaRoot] = process.argv.slice(2);
if (!inputDirectory || !reaRoot) throw new Error('Provide download directory and REA source root');
const { parse } = await import(pathToFileURL(join(resolve(reaRoot), 'node_modules/@babel/parser/lib/index.js')).href);
const output = { version: 1, authority: 'static-candidate', limitations: ['Public client syntax does not prove server implementation, permission availability, or successful writes.', 'Template expressions are retained as placeholders; HTTP base prefixes may require manual resolution.'], files: [], routes: [], endpoints: [], parseErrors: [] };

for (const file of (await readdir(inputDirectory)).filter(file => file.endsWith('.js')).sort()) {
  const source = await readFile(join(inputDirectory, file), 'utf8');
  const sha256 = createHash('sha256').update(source).digest('hex');
  output.files.push({ file, sha256, bytes: Buffer.byteLength(source) });
  let ast;
  try { ast = parse(source, { sourceType: 'unambiguous' }); }
  catch (error) { output.parseErrors.push({ file, message: error.message }); continue; }
  const propertyName = node => node?.key?.name ?? node?.key?.value;
  const objectProperty = (node, key) => node?.properties?.find(item => propertyName(item) === key)?.value;
  const text = node => node ? source.slice(node.start, node.end) : undefined;
  const literal = node => node?.type === 'StringLiteral' ? node.value : undefined;
  const location = node => ({ file, sha256, line: node.loc.start.line, column: node.loc.start.column, start: node.start, end: node.end });
  const definitions = new Map();
  // Only top-level definitions are safe to bind without reconstructing lexical scopes.
  for (const statement of ast.program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type === 'VariableDeclaration') for (const item of declaration.declarations) {
      if (item.id?.type === 'Identifier' && item.init) definitions.set(item.id.name, item.init);
    }
  }
  const templatePath = (node, depth = 0) => {
    if (depth > 4) return undefined;
    if (node?.type === 'StringLiteral') return node.value;
    if (node?.type === 'TemplateLiteral') return node.quasis.map((quasi, index) => {
      if (index >= node.expressions.length) return quasi.value.cooked;
      const expression = node.expressions[index];
      const resolved = expression.type === 'CallExpression' ? templatePath(expression, depth + 1) : undefined;
      return quasi.value.cooked + (resolved ?? '${' + text(expression) + '}');
    }).join('');
    if (node?.type === 'Identifier') return templatePath(definitions.get(node.name), depth + 1);
    if (node?.type === 'CallExpression' && node.callee.type === 'Identifier') {
      const fn = definitions.get(node.callee.name);
      if (fn?.type === 'ArrowFunctionExpression' && fn.body.type === 'TemplateLiteral') {
        const body = templatePath(fn.body, depth + 1);
        return body === undefined ? undefined : body.replace(/\$\{([^}]+)\}/g, (match, expression) => {
          const index = fn.params.findIndex(param => param.type === 'Identifier' && param.name === expression);
          return index < 0 ? match : '${' + text(node.arguments[index]) + '}';
        });
      }
    }
  };
  function visit(node, parentRoute) {
    if (!node || typeof node !== 'object') return;
    let route = parentRoute;
    if (node.type === 'ObjectExpression') {
      const path = literal(objectProperty(node, 'path'));
      const meta = objectProperty(node, 'meta');
      const keys = node.properties.map(propertyName);
      if (path !== undefined && keys.some(key => ['Component', 'meta', 'children', 'redirect', 'permissionKey'].includes(key))) {
        route = [...(parentRoute ?? []), path];
        output.routes.push({ declaredPath: path, hierarchy: route, titleKey: literal(objectProperty(meta, 'title')), permissionExpression: text(objectProperty(node, 'permissionKey')), hiddenExpression: text(objectProperty(node, 'hidden') ?? objectProperty(meta, 'hidden')), redirect: literal(objectProperty(node, 'redirect')), lazyBundles: [...text(node).matchAll(/import\(["']\.\/([^"']+\.js)["']\)/g)].map(match => match[1]), source: location(node) });
      }
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
      const method = node.callee.property?.name?.toUpperCase();
      const path = templatePath(node.arguments?.[0]);
      if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && path && (path.startsWith('/') || path.startsWith('${')) && path.includes('/')) {
        const body = node.arguments?.[1];
        output.endpoints.push({ method, path, expression: text(node.arguments[0]), pathAuthority: 'candidate-expansion', bodyKeys: body?.type === 'ObjectExpression' ? body.properties.map(propertyName).filter(Boolean) : undefined, source: location(node) });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(child => visit(child, route));
      else if (value && typeof value === 'object') visit(value, route);
    }
  }
  visit(ast, undefined);
}
await mkdir('docs/reverse-engineering', { recursive: true });
await writeFile('docs/reverse-engineering/static-inventory.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ files: output.files.length, routes: output.routes.length, endpoints: output.endpoints.length, parseErrors: output.parseErrors.length }));
