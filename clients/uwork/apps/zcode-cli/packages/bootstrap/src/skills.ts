import { resolve } from "node:path";
import { createConfig } from "@zcode/adapters/config";
import type {
  Logger,
  SkillContent,
  SkillDiagnostic,
  SkillLoadOutcome,
  SkillPort,
  TraceContext,
  EnterpriseSkillsCatalogPort,
  EnterpriseToolAuthorizationPort,
} from "@zcode/contracts";
import { createRootTraceContext } from "@zcode/contracts";
import { createConfiguredSkillPort } from "./skill-runtime.js";
import { resolveZCodePlugins } from "./plugins.js";
import { collectDisabledPaths } from "./skill-command-overrides.js";

export interface ListZCodeSkillsOptions {
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  projectConfigPath?: string;
  skipUserConfig?: boolean;
  userConfigPath?: string;
  workingDirectory?: string;
  enterpriseSkillsCatalog?: EnterpriseSkillsCatalogPort;
  enterpriseToolAuthorization?: EnterpriseToolAuthorizationPort;
  traceContext?: TraceContext;
  sessionId?: string;
  workspaceIdentity?: string;
}

export interface InspectZCodeSkillOptions extends ListZCodeSkillsOptions {
  name: string;
}

export interface ZCodeSkillInspection {
  diagnostics: SkillDiagnostic[];
  skill: SkillContent;
}

export async function listZCodeSkills(
  options: ListZCodeSkillsOptions = {},
): Promise<SkillLoadOutcome> {
  const discovery = createSkillDiscovery(options);
  if (!discovery.enabled) {
    return {
      diagnostics: [],
      skills: [],
      totalDiscovered: 0,
    };
  }

  return await discovery.skillPort.discoverSkills({
    workingDirectory: discovery.workingDirectory,
    trace: options.traceContext,
  });
}

export async function inspectZCodeSkill(
  options: InspectZCodeSkillOptions,
): Promise<ZCodeSkillInspection> {
  const discovery = createSkillDiscovery(options);
  if (!discovery.enabled) {
    throw new Error("Skills are disabled.");
  }

  const outcome = await discovery.skillPort.discoverSkills({
    workingDirectory: discovery.workingDirectory,
    trace: options.traceContext,
  });
  if (
    !outcome.skills.some(
      (skill) => skill.name === options.name || skill.qualifiedName === options.name,
    )
  ) {
    throw new Error(`Skill not found: ${options.name}`);
  }

  const skill = await discovery.skillPort.loadSkill({
    name: options.name,
    workingDirectory: discovery.workingDirectory,
    trace: options.traceContext,
  });

  return {
    diagnostics: outcome.diagnostics,
    skill,
  };
}

function createSkillDiscovery(options: ListZCodeSkillsOptions):
  | {
      enabled: false;
      workingDirectory: string;
    }
  | {
      enabled: true;
      skillPort: SkillPort;
      workingDirectory: string;
    } {
  const workingDirectory = resolve(options.workingDirectory ?? process.cwd());
  const configResult = createConfig({
    env: options.env,
    projectConfigPath: options.projectConfigPath,
    workingDirectory,
    skipUserConfig: options.skipUserConfig,
    userConfigPath: options.userConfigPath,
  });

  if (!configResult.config.features.skill || !configResult.config.skills.enabled) {
    return {
      enabled: false,
      workingDirectory,
    };
  }
  const pluginOutcome = resolveZCodePlugins({
    configResult,
    env: options.env,
    logger: options.logger,
    projectConfigPath: options.projectConfigPath,
    skipUserConfig: options.skipUserConfig,
    userConfigPath: options.userConfigPath,
    workingDirectory,
  });

  return {
    enabled: true,
    skillPort: createConfiguredSkillPort({
      enabled: true,
      roots: configResult.config.skills.roots,
      resolvedRoots: pluginOutcome.skillRoots,
      disabledPaths: collectDisabledPaths(configResult.config.skillOverrides),
      context: {
        authorization: options.enterpriseToolAuthorization,
        catalog: options.enterpriseSkillsCatalog,
        sessionId: options.sessionId ?? "enterprise-draft",
        workspacePath: workingDirectory,
        workspaceIdentity: options.workspaceIdentity,
        traceContext: options.traceContext ?? createRootTraceContext(),
      },
    })!,
    workingDirectory,
  };
}
