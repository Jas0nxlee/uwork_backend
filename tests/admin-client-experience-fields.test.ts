import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  clientExperienceDefaults,
  clientExperienceSchemas,
  type ClientExperienceConfigMap,
} from "../src/client-experience.js";

type InputEvent = {
  target: { value: string; checked: boolean; valueAsNumber: number };
};
interface Props {
  children?: ReactNode;
  value?: unknown;
  disabled?: boolean;
  maxLength?: number;
  max?: number;
  type?: string;
  "aria-label"?: string;
  onChange?(event: InputEvent): void;
  onClick?(): void;
}
type Element = ReactElement<Props>;
function pureElements(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Props>(child)) return [];
    const nested =
      typeof child.type === "function"
        ? (child.type as (props: Props) => ReactNode)(child.props)
        : child.props.children;
    return [child, ...pureElements(nested)];
  });
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<Props>(child)
          ? text(child.props.children)
          : "",
    )
    .join("");
}
function button(node: ReactNode, label: string) {
  const result = pureElements(node).find(
    (element) =>
      element.type === "button" && text(element.props.children) === label,
  );
  assert.ok(result, `button: ${label}`);
  return result;
}
function field(node: ReactNode, label: string) {
  const parent = pureElements(node).find(
    (element) =>
      element.type === "label" && text(element.props.children).includes(label),
  );
  assert.ok(parent, `field label: ${label}`);
  const input = pureElements(parent.props.children).find((element) =>
    ["input", "select", "textarea"].includes(String(element.type)),
  );
  assert.ok(input, `field input: ${label}`);
  return input;
}
function change(input: Element, value: string, checked = false) {
  assert.ok(input.props.onChange);
  input.props.onChange({
    target: {
      value,
      checked,
      valueAsNumber: value === "" ? Number.NaN : Number(value),
    },
  });
}
async function fixture(t: TestContext) {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../admin", import.meta.url)),
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent",
  });
  t.after(() => server.close());
  return {
    server,
    fields: await server.ssrLoadModule("/src/clientExperienceFields.tsx"),
  };
}

test("actual configuration retains seven tabs and exposes four structured control-plane tabs", async (t) => {
  const { server } = await fixture(t);
  const { Configuration } = await server.ssrLoadModule("/src/forms.tsx");
  const html = renderToStaticMarkup(
    createElement(Configuration, { base: "/api/tenants/A", notify() {} }),
  );
  for (const label of [
    "菜单",
    "新对话",
    "助理渠道",
    "分享协作",
    "个人资产",
    "安全基线",
    "IP 白名单",
    "场景模板",
    "帮助与反馈",
    "桌面行为",
    "插件排序",
  ])
    assert.ok(html.includes(label));
  assert.ok(html.includes("当前配置尚未加载"));
});

