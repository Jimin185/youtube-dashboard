"use client";

import { useEffect, useMemo, useState } from "react";
import { renderTemplate, templateVars } from "@/lib/outbound";
import type { Outbound } from "@/lib/db/schema";

export interface ComposeTarget {
  id: number;
  name: string; // 담당자 표시용
  email: string;
  client?: string; // 클라이언트명 ([기업명] 치환·경고용)
}

interface SavedTemplate {
  id: number;
  name: string;
  subject: string;
  body: string;
}

interface Props {
  targets: ComposeTarget[];
  mode: "outbound" | "prospect"; // outbound: 기존 스레드에 답장/리마인드, prospect: 신규 발송
  onClose: () => void;
  onSent: () => void;
}

/** 수신자별 치환 미리보기용 가짜 아웃바운드 */
function pseudoOutbound(t: ComposeTarget): Outbound {
  return {
    contactName: t.name,
    clientName: t.client ?? "",
    contactEmail: t.email,
    subject: "",
  } as Outbound;
}

/** 단건/일괄 메일 작성 모달. [기업명], [담당자] 가 수신자별로 치환된다. */
export default function ComposeModal({ targets, mode, onClose, onSent }: Props) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: { outboundId: number; error?: string }[] } | null>(null);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [selectedTpl, setSelectedTpl] = useState("");
  const [savingTpl, setSavingTpl] = useState(false);
  const [tplName, setTplName] = useState("");
  const [showTplSave, setShowTplSave] = useState(false);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((data) => setSavedTemplates(data.items ?? []))
      .catch(() => {});
  }, []);

  function loadTemplate(idStr: string) {
    setSelectedTpl(idStr);
    const tpl = savedTemplates.find((t) => String(t.id) === idStr);
    if (tpl) {
      setSubject(tpl.subject);
      setBody(tpl.body);
    }
  }

  async function saveTemplate() {
    if (!tplName.trim() || !body.trim()) return;
    setSavingTpl(true);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tplName.trim(), subject, body }),
    });
    setSavingTpl(false);
    if (res.ok) {
      const data = await res.json();
      setSavedTemplates((prev) => [data.item, ...prev.filter((t) => t.id !== data.item.id)]);
      setSelectedTpl(String(data.item.id));
      setShowTplSave(false);
      setTplName("");
    }
  }

  async function deleteTemplate() {
    if (!selectedTpl) return;
    await fetch(`/api/templates/${selectedTpl}`, { method: "DELETE" });
    setSavedTemplates((prev) => prev.filter((t) => String(t.id) !== selectedTpl));
    setSelectedTpl("");
  }

  // [기업명] 을 썼는데 클라이언트명이 비어있는 수신자 경고
  const missingClient = useMemo(() => {
    const vars = templateVars(subject + "\n" + body);
    if (!vars.client) return [];
    return targets.filter((t) => !t.client?.trim());
  }, [subject, body, targets]);

  const preview = useMemo(() => {
    if (targets.length === 0) return null;
    const o = pseudoOutbound(targets[0]);
    return {
      who: targets[0].email,
      subject: subject.trim() ? renderTemplate(subject, o) : "(기존 메일에 Re: 답장)",
      body: renderTemplate(body, o),
    };
  }, [targets, subject, body]);

  async function send() {
    if (!body.trim()) {
      setError("본문을 입력하세요.");
      return;
    }
    if (mode === "prospect" && !subject.trim()) {
      setError("신규 발송은 제목이 필요합니다.");
      return;
    }
    setSending(true);
    setError("");
    const payload =
      mode === "prospect"
        ? { prospectIds: targets.map((t) => t.id), subject, body }
        : { outboundIds: targets.map((t) => t.id), subject, body };
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSending(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "발송에 실패했습니다.");
      return;
    }
    setResult(data);
    onSent();
  }

  function insertVar(v: string) {
    setBody((b) => b + v);
  }

  const failedNames = (result?.failed ?? []).map((f) => {
    const t = targets.find((x) => x.id === f.outboundId);
    return `${t?.email ?? ""}: ${f.error ?? "오류"}`;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-bold text-lg">
            {mode === "prospect" ? "신규 메일 보내기" : "메일 보내기"}{" "}
            <span className="text-blue-600">({targets.length}건)</span>
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-4">
          <div>
            <div className="text-xs font-medium text-slate-500 mb-1.5">받는 사람</div>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {targets.map((t) => (
                <span key={t.id} className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs">
                  {t.name || t.client || t.email.split("@")[0]}
                  <span className="text-slate-400 ml-1">&lt;{t.email}&gt;</span>
                </span>
              ))}
            </div>
          </div>

          {result === null ? (
            <>
              {/* 템플릿 불러오기/저장 */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                <span className="text-xs font-medium text-slate-500">📋 템플릿</span>
                <select
                  value={selectedTpl}
                  onChange={(e) => loadTemplate(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs max-w-44"
                >
                  <option value="">불러오기...</option>
                  {savedTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {selectedTpl && (
                  <button onClick={deleteTemplate} className="text-xs text-red-400 hover:text-red-600" title="선택한 템플릿 삭제">
                    삭제
                  </button>
                )}
                <div className="ml-auto">
                  {showTplSave ? (
                    <span className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={tplName}
                        onChange={(e) => setTplName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveTemplate()}
                        placeholder="템플릿 이름"
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs w-32"
                      />
                      <button
                        onClick={saveTemplate}
                        disabled={savingTpl || !tplName.trim()}
                        className="text-xs rounded-md bg-slate-900 text-white px-2.5 py-1 disabled:opacity-40"
                      >
                        저장
                      </button>
                      <button onClick={() => setShowTplSave(false)} className="text-xs text-slate-400">
                        취소
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setShowTplSave(true)}
                      disabled={!body.trim()}
                      className="text-xs text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      + 현재 내용을 템플릿으로 저장
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  제목 {mode === "prospect" && <span className="text-red-500">*</span>}
                </label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={
                    mode === "prospect"
                      ? "예: [기업명] 유튜브 광고 제안드립니다"
                      : "비워두면 기존 메일에 'Re:' 답장으로 발송됩니다"
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-500">본문</label>
                  <div className="flex gap-1.5">
                    {["[기업명]", "[담당자]"].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => insertVar(v)}
                        className="text-xs rounded-md bg-blue-50 text-blue-600 px-2 py-1 hover:bg-blue-100"
                      >
                        {v} 넣기
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  placeholder={"안녕하세요 [담당자]님,\n\n[기업명]의 유튜브 마케팅과 관련하여 제안드리고자 연락드렸습니다..."}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
                <p className="text-xs text-slate-400 mt-1">
                  대괄호 부분이 받는 사람마다 자동으로 바뀝니다: [기업명] → 무신사 · [담당자] → 김철수
                </p>
              </div>

              {missingClient.length > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  ⚠️ [기업명]을 사용했는데 클라이언트명이 비어있는 수신자가 {missingClient.length}건 있어요
                  (이메일 도메인으로 대체됨): {missingClient.slice(0, 3).map((t) => t.email).join(", ")}
                  {missingClient.length > 3 && ` 외 ${missingClient.length - 3}건`}
                </div>
              )}

              {body.trim() && preview && (
                <div className="rounded-lg border border-slate-200">
                  <button
                    onClick={() => setShowPreview(!showPreview)}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
                  >
                    {showPreview ? "▾" : "▸"} 미리보기 — {preview.who} 에게는 이렇게 보내져요
                  </button>
                  {showPreview && (
                    <div className="px-3 pb-3 text-sm space-y-1.5">
                      <p className="font-semibold">{preview.subject}</p>
                      <pre className="whitespace-pre-wrap font-sans text-slate-700 bg-slate-50 rounded-md p-2.5 text-xs max-h-48 overflow-y-auto">
                        {preview.body}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}
            </>
          ) : (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2">
              <p className="font-semibold text-emerald-600">
                ✓ {result.sent}건 발송 완료
                {mode === "prospect" && result.sent > 0 && " — 보낸 목록으로 이동했습니다"}
              </p>
              {failedNames.length > 0 && (
                <div className="text-sm text-red-600">
                  <p className="font-medium">{failedNames.length}건 실패:</p>
                  <ul className="list-disc ml-5 mt-1 space-y-0.5">
                    {failedNames.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm border border-slate-300 hover:bg-slate-50">
            {result ? "닫기" : "취소"}
          </button>
          {result === null && (
            <button
              onClick={send}
              disabled={sending}
              className="rounded-lg px-5 py-2 text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? `발송 중... (${targets.length}건)` : `${targets.length}건 발송`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
