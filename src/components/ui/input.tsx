type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export function Input({ label, ...props }: InputProps) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        {...props}
        className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-blue-500/30"
        style={{ borderColor: "var(--border)", background: "var(--background)" }}
      />
    </div>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: { value: string; label: string }[];
};

export function Select({ label, options, ...props }: SelectProps) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <select
        {...props}
        className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-blue-500/30"
        style={{ borderColor: "var(--border)", background: "var(--background)" }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
};

export function Textarea({ label, ...props }: TextareaProps) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <textarea
        {...props}
        className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
        style={{ borderColor: "var(--border)", background: "var(--background)" }}
      />
    </div>
  );
}
