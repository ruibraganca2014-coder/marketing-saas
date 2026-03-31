"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { CheckCircle2, XCircle, AlertTriangle, X } from "lucide-react";

type ToastType = "success" | "error" | "warning";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

type ToastContextType = {
  toast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = "success") => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  const icons = {
    success: <CheckCircle2 size={18} className="text-green-500" />,
    error: <XCircle size={18} className="text-red-500" />,
    warning: <AlertTriangle size={18} className="text-yellow-500" />,
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[200] space-y-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg animate-slide-in"
            style={{ background: "var(--card)", borderColor: "var(--border)" }}
          >
            {icons[t.type]}
            <p className="text-sm flex-1">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="p-0.5 rounded hover:bg-gray-100/10">
              <X size={14} style={{ color: "var(--muted-foreground)" }} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
