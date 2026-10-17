"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import {
  getAirdropWalletBalance,
  getTokenBalance,
  isValidSolanaAddress,
  amountToRaw,
  rawToAmount,
  executePayoutTransfers,
  confirmTokenTransfer,
  type PayoutTransfer,
} from "@/lib/solana";
import { uploadAsset, deleteAsset } from "@/lib/storage";
import { requireActiveUser, requireCapability, type AuthorizationContext } from "@/lib/authz";
import { writeSecurityAudit } from "@/lib/audit";
import {
  assertSecurityAdminRemovalSafe,
  isUuid,
  validateUserIds,
  validateUserRole,
  validateUserStatus,
  requiresSecurityAuthorization,
  type ManagedUserRole,
  type ManagedUserStatus,
  type SecurityAdminState,
  OFFER_CLICK_DEDUPE_SECONDS,
} from "@/lib/security-mutations";

interface ManagedUserRow {
  user_id: string;
  role: ManagedUserRole;
  status: ManagedUserStatus;
  can_manage_security: boolean;
}

function toSecurityAdminState(row: ManagedUserRow): SecurityAdminState {
  return {
    id: row.user_id,
    role: row.role,
    status: row.status,
    canManageSecurity: row.can_manage_security,
  };
}

async function loadManagedUserStates(ids: string[]): Promise<SecurityAdminState[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("user_authorizations")
    .select("user_id, role, status, can_manage_security")
    .in("user_id", ids);
  if (error) throw error;
  if (!data || data.length !== ids.length) {
    throw new Error("One or more selected users do not exist.");
  }
  return (data as ManagedUserRow[]).map(toSecurityAdminState);
}

async function loadActiveSecurityAdminIds(): Promise<string[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("user_authorizations")
    .select("user_id")
    .eq("role", "admin")
    .eq("status", "active")
    .eq("can_manage_security", true);
  if (error) throw error;
  return (data ?? []).map((row: { user_id: string }) => row.user_id);
}

async function auditMutationFailure(
  context: AuthorizationContext,
  action: string,
  targetTable: string,
  targetId: string | null,
  error: unknown,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await writeSecurityAudit(context, {
    action,
    targetTable,
    targetId,
    success: false,
    errorMessage: error instanceof Error ? error.message : "Unknown error",
    metadata,
  });
}

async function auditedAdminMutation<T>(
  context: AuthorizationContext,
  action: string,
  targetTable: string,
  targetId: string | null,
  mutate: () => Promise<T>,
  metadata: Record<string, unknown> = {}
): Promise<T> {
  try {
    const result = await mutate();
    await writeSecurityAudit(context, {
      action,
      targetTable,
      targetId,
      success: true,
      metadata,
    });
    return result;
  } catch (error) {
    await auditMutationFailure(context, action, targetTable, targetId, error, metadata);
    throw error;
  }
}

export async function updateProfile(formData: FormData) {
  const { user } = await requireActiveUser();
  const supabase = createClient();
  const displayName = formData.get("displayName") as string;

  const { error } = await supabase
    .from("users")
    .update({ display_name: displayName })
    .eq("id", user.id);

  if (error) throw error;
  revalidatePath("/dashboard/profile");
}

async function resolveImageUrl(
  formData: FormData,
  fileFieldName: string,
  urlFieldName: string,
  folder: string
): Promise<string | null> {
  const file = formData.get(fileFieldName) as File | null;
  const url = (formData.get(urlFieldName) as string) || null;

  if (file && file.size > 0) {
    const { url: uploadedUrl, error } = await uploadAsset(file, folder);
    if (error) throw new Error(error);
    return uploadedUrl;
  }

  return url;
}

export async function createOffer(formData: FormData) {
  const context = await requireCapability("manage_content");
  const supabase = createServiceClient();
  const logoUrl = await resolveImageUrl(formData, "logoFile", "logoUrl", "offers");

  await auditedAdminMutation(context, "offer.create", "public.affiliate_offers", null, async () => {
    const { error } = await supabase.from("affiliate_offers").insert({
      name: formData.get("name") as string,
      category_id: (formData.get("categoryId") as string) || null,
      referral_url: formData.get("referralUrl") as string,
      description: formData.get("description") as string,
      benefit_text: formData.get("benefitText") as string,
      reward_eligible: formData.get("rewardEligible") === "on",
      active: formData.get("active") === "on",
      display_order: parseInt(formData.get("displayOrder") as string) || 0,
      logo_url: logoUrl,
    });
    if (error) throw error;
  });
  revalidatePath("/admin/offers");
}

export async function updateOffer(id: string, formData: FormData) {
  const context = await requireCapability("manage_content");
  const supabase = createServiceClient();

  await auditedAdminMutation(context, "offer.update", "public.affiliate_offers", id, async () => {
    // Fetch current logo URL to decide whether to delete old asset.
    const { data: current } = await supabase
      .from("affiliate_offers")
      .select("logo_url")
      .eq("id", id)
      .single();

    const logoUrl = await resolveImageUrl(formData, "logoFile", "logoUrl", "offers");

    // If a new file was uploaded and the old logo was in storage, delete it.
    const newFile = formData.get("logoFile") as File | null;
    if (newFile && newFile.size > 0 && current?.logo_url && current.logo_url !== logoUrl) {
      await deleteAsset(current.logo_url);
    }

    const { error } = await supabase
      .from("affiliate_offers")
      .update({
        name: formData.get("name") as string,
        category_id: (formData.get("categoryId") as string) || null,
        referral_url: formData.get("referralUrl") as string,
        description: formData.get("description") as string,
        benefit_text: formData.get("benefitText") as string,
        reward_eligible: formData.get("rewardEligible") === "on",
        active: formData.get("active") === "on",
        display_order: parseInt(formData.get("displayOrder") as string) || 0,
        logo_url: logoUrl,
      })
      .eq("id", id);
    if (error) throw error;
  });
  revalidatePath("/admin/offers");
}

