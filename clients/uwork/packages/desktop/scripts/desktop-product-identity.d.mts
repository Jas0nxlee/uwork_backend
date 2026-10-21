export type DesktopProductFlavor = "production" | "preview";
export type DesktopProductEnvironment = Record<string, string | undefined>;
export interface DesktopProductIdentity {
  readonly flavor: DesktopProductFlavor;
  readonly appId: string;
  readonly productName: string;
  readonly linuxExecutableName: string;
  readonly linuxPackageName: string;
  readonly cuaHelperInstallVariant: "preview" | null;
}
export const ZCODE_PREVIEW_IDENTITY_ENV: "ZCODE_PREVIEW_IDENTITY";
export const desktopProductIdentities: Readonly<
  Record<DesktopProductFlavor, DesktopProductIdentity>
>;
export function isPreviewIdentityRequested(env?: DesktopProductEnvironment): boolean;
export function resolveDesktopProductFlavor(env?: DesktopProductEnvironment): DesktopProductFlavor;
export function resolveDesktopProductIdentity(
  env?: DesktopProductEnvironment,
): DesktopProductIdentity;
export function resolveDesktopArtifactSuffix(env?: DesktopProductEnvironment): "_TEST" | "";
export function resolveWindowsAppUserModelIdForFlavor(
  flavor: DesktopProductFlavor,
  runtime?: { isPackaged: boolean },
): string;
export function resolveWindowsAppUserModelId(
  env?: DesktopProductEnvironment,
  runtime?: { isPackaged: boolean },
): string;
