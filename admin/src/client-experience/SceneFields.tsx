import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { ClientExperienceConfigMap } from "../../../src/client-experience.js";
import { LocalizedFields } from "./LocalizedFields.js";

type Scenes = ClientExperienceConfigMap["scenes"];
type Draft = Scenes["draftSuggestions"][number];
type TemplateBase = Pick<Draft, "id" | "title" | "prompt" | "icon">;

function nextId(items: readonly TemplateBase[]) {
  let index = 1;
  while (items.some((item) => item.id === `template-${index}`)) index++;
  return `template-${index}`;
}
function TemplateList<T extends TemplateBase>({
  title,
  items,
  create,
  onChange,
  extra,
}: {
  title: string;
  items: T[];
  create(id: string): T;
  onChange(value: T[]): void;
  extra?(item: T, update: (value: T) => void): ReactNode;
}) {
  return (
    <section className="experience-section">
      <div className="section-heading">
        <h2>{title}</h2>
        <span>{items.length} / 20</span>
      </div>
      {items.length === 0 && (
        <p className="field-description">暂无{title}，可添加后填写内容。</p>
      )}
      {items.map((item, index) => {
        const update = (next: T) =>
          onChange(
            items.map((current, position) =>
              position === index ? next : current,
            ),
          );
        return (
          <fieldset className="template-card" key={index}>
            <legend>
              {title} {index + 1}
            </legend>
            <div className="template-actions">
              <button
                type="button"
                className="danger"
                onClick={() =>
                  onChange(items.filter((_, position) => position !== index))
                }
              >
                <Trash2 size={15} />
                移除{title} {index + 1}
              </button>
            </div>
            <div className="form-grid">
              <label>
                <span>模板 ID</span>
                <input
                  maxLength={64}
                  value={item.id}
                  onChange={(event) =>
                    update({ ...item, id: event.target.value })
                  }
                />
                <small>组内唯一，最多 64 字符。</small>
              </label>
              <label>
                <span>图标（可选）</span>
                <input
                  maxLength={64}
                  placeholder="如 sparkles 或 calendar-clock"
                  value={item.icon ?? ""}
                  onChange={(event) =>
                    update({ ...item, icon: event.target.value || undefined })
                  }
                />
                <small>
                  使用小写 kebab 名称，最多 64 字符；留空使用默认图标。
                </small>
              </label>
            </div>
            <LocalizedFields
              label="标题"
              value={item.title}
              max={100}
              onChange={(title) => update({ ...item, title })}
            />
            <LocalizedFields
              label="提示词"
              value={item.prompt}
              max={4000}
              multiline
              onChange={(prompt) => update({ ...item, prompt })}
            />
            {extra?.(item, update)}
          </fieldset>
        );
      })}
      <button
        type="button"
        disabled={items.length >= 20}
        onClick={() => onChange([...items, create(nextId(items))])}
      >
        <Plus size={16} />
        添加{title}
      </button>
    </section>
  );
}
export function SceneFields({
  value,
  onChange,
}: {
  value: Scenes;
  onChange(value: Scenes): void;
}) {
  return (
    <div className="experience-editor">
      <p className="field-description">
        模板只填充现有客户端界面，不授予插件、工具、文件或模型执行权限。每组最多
        20 项，整份场景配置最多 128 KiB。
      </p>
      <TemplateList
        title="草稿建议"
        items={value.draftSuggestions}
        create={(id) => ({ id, title: { cn: "新建议" }, prompt: {} })}
        onChange={(draftSuggestions) =>
          onChange({ ...value, draftSuggestions })
        }
        extra={(item, update) => (
          <>
            <fieldset className="choice-group">
              <legend>导航动作（可选）</legend>
              {(
                [
                  ["NAVIGATE:AUTOMATIONS", "打开自动化"],
                  ["NAVIGATE:AUTOMATIONS:OFFPEAK", "打开错峰任务"],
                ] as const
              ).map(([action, label]) => (
                <label className="inline-check" key={action}>
                  <input
                    type="checkbox"
                    checked={item.actions?.includes(action) ?? false}
                    onChange={(event) =>
                      update({
                        ...item,
                        actions: event.target.checked
                          ? [...(item.actions ?? []), action]
                          : item.actions?.filter(
                              (current) => current !== action,
                            ),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <label>
              <span>插件稳定 ID（可选）</span>
              <input
                maxLength={200}
                value={item.pluginStableId ?? ""}
                onChange={(event) =>
                  update({
                    ...item,
                    pluginStableId: event.target.value || undefined,
                  })
                }
              />
              <small>仅匹配已存在插件，不安装或授权插件；最多 200 字符。</small>
            </label>
          </>
        )}
      />
      <TemplateList
        title="定时模板"
        items={value.scheduledTemplates}
        create={(id) => ({
          id,
          title: { cn: "新定时模板" },
          prompt: {},
          cronExpr: "0 9 * * *",
        })}
        onChange={(scheduledTemplates) =>
          onChange({ ...value, scheduledTemplates })
        }
        extra={(item, update) => (
          <label>
            <span>Cron 表达式</span>
            <input
              maxLength={100}
              value={item.cronExpr}
              onChange={(event) =>
                update({ ...item, cronExpr: event.target.value })
              }
            />
            <small>
              仅五段无损子集：*/15 * * * *（每15分钟）、0 */2 * *
              *（每2小时）、0 9 * * *（每日）、0 9 * * 1-5（工作日）、0 9 * *
              1,3,5（星期列表）、0 9 1 * *（每月）、0 9 */2 *
              *（按天）。数字不带前导零；不支持固定月份、年份或任意脚本。
            </small>
          </label>
        )}
      />
      <TemplateList
        title="错峰模板"
        items={value.offPeakTemplates}
        create={(id) => ({ id, title: { cn: "新错峰模板" }, prompt: {} })}
        onChange={(offPeakTemplates) =>
          onChange({ ...value, offPeakTemplates })
        }
        extra={(item, update) => (
          <>
            <p className="field-description">
              保留自定义入口：ID 去掉 item / item- / item_ 前缀后，不能为
              customize。
            </p>
            <LocalizedFields
              label="说明"
              value={item.description ?? {}}
              max={1000}
              multiline
              optional
              onChange={(description) =>
                update({
                  ...item,
                  description: Object.keys(description).length
                    ? description
                    : undefined,
                })
              }
            />
          </>
        )}
      />
    </div>
  );
}
