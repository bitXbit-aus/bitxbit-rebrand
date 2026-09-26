export type UserRole = 'member' | 'admin';
export type UserStatus = 'active' | 'suspended';
export type ActivityType = 'click' | 'signup' | 'purchase' | 'other';
export type ProjectStatus = 'planning' | 'active' | 'completed' | 'paused';
export type RewardStatus = 'pending' | 'approved' | 'distributed' | 'rejected';
export type PeriodStatus = 'calculating' | 'approved' | 'distributed';

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  wallet_address: string | null;
  role: UserRole;
  status: UserStatus;
  referral_code: string | null;
  referred_by: string | null;
  created_at: string;
  last_login: string | null;
  email_verified: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  display_order: number;
  active: boolean;
}

export interface AffiliateOffer {
  id: string;
  name: string;
  category_id: string | null;
  category?: Category;
  referral_url: string;
  description: string | null;
  benefit_text: string | null;
  reward_eligible: boolean;
  active: boolean;
  display_order: number;
  logo_url: string | null;
}

export interface UserActivity {
  id: string;
  user_id: string;
  offer_id: string | null;
  offer?: AffiliateOffer;
  activity_type: ActivityType;
  source_url: string | null;
  created_at: string;
}

export interface AffiliateIncome {
  id: string;
  source: string;
  offer_id: string | null;
  amount: number;
  currency: string;
  date_received: string;
  proof_url: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AllocationModel {
  id: string;
  name: string;
  community_rewards_pct: number;
  liquidity_pct: number;
  buybacks_pct: number;
  projects_pct: number;
  operations_pct: number;
  is_active: boolean;
  effective_date: string;
}

export interface RewardPeriod {
  id: string;
  start_date: string;
  end_date: string;
  total_income: number;
  allocation_model_id: string | null;
  allocation_model?: AllocationModel;
  status: PeriodStatus;
  created_at: string;
}

export interface UserReward {
  id: string;
  user_id: string;
  reward_period_id: string;
  period?: RewardPeriod;
  estimated_aud_value: number | null;
  bitxbit_amount: number | null;
  status: RewardStatus;
  distribution_tx_hash: string | null;
  distributed_at: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  funding_goal: number | null;
  amount_allocated: number;
  status: ProjectStatus;
  impact_statement: string | null;
  image_url: string | null;
  display_order: number;
}

export interface TransparencyReport {
  id: string;
  report_month: string;
  report_year: number;
  total_income: number | null;
  allocation_snapshot: Record<string, number> | null;
  summary_text: string | null;
  proof_urls: string[] | null;
  published_by: string | null;
  published_at: string | null;
  created_at: string;
}

export interface DashboardStats {
  totalUsers: number;
  totalIncome: number;
  pendingRewards: number;
  recentSignups: number;
  liquidityBuilt: number;
  tokensBoughtBack: number;
  projectsFunded: number;
}
