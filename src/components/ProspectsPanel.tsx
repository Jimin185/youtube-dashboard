"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { ComposeTarget } from "./ComposeModal";

export interface ProspectItem {
  id: number;
  clientName: string;
  contactName: string;
  contactEmail: string;
  officialEmail: string;
  website: string;
  memo: string;
  importance: number;
  createdAt: string;
}

// 엑셀 템플릿 헤더 (업로드 시에도 같은 이름으로 인식)
const HEADERS = ["클라이언트", "담당자", "이메일", "공식이메일", "공식사이트", "메모", "중요도(0-3)"];

function EditableCell({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="w-full rounded border border-blue-400 px-1.5 py-0.5 text-xs focus:outline-none bg-white"
      />
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className={`w-full text-left text-xs rounded px-1.5 py-0.5 hover:bg-slate-100 truncate ${
        value ? "text-slate-700" : "text-slate-300"
      }`}
      title={value || placeholder}
    >
      {value || placeholder}
    </button>
  );
}

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex">
      {[1, 2, 3].map((n) => (
        <button
          key={n}
          onClick={() => onChange(value === n ? 0 : n)}
          className={`text-sm ${n <= value ? "text-amber-400" : "text-slate-200 hover:text-slate-300"}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

interface Props {
  onCompose: (targets: ComposeTarget[]) => void;
  refreshKey: number; // 발송 후 목록 갱신 트리거
  onCountChange: (n: number) => void;
}

/** 📤 보낼 목록: 수기 입력 + 엑셀 업로드, 선택 발송 */
export default function ProspectsPanel({ onCompose, refreshKey, onCountChange }: Props) {
  const [items, setItems] = useState<ProspectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState("");
  const [addForm, setAddForm] = useState({ clientName: "", contactName: "", contactEmail: "" });
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/prospects");
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.items ?? []);
    onCountChange((data.items ?? []).length);
    setLoading(false);
  }, [onCountChange]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function addOne(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.contactEmail.trim()) return;
    setAdding(true);
    const res = await fetch("/api/prospects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(addForm),
    });
    setAdding(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(data.error ?? "추가에 실패했습니다.");
      return;
    }
    if (data.inserted === 0) setNotice("이미 등록된 이메일입니다.");
    setAddForm({ clientName: "", contactName: "", contactEmail: "" });
    load();
  }

  async function patch(id: number, fields: Record<string, unknown>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...fields } : it)));
    await fetch(`/api/prospects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  }

  async function remove(id: number) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    await fetch(`/api/prospects/${id}`, { method: "DELETE" });
    load();
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      HEADERS,
      ["(예시) 무신사", "김철수", "cskim@example.com", "contact@example.com", "example.com", "패션 버티컬", 2],
    ]);
    ws["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 26 }, { wch: 24 }, { wch: 20 }, { wch: 24 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "보낼목록");
    XLSX.writeFile(wb, "보낼목록_템플릿.xlsx");
  }

  async function handleFile(file: File) {
    setNotice("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const norm = (v: unknown) => String(v ?? "").trim();
      const pick = (r: Record<string, unknown>, keys: string[]) => {
        for (const k of keys) {
          const hit = Object.keys(r).find((h) => h.replace(/\s/g, "").toLowerCase().startsWith(k.toLowerCase()));
          if (hit && norm(r[hit])) return norm(r[hit]);
        }
        return "";
      };
      const parsed = rows
        .map((r) => ({
          clientName: pick(r, ["클라이언트", "회사", "client", "company"]),
          contactName: pick(r, ["담당자", "이름", "contact", "name"]),
          contactEmail: pick(r, ["이메일", "메일", "email"]),
          officialEmail: pick(r, ["공식이메일", "공식메일"]),
          website: pick(r, ["공식사이트", "사이트", "website", "url"]),
          memo: pick(r, ["메모", "비고", "memo", "note"]),
          importance: Number(pick(r, ["중요도", "importance"])) || 0,
        }))
        .filter((r) => /\S+@\S+\.\S+/.test(r.contactEmail) && !r.clientName.startsWith("(예시)"));
      if (parsed.length === 0) {
        setNotice("파일에서 이메일이 있는 행을 찾지 못했습니다. 템플릿 양식을 확인해 주세요.");
        return;
      }
      const res = await fetch("/api/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data.error ?? "업로드에 실패했습니다.");
        return;
      }
      setNotice(
        `✓ ${data.inserted}건 추가 완료` + (data.skipped > 0 ? ` (중복 ${data.skipped}건 건너뜀)` : "")
      );
      load();
    } catch {
      setNotice("파일을 읽지 못했습니다. .xlsx 또는 .csv 파일인지 확인해 주세요.");
    }
  }

  const allChecked = items.length > 0 && items.every((i) => selected.has(i.id));
  const selectedItems = items.filter((i) => selected.has(i.id));

  return (
    <div>
      {notice && (
        <div className="mb-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm px-4 py-2.5 flex justify-between">
          {notice}
          <button onClick={() => setNotice("")} className="text-blue-400">✕</button>
        </div>
      )}

      {/* 도구 모음: 수기 추가 + 엑셀 */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3 flex flex-wrap items-end gap-3">
        <form onSubmit={addOne} className="flex flex-wrap items-end gap-2 flex-1 min-w-[300px]">
          <div>
            <label className="block text-xs text-slate-500 mb-1">클라이언트</label>
            <input
              value={addForm.clientName}
              onChange={(e) => setAddForm((f) => ({ ...f, clientName: e.target.value }))}
              placeholder="회사명"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm w-32"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">담당자</label>
            <input
              value={addForm.contactName}
              onChange={(e) => setAddForm((f) => ({ ...f, contactName: e.target.value }))}
              placeholder="이름"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm w-24"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              이메일 <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              required
              value={addForm.contactEmail}
              onChange={(e) => setAddForm((f) => ({ ...f, contactEmail: e.target.value }))}
              placeholder="contact@company.com"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm w-52"
            />
          </div>
          <button
            type="submit"
            disabled={adding}
            className="rounded-lg bg-slate-900 text-white px-4 py-1.5 text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            + 추가
          </button>
        </form>
        <div className="flex gap-2">
          <button
            onClick={downloadTemplate}
            className="rounded-lg border border-slate-300 px-3.5 py-1.5 text-sm hover:bg-slate-50"
          >
            📄 엑셀 템플릿 받기
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-emerald-600 text-white px-3.5 py-1.5 text-sm font-medium hover:bg-emerald-700"
          >
            ⬆️ 엑셀 업로드
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* 선택 툴바 */}
      {selectedItems.length > 0 && (
        <div className="sticky top-[57px] z-20 mb-3 rounded-xl bg-slate-900 text-white px-4 py-2.5 flex items-center gap-3 shadow-lg">
          <span className="text-sm font-medium">{selectedItems.length}건 선택됨</span>
          <button
            onClick={() =>
              onCompose(
                selectedItems.map((p) => ({
                  id: p.id,
                  name: p.contactName,
                  email: p.contactEmail,
                  client: p.clientName,
                }))
              )
            }
            className="rounded-lg bg-blue-500 hover:bg-blue-400 px-4 py-1.5 text-sm font-semibold"
          >
            ✉️ 선택한 {selectedItems.length}건에 신규 메일 보내기
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-sm text-slate-300 hover:text-white">
            선택 해제
          </button>
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500 bg-slate-50">
              <th className="px-3 py-2.5 w-8">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() =>
                    setSelected(allChecked ? new Set() : new Set(items.map((i) => i.id)))
                  }
                />
              </th>
              <th className="px-2 py-2.5 text-left w-16">중요도</th>
              <th className="px-2 py-2.5 text-left w-32">클라이언트</th>
              <th className="px-2 py-2.5 text-left w-24">담당자</th>
              <th className="px-2 py-2.5 text-left w-52">이메일</th>
              <th className="px-2 py-2.5 text-left w-44">공식이메일</th>
              <th className="px-2 py-2.5 text-left w-36">공식사이트</th>
              <th className="px-2 py-2.5 text-left">메모</th>
              <th className="px-2 py-2.5 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="text-center py-14 text-slate-400">불러오는 중...</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-14 text-slate-400">
                  <div className="space-y-1.5">
                    <p>보낼 목록이 비어있습니다.</p>
                    <p className="text-xs">
                      위에서 직접 추가하거나, 엑셀 템플릿을 받아 작성한 뒤 업로드하세요.
                      <br />
                      메일을 보내면 (대시보드에서든 Gmail에서든) 자동으로 &quot;보낸 목록&quot;으로 이동합니다.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr
                  key={p.id}
                  className={`border-b border-slate-100 hover:bg-slate-50/70 ${
                    selected.has(p.id) ? "bg-blue-50/60" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(p.id)) next.delete(p.id);
                          else next.add(p.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Stars value={p.importance} onChange={(v) => patch(p.id, { importance: v })} />
                  </td>
                  <td className="px-2 py-2">
                    <EditableCell value={p.clientName} placeholder="클라이언트" onSave={(v) => patch(p.id, { clientName: v })} />
                  </td>
                  <td className="px-2 py-2">
                    <EditableCell value={p.contactName} placeholder="담당자" onSave={(v) => patch(p.id, { contactName: v })} />
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500 truncate" title={p.contactEmail}>
                    {p.contactEmail}
                  </td>
                  <td className="px-2 py-2">
                    <EditableCell value={p.officialEmail} placeholder="공식이메일" onSave={(v) => patch(p.id, { officialEmail: v })} />
                  </td>
                  <td className="px-2 py-2">
                    <EditableCell value={p.website} placeholder="사이트" onSave={(v) => patch(p.id, { website: v })} />
                  </td>
                  <td className="px-2 py-2">
                    <EditableCell value={p.memo} placeholder="메모" onSave={(v) => patch(p.id, { memo: v })} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => remove(p.id)}
                      className="text-slate-300 hover:text-red-500 text-sm"
                      title="삭제"
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400 mt-3">
        💡 여기서 골라서 발송하거나, Gmail에서 직접 보내도 됩니다 — 같은 이메일 주소로 보낸 메일이 확인되면
        자동으로 &quot;보낸 목록&quot;으로 이동하고 적어둔 정보(클라이언트/공식이메일/메모)도 함께 넘어갑니다.
      </p>
    </div>
  );
}
