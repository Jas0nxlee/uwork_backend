import type { LocalizedClientText } from "../../../src/client-experience.js";

export function changeLocalizedText(
  value: LocalizedClientText,
  language: "cn" | "en",
  next: string,
): LocalizedClientText {
  const result = { ...value };
  if (next.trim()) result[language] = next;
  else delete result[language];
  return result;
}
export function LocalizedFields({
  label,
  value,
  max,
  multiline = false,
  optional = false,
  onChange,
}: {
  label: string;
  value: LocalizedClientText;
  max: number;
  multiline?: boolean;
  optional?: boolean;
  onChange(value: LocalizedClientText): void;
}) {
  return (
    <fieldset className="locale-fields">
      <legend>
        {label}
        {optional ? "（可选）" : "（至少一种语言）"}
      </legend>
      <div className="form-grid">
        {(
          [
            ["cn", "中文"],
            ["en", "English"],
          ] as const
        ).map(([language, name]) => (
          <label key={language}>
            <span>
              {label} · {name}
            </span>
            {multiline ? (
              <textarea
                rows={3}
                maxLength={max}
                value={value[language] ?? ""}
                onChange={(event) =>
                  onChange(
                    changeLocalizedText(value, language, event.target.value),
                  )
                }
              />
            ) : (
              <input
                maxLength={max}
                value={value[language] ?? ""}
                onChange={(event) =>
                  onChange(
                    changeLocalizedText(value, language, event.target.value),
                  )
                }
              />
            )}
          </label>
        ))}
      </div>
      <p className="field-description">
        每种语言最多 {max} 字；未填写的语言沿客户端原有规则回退。
      </p>
    </fieldset>
  );
}
