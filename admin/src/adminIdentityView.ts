export interface AdminIdentityView {
  user: { id: string; name: string };
  tenant: { id: string; name: string };
  role: string;
  organizations: { id: string; name: string }[];
}

export function applyEnterpriseMetadata(
  current: AdminIdentityView | null,
  enterprise: { id: string; name: string },
): AdminIdentityView | null {
  // 企业更名曾只刷新设置页，顶部组织标签仍旧；仅向当前组织同步显示名称。
  if (!current || current.tenant.id !== enterprise.id) return current;
  if (
    current.tenant.name === enterprise.name &&
    current.organizations.every(
      (org) => org.id !== enterprise.id || org.name === enterprise.name,
    )
  )
    return current;
  return {
    ...current,
    tenant: { ...current.tenant, name: enterprise.name },
    organizations: current.organizations.map((org) =>
      org.id === enterprise.id ? { ...org, name: enterprise.name } : org,
    ),
  };
}