test("actual scene add/edit/remove handlers create typed templates and omit empty optional languages", async (t) => {
  const { server, fields } = await fixture(t);
  const { SceneFields } = await server.ssrLoadModule(
    "/src/client-experience/SceneFields.tsx",
  );
  let data = structuredClone(clientExperienceDefaults.scenes);
  const tree = () =>
    SceneFields({
      value: data,
      onChange: (next: ClientExperienceConfigMap["scenes"]) => {
        data = next;
      },
    });
  button(tree(), "添加草稿建议").props.onClick!();
  assert.equal(data.draftSuggestions.length, 1);
  assert.equal(
    fields.clientExperienceProblem("scenes", data).length > 0,
    true,
    "new empty prompt remains an invalid local edit",
  );
  change(field(tree(), "提示词 · 中文"), "编写工作摘要");
  change(field(tree(), "标题 · English"), "Summary");
  change(field(tree(), "标题 · English"), "");
  assert.equal(Object.hasOwn(data.draftSuggestions[0]!.title, "en"), false);
  change(field(tree(), "打开自动化"), "", true);
  change(field(tree(), "插件稳定 ID"), "existing/plugin");
  assert.equal(fields.clientExperienceProblem("scenes", data), "");
  assert.deepEqual(
    clientExperienceSchemas.scenes.parse(data).draftSuggestions[0]?.actions,
    ["NAVIGATE:AUTOMATIONS"],
  );
  assert.equal(field(tree(), "模板 ID").props.maxLength, 64);
  assert.equal(field(tree(), "标题 · 中文").props.maxLength, 100);
  assert.equal(field(tree(), "提示词 · 中文").props.maxLength, 4000);
  button(tree(), "移除草稿建议 1").props.onClick!();
  assert.deepEqual(data.draftSuggestions, []);
  for (const label of ["添加定时模板", "添加错峰模板"]) {
    button(tree(), label).props.onClick!();
    const group =
      label === "添加定时模板"
        ? data.scheduledTemplates
        : data.offPeakTemplates;
    assert.equal(group.length, 1);
  }
  assert.equal(field(tree(), "Cron 表达式").props.maxLength, 100);
  const scheduledText = renderToStaticMarkup(tree());
  assert.ok(scheduledText.includes("五段无损子集"));
  assert.ok(scheduledText.includes("customize"));
});

test("scene add limit is twenty and removing a row preserves the remaining IDs", async (t) => {
  const { server } = await fixture(t);
  const { SceneFields } = await server.ssrLoadModule(
    "/src/client-experience/SceneFields.tsx",
  );
  let data = {
    ...structuredClone(clientExperienceDefaults.scenes),
    draftSuggestions: Array.from({ length: 20 }, (_, index) => ({
      id: `existing-${index}`,
      title: { cn: "标题" },
      prompt: { cn: "提示" },
    })),
  };
  const tree = () =>
    SceneFields({
      value: data,
      onChange: (next: typeof data) => {
        data = next;
      },
    });
  assert.equal(button(tree(), "添加草稿建议").props.disabled, true);
  button(tree(), "移除草稿建议 2").props.onClick!();
  assert.equal(data.draftSuggestions.length, 19);
  assert.equal(data.draftSuggestions[1]?.id, "existing-2");
  assert.equal(button(tree(), "添加草稿建议").props.disabled, false);
});

test("actual help switches clear to null and use the Root HTTPS and feedback schema", async (t) => {
  const { server, fields } = await fixture(t);
  const { HelpFields } = await server.ssrLoadModule(
    "/src/client-experience/HelpDesktopFields.tsx",
  );
  let data = structuredClone(clientExperienceDefaults.help);
  const tree = () =>
    HelpFields({
      value: data,
      onChange: (next: ClientExperienceConfigMap["help"]) => {
        data = next;
      },
    });
  change(field(tree(), "启用中文社区"), "", true);
  change(field(tree(), "中文社区 HTTPS 地址"), "http://example.test");
  assert.notEqual(fields.clientExperienceProblem("help", data), "");
  change(
    field(tree(), "中文社区 HTTPS 地址"),
    "https://user:password@example.test",
  );
  assert.notEqual(fields.clientExperienceProblem("help", data), "");
  change(
    field(tree(), "中文社区 HTTPS 地址"),
    "https://community.example.test/path",
  );
  assert.equal(fields.clientExperienceProblem("help", data), "");
  change(field(tree(), "中文社区 HTTPS 地址"), "");
  assert.equal(data.communityUrls["zh-CN"], null);
  change(field(tree(), "反馈模式"), "external");
  assert.notEqual(fields.clientExperienceProblem("help", data), "");
  change(field(tree(), "反馈 HTTPS 地址"), "https://feedback.example.test");
  assert.equal(fields.clientExperienceProblem("help", data), "");
  change(field(tree(), "反馈模式"), "disabled");
  assert.deepEqual(data.feedback, { mode: "disabled", url: null });
});

