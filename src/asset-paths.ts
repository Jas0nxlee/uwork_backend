export function isPortableAssetPath(path: string): boolean {
  if (
    path.startsWith("/") ||
    /[\\:<>"|?*\p{Cc}]/u.test(path) ||
    path !== path.normalize("NFC")
  )
    return false;
  // 孤立代理项会在 Node 的 UTF-8 文件系统编码时变成同一个替代字符。
  if (
    [...path].some((character) => {
      const point = character.codePointAt(0)!;
      return point >= 0xd800 && point <= 0xdfff;
    })
  )
    return false;
  return path
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        !segment.startsWith(" ") &&
        !/[. ]$/.test(segment) &&
        !/^(CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[0-9\u00b9\u00b2\u00b3]|LPT[0-9\u00b9\u00b2\u00b3])$/.test(
          segment.split(".")[0]!.trimEnd().toUpperCase(),
        ),
    );
}

export function hasUnambiguousAssetPaths(
  files: readonly { path: string }[],
): boolean {
  // 完整大写折叠覆盖 final sigma/long s 等小写不等而文件系统同名的情况。
  const paths = files.map((file) => file.path.toUpperCase().normalize("NFC"));
  return (
    new Set(paths).size === paths.length &&
    paths.every((path) => !paths.some((other) => other.startsWith(`${path}/`)))
  );
}
