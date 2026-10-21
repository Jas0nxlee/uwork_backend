import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/core.js";
import { createWecomProvider } from "../src/wecom.js";

const auth = {
  tenant_id: "tenant",
  corp_id: "corp",
  agent_id: "1000077",
  credential_id: "credential",
};
const member = (
  userid: string,
  name: string,
  department: number[],
  status: number,
) => ({ userid, name, department, status });

test("WeCom directory reads each visible department instead of the root department", async () => {
  const calls: { path: string; params: Record<string, string> }[] = [];
  const provider = createWecomProvider(async (path, params) => {
    calls.push({ path, params });
    if (path === "gettoken") return { errcode: 0, access_token: "token" };
    if (path === "department/list")
      return {
        errcode: 0,
        department: [
          { id: 23, name: "行政人事部", parentid: 1 },
          { id: 31, name: "招聘组", parentid: 23 },
        ],
      };
    if (path === "user/list" && params.department_id === "23")
      return {
        errcode: 0,
        userlist: [
          member("jingping.li", "李京平", [23], 1),
          member("guang.lin", "林光", [23, 31], 1),
        ],
      };
    if (path === "user/list" && params.department_id === "31")
      return {
        errcode: 0,
        userlist: [
          member("guang.lin", "林光", [23, 31], 1),
          member("left.one", "离职成员", [31], 4),
        ],
      };
    throw new Error(`unexpected upstream call ${path}`);
  });
  const directory = await provider.directory(auth, "secret");
  assert.deepEqual(
    calls.map((call) => call.path),
    ["gettoken", "department/list", "user/list", "user/list"],
  );
  assert.deepEqual(
    calls
      .filter((call) => call.path === "user/list")
      .map((call) => call.params.department_id),
    ["23", "31"],
  );
  assert.deepEqual(directory.departments, [
    { id: "23", name: "行政人事部", parentId: "1" },
    { id: "31", name: "招聘组", parentId: "23" },
  ]);
  assert.deepEqual(directory.members, [
    { id: "jingping.li", name: "李京平", departmentId: "23", active: true },
    { id: "guang.lin", name: "林光", departmentId: "23", active: true },
    { id: "left.one", name: "离职成员", departmentId: "31", active: false },
  ]);
});

test("WeCom directory refuses to sync an empty visible scope", async () => {
  const calls: string[] = [];
  const provider = createWecomProvider(async (path) => {
    calls.push(path);
    if (path === "gettoken") return { errcode: 0, access_token: "token" };
    if (path === "department/list") return { errcode: 0, department: [] };
    throw new Error(`unexpected upstream call ${path}`);
  });
  await assert.rejects(
    () => provider.directory(auth, "secret"),
    (error: ApiError) => {
      assert.equal(error.code, "WECOM_SCOPE_EMPTY");
      return true;
    },
  );
  assert.deepEqual(calls, ["gettoken", "department/list"]);
});

test("WeCom failures carry the upstream errcode", async () => {
  const provider = createWecomProvider(async (path) => {
    if (path === "gettoken") return { errcode: 0, access_token: "token" };
    if (path === "department/list")
      return {
        errcode: 60011,
        errmsg: "no privilege to access/modify contact/party/agent",
      };
    throw new Error(`unexpected upstream call ${path}`);
  });
  await assert.rejects(
    () => provider.directory(auth, "secret"),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "WECOM_REJECTED");
      assert.match(error.message, /errcode 60011/);
      assert.match(error.message, /no privilege to access/);
      return true;
    },
  );
});
