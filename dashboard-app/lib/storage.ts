"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { requireCapability } from "@/lib/authz";
import { writeSecurityAudit } from "@/lib/audit";
import { validateAsset } from "@/lib/asset-policy";

const ASSETS_BUCKET = "assets";

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.\-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface UploadResult {
  url: string | null;
  error: string | null;
}

export async function uploadAsset(file: File, folder: string): Promise<UploadResult> {
  const context = await requireCapability("manage_content");

  // R-006: one policy for size and type, shared with the client component and
  // unit-tested in lib/asset-policy.test.ts. This check is the ONLY guard on
  // upload size — Next's Server Action bodySizeLimit does not bound file uploads.
  const validation = validateAsset(file);
  if (!validation.ok) {
    return { url: null, error: validation.error };
  }

  const supabase = createServiceClient();

  const extension = file.name.split(".").pop() ?? "png";
  const baseName = sanitizeFilename(file.name.replace(/\.[^.]+$/, "")) || "asset";
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  const path = `${folder}/${baseName}-${timestamp}-${random}.${extension}`;

  try {
    const { error: uploadError } = await supabase.storage
      .from(ASSETS_BUCKET)
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);
    if (!publicUrlData?.publicUrl) {
      throw new Error("Could not get public URL for uploaded file");
    }

    await writeSecurityAudit(context, {
      action: "storage.asset_upload",
      targetTable: "storage.objects",
      targetId: path,
      after: { bucket: ASSETS_BUCKET, path, content_type: file.type, size: file.size },
    });
    return { url: publicUrlData.publicUrl, error: null };
  } catch (error) {
    await writeSecurityAudit(context, {
      action: "storage.asset_upload",
      targetTable: "storage.objects",
      targetId: path,
      success: false,
      errorMessage: error instanceof Error ? error.message : "Asset upload failed",
      metadata: { bucket: ASSETS_BUCKET, content_type: file.type, size: file.size },
    });
    return { url: null, error: error instanceof Error ? error.message : "Asset upload failed" };
  }
}

export async function deleteAsset(url: string): Promise<{ error: string | null }> {
  const context = await requireCapability("manage_content");

  if (!url) return { error: null };

  const supabase = createServiceClient();

  // Extract path from public URL.
  const bucketUrlPrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${ASSETS_BUCKET}/`;
  if (!url.startsWith(bucketUrlPrefix)) {
    // Not an asset bucket URL; skip deletion.
    return { error: null };
  }

  const path = url.slice(bucketUrlPrefix.length);

  try {
    const { error } = await supabase.storage.from(ASSETS_BUCKET).remove([path]);
    if (error) throw error;
    await writeSecurityAudit(context, {
      action: "storage.asset_delete",
      targetTable: "storage.objects",
      targetId: path,
      before: { bucket: ASSETS_BUCKET, path },
    });
    return { error: null };
  } catch (error) {
    await writeSecurityAudit(context, {
      action: "storage.asset_delete",
      targetTable: "storage.objects",
      targetId: path,
      success: false,
      errorMessage: error instanceof Error ? error.message : "Asset deletion failed",
      metadata: { bucket: ASSETS_BUCKET },
    });
    return { error: error instanceof Error ? error.message : "Asset deletion failed" };
  }
}