export async function deleteOffer(id: string) {
  const context = await requireCapability("manage_content");
  const supabase = createServiceClient();
  await auditedAdminMutation(context, "offer.delete", "public.affiliate_offers", id, async () => {
    const { error } = await supabase.from("affiliate_offers").delete().eq("id", id);
    if (error) throw error;
  });
  revalidatePath("/admin/offers");
}

export async function createCategory(formData: FormData) {
  const context = await requireCapability("manage_content");
  const supabase = createServiceClient();
  await auditedAdminMutation(context, "category.create", "public.categories", null, async () => {
    const { error } = await supabase.from("categories").insert({
      name: formData.get("name") as string,
      slug: formData.get("slug") as string,
      display_order: parseInt(formData.get("displayOrder") as string) || 0,
    });
    if (error) throw error;
  });
  revalidatePath("/admin/categories");
}

export async function createIncome(formData: FormData) {
  const context = await requireCapability("manage_financials");
  const supabase = createServiceClient();
  await auditedAdminMutation(context, "income.create", "public.affiliate_income", null, async () => {
    const { error } = await supabase.from("affiliate_income").insert({
      source: formData.get("source") as string,
      offer_id: (formData.get("offerId") as string) || null,
      amount: parseFloat(formData.get("amount") as string),
      currency: formData.get("currency") as string,
      date_received: formData.get("dateReceived") as string,
      notes: formData.get("notes") as string,
      created_by: context.user.id,
    });
    if (error) throw error;
  });
  revalidatePath("/admin/income");
}

export async function updateIncome(id: string, formData: FormData) {
  const context = await requireCapability("manage_financials");
  const supabase = createServiceClient();
  await auditedAdminMutation(context, "income.update", "public.affiliate_income", id, async () => {
    const { error } = await supabase
      .from("affiliate_income")
      .update({
        source: formData.get("source") as string,
        offer_id: (formData.get("offerId") as string) || null,
        amount: parseFloat(formData.get("amount") as string),
        currency: formData.get("currency") as string,
        date_received: formData.get("dateReceived") as string,
        notes: formData.get("notes") as string,
      })
      .eq("id", id);
    if (error) throw error;
  });
  revalidatePath("/admin/income");
}

export async function deleteIncome(id: string) {
  const context = await requireCapability("manage_financials");
  const supabase = createServiceClient();
  await auditedAdminMutation(context, "income.delete", "public.affiliate_income", id, async () => {
    const { error } = await supabase.from("affiliate_income").delete().eq("id", id);
    if (error) throw error;
  });
  revalidatePath("/admin/income");
}

export async function updateCategory(id: string, formData: FormData) {
  const context = await requireCapability("manage_content");
  const supabase = createServiceClient();
  await auditedAdminMutation(context, "category.update", "public.categories", id, async () => {
    const { error } = await supabase
      .from("categories")
      .update({
        name: formData.get("name") as string,
        slug: formData.get("slug") as string,
        display_order: parseInt(formData.get("displayOrder") as string) || 0,
        active: formData.get("active") === "on",
      })
      .eq("id", id);
    if (error) throw error;
  });
  revalidatePath("/admin/categories");
}

export async function deleteCategory(id: string) {
  const context = await requireCapability("manage_content");
  const supabase = createServiceClient();
  await auditedAdminMutation(context, "category.delete", "public.categories", id, async () => {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) throw error;
  });
  revalidatePath("/admin/categories");
}

export async function updateUser(id: string, formData: FormData) {
  if (!isUuid(id)) throw new Error("Invalid user ID.");

  let context = await requireCapability("manage_users");
  const supabase = createServiceClient();
  const [current] = await loadManagedUserStates([id]);
  const nextRole = validateUserRole(String(formData.get("role") ?? current.role));
  const nextStatus = validateUserStatus(String(formData.get("status") ?? current.status));
  const roleChanged = requiresSecurityAuthorization(current.role, nextRole);

  if (roleChanged) {
    try {
      context = await requireCapability("manage_security", { requiredAal: "aal2" });
    } catch (error) {
      await auditMutationFailure(
        context,
        "user.role_change_denied",
        "public.user_authorizations",
        id,
        error,
        { requested_role: nextRole }
      );
      throw error;
    }
  }

  const walletAddress = String(formData.get("walletAddress") ?? "").trim() || null;
  if (walletAddress && !isValidSolanaAddress(walletAddress)) {
    throw new Error("Invalid Solana wallet address.");
  }

  try {
    if (roleChanged || nextStatus !== current.status) {
      assertSecurityAdminRemovalSafe({
        actorId: context.user.id,
        targets: [current],
        allActiveSecurityAdminIds: await loadActiveSecurityAdminIds(),
        nextRole,
        nextStatus,
      });
    }

    const before = {
      role: current.role,
      status: current.status,
      display_name: null,
      wallet_address: null,
    };
    const { data: profile } = await supabase
      .from("users")
      .select("display_name, wallet_address")
      .eq("id", id)
      .single();
    before.display_name = profile?.display_name ?? null;
    before.wallet_address = profile?.wallet_address ?? null;

    const after = {
      role: nextRole,
      status: nextStatus,
      display_name: (formData.get("displayName") as string) || null,
      wallet_address: walletAddress,
    };
    const { error } = await supabase.from("users").update(after).eq("id", id);
    if (error) throw error;

    await writeSecurityAudit(context, {
      action: roleChanged ? "user.security_update" : "user.update",
      targetTable: "public.users",
      targetId: id,
      before,
      after,
      metadata: { role_changed: roleChanged },
    });
  } catch (error) {
    await auditMutationFailure(context, "user.update", "public.users", id, error, {
      requested_role: nextRole,
      requested_status: nextStatus,
    });
    throw error;
  }

  revalidatePath("/admin/users");
}