test("actual desktop controls preserve the 0.2 bound and the six permitted trace groups", async (t) => {
  const { server, fields } = await fixture(t);
  const { DesktopFields } = await server.ssrLoadModule(
    "/src/client-experience/HelpDesktopFields.tsx",
  );
  let data = structuredClone(clientExperienceDefaults.desktop);
  const tree = () =>
    DesktopFields({
      value: data,
      onChange: (next: ClientExperienceConfigMap["desktop"]) => {
        data = next;
      },
    });
  assert.equal(field(tree(), "采样比例").props.max, 0.2);
  change(field(tree(), "启用桌面上下文提示段"), "", true);
  change(field(tree(), "启用界面动作追踪"), "", true);
  change(field(tree(), "核心交互"), "", true);
  change(field(tree(), "采样比例"), "0.21");
  assert.notEqual(fields.clientExperienceProblem("desktop", data), "");
  change(field(tree(), "采样比例"), "0.2");
  assert.equal(fields.clientExperienceProblem("desktop", data), "");
  assert.deepEqual(data.rendererActionTrace.enabledGroups, ["core"]);
  const html = renderToStaticMarkup(tree());
  for (const group of [
    "core",
    "settings",
    "workbench",
    "extensions",
    "automation",
    "account",
  ])
    assert.ok(html.includes(`（${group}）`));
});

test("clearing an existing external feedback URL closes the entry with null", async (t) => {
  const { server } = await fixture(t);
  const { HelpFields } = await server.ssrLoadModule(
    "/src/client-experience/HelpDesktopFields.tsx",
  );
  let data: ClientExperienceConfigMap["help"] = {
    communityUrls: { "zh-CN": null, "en-US": null },
    feedback: { mode: "external", url: "https://feedback.example.test" },
  };
  const tree = HelpFields({
    value: data,
    onChange: (next: typeof data) => {
      data = next;
    },
  });
  change(field(tree, "反馈 HTTPS 地址"), "");
  assert.deepEqual(data.feedback, { mode: "disabled", url: null });
});

test("plugin order controls keep null optionality and reorder exact stable IDs without JSON editing", async (t) => {
  const { server, fields } = await fixture(t);
  const { PluginOrderFields } = await server.ssrLoadModule(
    "/src/client-experience/PluginOrderFields.tsx",
  );
  const { OrderedIdsFields } = await server.ssrLoadModule(
    "/src/client-experience/OrderedIdsFields.tsx",
  );
  let config = structuredClone(clientExperienceDefaults["plugin-store"]);
  const plugin = () =>
    PluginOrderFields({
      value: config,
      onChange: (next: ClientExperienceConfigMap["plugin-store"]) => {
        config = next;
      },
    });
  const toggle = field(plugin(), "启用自定义插件排序");
  change(toggle, "", true);
  assert.deepEqual(config.order, {});
  assert.equal(fields.clientExperienceProblem("plugin-store", config), "");
  let ids = ["category-b", "category-a"];
  const list = () =>
    OrderedIdsFields({
      label: "分类",
      value: ids,
      maxItems: 64,
      onChange: (next: string[]) => {
        ids = next;
      },
    });
  const up = pureElements(list()).find(
    (element) => element.props["aria-label"] === "上移分类 2",
  );
  assert.ok(up?.props.onClick);
  up.props.onClick();
  assert.deepEqual(ids, ["category-a", "category-b"]);
  config = {
    order: {
      code: {
        categoryOrder: ids,
        pluginOrder: { "category-a": ["plugin/one"] },
      },
    },
  };
  const html = renderToStaticMarkup(
    createElement(PluginOrderFields, { value: config, onChange() {} }),
  );
  assert.ok(html.includes("Code 模式"));
  assert.ok(html.includes("plugin/one"));
  assert.equal(html.includes("<textarea"), false);
  assert.equal(fields.clientExperienceProblem("plugin-store", config), "");
  // ModeFields含Hooks，交给真实SSR渲染；全局清空handler不依赖其内部状态。
  change(toggle, "", false);
  assert.deepEqual(config, { order: null });
});
