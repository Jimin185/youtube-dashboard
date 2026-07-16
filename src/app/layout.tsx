import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "아웃바운드 대시보드",
  description: "하이웍스 메일 연동 아웃바운드 영업 관리",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
