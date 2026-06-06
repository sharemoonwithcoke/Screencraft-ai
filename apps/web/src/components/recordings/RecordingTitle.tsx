"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X } from "lucide-react";

interface Props {
  id: string;
  initialTitle: string;
}

export function RecordingTitle({ id, initialTitle }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [value, setValue] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const save = async () => {
    const next = value.trim() || "Untitled recording";
    setValue(next);
    setTitle(next);
    setEditing(false);
    await fetch(`/api/recordings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
  };

  const cancel = () => {
    setValue(title);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          className="flex-1 min-w-0 text-lg font-semibold text-slate-900 bg-slate-100 px-2 py-1 rounded-lg border border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <button onClick={save} className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition-colors flex-shrink-0">
          <Check className="w-4 h-4" />
        </button>
        <button onClick={cancel} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group flex items-center gap-2 flex-1 min-w-0 text-left"
    >
      <span className="text-lg font-semibold text-slate-900 truncate group-hover:text-brand-600 transition-colors duration-200">
        {title}
      </span>
      <Pencil className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex-shrink-0" />
    </button>
  );
}
