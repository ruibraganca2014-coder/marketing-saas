type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50";
  const sizes = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";

  const variants: Record<string, string> = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    secondary: "border text-sm hover:bg-gray-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "hover:bg-gray-100 text-sm",
  };

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`${base} ${sizes} ${variants[variant]}`}
      style={variant === "secondary" ? { borderColor: "var(--border)" } : undefined}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
