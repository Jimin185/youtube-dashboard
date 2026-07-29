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
  fromName: string;
  fromEmail: string;
  signature: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export default function SettingsForm({ loginEmail }: { loginEmail: string }) {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [form, setForm] = useState({
    email: "",
    password: "",
    imapHost: "imap.gmail.com",
    imapPort: "993",
    smtpHost: "smtp.gmail.com",
    smtpPort: "465",
    fromName: "",
    fromEmail: "",
    signature: "",
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
            fromName: a.fromName ?? "",
            fromEmail: a.fromEmail ?? "",
            signature: a.signature ?? "",
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
        fromName: form.fromName,
        fromEmail: form.fromEmail,
        signature: form.signature,
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
        <h1 className="text-xl font-bold">설정 · 메일 계정 연결</h1>
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

        <div className="mb-5 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-800 space-y-1.5">
          <p className="font-semibold text-sm">📌 Gmail 연결 전 준비 — &quot;앱 비밀번호&quot; 만들기 (2분)</p>
          <p>Gmail은 보안상 일반 비밀번호로 외부 연결이 안 되고, 전용 &quot;앱 비밀번호&quot;를 만들어야 해요.</p>
          <ol className="list-decimal ml-4 space-y-1">
            <li>
              구글 계정에 <b>2단계 인증</b>이 켜져 있어야 합니다 (
              <a href="https://myaccount.google.com/signinoptions/two-step-verification" target="_blank" rel="noreferrer" className="underline">
                여기서 확인
              </a>
              )
            </li>
            <li>
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="underline font-medium">
                구글 앱 비밀번호 페이지
              </a>
              에서 이름(예: 대시보드)을 입력하고 만들기
            </li>
            <li>화면에 뜨는 <b>16자리 코드</b>를 복사해서 아래 &quot;앱 비밀번호&quot; 칸에 붙여넣기 (띄어쓰기는 있어도 무방)</li>
          </ol>
        </div>

        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">메일 주소 (Gmail 또는 하이웍스)</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="name@gmail.com 또는 회사메일"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">앱 비밀번호 (하이웍스는 메일 전용 비밀번호)</label>
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder={account ? "변경하려면 다시 입력" : "예: abcd efgh ijkl mnop"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              ⚠️ Gmail 로그인 비밀번호가 아니라 위에서 만든 <b>앱 비밀번호</b>를 넣어주세요. 암호화되어
              저장되며 메일 읽기/발송에만 사용됩니다.
            </p>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-4">
            <p className="text-sm font-semibold">✍️ 발신자 표시 · 서명 (선택)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">보내는 사람 이름</label>
                <input
                  value={form.fromName}
                  onChange={(e) => set("fromName", e.target.value)}
                  placeholder="예: 홍길동 | OO애드"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">발신 주소 (받는 사람에게 보이는 주소)</label>
                <div className="flex gap-1.5">
                  <input
                    value={form.fromEmail}
                    onChange={(e) => set("fromEmail", e.target.value)}
                    placeholder={`비우면 ${form.email || "연결한 Gmail"} 그대로`}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm min-w-0"
                  />
                  {loginEmail && form.fromEmail !== loginEmail && (
                    <button
                      type="button"
                      onClick={() => set("fromEmail", loginEmail)}
                      className="shrink-0 rounded-lg border border-blue-300 text-blue-600 px-2 py-1 text-xs hover:bg-blue-50"
                      title={loginEmail}
                    >
                      로그인 메일로
                    </button>
                  )}
                </div>
              </div>
            </div>
            {form.fromEmail && form.fromEmail.toLowerCase() !== form.email.toLowerCase() && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 space-y-1">
                <p className="font-semibold">
                  ⚠️ Gmail 계정과 다른 주소로 발신하려면 Gmail에 그 주소를 먼저 등록해야 해요
                </p>
                <p>
                  Gmail →{" "}
                  <a
                    href="https://mail.google.com/mail/u/0/#settings/accounts"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    설정 → 계정 및 가져오기
                  </a>{" "}
                  → &quot;다른 주소에서 메일 보내기&quot;에 <b>{form.fromEmail}</b> 추가 (확인 메일 인증 필요).
                  등록하지 않으면 Gmail이 발신 주소를 원래 계정으로 되돌려버립니다.
                </p>
                <p>💡 그 주소로 온 답장을 자동 감지하려면, 해당 메일함에서 Gmail로 자동 전달을 설정해 두세요.</p>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1">서명 (모든 발신 메일 끝에 자동으로 붙어요)</label>
              <textarea
                value={form.signature}
                onChange={(e) => set("signature", e.target.value)}
                rows={4}
                placeholder={"홍길동 드림\nOO애드 퍼포먼스마케팅팀\n010-0000-0000 | www.example.com"}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-y"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setAdvanced(!advanced)}
            className="text-xs text-slate-500 underline"
          >
            {advanced ? "고급 설정 접기" : "고급 설정 (Gmail이 아닌 다른 메일 사용 시)"}
          </button>
          {advanced && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      imapHost: "pop3s.hiworks.com",
                      imapPort: "995",
                      smtpHost: "smtps.hiworks.com",
                      smtpPort: "465",
                    }))
                  }
                  className="rounded-lg border border-emerald-300 text-emerald-700 px-3 py-1.5 text-xs hover:bg-emerald-50"
                >
                  🏢 하이웍스 서버로 채우기 (POP3)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      imapHost: "imap.gmail.com",
                      imapPort: "993",
                      smtpHost: "smtp.gmail.com",
                      smtpPort: "465",
                    }))
                  }
                  className="rounded-lg border border-slate-300 text-slate-600 px-3 py-1.5 text-xs hover:bg-slate-50"
                >
                  Gmail 서버로 되돌리기
                </button>
              </div>
              <p className="text-xs text-slate-400">
                하이웍스는 IMAP이 없어 POP3로 연결됩니다. 비밀번호 칸에는 하이웍스의{" "}
                <b>메일 전용 비밀번호</b>를 넣어주세요. (POP3 방식은 받은편지함만 읽으므로, 과거 보낸
                이력은 엑셀 업로드로 등록하고 발송은 대시보드에서 하시면 됩니다.)
              </p>
              <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">수신 서버 (IMAP/POP3)</label>
                <input
                  value={form.imapHost}
                  onChange={(e) => set("imapHost", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">수신 포트</label>
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
      </div>
    </main>
  );
}
