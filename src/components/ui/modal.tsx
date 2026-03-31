"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
};

export function Modal({ open, onClose, title, children, wide }: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={`relative rounded-xl border p-6 shadow-xl max-h-[90vh] overflow-y-auto ${wide ? "w-full max-w-2xl" : "w-full max-w-md"}`}
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
