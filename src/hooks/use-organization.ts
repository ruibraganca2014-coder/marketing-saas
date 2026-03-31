"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import type { Organization, OrgMember } from "@/types/database";

type OrgState = {
  organization: Organization | null;
  membership: OrgMember | null;
  loading: boolean;
};

export function useOrganization() {
  const [state, setState] = useState<OrgState>({
    organization: null,
    membership: null,
    loading: true,
  });

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setState({ organization: null, membership: null, loading: false });
        return;
      }

      // Get user's first org membership
      const { data: membership } = await supabase
        .from("mkt_org_members")
        .select("*")
        .eq("user_id", user.id)
        .limit(1)
        .single();

      if (!membership) {
        setState({ organization: null, membership: null, loading: false });
        return;
      }

      const { data: org } = await supabase
        .from("mkt_organizations")
        .select("*")
        .eq("id", membership.org_id)
        .single();

      setState({
        organization: org as Organization | null,
        membership: membership as OrgMember,
        loading: false,
      });
    }

    load();
  }, []);

  return state;
}
