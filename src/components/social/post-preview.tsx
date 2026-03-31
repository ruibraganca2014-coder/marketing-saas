"use client";

import { Globe, Hash, AtSign, Heart, MessageCircle, Share2, Bookmark, MoreHorizontal } from "lucide-react";

type PostPreviewProps = {
  content: string;
  platforms: string[];
  orgName?: string;
};

const platformStyles: Record<string, { name: string; bg: string; accent: string }> = {
  instagram: { name: "Instagram", bg: "linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)", accent: "#E4405F" },
  linkedin: { name: "LinkedIn", bg: "#0A66C2", accent: "#0A66C2" },
  twitter: { name: "X (Twitter)", bg: "#15202b", accent: "#1DA1F2" },
  facebook: { name: "Facebook", bg: "#1877F2", accent: "#1877F2" },
};

export function PostPreview({ content, platforms, orgName = "MarketingSaaS" }: PostPreviewProps) {
  if (!content && platforms.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold" style={{ color: "var(--muted-foreground)" }}>Preview:</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {platforms.map((platform) => {
          const style = platformStyles[platform];
          if (!style) return null;

          if (platform === "twitter") {
            return (
              <div key={platform} className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "#15202b", color: "#e7e9ea" }}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: style.accent, color: "white" }}>
                    {orgName.charAt(0)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-bold">{orgName}</span>
                      <span className="text-xs text-gray-500">@{orgName.toLowerCase().replace(/\s/g, "")} · agora</span>
                    </div>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{content || "..."}</p>
                    <div className="flex items-center gap-6 mt-3 text-gray-500">
                      <MessageCircle size={14} />
                      <Share2 size={14} />
                      <Heart size={14} />
                      <Bookmark size={14} />
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          if (platform === "instagram") {
            return (
              <div key={platform} className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)", background: "white", color: "#262626" }}>
                <div className="flex items-center gap-2 p-3">
                  <div className="w-8 h-8 rounded-full" style={{ background: platformStyles.instagram.bg }} />
                  <span className="text-xs font-semibold">{orgName.toLowerCase().replace(/\s/g, "")}</span>
                  <MoreHorizontal size={14} className="ml-auto text-gray-400" />
                </div>
                <div className="px-3 pb-3">
                  <p className="text-xs whitespace-pre-wrap">{content || "..."}</p>
                </div>
                <div className="flex items-center gap-4 px-3 pb-3">
                  <Heart size={16} />
                  <MessageCircle size={16} />
                  <Share2 size={16} />
                  <Bookmark size={16} className="ml-auto" />
                </div>
              </div>
            );
          }

          // LinkedIn / Facebook
          return (
            <div key={platform} className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "white", color: "#333" }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: style.accent }}>
                  {orgName.charAt(0)}
                </div>
                <div>
                  <p className="text-xs font-semibold">{orgName}</p>
                  <p className="text-[10px] text-gray-400">Agora · {style.name}</p>
                </div>
              </div>
              <p className="text-xs whitespace-pre-wrap mb-3">{content || "..."}</p>
              <div className="flex items-center gap-4 pt-2 border-t text-gray-400 text-[10px]">
                <span>Gosto</span>
                <span>Comentar</span>
                <span>Partilhar</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
