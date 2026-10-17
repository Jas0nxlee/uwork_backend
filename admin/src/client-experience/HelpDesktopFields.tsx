import {
  clientTraceGroups,
  type ClientExperienceConfigMap,
} from "../../../src/client-experience.js";

export function HelpFields({
  value,
  onChange,
}: {
  value: ClientExperienceConfigMap["help"];
  onChange(value: ClientExperienceConfigMap["help"]): void;
}) {
  return (
    <div className="experience-editor">
      <section className="experience-section">
        <h2>社区帮助链接</h2>
        <p className="field-description">
          只允许不含用户名和密码的 HTTPS 地址。关闭或清空会保存为
          null，受管客户端不会回退上一企业链接。
        </p>
        {(
          [
            ["zh-CN", "中文社区"],
            ["en-US", "English community"],
          ] as const
        ).map(([language, label]) => (
          <div className="link-setting" key={language}>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={value.communityUrls[language] !== null}
                onChange={(event) =>
                  onChange({
                    ...value,
                    communityUrls: {
                      ...value.communityUrls,
                      [language]: event.target.checked ? "" : null,
                    },
                  })
                }
              />
              启用{label}
            </label>
            <label>
              <span>{label} HTTPS 地址</span>
              <input
                type="url"
                maxLength={2048}
                placeholder="https://"
                disabled={value.communityUrls[language] === null}
                value={value.communityUrls[language] ?? ""}
                onChange={(event) =>
                  onChange({
                    ...value,
                    communityUrls: {
                      ...value.communityUrls,
                      [language]: event.target.value || null,
                    },
                  })
                }
              />
            </label>
          </div>
        ))}
      </section>
      <section className="experience-section">
        <h2>反馈入口</h2>
        <label>
          <span>反馈模式</span>
          <select
            value={value.feedback.mode}
            onChange={(event) =>
              onChange({
                ...value,
                feedback:
                  event.target.value === "external"
                    ? { mode: "external", url: "" }
                    : { mode: "disabled", url: null },
              })
            }
          >
            <option value="disabled">关闭反馈</option>
            <option value="external">外部 HTTPS 页面</option>
          </select>
        </label>
        {value.feedback.mode === "external" && (
          <label>
            <span>反馈 HTTPS 地址</span>
            <input
              type="url"
              maxLength={2048}
              value={value.feedback.url}
              placeholder="https://"
              onChange={(event) =>
                onChange({
                  ...value,
                  feedback: event.target.value.trim()
                    ? { mode: "external", url: event.target.value }
                    : { mode: "disabled", url: null },
                })
              }
            />
          </label>
        )}
        <p className="field-description">
          这里只配置外部页面，不创建内部反馈工单；清空地址会关闭入口并保存为
          null。整份帮助配置最多 16 KiB。
        </p>
      </section>
    </div>
  );
}
const groupLabels: Record<(typeof clientTraceGroups)[number], string> = {
  core: "核心交互",
  settings: "设置",
  workbench: "工作台",
  extensions: "扩展",
  automation: "自动化",
  account: "账号",
};
export function DesktopFields({
  value,
  onChange,
}: {
  value: ClientExperienceConfigMap["desktop"];
  onChange(value: ClientExperienceConfigMap["desktop"]): void;
}) {
  const trace = value.rendererActionTrace;
  return (
    <div className="experience-editor">
      <section className="experience-section">
        <h2>桌面上下文提示</h2>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={value.desktopContextPrompt.enabled}
            onChange={(event) =>
              onChange({
                ...value,
                desktopContextPrompt: { enabled: event.target.checked },
              })
            }
          />
          启用桌面上下文提示段
        </label>
        <p className="field-description">
          该开关不授予本机录屏、文件或工具权限，仍沿用当前桌面授权与会话准入。
        </p>
      </section>
      <section className="experience-section">
        <h2>界面动作追踪</h2>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={trace.enabled}
            onChange={(event) =>
              onChange({
                ...value,
                rendererActionTrace: {
                  ...trace,
                  enabled: event.target.checked,
                },
              })
            }
          />
          启用界面动作追踪
        </label>
        <label>
          <span>采样比例（0–0.2）</span>
          <input
            type="number"
            min={0}
            max={0.2}
            step={0.01}
            value={Number.isNaN(trace.sampleRatio) ? "" : trace.sampleRatio}
            onChange={(event) =>
              onChange({
                ...value,
                rendererActionTrace: {
                  ...trace,
                  sampleRatio: event.target.valueAsNumber,
                },
              })
            }
          />
          <small>
            0 表示不采样，0.2 表示最高 20%。不配置上传地址、请求头或凭据。
          </small>
        </label>
        <fieldset className="choice-group">
          <legend>启用的动作分组</legend>
          {clientTraceGroups.map((group) => (
            <label className="inline-check" key={group}>
              <input
                type="checkbox"
                checked={trace.enabledGroups.includes(group)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    rendererActionTrace: {
                      ...trace,
                      enabledGroups: event.target.checked
                        ? [...trace.enabledGroups, group]
                        : trace.enabledGroups.filter(
                            (current) => current !== group,
                          ),
                    },
                  })
                }
              />
              {groupLabels[group]}（{group}）
            </label>
          ))}
        </fieldset>
      </section>
    </div>
  );
}
