import { z } from "zod";
import { fail } from "../core.js";
import {
  assertShareJson,
  MAX_SHARE_PAYLOAD_BYTES,
  shareBytesSha256,
} from "./integrity.js";

export const SHARING_LIMITS = {
  preparationTtlMs: 10 * 60 * 1000,
  shareTtlMs: 7 * 24 * 60 * 60 * 1000,
  maxRows: 2000,
  maxPayloadBytes: MAX_SHARE_PAYLOAD_BYTES,
  maxArtifactCount: 8,
  maxArtifactBytes: 512 * 1024,
  maxTotalArtifactBytes: 1024 * 1024,
} as const;

// 点段虽不含斜线，仍会被 URL 规范化为父路径，不能作为附件/分享定位符。
export const SHARE_ID = z
  .string()
  .regex(/^[A-Za-z0-9._~-]{1,128}$/u)
  .refine((id) => id !== "." && id !== "..");
const boundedText = z.string().trim().min(1).max(200);
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
export const preparationSchema = z
  .object({
    client_request_id: SHARE_ID,
    title: boundedText,
    schema_version: z.literal(1),
    access_mode: z.literal("organization"),
    payload_sha256: sha,
    artifact_count: z
      .number()
      .int()
      .min(0)
      .max(SHARING_LIMITS.maxArtifactCount),
  })
  .strict();

export const artifactDescriptorSchema = z
  .object({
    artifact_id: SHARE_ID,
    logical_artifact_key: SHARE_ID,
    producer_product_turn_id: SHARE_ID,
    artifact_version: z.number().int().positive(),
    state: z.literal("current"),
    ref: z
      .string()
      .regex(/^zcode-artifact:\/\/share\/[A-Za-z0-9._~-]{1,128}$/u),
    artifact_type: z.enum(["text", "md", "image", "pdf"]),
    display_name: boundedText.refine(
      (name) => !/[\x00-\x1f\x7f/\\]/u.test(name),
    ),
    extension: z.enum(["txt", "md", "png", "jpg", "jpeg", "pdf"]),
    mime_type: z.enum([
      "text/plain",
      "text/markdown",
      "image/png",
      "image/jpeg",
      "application/pdf",
    ]),
    size_bytes: z.number().int().min(0).max(SHARING_LIMITS.maxArtifactBytes),
    sha256: sha,
  })
  .strict()
  .superRefine((descriptor, context) => {
    const allowed = SHARING_ARTIFACTS.some(
      (entry) =>
        entry.type === descriptor.artifact_type &&
        entry.extensions.includes(descriptor.extension) &&
        entry.mime_types.includes(descriptor.mime_type),
    );
    if (
      !allowed ||
      descriptor.ref !== `zcode-artifact://share/${descriptor.artifact_id}`
    )
      context.addIssue({ code: "custom", message: "附件类型或引用不合法" });
  });

export const SHARING_ARTIFACTS: {
  type: string;
  extensions: string[];
  mime_types: string[];
}[] = [
  { type: "text", extensions: ["txt"], mime_types: ["text/plain"] },
  { type: "md", extensions: ["md"], mime_types: ["text/markdown"] },
  { type: "image", extensions: ["png"], mime_types: ["image/png"] },
  { type: "image", extensions: ["jpg", "jpeg"], mime_types: ["image/jpeg"] },
  { type: "pdf", extensions: ["pdf"], mime_types: ["application/pdf"] },
];

export type ShareArtifactDescriptor = z.infer<typeof artifactDescriptorSchema>;
export const confirmSchema = z
  .object({
    selected_product_turn_ids: z
      .array(SHARE_ID)
      .min(1)
      .max(SHARING_LIMITS.maxRows),
    projection: z
      .object({
        rows: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .max(SHARING_LIMITS.maxRows),
      })
      .strict(),
    integrity: z
      .object({ projection_sha256: sha, artifact_set_sha256: sha })
      .strict(),
    disclosure_confirmation: z
      .object({
        version: z.literal(1),
        accepted_at: z.number().int().nonnegative(),
        acknowledged_no_secret_detection: z.literal(true),
      })
      .strict(),
  })
  .strict();
export type ShareConfirm = z.infer<typeof confirmSchema>;
export type SharePreparation = z.infer<typeof preparationSchema>;

export function parseConfirmation(value: unknown) {
  assertShareJson(value);
  const body = confirmSchema.parse(value);
  const selected = new Set(body.selected_product_turn_ids);
  const present = new Set<string>();
  if (selected.size !== body.selected_product_turn_ids.length)
    fail(400, "SHARE_TURN_INVALID", "分享轮次不能重复");
  for (const row of body.projection.rows) {
    if (
      typeof row.kind !== "string" ||
      !row.kind ||
      typeof row.productTurnId !== "string" ||
      !selected.has(row.productTurnId)
    )
      fail(400, "SHARE_TURN_INVALID", "分享行必须属于所选轮次");
    present.add(row.productTurnId);
  }
  if (present.size !== selected.size)
    fail(400, "SHARE_TURN_INVALID", "所选轮次缺少内容");
  return body;
}

export function parseArtifact(value: unknown) {
  assertShareJson(value);
  const body = z
    .object({
      descriptor: artifactDescriptorSchema,
      content_base64: z
        .string()
        .max(Math.ceil(SHARING_LIMITS.maxArtifactBytes / 3) * 4),
    })
    .strict()
    .parse(value);
  const bytes = Buffer.from(body.content_base64, "base64");
  // Node base64 解码会宽容非法字符；反编码一致性让实际字节而非声明成为唯一依据。
  if (
    bytes.toString("base64") !== body.content_base64 ||
    bytes.byteLength !== body.descriptor.size_bytes ||
    shareBytesSha256(bytes) !== body.descriptor.sha256
  )
    fail(400, "SHARE_ARTIFACT_INVALID", "附件字节或摘要不一致");
  return { descriptor: body.descriptor, bytes };
}
