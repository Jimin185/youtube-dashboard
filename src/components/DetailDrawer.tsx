"use client";

import { useEffect, useState } from "react";
import type { OutboundItem, ThreadMessage } from "./types";
import { formatDate } from "./types";

interface Props {
  item: OutboundItem;
  onClose: () => void;
  onChanged: () => void;
  onCompose: (item: OutboundItem) => void;
}

/** 아웃바운드 상세: 메일 스레드(원문) + 상태 변경 */
export default function DetailDrawer({ item, onClose, onChanged, onCompose }: Props) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [openBody, setOpenBody] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/outbounds/${item.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setMessages(data.messages ?? []);
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  async function setStatus(status: "active" | "replied" | "closed") {
    await fetch(`/api/outbounds/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    onChanged();
  }

  const statusLabel: Record<string, string> = {
    active: "답변 대기중",
    replied: "답변수신",
    closed: "완료/제외",
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-white h-full shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-lg leading-snug">{item.subject || "(제목 없음)"}</h2>
            <p className="text-sm text-slate-500 mt-1">
              {item.contactName || "담당자 미상"} · {item.contactEmail}
              {item.clientName && <> · {item.clientName}</>}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none shrink-0">
            ✕
          </button>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 text-sm">
          <span
            className={
              "rounded-full px-2.5 py-1 text-xs font-medium " +
              (item.status === "replied"
                ? "bg-emerald-100 text-emerald-700"
                : item.status === "closed"
                  ? "bg-slate-200 text-slate-600"
                  : "bg-amber-100 text-amber-700")
            }
          >
            {statusLabel[item.status]}
          </span>
          <span className="text-slate-400 text-xs">
            {item.stage}차 발송 · 1차 {formatDate(item.firstSentAt)}
            {item.nextReminderAt && item.status === "active" && (
              <> · 다음 리마인드 {formatDate(item.nextReminderAt)}</>
            )}
          </span>
          <div className="ml-auto flex gap-1.5">
            {item.status !== "replied" && (
              <button
                onClick={() => setStatus("replied")}
                className="rounded-lg border border-emerald-300 text-emerald-700 px-2.5 py-1 text-xs hover:bg-emerald-50"
              >
                ✓ 답변수신 체크
              </button>
            )}
            {item.status !== "active" && (
              <button
                onClick={() => setStatus("active")}
                className="rounded-lg border border-amber-300 text-amber-700 px-2.5 py-1 text-xs hover:bg-amber-50"
              >
                대기중으로
              </button>
            )}
            {item.status !== "closed" && (
              <button
                onClick={() => setStatus("closed")}
                className="rounded-lg border border-slate-300 text-slate-600 px-2.5 py-1 text-xs hover:bg-slate-50"
              >
                완료 처리
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-slate-50">
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-10">불러오는 중...</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">메일 기록이 없습니다.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={m.direction === "sent" ? "pl-10" : "pr-10"}>
                <div
                  className={
                    "rounded-xl border p-3 text-sm cursor-pointer " +
                    (m.direction === "sent"
                      ? "bg-blue-50 border-blue-100"
                      : "bg-white border-slate-200")
                  }
                  onClick={() => setOpenBody(openBody === m.id ? null : m.id)}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold">
                      {m.direction === "sent" ? "→ 보냄" : "← 받음"}{" "}
                      <span className="font-normal text-slate-400">
                        {m.direction === "sent" ? m.toAddr : m.fromAddr}
                      </span>
                    </span>
                    <span className="text-xs text-slate-400 shrink-0">
                      {new Date(m.date).toLocaleString("ko-KR", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  {openBody === m.id ? (
                    <pre className="whitespace-pre-wrap font-sans text-slate-700 mt-2 max-h-96 overflow-y-auto">
                      {m.bodyText || m.snippet || "(본문 없음)"}
                    </pre>
                  ) : (
                    <p className="text-slate-500 line-clamp-2">{m.snippet || "(본문 미리보기 없음)"}</p>
                  )}
                  <p className="text-[10px] text-slate-300 mt-1">{openBody === m.id ? "접기" : "원문 보기"}</p>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200">
          <button
            onClick={() => onCompose(item)}
            className="w-full rounded-lg bg-blue-600 text-white py-2.5 text-sm font-semibold hover:bg-blue-700"
          >
            이 담당자에게 메일 보내기
          </button>
        </div>
      </div>
    </div>
  );
}
