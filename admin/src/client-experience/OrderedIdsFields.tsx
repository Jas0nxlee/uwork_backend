import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

export function moveOrderedId(
  items: readonly string[],
  index: number,
  direction: -1 | 1,
): string[] {
  const target = index + direction;
  const next = [...items];
  if (
    index >= 0 &&
    index < items.length &&
    target >= 0 &&
    target < items.length
  )
    [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
export function OrderedIdsFields({
  label,
  value,
  maxItems,
  onChange,
}: {
  label: string;
  value: string[];
  maxItems: number;
  onChange(value: string[]): void;
}) {
  return (
    <fieldset className="ordered-ids">
      <legend>
        {label}（{value.length}/{maxItems}）
      </legend>
      {value.length === 0 && (
        <p className="field-description">未指定的 ID 继续使用原目录顺序。</p>
      )}
      {value.map((id, index) => (
        <div className="order-row" key={index}>
          <span className="row-number">{index + 1}</span>
          <input
            aria-label={`${label} ${index + 1} ID`}
            maxLength={200}
            value={id}
            onChange={(event) =>
              onChange(
                value.map((current, position) =>
                  position === index ? event.target.value : current,
                ),
              )
            }
          />
          <button
            type="button"
            className="icon"
            aria-label={`上移${label} ${index + 1}`}
            disabled={index === 0}
            onClick={() => onChange(moveOrderedId(value, index, -1))}
          >
            <ArrowUp size={16} />
          </button>
          <button
            type="button"
            className="icon"
            aria-label={`下移${label} ${index + 1}`}
            disabled={index === value.length - 1}
            onClick={() => onChange(moveOrderedId(value, index, 1))}
          >
            <ArrowDown size={16} />
          </button>
          <button
            type="button"
            className="icon danger"
            aria-label={`移除${label} ${index + 1}`}
            onClick={() =>
              onChange(value.filter((_, position) => position !== index))
            }
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={value.length >= maxItems}
        onClick={() => onChange([...value, ""])}
      >
        <Plus size={16} />
        添加{label}
      </button>
      <p className="field-description">
        每个 ID 最多 200 字符，同一列表不能重复。使用上下按钮调整显示顺序。
      </p>
    </fieldset>
  );
}