export async function bulkUpdateUsersRole(ids: string[], role: string) {
  const userIds = validateUserIds(ids);
  const nextRole = validateUserRole(role);
  const baseContext = await requireActiveUser();
  let context: AuthorizationContext;
  try {
    context = await requireCapability("manage_security", { requiredAal: "aal2" });
  } catch (error) {
    await auditMutationFailure(
      baseContext,
      "users.bulk_role_update_denied",
      "public.user_authorizations",
      null,
      error,
      { target_ids: userIds, role: nextRole }
    );
    throw error;
  }
  const supabase = createServiceClient();

  try {
    const targets = await loadManagedUserStates(userIds);
    assertSecurityAdminRemovalSafe({
      actorId: context.user.id,
      targets,
      allActiveSecurityAdminIds: await loadActiveSecurityAdminIds(),
      nextRole,
    });

    const { error } = await supabase.from("users").update({ role: nextRole }).in("id", userIds);
    if (error) throw error;
    await writeSecurityAudit(context, {
      action: "users.bulk_role_update",
      targetTable: "public.users",
      metadata: { target_ids: userIds, role: nextRole, previous: targets },
    });
  } catch (error) {
    await auditMutationFailure(context, "users.bulk_role_update", "public.users", null, error, {
      target_ids: userIds,
      role: nextRole,
    });
    throw error;
  }
  revalidatePath("/admin/users");
}

export async function bulkUpdateUsersStatus(ids: string[], status: string) {
  const userIds = validateUserIds(ids);
  const nextStatus = validateUserStatus(status);
  const context = await requireCapability("manage_users");
  const supabase = createServiceClient();

  try {
    const targets = await loadManagedUserStates(userIds);
    assertSecurityAdminRemovalSafe({
      actorId: context.user.id,
      targets,
      allActiveSecurityAdminIds: await loadActiveSecurityAdminIds(),
      nextStatus,
    });
    const { error } = await supabase.from("users").update({ status: nextStatus }).in("id", userIds);
    if (error) throw error;
    await writeSecurityAudit(context, {
      action: "users.bulk_status_update",
      targetTable: "public.users",
      metadata: { target_ids: userIds, status: nextStatus, previous: targets },
    });
  } catch (error) {
    await auditMutationFailure(context, "users.bulk_status_update", "public.users", null, error, {
      target_ids: userIds,
      status: nextStatus,
    });
    throw error;
  }
  revalidatePath("/admin/users");
}

export async function bulkDeleteUsers(ids: string[]) {
  const userIds = validateUserIds(ids);
  const context = await requireCapability("manage_users");
  const supabase = createServiceClient();

  try {
    const targets = await loadManagedUserStates(userIds);
    assertSecurityAdminRemovalSafe({
      actorId: context.user.id,
      targets,
      allActiveSecurityAdminIds: await loadActiveSecurityAdminIds(),
      deleting: true,
    });
    const { error } = await supabase.from("users").delete().in("id", userIds);
    if (error) throw error;
    await writeSecurityAudit(context, {
      action: "users.bulk_delete",
      targetTable: "public.users",
      metadata: { target_ids: userIds, previous: targets },
    });
  } catch (error) {
    await auditMutationFailure(context, "users.bulk_delete", "public.users", null, error, {
      target_ids: userIds,
    });
    throw error;
  }
  revalidatePath("/admin/users");
}

export async function createRewardPeriod(formData: FormData) {
  const context = await requireCapability("manage_rewards");
  const supabase = createServiceClient();
  await auditedAdminMutation(context, "reward_period.create", "public.reward_periods", null, async () => {
    const { error } = await supabase.from("reward_periods").insert({
      start_date: formData.get("startDate") as string,
      end_date: formData.get("endDate") as string,
      allocation_model_id: (formData.get("allocationModelId") as string) || null,
    });
    if (error) throw error;
  });
  revalidatePath("/admin/rewards");
}

const ACTIVITY_POINTS: Record<string, number> = {
  click: 1,
  signup: 5,
  purchase: 10,
  other: 1,
};

