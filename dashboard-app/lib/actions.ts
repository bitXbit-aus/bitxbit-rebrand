"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { distributeTokens, getAirdropWalletBalance, getTokenBalance, isValidSolanaAddress, AirdropResult } from "@/lib/solana";
import { uploadAsset, deleteAsset } from "@/lib/storage";

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
  const supabase = createClient();
  const logoUrl = await resolveImageUrl(formData, "logoFile", "logoUrl", "offers");

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
  revalidatePath("/admin/offers");
}

export async function updateOffer(id: string, formData: FormData) {
  const supabase = createClient();

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
  const supabase = createServiceClient();
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

export async function bulkUpdateUsersRole(ids: string[], role: string) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("users").update({ role }).in("id", ids);
  if (error) throw error;
  revalidatePath("/admin/users");
}

export async function bulkUpdateUsersStatus(ids: string[], status: string) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("users").update({ status }).in("id", ids);
  if (error) throw error;
  revalidatePath("/admin/users");
}

export async function bulkDeleteUsers(ids: string[]) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("users").delete().in("id", ids);
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
  const imageUrl = await resolveImageUrl(formData, "imageFile", "imageUrl", "projects");

  const { error } = await supabase.from("projects").insert({
    name: formData.get("name") as string,
    description: formData.get("description") as string,
    funding_goal: parseFloat(formData.get("fundingGoal") as string) || null,
    status: formData.get("status") as string,
    impact_statement: formData.get("impactStatement") as string,
    image_url: imageUrl,
  });
  if (error) throw error;
  revalidatePath("/admin/projects");
}

export async function updateProject(id: string, formData: FormData) {
  const supabase = createClient();

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
  revalidatePath("/admin/projects");
}

export async function deleteProject(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/projects");
}

export async function createTransparencyReport(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

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

  const { error } = await supabase.from("transparency_reports").insert({
    report_month: formData.get("reportMonth") as string,
    report_year: parseInt(formData.get("reportYear") as string),
    total_income: totalIncome || null,
    allocation_snapshot: allocationSnapshot,
    summary_text: formData.get("summaryText") as string,
    proof_urls: proofUrls,
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

  if (!isValidSolanaAddress(walletAddress)) {
    throw new Error("Invalid Solana wallet address.");
  }

  const { error } = await supabase
    .from("users")
    .update({ wallet_address: walletAddress })
    .eq("id", user.id);

  if (error) throw error;
  revalidatePath("/dashboard/wallet");
  revalidatePath("/dashboard/profile");
}

export async function getAirdropWalletBalanceAction() {
  return getAirdropWalletBalance();
}

export async function getTokenBalanceAction(walletAddress: string) {
  return getTokenBalance(walletAddress);
}

export async function sendTestAirdrop(formData: FormData) {
  const walletAddress = formData.get("walletAddress") as string;
  if (!walletAddress) {
    throw new Error("Wallet address is required");
  }

  if (!isValidSolanaAddress(walletAddress)) {
    throw new Error("Invalid Solana wallet address.");
  }

  const TEST_AMOUNT = 0.001;
  const balance = await getAirdropWalletBalance();

  if (balance.token < TEST_AMOUNT) {
    throw new Error(`Insufficient bitxbit balance. Wallet: ${balance.token.toFixed(4)}, needed: ${TEST_AMOUNT}`);
  }

  if (balance.sol < 0.005) {
    throw new Error(`Insufficient SOL for fees. Wallet: ${balance.sol.toFixed(4)} SOL`);
  }

  const results = await distributeTokens([
    { userId: "test", walletAddress, amount: TEST_AMOUNT },
  ]);

  const result = results[0];
  if (!result.txHash) {
    throw new Error(result.error ?? "Test airdrop failed");
  }

  revalidatePath("/admin/rewards");
}

export async function airdropRewards(periodId: string) {
  const supabase = createClient();

  const { data: rewards } = await supabase
    .from("user_rewards")
    .select("id, user_id, bitxbit_amount, users!inner(wallet_address)")
    .eq("reward_period_id", periodId)
    .eq("status", "approved");

  const distributions = rewards
    ?.map((r: any) => ({
      userId: r.user_id,
      walletAddress: r.users?.wallet_address,
      amount: r.bitxbit_amount ?? 0,
      rewardId: r.id,
    }))
    .filter((d) => d.walletAddress && d.amount > 0 && isValidSolanaAddress(d.walletAddress)) ?? [];

  const invalidWalletCount = rewards?.filter(
    (r: any) => r.users?.wallet_address && !isValidSolanaAddress(r.users.wallet_address)
  ).length ?? 0;
  const missingWalletCount = (rewards?.length ?? 0) - distributions.length - invalidWalletCount;

  if (distributions.length === 0) {
    let message = "No approved rewards found for this period.";
    if (missingWalletCount > 0 && invalidWalletCount > 0) {
      message = `${missingWalletCount} member(s) are missing a wallet address and ${invalidWalletCount} have an invalid address.`;
    } else if (missingWalletCount > 0) {
      message = `${missingWalletCount} member(s) are missing a wallet address.`;
    } else if (invalidWalletCount > 0) {
      message = `${invalidWalletCount} member(s) have an invalid wallet address.`;
    }
    throw new Error(message);
  }

  // Pre-flight balance checks
  const totalNeeded = distributions.reduce((sum, d) => sum + d.amount, 0);
  const balance = await getAirdropWalletBalance();
  const estimatedSolFee = distributions.length * 0.005;

  if (balance.token < totalNeeded) {
    throw new Error(
      `Insufficient bitxbit balance. Wallet: ${balance.token.toFixed(4)}, Needed: ${totalNeeded.toFixed(4)}`
    );
  }

  if (balance.sol < estimatedSolFee) {
    throw new Error(
      `Insufficient SOL for fees. Wallet: ${balance.sol.toFixed(4)} SOL, Estimated: ${estimatedSolFee.toFixed(4)} SOL`
    );
  }

  const results = await distributeTokens(distributions);

  const failed = results.filter((r) => !r.txHash);
  if (failed.length > 0) {
    console.error("Some airdrops failed:", failed);
  }

  for (const result of results) {
    if (result.txHash) {
      await supabase
        .from("user_rewards")
        .update({
          status: "distributed",
          distribution_tx_hash: result.txHash,
          distributed_at: new Date().toISOString(),
        })
        .eq("id", result.rewardId);
    }
  }

  await supabase
    .from("reward_periods")
    .update({ status: "distributed" })
    .eq("id", periodId);

  revalidatePath("/admin/rewards");
}
