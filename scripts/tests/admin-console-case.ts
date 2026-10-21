import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

async function sourceArray(path: string, name: string, kind: ts.ScriptKind) {
  const source = ts.createSourceFile(
    path,
    await readFile(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  let value: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name)
      value = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(value, "original source inventory required");
  while (ts.isAsExpression(value)) value = value.expression;
  assert.ok(ts.isArrayLiteralExpression(value));
  return value.elements;
}

export async function runAdminConsoleCase(p: AdminUiCasePorts) {
  const views = (
    await sourceArray("admin/src/catalog.ts", "views", ts.ScriptKind.TS)
  )
    .map((node) => {
      assert.ok(ts.isObjectLiteralExpression(node));
      const values = Object.fromEntries(
        node.properties.flatMap((property) =>
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          ts.isStringLiteral(property.initializer)
            ? [[property.name.text, property.initializer.text]]
            : [],
        ),
      );
      assert.ok(values.id && values.label);
      return values as { id: string; label: string; path?: string };
    })
    .filter((view) => view.id !== "integrations")
    .map((view) => ({
      ...view,
      endpoints: view.path
        ? [view.path]
        : (
            {
              overview: ["/metrics", "/subscription"],
              enterprise: ["", "/retention"],
              subscription: ["/subscription", "/limits"],
              configuration: ["/configurations/menus"],
            } as Record<string, string[]>
          )[view.id],
    }));
  assert.ok(views.length > 20 && views.every((view) => view.endpoints?.length));
  const tabs = (
    await sourceArray(
      "admin/src/forms.tsx",
      "configurationTabs",
      ts.ScriptKind.TSX,
    )
  ).map((node) => {
    assert.ok(ts.isArrayLiteralExpression(node));
    assert.equal(node.elements.length, 2);
    const [id, label] = node.elements;
    assert.ok(
      id && label && ts.isStringLiteral(id) && ts.isStringLiteral(label),
    );
    return { id: id.text, label: label.text };
  });
  p.control.consoleViews = views;
  p.control.consoleTabs = tabs;
  await p.saveControl();
  const db = p.app.services.db;
  const snapshot = () =>
    Object.fromEntries(
      [
        "resources",
        "members",
        "credentials",
        "configurations",
        "ledger",
        "categories",
        "policies",
        "subscriptions",
      ].map((table) => [
        table,
        db.all<Row>(`SELECT * FROM ${table} ORDER BY rowid`),
      ]),
    );
  const before = snapshot();
  const widths = process.env.UWORK_CONSOLE_WIDTH
    ? [Number(process.env.UWORK_CONSOLE_WIDTH)]
    : [1440, 768, 320];
  assert.ok(widths.every((width) => [1440, 768, 320].includes(width)));
  for (const width of widths) {
    const result = (await p.run("console-width-" + width)) as Row;
    assert.equal(result.calibrationObserved, true);
    assert.equal((result.views as Row[]).length, views.length);
    assert.equal((result.configurationTabs as Row[]).length, tabs.length);
    assert.deepEqual(result.errors, []);
    assert.ok(Number(result.networkResponses) > views.length);
    assert.deepEqual(snapshot(), before);
  }
  assert.equal(p.supplier.length, 0);
  const browser = p.traffic.filter(
    (row) =>
      row.source === "browser" && String(row.route).startsWith("/api/tenants/"),
  );
  assert.ok(browser.length > views.length * widths.length);
  assert.ok(
    browser.every(
      (row) =>
        row.method === "GET" &&
        Number(row.status) >= 200 &&
        Number(row.status) < 300,
    ),
  );
  assert.equal(
    browser.some((row) => String(row.route).includes("/integrations")),
    false,
  );
  p.facts.status = "passed";
  p.facts.sourceViewCount = views.length;
  p.facts.sourceConfigurationTabs = tabs.length;
  p.facts.widths = widths;
  p.facts.businessRowsUnchanged = true;
  p.facts.noSupplierOrBilling = true;
}