async function executeRewardCalculation(
  supabase: ReturnType<typeof createServiceClient>,
  periodId: string
) {
  const { data: period, error: periodError } = await supabase
    .from("reward_periods")
    .select("*, allocation_model:allocation_models(*)")
    .eq("id", periodId)
    .single();
  if (periodError || !period) throw periodError || new Error("Period not found");

  const { data: incomeRows } = await supabase
    .from("affiliate_income")
    .select("amount")
    .gte("date_received", period.start_date)
    .lte("date_received", period.end_date);
  const totalIncome = incomeRows?.reduce((sum, row) => sum + (row.amount || 0), 0) ?? 0;

  const communityPct = period.allocation_model?.community_rewards_pct ?? 0;
  const communityPool = totalIncome * (communityPct / 100);

  const { data: activities } = await supabase
    .from("user_activities")
    .select("user_id, activity_type")
    .gte("created_at", `${period.start_date}T00:00:00Z`)
    .lte("created_at", `${period.end_date}T23:59:59Z`);

  const { data: users } = await supabase.from("users").select("id, referred_by");

  const directPointsByUser = new Map<string, number>();
  activities?.forEach((a) => {
    const points = ACTIVITY_POINTS[a.activity_type] ?? 1;
    const current = directPointsByUser.get(a.user_id) || 0;
    directPointsByUser.set(a.user_id, current + points);
  });

  const REFERRAL_BONUS_PCT = 5;
  const pointsByUser = new Map<string, number>();
  let totalPoints = 0;

  users?.forEach((user) => {
    let points = directPointsByUser.get(user.id) || 0;

    // Add 5% of each referred user's direct points
    users.forEach((potentialReferral) => {
      if (potentialReferral.referred_by === user.id) {
        const referralPoints = directPointsByUser.get(potentialReferral.id) || 0;
        points += referralPoints * (REFERRAL_BONUS_PCT / 100);
      }
    });

    if (points > 0) {
      pointsByUser.set(user.id, points);
      totalPoints += points;
    }
  });

  if (totalPoints === 0 || communityPool === 0) {
    await supabase
      .from("reward_periods")
      .update({ total_income: totalIncome, status: "calculating" })
      .eq("id", periodId);
    return { totalIncome, recipients: 0 };
  }

  const rewards = Array.from(pointsByUser.entries()).map(([userId, points]) => {
    const estimated = (points / totalPoints) * communityPool;
    return {
      user_id: userId,
      reward_period_id: periodId,
      estimated_aud_value: Number(estimated.toFixed(2)),
      bitxbit_amount: Number(estimated.toFixed(4)),
      status: "pending",
    };
  });

  await supabase.from("user_rewards").delete().eq("reward_period_id", periodId);
  const { error: insertError } = await supabase.from("user_rewards").insert(rewards);
  if (insertError) throw insertError;

  await supabase
    .from("reward_periods")
    .update({ total_income: totalIncome, status: "calculating" })
    .eq("id", periodId);

  return { totalIncome, recipients: rewards.length };
}

export async function calculateRewards(periodId: string) {
  if (!isUuid(periodId)) throw new Error("Invalid reward period ID.");
  const context = await requireCapability("manage_rewards");
  const supabase = createServiceClient();

  await auditedAdminMutation(
    context,
    "reward_period.calculate",
    "public.reward_periods",
    periodId,
    async () => {
      const { data: period, error: periodError } = await supabase
        .from("reward_periods")
        .select("status")
        .eq("id", periodId)
        .single();
      if (periodError || !period) throw periodError || new Error("Period not found");

      // Lock calculations after approval or distribution.
      if (period.status === "approved" || period.status === "distributed") {
        throw new Error(
          `Cannot recalculate rewards for a period that is already ${period.status}. Use the correction process instead.`
        );
      }

      // Prohibit changes once any payout activity exists.
      const { data: payouts, error: payoutsError } = await supabase
        .from("payout_operations")
        .select("id")
        .eq("reward_period_id", periodId)
        .limit(1);
      if (payoutsError) throw payoutsError;
      if (payouts && payouts.length > 0) {
        throw new Error(
          "Cannot recalculate rewards for a period with existing payout activity. Use the correction process instead."
        );
      }

      return executeRewardCalculation(supabase, periodId);
    },
    { period_id: periodId }
  );

  revalidatePath("/admin/rewards");
}

export async function correctRewards(periodId: string, reason: string) {
  if (!isUuid(periodId)) throw new Error("Invalid reward period ID.");
  if (!reason || reason.trim().length === 0) {
    throw new Error("A correction reason is required.");
  }
  if (reason.trim().length > 2000) {
    throw new Error("Correction reason must be 2000 characters or less.");
  }

  const context = await requireCapability("manage_rewards");
  const supabase = createServiceClient();

  await auditedAdminMutation(
    context,
    "reward_period.correct",
    "public.reward_periods",
    periodId,
    async () => {
      const { data: period, error: periodError } = await supabase
        .from("reward_periods")
        .select("status")
        .eq("id", periodId)
        .single();
      if (periodError || !period) throw periodError || new Error("Period not found");

      if (period.status === "distributed") {
        throw new Error("Cannot correct a period that has already been distributed.");
      }

      // Confirmed payouts are final; correction would require a reversal flow.
      const { data: confirmedPayouts, error: confirmedError } = await supabase
        .from("payout_operations")
        .select("id")
        .eq("reward_period_id", periodId)
        .eq("status", "confirmed")
        .limit(1);
      if (confirmedError) throw confirmedError;
      if (confirmedPayouts && confirmedPayouts.length > 0) {
        throw new Error(
          "Cannot correct a period with confirmed payouts. Reversal requires a separate financial process."
        );
      }

      // Remove any pending/failed/submitted payout operations so the reward
      // amounts and recipients can be safely recalculated.
      const { error: deletePayoutsError } = await supabase
        .from("payout_operations")
        .delete()
        .eq("reward_period_id", periodId);
      if (deletePayoutsError) throw deletePayoutsError;

      // Reset reward records before recalculation.
      const { error: deleteRewardsError } = await supabase
        .from("user_rewards")
        .delete()
        .eq("reward_period_id", periodId);
      if (deleteRewardsError) throw deleteRewardsError;

      // Reset period status so recalculation can proceed.
      const { error: resetError } = await supabase
        .from("reward_periods")
        .update({ status: "pending", total_income: 0 })
        .eq("id", periodId);
      if (resetError) throw resetError;

      return executeRewardCalculation(supabase, periodId);
    },
    { period_id: periodId, reason: reason.trim() }
  );

  revalidatePath("/admin/rewards");
}

