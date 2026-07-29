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
// 상태를 비우면 '보낼 목록'으로, '보냄/답변수신/완료'를 적으면 '보낸 목록'으로 바로 들어간다
const HEADERS = [
  "클라이언트",
  "담당자",
  "이메일",
  "공식이메일",
  "공식사이트",
  "메모",
  "중요도(0-3)",
  "상태(비우면 보낼예정)",
  "차수(1-3)",
  "발송일",
  "제목(보낸 메일)",
];

/** 엑셀 셀 값을 ISO 날짜 문자열로 (엑셀 날짜 일련번호/Date/문자열 모두 지원) */
function toIsoDate(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString();
  if (typeof v === "number" && v > 20000 && v < 60000) {
    return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString();
  }
  const s = String(v ?? "").trim();
  if (!s) return "";
  const d = new Date(s.replace(/\./g, "-").replace(/-+$/, ""));
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

/** 상태 셀 텍스트 → 내부 상태값 */
function parseStatus(s: string): "pending" | "active" | "replied" | "closed" {
  const t = s.replace(/\s/g, "");
  if (/답변|회신|응답/.test(t)) return "replied";
  if (/완료|제외|종료|중단/.test(t)) return "closed";
  if (/보냄|발송|진행|대기중|[123]차/.test(t)) return "active";
  return "pending"; // 비어있거나 '보낼예정' 등 → 보낼 목록
}

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
  onImported: () => void; // 기존 발송분이 보낸 목록에 추가됐을 때 (아웃바운드 새로고침)
}

/** 📤 보낼 목록: 수기 입력 + 엑셀 업로드, 선택 발송 */
export default function ProspectsPanel({ onCompose, refreshKey, onCountChange, onImported }: Props) {
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
      // 예시 1: 아직 안 보낸 곳 → 상태 비움 → 보낼 목록으로
      ["(예시) 무신사", "김철수", "cskim@example.com", "contact@example.com", "example.com", "패션 버티컬", 2, "", "", "", ""],
      // 예시 2: 대시보드 쓰기 전에 이미 보낸 곳 → 보낸 목록으로 (차수/발송일/제목까지 기록)
      ["(예시) 쿠팡", "박영희", "yh@example.com", "", "", "기존 발송분", 1, "보냄", 2, "2026-06-20", "유튜브 광고 제안드립니다"],
      // 예시 3: 답장까지 받은 곳
      ["(예시) 토스", "정수진", "sj@example.com", "", "", "", 3, "답변수신", 1, "2026-07-01", "브랜디드 콘텐츠 제안"],
    ]);
    ws["!cols"] = [
      { wch: 16 }, { wch: 12 }, { wch: 26 }, { wch: 24 }, { wch: 20 }, { wch: 24 },
      { wch: 10 }, { wch: 18 }, { wch: 9 }, { wch: 12 }, { wch: 26 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "아웃바운드");
    XLSX.writeFile(wb, "아웃바운드_업로드_템플릿.xlsx");
  }

  async function handleFile(file: File) {
    setNotice("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const norm = (v: unknown) => String(v ?? "").trim();
      const pick = (r: Record<string, unknown>, keys: string[], exclude: string[] = []) => {
        for (const k of keys) {
          const hit = Object.keys(r).find((h) => {
            const n = h.replace(/\s/g, "").toLowerCase();
            return n.startsWith(k.toLowerCase()) && !exclude.some((x) => n.includes(x));
          });
          if (hit && norm(r[hit])) return norm(r[hit]);
        }
        return "";
      };
      const isEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s);
      const pickRaw = (r: Record<string, unknown>, keys: string[]) => {
        for (const k of keys) {
          const hit = Object.keys(r).find((h) =>
            h.replace(/\s/g, "").toLowerCase().startsWith(k.toLowerCase())
          );
          if (hit && String(r[hit] ?? "").trim() !== "") return r[hit];
        }
        return "";
      };
      const parsed = rows
        .map((r) => {
          const statusText = pick(r, ["상태", "status"]);
          const stageText = pick(r, ["차수", "stage"]);
          const status = parseStatus(statusText);
          const sentAt = toIsoDate(pickRaw(r, ["발송일", "1차발송", "보낸날"]));
          const stage = Math.min(3, Math.max(1, parseInt(stageText.replace(/[^0-9]/g, ""), 10) || 1));
          return {
            clientName: pick(r, ["클라이언트", "회사", "client", "company"], ["메일", "email", "사이트", "url"]),
            contactName: pick(r, ["담당자", "이름", "contact", "name"], ["메일", "email"]),
            // 공식이메일 열을 먼저 찾은 뒤 (이메일 열과 접두어가 겹치므로) 남는 이메일 열을 담당자 이메일로
            officialEmail: pick(r, ["공식이메일", "공식메일"]),
            contactEmail: pick(r, ["담당자이메일", "이메일", "메일", "email"], ["공식"]),
            website: pick(r, ["공식사이트", "사이트", "website", "url"]),
            memo: pick(r, ["메모", "비고", "memo", "note"]),
            importance: Number(pick(r, ["중요도", "importance"])) || 0,
            subject: pick(r, ["제목", "subject"]),
            // 상태는 비웠지만 차수/발송일이 적혀 있으면 '이미 보낸 것'으로 간주
            status: status === "pending" && (stageText.trim() || sentAt) ? "active" : status,
            stage,
            sentAt,
          };
        })
        // 담당자 이메일 또는 공식이메일 중 하나만 있으면 등록 가능
        .filter(
          (r) =>
            (isEmail(r.contactEmail) || isEmail(r.officialEmail)) &&
            !r.clientName.startsWith("(예시)")
        );
      if (parsed.length === 0) {
        setNotice(
          "이메일이 있는 행을 찾지 못했습니다. '이메일' 또는 '공식이메일' 열 중 하나는 채워져 있어야 해요."
        );
        return;
      }

      // 상태 없는 행 → 보낼 목록, 보냄/답변수신/완료 행 → 보낸 목록(기존 발송분)
      const prospectRows = parsed.filter((r) => r.status === "pending");
      const sentRows = parsed.filter((r) => r.status !== "pending");
      const parts: string[] = [];

      if (prospectRows.length > 0) {
        const res = await fetch("/api/prospects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: prospectRows }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setNotice(data.error ?? "업로드에 실패했습니다.");
          return;
        }
        parts.push(
          `📤 보낼 목록 ${data.inserted}건` + (data.skipped > 0 ? ` (중복 ${data.skipped} 제외)` : "")
        );
      }

      if (sentRows.length > 0) {
        const res = await fetch("/api/outbounds/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: sentRows }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setNotice((parts.length ? parts.join(" · ") + " / " : "") + (data.error ?? "기존 발송분 등록 실패"));
          return;
        }
        parts.push(
          `📬 보낸 목록(기존 발송분) ${data.inserted}건` +
            (data.skipped > 0 ? ` (중복 ${data.skipped} 제외)` : "")
        );
        onImported();
      }

      setNotice(`✓ 추가 완료 — ${parts.join(" · ")}`);
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
                      필수는 <b>이메일 또는 공식이메일 중 하나</b>뿐, 나머지 칸은 비워도 됩니다.
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
