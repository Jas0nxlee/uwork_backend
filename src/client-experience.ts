import { z } from "zod";

// 公开配置合同也用于管理表单；保持纯数据/纯校验，不能引入数据库、凭据或 Node I/O。
const text = (max: number) => z.string().trim().min(1).max(max);
const id = text(64);
const localized = (max: number) =>
  z
    .object({ cn: text(max).optional(), en: text(max).optional() })
    .strict()
    .refine(
      (v) => v.cn !== undefined || v.en !== undefined,
      "至少填写一种语言",
    );
export type LocalizedClientText = z.infer<ReturnType<typeof localized>>;
const unique = <T>(values: readonly T[]) =>
  new Set(values).size === values.length;
const withinBytes = (max: number) => (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength <= max;
const canonicalNumber = (value: string, min: number, max: number) =>
  /^\d+$/u.test(value) &&
  String(Number(value)) === value &&
  Number(value) >= min &&
  Number(value) <= max;

/** 配置模板只接受原客户端 builder 可无损编辑的子集，不创建另一套调度器。 */
export function isEditableClientTemplateCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/u);
  if (fields.length !== 5) return false;
  const [minute, hour, day, month, weekday] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (month !== "*") return false;
  const interval = (value: string, max: number) =>
    value.startsWith("*/") && canonicalNumber(value.slice(2), 1, max);
  if (interval(minute, 59))
    return hour === "*" && day === "*" && weekday === "*";
  if (!canonicalNumber(minute, 0, 59)) return false;
  if (hour === "*") return day === "*" && weekday === "*";
  if (interval(hour, 24)) return day === "*" && weekday === "*";
  if (!canonicalNumber(hour, 0, 23)) return false;
  if (interval(day, 31)) return weekday === "*";
  if (day !== "*") return canonicalNumber(day, 1, 31) && weekday === "*";
  if (weekday === "*" || weekday === "1-5") return true;
  const days = weekday.split(",");
  return (
    days.every((v) => canonicalNumber(v, 0, 6)) &&
    unique(days) &&
    days.join(",") === [...days].sort((a, b) => Number(a) - Number(b)).join(",")
  );
}

const templateFields = {
  id,
  title: localized(100),
  prompt: localized(4000),
  icon: text(64)
    .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u)
    .optional(),
};
const draft = z
  .object({
    ...templateFields,
    actions: z
      .array(z.enum(["NAVIGATE:AUTOMATIONS", "NAVIGATE:AUTOMATIONS:OFFPEAK"]))
      .max(2)
      .refine(unique, "动作不能重复")
      .optional(),
    pluginStableId: text(200).optional(),
  })
  .strict();
const scheduled = z
  .object({
    ...templateFields,
    cronExpr: text(100)
      .transform((v) => v.replace(/\s+/gu, " "))
      .refine(isEditableClientTemplateCron, "调度表达式无法在客户端无损编辑"),
  })
  .strict();
const offPeak = z
  .object({
    ...templateFields,
    description: localized(1000).optional(),
  })
  .strict()
  .refine(
    (v) => v.id.replace(/^item[-_]?/iu, "").toLowerCase() !== "customize",
    "不能占用客户端自定义入口标识",
  );
const templates = <T extends z.ZodType<{ id: string }>>(schema: T) =>
  z
    .array(schema)
    .max(20)
    .refine((items) => unique(items.map((v) => v.id)), "模板标识不能重复");
export const scenesConfigurationSchema = z
  .object({
    draftSuggestions: templates(draft),
    scheduledTemplates: templates(scheduled),
    offPeakTemplates: templates(offPeak),
  })
  .strict()
  .refine(withinBytes(128 * 1024), "场景配置不能超过 128 KiB");

const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .pipe(z.url())
  .refine((value) => {
    // z.url 的格式失败后仍可能执行 refine；未完成的表单值必须返回校验失败，不能抛出 500。
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "链接必须为不含用户名和密码的 HTTPS 地址");
export const helpConfigurationSchema = z
  .object({
    communityUrls: z
      .object({ "zh-CN": httpsUrl.nullable(), "en-US": httpsUrl.nullable() })
      .strict(),
    feedback: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("disabled"), url: z.null() }).strict(),
      z.object({ mode: z.literal("external"), url: httpsUrl }).strict(),
    ]),
  })
  .strict()
  .refine(withinBytes(16 * 1024), "帮助配置不能超过 16 KiB");
export const clientTraceGroups = [
  "core",
  "settings",
  "workbench",
  "extensions",
  "automation",
  "account",
] as const;
export const desktopConfigurationSchema = z
  .object({
    desktopContextPrompt: z.object({ enabled: z.boolean() }).strict(),
    rendererActionTrace: z
      .object({
        enabled: z.boolean(),
        sampleRatio: z.number().min(0).max(0.2),
        enabledGroups: z
          .array(z.enum(clientTraceGroups))
          .max(6)
          .refine(unique, "追踪分组不能重复"),
      })
      .strict(),
  })
  .strict();

const orderList = z.array(text(200)).refine(unique, "排序列表不能重复");
const categoryKey = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => v === v.trim(), "分类标识不能包含首尾空白");
const modeOrder = z
  .object({
    categoryOrder: orderList.max(64).optional(),
    pluginOrder: z
      .unknown()
      // Zod record 会跳过 __proto__；必须在解析前拒绝，避免管理表单保存成功却丢分类。
      .refine(
        (v) =>
          v === null || typeof v !== "object" || !Object.hasOwn(v, "__proto__"),
        "分类标识 __proto__ 为保留值",
      )
      .pipe(
        z
          .record(categoryKey, orderList.max(100))
          .refine((v) => Object.keys(v).length <= 64, "每模式最多 64 个分类"),
      )
      .optional(),
  })
  .strict();
export const pluginStoreConfigurationSchema = z
  .object({
    order: z
      .object({ code: modeOrder.optional(), work: modeOrder.optional() })
      .strict()
      .nullable(),
  })
  .strict()
  .refine(withinBytes(64 * 1024), "插件排序配置不能超过 64 KiB");

export const clientExperienceSchemas = {
  scenes: scenesConfigurationSchema,
  help: helpConfigurationSchema,
  desktop: desktopConfigurationSchema,
  "plugin-store": pluginStoreConfigurationSchema,
};
export type ClientExperienceKind = keyof typeof clientExperienceSchemas;
export type ClientExperienceConfigMap = {
  [K in ClientExperienceKind]: z.infer<(typeof clientExperienceSchemas)[K]>;
};
export const clientExperienceDefaults: ClientExperienceConfigMap = {
  scenes: {
    draftSuggestions: [],
    scheduledTemplates: [],
    offPeakTemplates: [],
  },
  help: {
    communityUrls: { "zh-CN": null, "en-US": null },
    feedback: { mode: "disabled", url: null },
  },
  desktop: {
    desktopContextPrompt: { enabled: false },
    rendererActionTrace: { enabled: false, sampleRatio: 0, enabledGroups: [] },
  },
  "plugin-store": { order: null },
};