export async function approveRewards(periodId: string) {
  if (!isUuid(periodId)) throw new Error("Invalid reward period ID.");
  const context = await requireCapability("manage_rewards");
  const supabase = createServiceClient();
  await auditedAdminMutation(
    context,
    "reward_period.approve",
    "public.reward_periods",
    periodId,
    async () => {
      const { error } = await supabase
        .from("user_rewards")
        .update({ status: "approved" })
        .eq("reward_period_id", periodId)
        .eq("status", "pending");
      if (error) throw error;

      await supabase.from("reward_periods").update({ status: "approved" }).eq("id", periodId);
    },
    { period_id: periodId }
  );
  revalidatePath("/admin/rewards");
}

export async function publishTransparencyReport(id: string) {
  const context = await requireCapability("manage_content");
  const supabase = createServiceClient();
  await auditedAdminMutation(
    context,
    "transparency_report.publish",
    "public.transparency_reports",
    id,
    async () => {
      const { error } = await supabase
        .from("transparency_reports")
        .update({ published_at: new Date().toISOString(), published_by: context.user.id })
        .eq("id", id);
      if (error) throw error;
    }
  );
  revalidatePath("/admin/transparency-updates");
  revalidatePath("/dashboard/transparency");
}

export async function unpublishTransparencyReport(id: string) {
  const context = await requireCapability("manage_content");
  const supabase = createServiceClient();
  await auditedAdminMutation(
    context,
    "transparency_report.unpublish",
    "public.transparency_reports",
    id,
    async () => {
      const { error } = await supabase
        .from("transparency_reports")
        .update({ published_at: null, published_by: null })
        .eq("id", id);
      if (error) throw error;
    }
  );
  revalidatePath("/admin/transparency-updates");
  revalidatePath("/dashboard/transparency");
}

export async function createProject(formData: FormData) {
  const context = await requireCapability("manage_content");
  const supabase = createServiceClient();
  const imageUrl = await resolveImageUrl(formData, "imageFile", "imageUrl", "projects");

  await auditedAdminMutation(context, "project.create", "public.projects", null, async () => {
    const { error } = await supabase.from("projects").insert({
      name: formData.get("name") as string,
      description: formData.get("description") as string,
      funding_goal: parseFloat(formData.get("fundingGoal") as string) || null,
      status: formData.get("status") as string,
      impact_statement: formData.get("impactStatement") as string,
      image_url: imageUrl,
    });
    if (error) throw error;
  });
  revalidatePath("/admin/projects");
}

export async function updateProject(id: string, formData: FormData) {
  const context = await requireCapability("manage_content");
  const supabase = createServiceClient();

  await auditedAdminMutation(context, "project.update", "public.projects", id, async () => {
    // Fetch current image URL to decide whether to delete old asset.
    const { data: current } = await supabase
      .from("projects")
      .select("image_url")
      .eq("id", id)
      .single();

    const imageUrl = await resolveImageUrl(formData, "imageFile", "imageUrl", "projects");

    // If a new file was uploaded and the old image was in storage, delete it.
    const newFile = formData.get("imageFile") as File | null;
    if (newFile && newFile.size > 0 && current?.image_url && current.image_url !== imageUrl) {
      await deleteAsset(current.image_url);
    }

    const { error } = await supabase
      .from("projects")
      .update({
        name: formData.get("name") as string,
        description: formData.get("description") as string,
        funding_goal: parseFloat(formData.get("fundingGoal") as string) || null,
        status: formData.get("status") as string,
        impact_statement: formData.get("impactStatement") as string,
        amount_allocated: parseFloat(formData.get("amountAllocated") as string) || 0,
        image_url: imageUrl,
      })
      .eq("id", id);
    if (error) throw error;
  });
  revalidatePath("/admin/projects");
}

export async function deleteProject(id: string) {
  const context = await requireCapability("manage_content");
  const supabase = createServiceClient();
  await auditedAdminMutation(context, "project.delete", "public.projects", id, async () => {
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) throw error;
  });
  revalidatePath("/admin/projects");
}

