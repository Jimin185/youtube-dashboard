"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AccountInfo {
  id: number;
  email: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export default function SettingsForm() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [form, setForm] = useState({
    email: "",
    password: "",
    imapHost: "imap.hiworks.com",
    imapPort: "993",
    smtpHost: "smtp.hiworks.com",
    smtpPort: "465",
  });
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/account")
      .then((r) => r.json())
      .then((data) => {
        const a = data.accounts?.[0];
        if (a) {
          setAccount(a);
          setForm((f) => ({
            ...f,
            email: a.email,
            imapHost: a.imapHost,
            imapPort: String(a.imapPort),
            smtpHost: a.smtpHost,
            smtpPort: String(a.smtpPort),
          }));
        }
      })
      .catch(() => {});
  }, []);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.email,
        password: form.password,
        imapHost: form.imapHost,
        imapPort: Number(form.imapPort),
        smtpHost: form.smtpHost,
        smtpPort: Number(form.smtpPort),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok && data.ok) {
      setMessage({ type: "ok", text: "✓ 연결 성공! 이제 대시보드에서 '메일 동기화'를 눌러보세요." });
    } else {
      setMessage({ type: "err", text: data.error ?? "저장에 실패했습니다." });
    }
  }

  return (
    <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-slate-400 hover:text-slate-600">← 대시보드</Link>
        <h1 className="text-xl font-bold">설정 · 하이웍스 메일 연결</h1>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        {account && (
          <div className="mb-5 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm">
            <p>
              연결된 계정: <b>{account.email}</b>
            </p>
            <p className="text-slate-500 text-xs mt-1">
              마지막 동기화:{" "}
              {account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString("ko-KR") : "아직 없음"}
              {account.lastSyncError && (
                <span className="text-red-600 block mt-0.5">최근 오류: {account.lastSyncError}</span>
              )}
            </p>
          </div>
        )}

        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">하이웍스 메일 주소</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="name@company.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">메일 비밀번호</label>
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder={account ? "변경하려면 다시 입력" : "하이웍스 로그인 비밀번호"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              비밀번호는 암호화되어 저장되며 메일 읽기/발송에만 사용됩니다.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setAdvanced(!advanced)}
            className="text-xs text-slate-500 underline"
          >
            {advanced ? "고급 설정 접기" : "고급 설정 (서버 주소 변경)"}
          </button>
          {advanced && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">IMAP 서버 (수신)</label>
                <input
                  value={form.imapHost}
                  onChange={(e) => set("imapHost", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">IMAP 포트</label>
                <input
                  value={form.imapPort}
                  onChange={(e) => set("imapPort", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">SMTP 서버 (발신)</label>
                <input
                  value={form.smtpHost}
                  onChange={(e) => set("smtpHost", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">SMTP 포트</label>
                <input
                  value={form.smtpPort}
                  onChange={(e) => set("smtpPort", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {message && (
            <p className={`text-sm ${message.type === "ok" ? "text-emerald-600" : "text-red-600"}`}>
              {message.text}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-blue-600 text-white py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "연결 테스트 중..." : "저장하고 연결 테스트"}
          </button>
        </form>

        <div className="mt-6 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800 space-y-1">
          <p className="font-semibold">⚠️ 하이웍스에서 IMAP을 먼저 켜주세요</p>
          <p>하이웍스 웹메일 → 환경설정 → POP3/IMAP 설정 → IMAP 사용 체크</p>
          <p>연결이 안 되면 회사 관리자에게 IMAP/SMTP 사용 가능 여부를 확인해 주세요.</p>
        </div>
      </div>
    </main>
  );
}
