"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "./button";
import { useEffect, useRef } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "danger",
  onConfirm,
  onCancel,
  loading,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div
        className="relative w-full max-w-sm rounded-xl border p-6 shadow-xl"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="flex items-start gap-3 mb-4">
          {variant === "danger" && (
            <div className="p-2 rounded-full bg-red-100">
              <AlertTriangle size={20} className="text-red-600" />
            </div>
          )}
          <div>
            <h3 className="font-semibold">{title}</h3>
            <p className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
          <Button
            ref={confirmRef}
            variant={variant}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
