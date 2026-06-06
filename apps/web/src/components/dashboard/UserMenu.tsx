"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { LogOut, ChevronDown } from "lucide-react";

interface Props {
  name?: string | null;
  email?: string | null;
}

export function UserMenu({ name, email }: Props) {
  const [open, setOpen] = useState(false);

  const initials = name
    ? name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-slate-100 transition-colors duration-200"
      >
        <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-semibold select-none">
          {initials}
        </div>
        <span className="text-sm text-slate-700 font-medium max-w-[120px] truncate hidden sm:block">
          {name ?? email ?? "Account"}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 w-52 bg-white border border-slate-200 rounded-xl shadow-lg py-1 text-sm">
            {email && (
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-xs text-slate-400 truncate">{email}</p>
              </div>
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/auth/login" })}
              className="w-full flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50 transition-colors duration-150"
            >
              <LogOut className="w-3.5 h-3.5 text-slate-400" />
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
