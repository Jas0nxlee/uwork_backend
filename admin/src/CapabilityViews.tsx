import { display, type Row } from "./api.js";

const flag = (value: unknown) =>
  value === true ? "是" : value === false ? "否" : display(value);

/** 运行能力展示；沙箱不可用时明确说不可用，不暗示可执行。 */
export function RuntimeCapabilityDetails({
  runtime,
  sandbox,
}: {
  runtime: Row;
  sandbox: Row;
}) {
  const available = sandbox.available === true;
  return (
    <>
      {!available && (
        <p className="error" role="alert">
          专用 Docker 镜像未配置：隔离代码执行不可用（镜像{" "}
          {display(sandbox.image)}）。智能体仍可使用模型与已批准连接器。
        </p>
      )}
      <h3>运行引擎</h3>
      <dl className="capabilities">
        <div>
          <dt>引擎</dt>
          <dd>{display(runtime.engine)}</dd>
        </div>
        <div>
          <dt>任意代码执行</dt>
          <dd>{flag(runtime.arbitraryCodeExecution)}</dd>
        </div>
        <div>
          <dt>隔离代码执行</dt>
          <dd>{flag(runtime.isolatedCodeExecution)}</dd>
        </div>
        <div>
          <dt>宿主代码执行</dt>
          <dd>{flag(runtime.hostCodeExecution)}</dd>
        </div>
        <div>
          <dt>工具类型</dt>
          <dd>
            {Array.isArray(runtime.toolKinds)
              ? runtime.toolKinds.map((kind) => display(kind)).join("、")
              : "-"}
          </dd>
        </div>
        <div>
          <dt>模型轮次上限</dt>
          <dd>{display(runtime.maxModelTurns)}</dd>
        </div>
        <div>
          <dt>工具调用上限</dt>
          <dd>{display(runtime.maxToolCalls)}</dd>
        </div>
        <div>
          <dt>并发运行</dt>
          <dd>{display(runtime.maxConcurrentRuns)}</dd>
        </div>
        <div>
          <dt>单次运行上限</dt>
          <dd>{display(runtime.maxRunTimeMs)} ms</dd>
        </div>
      </dl>
      <h3>Docker 沙箱</h3>
      <dl className="capabilities">
        <div>
          <dt>可用性</dt>
          <dd>{available ? "可用" : "不可用"}</dd>
        </div>
        <div>
          <dt>镜像</dt>
          <dd>{display(sandbox.image)}</dd>
        </div>
        <div>
          <dt>每租户 Runtime 上限</dt>
          <dd>{display(sandbox.maxTenantRuntimes)}</dd>
        </div>
        <div>
          <dt>并发执行上限</dt>
          <dd>{display(sandbox.maxConcurrentExecutions)}</dd>
        </div>
        <div>
          <dt>Runtime 最长存活</dt>
          <dd>{display(sandbox.maxLifetimeMs)} ms</dd>
        </div>
        <div>
          <dt>沙箱网络</dt>
          <dd>{flag(sandbox.network)}</dd>
        </div>
        <div>
          <dt>宿主挂载</dt>
          <dd>{flag(sandbox.hostMounts)}</dd>
        </div>
        <div>
          <dt>凭据注入</dt>
          <dd>{flag(sandbox.credentialInjection)}</dd>
        </div>
      </dl>
    </>
  );
}

/** 成员有效权限：后端按当前成员身份重新计算，不是角色模板推断。 */
export function MemberPermissionsDetails({ data }: { data: Row }) {
  const resources = Array.isArray(data.resources)
    ? (data.resources as Row[])
    : [];
  return (
    <>
      <dl className="capabilities">
        <div>
          <dt>成员状态</dt>
          <dd>{display(data.status)}</dd>
        </div>
        <div>
          <dt>席位</dt>
          <dd>{data.seat === true ? "已分配" : "未分配"}</dd>
        </div>
        <div>
          <dt>可见资源数</dt>
          <dd>{resources.length}</dd>
        </div>
      </dl>
      <h3>当前可见资源</h3>
      {resources.length ? (
        <ul>
          {resources.map((resource) => (
            <li key={display(resource.id)}>
              <strong>{display(resource.name)}</strong>{" "}
              <span className="status">{display(resource.kind)}</span>{" "}
              <code>{display(resource.id)}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">无可见资源</p>
      )}
      <h3>安全策略</h3>
      <pre className="detail">
        {JSON.stringify(data.security ?? {}, null, 2)}
      </pre>
    </>
  );
}
