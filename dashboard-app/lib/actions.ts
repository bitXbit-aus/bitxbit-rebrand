"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateProfile(formData: FormData) {
  const supabase = createClient();
  const userId = formData.get("userId") as string;
  const displayName = formData.get("displayName") as string;
  const walletAddress = formData.get("walletAddress") as string;

  const { error } = await supabase
    .from("users")
    .update({ display_name: displayName, wallet_address: walletAddress })
    .eq("id", userId);

  if (error) throw error;
  revalidatePath("/dashboard/profile");
}

export async function createOffer(formData: FormData) {
  const supabase = createClient();
  const { error } = await supabase.from("affiliate_offers").insert({
    name: formData.get("name") as string,
    category_id: (formData.get("categoryId") as string) || null,
    referral_url: formData.get("referralUrl") as string,
    description: formData.get("description") as string,
    benefit_text: formData.get("benefitText") as string,
    reward_eligible: formData.get("rewardEligible") === "on",
    active: formData.get("active") === "on",
  });
  if (error) throw error;
  revalidatePath("/admin/offers");
}

export async function updateOffer(id: string, formData: FormData) {
  const supabase = createClient();
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
    })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/offers");
}

export async function deleteOffer(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("affiliate_offers").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/offers");
}

export async function createCategory(formData: FormData) {
  const supabase = createClient();
  const { error } = await supabase.from("categories").insert({
    name: formData.get("name") as string,
    slug: formData.get("slug") as string,
    display_order: parseInt(formData.get("displayOrder") as string) || 0,
  });
  if (error) throw error;
  revalidatePath("/admin/categories");
}

export async function createIncome(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("affiliate_income").insert({
    source: formData.get("source") as string,
    offer_id: (formData.get("offerId") as string) || null,
    amount: parseFloat(formData.get("amount") as string),
    currency: formData.get("currency") as string,
    date_received: formData.get("dateReceived") as string,
    notes: formData.get("notes") as string,
    created_by: user?.id,
  });
  if (error) throw error;
  revalidatePath("/admin/income");
}

export async function updateIncome(id: string, formData: FormData) {
  const supabase = createClient();
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
  revalidatePath("/admin/income");
}

export async function deleteIncome(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("affiliate_income").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/income");
}

export async function updateCategory(id: string, formData: FormData) {
  const supabase = createClient();
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
  revalidatePath("/admin/categories");
}

export async function deleteCategory(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/categories");
}

export async function updateUser(id: string, formData: FormData) {
  const supabase = createClient();
  const { error } = await supabase
    .from("users")
    .update({
      role: formData.get("role") as string,
      status: formData.get("status") as string,
      display_name: (formData.get("displayName") as string) || null,
      wallet_address: (formData.get("walletAddress") as string) || null,
    })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/users");
}

export async function createRewardPeriod(formData: FormData) {
  const supabase = createClient();
  const { error } = await supabase.from("reward_periods").insert({
    start_date: formData.get("startDate") as string,
    end_date: formData.get("endDate") as string,
    allocation_model_id: (formData.get("allocationModelId") as string) || null,
  });
  if (error) throw error;
  revalidatePath("/admin/rewards");
}

const ACTIVITY_POINTS: Record<string, number> = {
  click: 1,
  signup: 5,
  purchase: 10,
  other: 1,
};

export async function calculateRewards(periodId: string) {
  const supabase = createClient();

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

  const { data: users } = await supabase
    .from("users")
    .select("id, referred_by");

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
    await supabase.from("reward_periods").update({ total_income: totalIncome, status: "calculating" }).eq("id", periodId);
    return;
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

  revalidatePath("/admin/rewards");
}

export async function approveRewards(periodId: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("user_rewards")
    .update({ status: "approved" })
    .eq("reward_period_id", periodId)
    .eq("status", "pending");
  if (error) throw error;

  await supabase.from("reward_periods").update({ status: "approved" }).eq("id", periodId);
  revalidatePath("/admin/rewards");
}

export async function distributeRewards(periodId: string, txHash: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("user_rewards")
    .update({ status: "distributed", distribution_tx_hash: txHash, distributed_at: new Date().toISOString() })
    .eq("reward_period_id", periodId)
    .eq("status", "approved");
  if (error) throw error;

  await supabase.from("reward_periods").update({ status: "distributed" }).eq("id", periodId);
  revalidatePath("/admin/rewards");
}

export async function distributeRewardsWithTx(periodId: string, formData: FormData) {
  const txHash = formData.get("txHash") as string;
  if (!txHash) throw new Error("Transaction hash is required");
  return distributeRewards(periodId, txHash);
}

export async function publishTransparencyReport(id: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("transparency_reports")
    .update({ published_at: new Date().toISOString(), published_by: user?.id })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/transparency-updates");
  revalidatePath("/dashboard/transparency");
}

export async function unpublishTransparencyReport(id: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("transparency_reports")
    .update({ published_at: null, published_by: null })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/transparency-updates");
  revalidatePath("/dashboard/transparency");
}

export async function createProject(formData: FormData) {
  const supabase = createClient();
  const { error } = await supabase.from("projects").insert({
    name: formData.get("name") as string,
    description: formData.get("description") as string,
    funding_goal: parseFloat(formData.get("fundingGoal") as string) || null,
    status: formData.get("status") as string,
    impact_statement: formData.get("impactStatement") as string,
  });
  if (error) throw error;
  revalidatePath("/admin/projects");
}

export async function updateProject(id: string, formData: FormData) {
  const supabase = createClient();
  const { error } = await supabase
    .from("projects")
    .update({
      name: formData.get("name") as string,
      description: formData.get("description") as string,
      funding_goal: parseFloat(formData.get("fundingGoal") as string) || null,
      status: formData.get("status") as string,
      impact_statement: formData.get("impactStatement") as string,
      amount_allocated: parseFloat(formData.get("amountAllocated") as string) || 0,
    })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/projects");
}

export async function createTransparencyReport(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("transparency_reports").insert({
    report_month: formData.get("reportMonth") as string,
    report_year: parseInt(formData.get("reportYear") as string),
    total_income: parseFloat(formData.get("totalIncome") as string) || null,
    summary_text: formData.get("summaryText") as string,
    published_by: user?.id,
    published_at: new Date().toISOString(),
  });
  if (error) throw error;
  revalidatePath("/admin/transparency-updates");
}

export async function trackOfferClick(offerId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in to track offer clicks.");
  }

  const { error } = await supabase.from("user_activities").insert({
    user_id: user.id,
    offer_id: offerId,
    activity_type: "click",
  });

  if (error) throw error;
}

export async function saveWalletAddress(walletAddress: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in to save a wallet address.");
  }

  const { error } = await supabase
    .from("users")
    .update({ wallet_address: walletAddress })
    .eq("id", user.id);

  if (error) throw error;
  revalidatePath("/dashboard/wallet");
  revalidatePath("/dashboard/profile");
}
