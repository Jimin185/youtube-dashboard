"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";
import type { OutboundItem, TabKey } from "./types";
import { formatDate } from "./types";
import ComposeModal, { type ComposeTarget } from "./ComposeModal";
import DetailDrawer from "./DetailDrawer";
import ProspectsPanel from "./ProspectsPanel";

const TABS: { key: TabKey; label: string }[] = [
  { key: "prospects", label: "📤 보낼 목록" },
  { key: "all", label: "보낸 목록" },
  { key: "replied", label: "답변수신" },
  { key: "second", label: "2차 리마인드 (15일)" },
  { key: "third", label: "3차 리마인드 (한달)" },
  { key: "closed", label: "완료/제외" },
  { key: "db", label: "🗂 전체 DB" },
];

/** 클릭해서 바로 수정하는 셀 (공식이메일/사이트/메모 등) */
function EditableCell({
  value,
  placeholder,
  onSave,
  className = "",
}: {
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
  className?: string;
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
        className={`w-full rounded border border-blue-400 px-1.5 py-0.5 text-xs focus:outline-none bg-white ${className}`}
      />
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className={`w-full text-left text-xs rounded px-1.5 py-0.5 hover:bg-slate-100 truncate ${
        value ? "text-slate-700" : "text-slate-300"
      } ${className}`}
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
          title={`중요도 ${n}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function Dashboard({ userName }: { userName: string }) {
  const router = useRouter();
  const [items, setItems] = useState<OutboundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [compose, setCompose] = useState<{ targets: ComposeTarget[]; mode: "outbound" | "prospect" } | null>(null);
  const [detail, setDetail] = useState<OutboundItem | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const [prospectCount, setProspectCount] = useState(0);
  const [prospectRefresh, setProspectRefresh] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch("/api/outbounds");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    const data = await res.json();
    setItems(data.items ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
    // 대시보드를 열면 30분 이상 지난 경우 자동으로 메일 동기화
    fetch("/api/sync?auto=1", { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.skipped && Array.isArray(data.results) && data.results.length > 0) {
          load();
          setProspectRefresh((n) => n + 1);
        }
      })
      .catch(() => {});
  }, [load]);

  async function syncNow() {
    setSyncing(true);
    setNotice("");
    // 메일이 아주 많으면 서버가 시간 예산만큼 처리하고 partial로 반환 → 이어서 재요청 (최대 8회)
    for (let round = 0; round < 8; round++) {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncing(false);
        setNotice(data.error ?? "동기화에 실패했습니다.");
        return;
      }
      const results: { error?: string; partial?: boolean }[] = data.results ?? [];
      const errs = results.filter((r) => r.error);
      const hasPartial = results.some((r) => r.partial);
      if (errs.length > 0) {
        setSyncing(false);
        setNotice(`동기화 오류: ${errs[0].error}`);
        load();
        return;
      }
      load();
      if (!hasPartial) {
        setSyncing(false);
        const moved =
          data.movedProspects > 0 ? ` 보낼 목록 ${data.movedProspects}건이 보낸 목록으로 이동했어요.` : "";
        setNotice(`동기화 완료!${moved}`);
        setProspectRefresh((n) => n + 1);
        return;
      }
      setNotice(`메일이 많아 나눠서 동기화 중... (${round + 1}차 진행)`);
    }
    setSyncing(false);
    setNotice("메일이 매우 많아 일부만 동기화됐어요. '메일 동기화'를 한 번 더 눌러주세요.");
    setProspectRefresh((n) => n + 1);
  }

  async function patch(id: number, fields: Record<string, unknown>) {
    // 낙관적 업데이트
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...fields } : it)));
    await fetch(`/api/outbounds/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    load();
  }

  const counts = useMemo(
    () => ({
      prospects: prospectCount,
      all: items.filter((i) => i.status !== "closed").length,
      replied: items.filter((i) => i.status === "replied").length,
      second: items.filter((i) => i.reminderBucket === "second").length,
      third: items.filter((i) => i.reminderBucket === "third").length,
      closed: items.filter((i) => i.status === "closed").length,
      db: items.length,
    }),
    [items, prospectCount]
  );

  const filtered = useMemo(() => {
    let list = items;
    if (tab === "replied") list = list.filter((i) => i.status === "replied");
    else if (tab === "second") list = list.filter((i) => i.reminderBucket === "second");
    else if (tab === "third") list = list.filter((i) => i.reminderBucket === "third");
    else if (tab === "closed") list = list.filter((i) => i.status === "closed");
    else if (tab === "db") list = items; // 전체 DB: 상태 무관 전부
    else list = list.filter((i) => i.status !== "closed");
    if (mineOnly) list = list.filter((i) => i.isMine);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (i) =>
          i.clientName.toLowerCase().includes(q) ||
          i.contactName.toLowerCase().includes(q) ||
          i.contactEmail.toLowerCase().includes(q) ||
          i.subject.toLowerCase().includes(q) ||
          i.memo.toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, tab, search, mineOnly]);

  const selectedItems = filtered.filter((i) => selected.has(i.id));
  const allChecked = filtered.length > 0 && filtered.every((i) => selected.has(i.id));

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(filtered.map((i) => i.id)));
  }
  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportExcel() {
    const statusLabel: Record<string, string> = { active: "대기중", replied: "답변수신", closed: "완료" };
    const rows = items.map((i) => ({
      클라이언트: i.clientName,
      담당자: i.contactName,
      이메일: i.contactEmail,
      제목: i.subject,
      상태: statusLabel[i.status] ?? i.status,
      차수: `${i.stage}차`,
      "1차 발송일": formatDate(i.firstSentAt),
      "최근 발송일": formatDate(i.lastSentAt),
      답변일: formatDate(i.repliedAt),
      중요도: "★".repeat(i.importance),
      공식이메일: i.officialEmail,
      공식사이트: i.website,
      메모: i.memo,
      담당팀원: i.ownerName,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "아웃바운드DB");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `아웃바운드_전체DB_${today}.xlsx`);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const statCards = [
    { label: "보낼 목록", value: counts.prospects, color: "text-blue-600", tab: "prospects" as TabKey },
    { label: "보낸 목록", value: counts.all, color: "text-slate-900", tab: "all" as TabKey },
    { label: "답변수신", value: counts.replied, color: "text-emerald-600", tab: "replied" as TabKey },
    { label: "2차 리마인드 대상", value: counts.second, color: "text-amber-600", tab: "second" as TabKey },
    { label: "3차 리마인드 대상", value: counts.third, color: "text-red-600", tab: "third" as TabKey },
  ];

  const isOutboundView = tab !== "prospects";

  return (
    <div className="flex-1 flex flex-col">
      {/* 헤더 */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-4">
          <h1 className="font-bold text-lg">📬 아웃바운드 대시보드</h1>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-slate-500 mr-2">{userName}님</span>
            <button
              onClick={syncNow}
              disabled={syncing}
              className="rounded-lg bg-blue-600 text-white px-3.5 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {syncing ? "동기화 중..." : "🔄 메일 동기화"}
            </button>
            <Link href="/settings" className="rounded-lg border border-slate-300 px-3.5 py-1.5 hover:bg-slate-50">
              설정
            </Link>
            <button onClick={logout} className="text-slate-400 hover:text-slate-600 px-2">
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] w-full mx-auto px-6 py-6 flex-1">
        {notice && (
          <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm px-4 py-2.5 flex justify-between">
            {notice}
            <button onClick={() => setNotice("")} className="text-blue-400">✕</button>
          </div>
        )}

        {/* 통계 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {statCards.map((c) => (
            <button
              key={c.label}
              onClick={() => setTab(c.tab)}
              className={`bg-white rounded-xl border p-4 text-left hover:shadow-sm transition ${
                tab === c.tab ? "border-blue-400 ring-1 ring-blue-200" : "border-slate-200"
              }`}
            >
              <div className="text-xs text-slate-500">{c.label}</div>
              <div className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</div>
            </button>
          ))}
        </div>

        {/* 탭 + 검색 */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex flex-wrap rounded-lg border border-slate-200 bg-white p-0.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key);
                  setSelected(new Set());
                }}
                className={`px-3 py-1.5 text-sm rounded-md ${
                  tab === t.key ? "bg-slate-900 text-white font-medium" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t.label}
                <span className="ml-1 text-xs opacity-60">{counts[t.key]}</span>
              </button>
            ))}
          </div>
          {isOutboundView && (
            <>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="클라이언트 / 담당자 / 제목 검색"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer select-none">
                <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
                내 것만 보기
              </label>
              {tab === "db" && (
                <button
                  onClick={exportExcel}
                  className="ml-auto rounded-lg border border-emerald-300 text-emerald-700 px-3.5 py-1.5 text-sm hover:bg-emerald-50"
                >
                  ⬇️ 엑셀 다운로드 ({items.length}건)
                </button>
              )}
            </>
          )}
        </div>

        {/* ─── 보낼 목록 뷰 ─── */}
        {tab === "prospects" && (
          <ProspectsPanel
            refreshKey={prospectRefresh}
            onCountChange={setProspectCount}
            onCompose={(targets) => setCompose({ targets, mode: "prospect" })}
            onImported={load}
          />
        )}

        {/* ─── 아웃바운드 뷰 ─── */}
        {isOutboundView && (
          <>
            {/* 선택 툴바 */}
            {selectedItems.length > 0 && (
              <div className="sticky top-[57px] z-20 mb-3 rounded-xl bg-slate-900 text-white px-4 py-2.5 flex items-center gap-3 shadow-lg">
                <span className="text-sm font-medium">{selectedItems.length}건 선택됨</span>
                <button
                  onClick={() =>
                    setCompose({
                      targets: selectedItems.map((i) => ({
                        id: i.id,
                        name: i.contactName,
                        email: i.contactEmail,
                        client: i.clientName,
                      })),
                      mode: "outbound",
                    })
                  }
                  className="rounded-lg bg-blue-500 hover:bg-blue-400 px-4 py-1.5 text-sm font-semibold"
                >
                  ✉️ 선택한 {selectedItems.length}건에 메일 보내기
                </button>
                <button onClick={() => setSelected(new Set())} className="ml-auto text-sm text-slate-300 hover:text-white">
                  선택 해제
                </button>
              </div>
            )}

            {/* 테이블 */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm min-w-[1100px]">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500 bg-slate-50">
                    <th className="px-3 py-2.5 w-8">
                      <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                    </th>
                    <th className="px-2 py-2.5 text-left w-16">중요도</th>
                    <th className="px-2 py-2.5 text-left w-28">클라이언트</th>
                    <th className="px-2 py-2.5 text-left w-24">담당자</th>
                    <th className="px-2 py-2.5 text-left w-44">이메일</th>
                    <th className="px-2 py-2.5 text-left">제목</th>
                    <th className="px-2 py-2.5 text-left w-14">차수</th>
                    <th className="px-2 py-2.5 text-left w-20">상태</th>
                    <th className="px-2 py-2.5 text-left w-20">1차 발송</th>
                    <th className="px-2 py-2.5 text-left w-24">다음 리마인드</th>
                    <th className="px-2 py-2.5 text-left w-40">공식이메일</th>
                    <th className="px-2 py-2.5 text-left w-36">공식사이트</th>
                    <th className="px-2 py-2.5 text-left w-40">메모</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={13} className="text-center py-16 text-slate-400">
                        불러오는 중...
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="text-center py-16 text-slate-400">
                        {items.length === 0 ? (
                          <div className="space-y-2">
                            <p>아직 수집된 아웃바운드 메일이 없습니다.</p>
                            <p className="text-xs">
                              <Link href="/settings" className="text-blue-600 underline">설정</Link>
                              에서 메일 계정을 연결한 뒤 상단의 &quot;메일 동기화&quot;를 눌러주세요.
                            </p>
                          </div>
                        ) : (
                          "조건에 맞는 항목이 없습니다."
                        )}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((i) => (
                      <tr
                        key={i.id}
                        className={`border-b border-slate-100 hover:bg-slate-50/70 ${
                          selected.has(i.id) ? "bg-blue-50/60" : ""
                        }`}
                      >
                        <td className="px-3 py-2 align-middle">
                          <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                        </td>
                        <td className="px-2 py-2">
                          <Stars value={i.importance} onChange={(v) => patch(i.id, { importance: v })} />
                        </td>
                        <td className="px-2 py-2">
                          <EditableCell
                            value={i.clientName}
                            placeholder="클라이언트"
                            onSave={(v) => patch(i.id, { clientName: v })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <EditableCell
                            value={i.contactName}
                            placeholder="담당자"
                            onSave={(v) => patch(i.id, { contactName: v })}
                          />
                        </td>
                        <td className="px-2 py-2 text-xs text-slate-500 truncate max-w-44" title={i.contactEmail}>
                          {i.contactEmail}
                        </td>
                        <td className="px-2 py-2">
                          <button
                            onClick={() => setDetail(i)}
                            className="text-left text-blue-700 hover:underline line-clamp-1"
                            title="메일 원문/스레드 보기"
                          >
                            {i.subject || "(제목 없음)"}
                          </button>
                          {!i.isMine && <span className="text-[10px] text-slate-400">담당: {i.ownerName}</span>}
                        </td>
                        <td className="px-2 py-2">
                          <button
                            onClick={() => patch(i.id, { stage: i.stage >= 3 ? 1 : i.stage + 1 })}
                            className="rounded bg-slate-100 hover:bg-blue-100 hover:text-blue-700 px-1.5 py-0.5 text-xs font-medium"
                            title="클릭해서 차수 직접 변경 (1→2→3→1)"
                          >
                            {i.stage}차
                          </button>
                        </td>
                        <td className="px-2 py-2">
                          {/* 상태를 표에서 바로 변경 */}
                          <select
                            value={i.status}
                            onChange={(e) => patch(i.id, { status: e.target.value })}
                            title="클릭해서 상태 변경"
                            className={
                              "rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer border-0 focus:outline-none focus:ring-2 focus:ring-blue-300 " +
                              (i.status === "replied"
                                ? "bg-emerald-100 text-emerald-700"
                                : i.status === "closed"
                                  ? "bg-slate-200 text-slate-600"
                                  : i.reminderBucket
                                    ? "bg-red-100 text-red-700"
                                    : "bg-amber-100 text-amber-700")
                            }
                          >
                            <option value="active">
                              {i.status === "active" && i.reminderBucket
                                ? i.reminderBucket === "second"
                                  ? "2차 필요"
                                  : "3차 필요"
                                : "대기중"}
                            </option>
                            <option value="replied">답변수신</option>
                            <option value="closed">완료</option>
                          </select>
                        </td>
                        <td className="px-2 py-2 text-xs text-slate-500">{formatDate(i.firstSentAt)}</td>
                        <td className="px-2 py-2 text-xs text-slate-500">
                          {i.status === "active" ? formatDate(i.nextReminderAt) : "-"}
                        </td>
                        <td className="px-2 py-2">
                          <EditableCell
                            value={i.officialEmail}
                            placeholder="공식이메일 입력"
                            onSave={(v) => patch(i.id, { officialEmail: v })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <EditableCell
                              value={i.website}
                              placeholder="사이트 입력"
                              onSave={(v) => patch(i.id, { website: v })}
                            />
                            {i.website && (
                              <a
                                href={i.website.startsWith("http") ? i.website : `https://${i.website}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-500 text-xs shrink-0"
                                title="사이트 열기"
                              >
                                ↗
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <EditableCell value={i.memo} placeholder="메모 입력" onSave={(v) => patch(i.id, { memo: v })} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-3">
              💡 셀을 클릭하면 바로 수정됩니다 · 제목을 클릭하면 메일 원문과 주고받은 기록을 볼 수 있어요 · 2차
              리마인드는 1차 발송 15일 후, 3차는 한달 후 자동으로 목록에 나타납니다 · 메일은 대시보드를 열 때마다
              자동 동기화됩니다 (매일 오전 9시에도 자동 실행).
            </p>
          </>
        )}
      </main>

      {compose && (
        <ComposeModal
          targets={compose.targets}
          mode={compose.mode}
          onClose={() => setCompose(null)}
          onSent={() => {
            setSelected(new Set());
            load();
            setProspectRefresh((n) => n + 1);
          }}
        />
      )}
      {detail && (
        <DetailDrawer
          item={detail}
          onClose={() => setDetail(null)}
          onChanged={() => {
            load();
            setDetail(null);
          }}
          onCompose={(item) => {
            setDetail(null);
            setCompose({
              targets: [
                { id: item.id, name: item.contactName, email: item.contactEmail, client: item.clientName },
              ],
              mode: "outbound",
            });
          }}
        />
      )}
    </div>
  );
}
