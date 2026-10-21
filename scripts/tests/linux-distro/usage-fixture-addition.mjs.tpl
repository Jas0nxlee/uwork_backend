// 测试夹具只通过原公开 HTTP 创建第二成员并观测授权，不直接修改业务状态。
const distroOtherPassword = randomBytes(24).toString("hex");
const distroOther = await api(prefix + "/members", "POST", {
  email: "linux-other@example.test", name: "Linux另一测试成员",
  password: distroOtherPassword, role: "member", departmentId: department.id, seat: true,
});
const distroOtherToken = (await api("/api/auth/login", "POST", {
  email: "linux-other@example.test", password: distroOtherPassword,
}, undefined)).token;
async function distroUsageRequest(path, credential) {
  const response = await fetch(backendOrigin + path, { headers: { authorization: `Bearer ${credential}` } });
  return { status: response.status, body: await response.json() };
}
async function distroPublicUsageProof() {
  return {
    source: "original public HTTP; separate password-authenticated ordinary members",
    self: await distroUsageRequest("/api/client/usage", token),
    other: await distroUsageRequest("/api/client/usage", distroOtherToken),
    // The public self API has no selector: a foreign userId must not expand its actor scope.
    otherWithForeignSelector: await distroUsageRequest("/api/client/usage?userId=" + encodeURIComponent(member.id), distroOtherToken),
    selfManagement: await distroUsageRequest(prefix + "/usage", token),
    otherManagement: await distroUsageRequest(prefix + "/usage", distroOtherToken),
  };
}
