/** 真实退出测试曾直接显示内部码；只映射已知稳定值，保留原始诊断供排查。 */
export function enterpriseModelErrorMessageId(error: {
  code?: string;
  message: string;
}): string | undefined {
  const messages: Record<string, string> = {
    enterprise_identity_changed: "chat.error.enterpriseSessionChanged",
    enterprise_configuration_changed: "chat.error.enterpriseSessionChanged",
    enterprise_runtime_obsolete: "chat.error.enterpriseSessionChanged",
    enterprise_policy_unavailable: "chat.error.enterpriseServiceUnavailable",
    enterprise_model_relay_unavailable: "chat.error.enterpriseServiceUnavailable",
    enterprise_model_unavailable: "chat.error.enterpriseServiceUnavailable",
    enterprise_response_private: "chat.error.enterpriseResponseBlocked",
  };
  const read = (value: string) => (Object.hasOwn(messages, value) ? messages[value] : undefined);
  return (error.code ? read(error.code) : undefined) ?? read(error.message);
}