export async function createTransparencyReport(formData: FormData) {
  const context = await requireCapability("manage_content");
  const supabase = createServiceClient();

  const totalIncome = parseFloat(formData.get("totalIncome") as string) || 0;
  const communityRewardsPct = parseFloat(formData.get("communityRewardsPct") as string) || 0;
  const liquidityPct = parseFloat(formData.get("liquidityPct") as string) || 0;
  const buybacksPct = parseFloat(formData.get("buybacksPct") as string) || 0;
  const projectsPct = parseFloat(formData.get("projectsPct") as string) || 0;
  const operationsPct = parseFloat(formData.get("operationsPct") as string) || 0;

  const allocationSnapshot = {
    community_rewards_pct: communityRewardsPct,
    liquidity_pct: liquidityPct,
    buybacks_pct: buybacksPct,
    projects_pct: projectsPct,
    operations_pct: operationsPct,
    community_rewards_aud: Number(((totalIncome * communityRewardsPct) / 100).toFixed(2)),
    liquidity_aud: Number(((totalIncome * liquidityPct) / 100).toFixed(2)),
    buybacks_aud: Number(((totalIncome * buybacksPct) / 100).toFixed(2)),
    projects_aud: Number(((totalIncome * projectsPct) / 100).toFixed(2)),
    operations_aud: Number(((totalIncome * operationsPct) / 100).toFixed(2)),
  };

  const proofUrls = (formData.get("proofUrls") as string)
    ?.split("\n")
    .map((url) => url.trim())
    .filter(Boolean) ?? [];

  await auditedAdminMutation(
    context,
    "transparency_report.create",
    "public.transparency_reports",
    null,
    async () => {
      const { error } = await supabase.from("transparency_reports").insert({
        report_month: formData.get("reportMonth") as string,
        report_year: parseInt(formData.get("reportYear") as string),
        total_income: totalIncome || null,
        allocation_snapshot: allocationSnapshot,
        summary_text: formData.get("summaryText") as string,
        proof_urls: proofUrls,
        published_by: context.user.id,
        published_at: new Date().toISOString(),
      });
      if (error) throw error;
    }
  );
  revalidatePath("/admin/transparency-updates");
}

export async function trackOfferClick(offerId: string, referralUrl: string) {
  if (!isUuid(offerId)) throw new Error("Invalid offer ID.");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(referralUrl);
  } catch {
    throw new Error("Invalid offer URL.");
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("Invalid offer URL protocol.");
  }

  const context = await requireActiveUser();
  const supabase = createServiceClient();
  try {
    const { data, error } = await supabase.rpc("record_trusted_offer_click", {
      p_user_id: context.user.id,
      p_offer_id: offerId,
      p_expected_url: referralUrl,
      p_dedupe_seconds: OFFER_CLICK_DEDUPE_SECONDS,
    });
    if (error) throw error;

    const recorded = data === true;
    await writeSecurityAudit(context, {
      action: recorded ? "offer.click_recorded" : "offer.click_deduplicated",
      targetTable: "public.user_activities",
      targetId: offerId,
      metadata: {
        offer_id: offerId,
        recorded,
        trusted_source: "server_action",
        dedupe_seconds: OFFER_CLICK_DEDUPE_SECONDS,
      },
    });
    return { recorded };
  } catch (error) {
    await auditMutationFailure(
      context,
      "offer.click_ingestion",
      "public.user_activities",
      offerId,
      error,
      { trusted_source: "server_action" }
    );
    throw error;
  }
}

export async function saveWalletAddress(walletAddress: string) {
  const context = await requireActiveUser();
  const { user } = context;
  const supabase = createServiceClient();

  if (!isValidSolanaAddress(walletAddress)) {
    throw new Error("Invalid Solana wallet address.");
  }

  try {
    const { data: current, error: readError } = await supabase
      .from("users")
      .select("wallet_address, wallet_verified")
      .eq("id", user.id)
      .single();
    if (readError) throw readError;

    const currentAddress = current?.wallet_address ?? null;
    const isSameAddress = currentAddress?.toLowerCase() === walletAddress.toLowerCase();

    // Wallet address changes must go through cryptographic verification
    // (verifyWalletSignature). This action only permits idempotent re-saving
    // of the currently verified address.
    if (!isSameAddress) {
      throw new Error(
        "Wallet address changes require ownership verification. Please verify the new wallet before saving it as your payout address."
      );
    }

    revalidatePath("/dashboard/wallet");
    revalidatePath("/dashboard/profile");
    return { walletAddress, verified: current?.wallet_verified ?? false };
  } catch (error) {
    await auditMutationFailure(context, "wallet.address_save", "public.users", user.id, error);
    throw error;
  }
}

export async function getAirdropWalletBalanceAction() {
  const context = await requireCapability("manage_rewards");
  try {
    const balance = await getAirdropWalletBalance();
    await writeSecurityAudit(context, {
      action: "treasury.balance_read",
      targetTable: "external.solana",
      metadata: { token_balance: balance.token, sol_balance: balance.sol },
    });
    return balance;
  } catch (error) {
    await auditMutationFailure(context, "treasury.balance_read", "external.solana", null, error);
    throw error;
  }
}

export async function getTokenBalanceAction(walletAddress: string) {
  return getTokenBalance(walletAddress);
}

export async function sendTestAirdrop(formData: FormData) {
  const context = await requireCapability("manage_rewards");
  const walletAddress = formData.get("walletAddress") as string;
  if (!walletAddress) {
    throw new Error("Wallet address is required");
  }

  if (!isValidSolanaAddress(walletAddress)) {
    throw new Error("Invalid Solana wallet address.");
  }

  // Disable production test airdrops unless explicitly enabled. This prevents
  // accidental token outflows during security reviews or production operation.
  if (process.env.ENABLE_TEST_AIRDROP !== "true") {
    throw new Error("Test airdrops are disabled. Set ENABLE_TEST_AIRDROP=true to enable in a safe environment.");
  }

  const TEST_AMOUNT = 0.001;
  const amountRaw = amountToRaw(TEST_AMOUNT);
  try {
    const balance = await getAirdropWalletBalance();
    if (balance.token < TEST_AMOUNT) {
      throw new Error(`Insufficient bitxbit balance. Wallet: ${balance.token.toFixed(4)}, needed: ${TEST_AMOUNT}`);
    }
    if (balance.sol < 0.005) {
      throw new Error(`Insufficient SOL for fees. Wallet: ${balance.sol.toFixed(4)} SOL`);
    }

    const results = await executePayoutTransfers([
      { operationId: `test:${context.user.id}:${Date.now()}`, walletAddress, amountRaw },
    ]);
    const result = results[0];
    if (!result.txHash) {
      throw new Error(result.error ?? "Test airdrop failed");
    }

    const confirmation = await confirmTokenTransfer(result.txHash, walletAddress, amountRaw);
    if (!confirmation.confirmed) {
      throw new Error(`Test airdrop could not be confirmed on-chain: ${confirmation.verificationError}`);
    }

    await writeSecurityAudit(context, {
      action: "airdrop.test_send",
      targetTable: "external.solana",
      targetId: result.txHash,
      after: { wallet_address: walletAddress, amount: TEST_AMOUNT, transaction_hash: result.txHash },
    });
  } catch (error) {
    await auditMutationFailure(context, "airdrop.test_send", "external.solana", null, error, {
      wallet_address: walletAddress,
      amount: TEST_AMOUNT,
    });
    throw error;
  }

  revalidatePath("/admin/rewards");
}

