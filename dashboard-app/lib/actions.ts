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
