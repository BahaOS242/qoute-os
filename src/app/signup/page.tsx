import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "@/components/dashboard/auth-form";

export const metadata = { title: "Create your account" };

export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center text-lg font-semibold tracking-tight">QuoteOS</Link>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="mb-5 text-lg font-semibold">Create your account</h1>
          <Suspense>
            <AuthForm mode="signup" />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
