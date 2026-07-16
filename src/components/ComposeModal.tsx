"use client";

import { useState } from "react";
import type { OutboundItem } from "./types";

interface Props {
  targets: OutboundItem[];
  onClose: () => void;
  onSent: () => void;
}

/** 단건/일괄 메일 작성 모달. {{담당자}}, {{클라이언트}} 변수가 수신자별로 치환된다. */
export default function ComposeModal({ targets, onClose, onSent }: Props) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: { outboundId: number; error?: string }[] } | null>(null);
  const [error, setError] = useState("");

  async function send() {
    if (!body.trim()) {
      setError("본문을 입력하세요.");
      return;
    }
    setSending(true);
    setError("");
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outboundIds: targets.map((t) => t.id), subject, body }),
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
    return `${t?.contactEmail ?? f.outboundId}: ${f.error ?? "오류"}`;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-bold text-lg">
            메일 보내기 <span className="text-blue-600">({targets.length}건)</span>
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
                  {t.contactName || t.clientName || t.contactEmail.split("@")[0]}
                  <span className="text-slate-400 ml-1">&lt;{t.contactEmail}&gt;</span>
                </span>
              ))}
            </div>
          </div>

          {result === null ? (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">제목</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="비워두면 기존 메일에 'Re:' 답장으로 발송됩니다"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-500">본문</label>
                  <div className="flex gap-1.5">
                    {["{{담당자}}", "{{클라이언트}}"].map((v) => (
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
                  placeholder={"안녕하세요 {{담당자}}님,\n\n{{클라이언트}} 관련하여 지난번 보내드린 제안 다시 한번 안내드립니다..."}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
                <p className="text-xs text-slate-400 mt-1">
                  변수는 받는 사람마다 자동으로 치환됩니다. 예: {"{{담당자}}"} → 김철수
                </p>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </>
          ) : (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2">
              <p className="font-semibold text-emerald-600">✓ {result.sent}건 발송 완료</p>
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
