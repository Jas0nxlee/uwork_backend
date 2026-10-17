import {
  clientExperienceSchemas,
  type ClientExperienceKind,
  type ClientExperienceConfigMap,
} from "../../src/client-experience.js";
import { SceneFields } from "./client-experience/SceneFields.js";
import {
  HelpFields,
  DesktopFields,
} from "./client-experience/HelpDesktopFields.js";
import { PluginOrderFields } from "./client-experience/PluginOrderFields.js";

export function isClientExperienceKind(
  kind: string,
): kind is ClientExperienceKind {
  return Object.hasOwn(clientExperienceSchemas, kind);
}
export function clientExperienceProblem(kind: string, value: unknown): string {
  if (!isClientExperienceKind(kind)) return "";
  const result = clientExperienceSchemas[kind].safeParse(value);
  return result.success
    ? ""
    : result.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".") || "配置"}：${issue.message}`)
        .join("\n");
}
export function prepareClientExperienceData(
  kind: string,
  value: unknown,
): unknown {
  if (!isClientExperienceKind(kind)) return value;
  const problem = clientExperienceProblem(kind, value);
  if (problem) throw new Error(problem);
  return clientExperienceSchemas[kind].parse(value);
}
export function ClientExperienceFields({
  kind,
  value,
  onChange,
}: {
  kind: ClientExperienceKind;
  value: unknown;
  onChange(value: unknown): void;
}) {
  // 加载入口与保存入口使用同一公共schema；编辑中的不完整字符串仍留在本scope草稿中。
  switch (kind) {
    case "scenes":
      return (
        <SceneFields
          value={value as ClientExperienceConfigMap["scenes"]}
          onChange={onChange}
        />
      );
    case "help":
      return (
        <HelpFields
          value={value as ClientExperienceConfigMap["help"]}
          onChange={onChange}
        />
      );
    case "desktop":
      return (
        <DesktopFields
          value={value as ClientExperienceConfigMap["desktop"]}
          onChange={onChange}
        />
      );
    case "plugin-store":
      return (
        <PluginOrderFields
          value={value as ClientExperienceConfigMap["plugin-store"]}
          onChange={onChange}
        />
      );
  }
}
