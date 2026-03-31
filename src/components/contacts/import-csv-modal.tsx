"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Upload, FileText, AlertCircle, Check } from "lucide-react";
import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase";
import { useToast } from "@/components/ui/toast";

type ImportCSVModalProps = {
  open: boolean;
  onClose: () => void;
  orgId: string;
  onImported: () => void;
};

type ParsedRow = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company: string;
  job_title: string;
  source: string;
  status: string;
};

export function ImportCSVModal({ open, onClose, orgId, onImported }: ImportCSVModalProps) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);

  function parseCSV(text: string): ParsedRow[] {
    const lines = text.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, "").toLowerCase());

    return lines.slice(1).map((line) => {
      const values = line.split(",").map((v) => v.trim().replace(/"/g, ""));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = values[i] || "";
      });

      return {
        first_name: row["nome"] || row["first_name"] || row["first name"] || "",
        last_name: row["apelido"] || row["last_name"] || row["last name"] || "",
        email: row["email"] || row["e-mail"] || "",
        phone: row["telefone"] || row["phone"] || row["tel"] || "",
        company: row["empresa"] || row["company"] || "",
        job_title: row["cargo"] || row["job_title"] || row["job title"] || "",
        source: row["origem"] || row["source"] || "",
        status: row["status"] || "new",
      };
    }).filter((r) => r.first_name || r.email);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      setRows(parsed);
    };
    reader.readAsText(file, "utf-8");
  }

  async function handleImport() {
    if (rows.length === 0) return;
    setImporting(true);

    const supabase = createClient();
    const payload = rows.map((r) => ({
      org_id: orgId,
      ...r,
      score: 0,
      tags: [],
    }));

    const { error } = await supabase.from("mkt_contacts").insert(payload);

    if (error) {
      toast("Erro ao importar: " + error.message, "error");
    } else {
      toast(`${rows.length} contatos importados com sucesso!`);
      setDone(true);
      onImported();
    }
    setImporting(false);
  }

  function handleClose() {
    setRows([]);
    setFileName("");
    setDone(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Importar Contatos via CSV" wide>
      {done ? (
        <div className="text-center py-8">
          <Check size={48} className="mx-auto text-green-500 mb-3" />
          <p className="font-semibold">{rows.length} contatos importados!</p>
          <Button onClick={handleClose} className="mt-4">Fechar</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            <p>Faca upload de um ficheiro CSV com as colunas:</p>
            <p className="font-mono text-xs mt-1 px-3 py-2 rounded-lg" style={{ background: "var(--secondary)" }}>
              nome, apelido, email, telefone, empresa, cargo, origem, status
            </p>
          </div>

          {/* Upload area */}
          <div
            className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
            style={{ borderColor: "var(--border)" }}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
            {fileName ? (
              <div className="flex items-center justify-center gap-2">
                <FileText size={20} style={{ color: "var(--primary)" }} />
                <span className="text-sm font-medium">{fileName}</span>
              </div>
            ) : (
              <>
                <Upload size={32} className="mx-auto mb-2" style={{ color: "var(--muted-foreground)" }} />
                <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                  Clique para selecionar um ficheiro CSV
                </p>
              </>
            )}
          </div>

          {/* Preview */}
          {rows.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={14} style={{ color: "var(--primary)" }} />
                <span className="text-sm font-medium">{rows.length} contatos encontrados</span>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: "var(--secondary)" }}>
                      <th className="text-left px-3 py-2">Nome</th>
                      <th className="text-left px-3 py-2">Email</th>
                      <th className="text-left px-3 py-2">Empresa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((r, i) => (
                      <tr key={i} className="border-t" style={{ borderColor: "var(--border)" }}>
                        <td className="px-3 py-1.5">{r.first_name} {r.last_name}</td>
                        <td className="px-3 py-1.5">{r.email}</td>
                        <td className="px-3 py-1.5">{r.company}</td>
                      </tr>
                    ))}
                    {rows.length > 10 && (
                      <tr><td colSpan={3} className="px-3 py-1.5 text-center" style={{ color: "var(--muted-foreground)" }}>... e mais {rows.length - 10}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleClose}>Cancelar</Button>
            <Button onClick={handleImport} loading={importing} disabled={rows.length === 0}>
              <Upload size={14} />
              Importar {rows.length} contatos
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