const TOKEN_DECIMALS = 9;

export async function airdropRewards(periodId: string) {
  if (!isUuid(periodId)) throw new Error("Invalid reward period ID.");
  const context = await requireCapability("manage_rewards");
  const supabase = createServiceClient();

  const result = await auditedAdminMutation(
    context,
    "airdrop.rewards",
    "public.reward_periods",
    periodId,
    async () => {
      const { data: period, error: periodError } = await supabase
        .from("reward_periods")
        .select("id, status")
        .eq("id", periodId)
        .single();
      if (periodError || !period) throw periodError || new Error("Period not found");
      if (period.status !== "approved") {
        throw new Error(`Cannot distribute rewards for period with status '${period.status}'`);
      }

      const { data: rewards, error: rewardsError } = await supabase
        .from("user_rewards")
        .select("id, user_id, bitxbit_amount, users!inner(wallet_address, wallet_verified)")
        .eq("reward_period_id", periodId)
        .eq("status", "approved");
      if (rewardsError) throw rewardsError;

      const { data: existingOps, error: opsError } = await supabase
        .from("payout_operations")
        .select("id, operation_id, reward_id, status, transaction_hash, token_amount_raw, wallet_address")
        .eq("reward_period_id", periodId);
      if (opsError) throw opsError;

      const existingByReward = new Map<string, (typeof existingOps)[number]>();
      for (const op of existingOps ?? []) {
        existingByReward.set(op.reward_id, op);
      }

      const distributions: PayoutTransfer[] = [];
      const rewardMeta = new Map<
        string,
        { rewardId: string; walletAddress: string; amountRaw: bigint }
      >();
      const skipped = new Map<string, number>();

      function incrementSkip(reason: string) {
        skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
      }

      async function reconcileSubmittedOperation(
        op: NonNullable<typeof existingOps>[number]
      ): Promise<"confirmed" | "failed" | "unresolved"> {
        if (!op.transaction_hash) return "unresolved";
        const confirmation = await confirmTokenTransfer(
          op.transaction_hash,
          op.wallet_address,
          op.token_amount_raw
        );
        if (confirmation.confirmed) {
          await supabase
            .from("payout_operations")
            .update({
              status: "confirmed",
              confirmed_at: new Date().toISOString(),
              blockchain_confirmation: confirmation,
              updated_at: new Date().toISOString(),
            })
            .eq("operation_id", op.operation_id);
          await supabase
            .from("user_rewards")
            .update({
              status: "distributed",
              distribution_tx_hash: op.transaction_hash,
              distributed_at: new Date().toISOString(),
            })
            .eq("id", op.reward_id);
          return "confirmed";
        }
        if (confirmation.verificationError) {
          await supabase
            .from("payout_operations")
            .update({
              status: "failed",
              submission_error: `On-chain verification failed: ${confirmation.verificationError}`,
              failed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("operation_id", op.operation_id);
          return "failed";
        }
        return "unresolved";
      }

      for (const reward of rewards ?? []) {
        const userRelation = reward.users as
          | { wallet_address: string | null; wallet_verified: boolean | null }
          | { wallet_address: string | null; wallet_verified: boolean | null }[]
          | null;
        const user = Array.isArray(userRelation) ? userRelation[0] : userRelation;
        const walletAddress = user?.wallet_address;
        const walletVerified = user?.wallet_verified ?? false;
        const amount = reward.bitxbit_amount ?? 0;
        const amountRaw = amountToRaw(amount, TOKEN_DECIMALS);

        if (!walletAddress) {
          incrementSkip("missing_wallet");
          continue;
        }
        if (!isValidSolanaAddress(walletAddress)) {
          incrementSkip("invalid_wallet");
          continue;
        }
        if (!walletVerified) {
          incrementSkip("unverified_wallet");
          continue;
        }
        if (amountRaw <= 0n) {
          incrementSkip("zero_amount");
          continue;
        }

        const operationId = `payout:${periodId}:${reward.id}`;
        let existing = existingByReward.get(reward.id);

        if (!existing) {
          const { error: insertError } = await supabase.from("payout_operations").insert({
            operation_id: operationId,
            reward_period_id: periodId,
            reward_id: reward.id,
            user_id: reward.user_id,
            wallet_address: walletAddress,
            token_amount_raw: amountRaw,
            token_decimals: TOKEN_DECIMALS,
            status: "pending",
            actor_id: context.user.id,
          });
          if (insertError) throw insertError;
          existing = {
            id: "",
            operation_id: operationId,
            reward_id: reward.id,
            status: "pending",
            transaction_hash: null,
            token_amount_raw: amountRaw,
            wallet_address: walletAddress,
          } as unknown as NonNullable<typeof existingOps>[number];
          existingByReward.set(reward.id, existing);
        }

        if (existing.status === "confirmed") {
          continue;
        }

        if (existing.status === "submitted") {
          // Reconcile before any retry. An unresolved transfer must never
          // automatically trigger another payment.
          const outcome = await reconcileSubmittedOperation(existing);
          if (outcome === "confirmed") continue;
          if (outcome === "unresolved") {
            incrementSkip("submitted_unresolved");
            continue;
          }
          // outcome === "failed": fall through to claim and retry
        }

        if (existing.status === "submitting") {
          // Another process is currently submitting this operation, or a prior
          // submission crashed mid-flight. Do not auto-retry; require manual
          // recovery or a dedicated reconciliation job.
          incrementSkip("submitting_in_flight");
          continue;
        }

        if (existing.status !== "pending" && existing.status !== "failed") {
          incrementSkip("unexpected_status");
          continue;
        }

        // Atomically claim the operation. Only the caller that succeeds may
        // submit a blockchain transaction for this reward.
        const { data: claimedId, error: claimError } = await supabase.rpc("claim_payout_operation", {
          p_operation_id: operationId,
          p_actor_id: context.user.id,
        });
        if (claimError) throw claimError;
        if (!claimedId) {
          incrementSkip("claim_failed");
          continue;
        }

        distributions.push({ operationId, walletAddress, amountRaw });
        rewardMeta.set(operationId, { rewardId: reward.id, walletAddress, amountRaw });
      }

      if (distributions.length === 0) {
        const confirmedCount =
          rewards?.filter((r) => existingByReward.get(r.id)?.status === "confirmed").length ?? 0;
        if (confirmedCount === (rewards?.length ?? 0) && (rewards?.length ?? 0) > 0) {
          await supabase.from("reward_periods").update({ status: "distributed" }).eq("id", periodId);
          return { status: "already_distributed", confirmedCount };
        }
        return {
          attempted: 0,
          submitted: 0,
          confirmed: 0,
          reconciliationFailures: 0,
          skipped: Object.fromEntries(skipped),
        };
      }

      const totalNeededRaw = distributions.reduce((sum, d) => sum + d.amountRaw, 0n);
      const balance = await getAirdropWalletBalance();
      const balanceRaw = amountToRaw(balance.token, TOKEN_DECIMALS);
      const estimatedSolFee = distributions.length * 0.005;
      if (balanceRaw < totalNeededRaw) {
        throw new Error(
          `Insufficient bitxbit balance. Wallet: ${balance.token.toFixed(4)}, Needed: ${rawToAmount(
            totalNeededRaw,
            TOKEN_DECIMALS
          )}`
        );
      }
      if (balance.sol < estimatedSolFee) {
        throw new Error(
          `Insufficient SOL for fees. Wallet: ${balance.sol.toFixed(4)} SOL, Estimated: ${estimatedSolFee.toFixed(
            4
          )} SOL`
        );
      }

      const transferResults = await executePayoutTransfers(distributions);

      for (const result of transferResults) {
        if (result.txHash) {
          await supabase
            .from("payout_operations")
            .update({
              status: "submitted",
              transaction_hash: result.txHash,
              submitted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("operation_id", result.operationId);
        } else {
          await supabase
            .from("payout_operations")
            .update({
              status: "failed",
              submission_error: result.error,
              failed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("operation_id", result.operationId);
        }
      }

      const submittedOps = transferResults.filter((r) => r.txHash);
      let confirmedCount = 0;
      let reconciliationFailures = 0;

      for (const result of submittedOps) {
        const meta = rewardMeta.get(result.operationId);
        if (!meta || !result.txHash) continue;

        const confirmation = await confirmTokenTransfer(
          result.txHash,
          meta.walletAddress,
          meta.amountRaw
        );

        if (confirmation.confirmed) {
          await supabase
            .from("payout_operations")
            .update({
              status: "confirmed",
              confirmed_at: new Date().toISOString(),
              blockchain_confirmation: confirmation,
              updated_at: new Date().toISOString(),
            })
            .eq("operation_id", result.operationId);

          await supabase
            .from("user_rewards")
            .update({
              status: "distributed",
              distribution_tx_hash: result.txHash,
              distributed_at: new Date().toISOString(),
            })
            .eq("id", meta.rewardId);

          confirmedCount++;
        } else {
          await supabase
            .from("payout_operations")
            .update({
              status: "failed",
              submission_error: `On-chain verification failed: ${confirmation.verificationError}`,
              failed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("operation_id", result.operationId);
          reconciliationFailures++;
        }
      }

      const { data: finalOps } = await supabase
        .from("payout_operations")
        .select("status")
        .eq("reward_period_id", periodId);
      const allConfirmed = finalOps?.every((op) => op.status === "confirmed") ?? false;
      const totalFinalOps = finalOps?.length ?? 0;

      if (allConfirmed && totalFinalOps === (rewards?.length ?? 0) && totalFinalOps > 0) {
        await supabase.from("reward_periods").update({ status: "distributed" }).eq("id", periodId);
      }

      return {
        attempted: distributions.length,
        submitted: submittedOps.length,
        confirmed: confirmedCount,
        reconciliationFailures,
        skipped: Object.fromEntries(skipped),
      };
    },
    { period_id: periodId }
  );

  revalidatePath("/admin/rewards");
  return result;
}
