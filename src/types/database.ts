export type Organization = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  plan: string;
  created_at: string;
  updated_at: string;
};

export type OrgMember = {
  id: string;
  org_id: string;
  user_id: string;
  role: "admin" | "manager" | "editor" | "viewer";
  created_at: string;
};

export type Contact = {
  id: string;
  org_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  source: string | null;
  status: "new" | "contacted" | "qualified" | "proposal" | "customer" | "lost";
  score: number;
  tags: string[];
  notes: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PipelineStage = {
  id: string;
  org_id: string;
  name: string;
  color: string;
  position: number;
  created_at: string;
};

export type Deal = {
  id: string;
  org_id: string;
  contact_id: string | null;
  stage_id: string | null;
  title: string;
  value: number;
  currency: string;
  probability: number;
  expected_close_date: string | null;
  status: "open" | "won" | "lost";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Campaign = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  objective: "awareness" | "leads" | "sales" | "engagement" | null;
  status: "planning" | "active" | "paused" | "completed";
  budget_planned: number;
  budget_spent: number;
  start_date: string | null;
  end_date: string | null;
  channels: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SocialAccount = {
  id: string;
  org_id: string;
  platform: string;
  account_name: string | null;
  account_id: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  profile_image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SocialPost = {
  id: string;
  org_id: string;
  campaign_id: string | null;
  content: string;
  media_urls: string[];
  platforms: string[];
  status: "draft" | "scheduled" | "published" | "error";
  scheduled_at: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EmailTemplate = {
  id: string;
  org_id: string;
  name: string;
  subject: string | null;
  html_content: string | null;
  text_content: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
};

export type EmailCampaign = {
  id: string;
  org_id: string;
  campaign_id: string | null;
  template_id: string | null;
  name: string;
  subject: string | null;
  status: "draft" | "scheduled" | "sending" | "sent";
  scheduled_at: string | null;
  sent_at: string | null;
  total_recipients: number;
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  total_bounced: number;
  total_unsubscribed: number;
  created_at: string;
  updated_at: string;
};
