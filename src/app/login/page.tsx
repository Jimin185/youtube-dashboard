"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "로그인에 실패했습니다.");
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-1">아웃바운드 대시보드</h1>
        <p className="text-sm text-slate-500 text-center mb-8">메일 연동 아웃바운드 영업 관리</p>
        <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">이메일</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="name@company.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">비밀번호</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 text-white py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
          <p className="text-sm text-center text-slate-500">
            계정이 없나요?{" "}
            <Link href="/register" className="text-blue-600 font-medium hover:underline">
              팀원 가입
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
