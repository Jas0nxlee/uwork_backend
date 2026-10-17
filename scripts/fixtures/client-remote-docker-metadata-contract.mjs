export function isOwnedMetadataCall(command, remoteSeedPath) {
  const args = command.args ?? [];
  if (!Array.isArray(args)) return false;
  if (command.channel === "system" && command.method === "info")
    return args.length === 0;
  return (
    command.channel === "file" &&
    ["readTextFile", "stat"].includes(command.method) &&
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0]) &&
    args[0].path === remoteSeedPath &&
    Object.keys(args[0]).length === 1
  );
}
