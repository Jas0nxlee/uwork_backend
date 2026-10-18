import { fail } from "../core.js";
import type { ShareArtifactDescriptor, ShareConfirm } from "./contracts.js";

function invalid(): never {
  fail(400, "SHARE_ARTIFACT_REFERENCE_INVALID", "分享行与附件清单不一致");
}

/** 摘要仅证明请求未变，不能证明 row 没有错接另一个附件；闭包另由此处核对。 */
export function assertArtifactReferences(
  confirm: ShareConfirm,
  descriptors: ShareArtifactDescriptor[],
) {
  const byId = new Map(
    descriptors.map((descriptor) => [descriptor.artifact_id, descriptor]),
  );
  const byRef = new Map(
    descriptors.map((descriptor) => [descriptor.ref, descriptor]),
  );
  const referenced = new Set<string>();
  const artifactRows = new Set<string>();
  for (const row of confirm.projection.rows) {
    if (row.kind === "artifact") {
      const descriptor =
        typeof row.artifactVersionId === "string"
          ? byId.get(row.artifactVersionId)
          : undefined;
      if (!descriptor || artifactRows.has(descriptor.artifact_id)) invalid();
      if (
        row.ref !== descriptor.ref ||
        row.logicalArtifactKey !== descriptor.logical_artifact_key ||
        row.productTurnId !== descriptor.producer_product_turn_id ||
        row.artifactType !== descriptor.artifact_type ||
        row.displayName !== descriptor.display_name ||
        row.mimeType !== descriptor.mime_type ||
        row.sizeBytes !== descriptor.size_bytes ||
        row.sha256 !== descriptor.sha256 ||
        row.state !== descriptor.state
      )
        invalid();
      referenced.add(descriptor.artifact_id);
      artifactRows.add(descriptor.artifact_id);
    }
    if (row.kind === "userInput" && row.attachments !== undefined) {
      if (!Array.isArray(row.attachments)) invalid();
      for (const entry of row.attachments) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          invalid();
        const attachment = entry as Record<string, unknown>;
        const descriptor =
          typeof attachment.ref === "string"
            ? byRef.get(attachment.ref)
            : undefined;
        if (
          !descriptor ||
          attachment.fileName !== descriptor.display_name ||
          attachment.mime !== descriptor.mime_type ||
          attachment.bytes !== descriptor.size_bytes
        )
          invalid();
        referenced.add(descriptor.artifact_id);
        if (attachment.previewRef !== undefined) {
          const preview =
            typeof attachment.previewRef === "string"
              ? byRef.get(attachment.previewRef)
              : undefined;
          if (!preview || preview.artifact_type !== "image") invalid();
          referenced.add(preview.artifact_id);
        }
      }
    }
  }
  if (referenced.size !== descriptors.length) invalid();
}
