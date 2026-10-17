import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ClientExperienceConfigMap } from "../../../src/client-experience.js";
import { OrderedIdsFields } from "./OrderedIdsFields.js";

type PluginConfig = ClientExperienceConfigMap["plugin-store"];
type Order = NonNullable<PluginConfig["order"]>;
type ModeOrder = NonNullable<Order["code"]>;

function ModeFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ModeOrder;
  onChange(value: ModeOrder): void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const categories = value.pluginOrder ?? {};
  const nextId = categoryId.trim();
  const duplicate = Object.hasOwn(categories, nextId);
  return (
    <section className="experience-section">
      <h3>{label}</h3>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={value.categoryOrder !== undefined}
          onChange={(event) => {
            const next = { ...value };
            if (event.target.checked) next.categoryOrder = [];
            else delete next.categoryOrder;
            onChange(next);
          }}
        />
        自定义{label}分类顺序
      </label>
      {value.categoryOrder !== undefined && (
        <OrderedIdsFields
          label={`${label}分类`}
          value={value.categoryOrder}
          maxItems={64}
          onChange={(categoryOrder) => onChange({ ...value, categoryOrder })}
        />
      )}
      <h4>按分类排列插件</h4>
      {Object.entries(categories).map(([id, plugins]) => (
        <fieldset className="template-card" key={id}>
          <legend>{id}</legend>
          <div className="template-actions">
            <button
              type="button"
              className="danger"
              onClick={() =>
                onChange({
                  ...value,
                  pluginOrder: Object.fromEntries(
                    Object.entries(categories).filter(([key]) => key !== id),
                  ),
                })
              }
            >
              <Trash2 size={15} />
              移除分类 {id}
            </button>
          </div>
          <OrderedIdsFields
            label={`${label} ${id} 插件`}
            value={plugins}
            maxItems={100}
            onChange={(ids) =>
              onChange({ ...value, pluginOrder: { ...categories, [id]: ids } })
            }
          />
        </fieldset>
      ))}
      <div className="add-order-category">
        <label>
          <span>{label}新增分类 ID</span>
          <input
            maxLength={200}
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={
            !nextId || duplicate || Object.keys(categories).length >= 64
          }
          onClick={() => {
            onChange({
              ...value,
              pluginOrder: { ...categories, [nextId]: [] },
            });
            setCategoryId("");
          }}
        >
          <Plus size={16} />
          添加{label}插件分类
        </button>
      </div>
      {duplicate && <p className="field-description">该分类 ID 已存在。</p>}
      <p className="field-description">
        每模式最多 64 个分类，每分类最多 100 个插件
        ID。移除后重新添加可以修改分类 ID。
      </p>
    </section>
  );
}
export function PluginOrderFields({
  value,
  onChange,
}: {
  value: PluginConfig;
  onChange(value: PluginConfig): void;
}) {
  const order = value.order;
  return (
    <div className="experience-editor">
      <section className="experience-section">
        <h2>插件目录显示顺序</h2>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={order !== null}
            onChange={(event) =>
              onChange({ order: event.target.checked ? {} : null })
            }
          />
          启用自定义插件排序
        </label>
        <p className="field-description">
          仅影响展示，不安装或授权插件。关闭会清除本草稿的排序并保存为
          null，发布前不会改变客户端。整份排序配置最多 64 KiB。
        </p>
      </section>
      {order !== null &&
        (
          [
            ["code", "Code 模式"],
            ["work", "Work 模式"],
          ] as const
        ).map(([mode, label]) => (
          <section className="experience-section" key={mode}>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={order[mode] !== undefined}
                onChange={(event) => {
                  const next = { ...order };
                  if (event.target.checked) next[mode] = {};
                  else delete next[mode];
                  onChange({ order: next });
                }}
              />
              配置{label}
            </label>
            {order[mode] !== undefined && (
              <ModeFields
                label={label}
                value={order[mode]}
                onChange={(next) =>
                  onChange({ order: { ...order, [mode]: next } })
                }
              />
            )}
          </section>
        ))}
    </div>
  );
}
