"use client";

import { useState } from "react";
import type { Bootstrap } from "@/lib/data/store";
import type { Staff } from "@/lib/domain/types";
import { supabaseConfig } from "@/lib/supabaseConfig";
import { PinPad, useClock } from "./ui";

export function LockScreen({
  boot,
  demo,
  onLogin,
}: {
  boot: Bootstrap;
  demo: boolean;
  onLogin: (pin: string) => Promise<Staff | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const now = useClock();
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(now);
  const date = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "short" }).format(now);
  return (
    <main className="lock">
      <section className="lock-info">
        <div className="row">
          {demo ? (
            <span className="badge-demo">DEMO · not connected to Supabase</span>
          ) : boot.outlet.isDemo ? (
            <span className="badge-demo">DEMO OUTLET (Supabase)</span>
          ) : (
            <span className="badge-live">LIVE · Supabase</span>
          )}
          <span style={{ color: "#d6d3cc" }}>
            {boot.outlet.name} · Device {boot.device.code}
          </span>
        </div>
        <div className="stack">
          <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: "-0.03em" }}>{time}</div>
          <div style={{ fontSize: 20, color: "#d6d3cc" }}>{date}</div>
        </div>
        {demo ? (
          <div style={{ color: "#d6d3cc", fontSize: 15, lineHeight: 1.6 }}>
            Demo PINs: Shrey (owner) 1234 · Ramesh 1111 · Sita 2222.
            <br />
            Demo data stays in this browser only.
            <br />
            <span style={{ color: "#fdba74" }}>
              Not connected: this version was built without {supabaseConfig().missing.join(" and ")}. Add it in Vercel → Settings →
              Environment Variables, then redeploy.
            </span>
          </div>
        ) : (
          <div />
        )}
      </section>
      <section className="lock-pad" aria-label="Staff login">
        <h1 style={{ fontSize: 26, textAlign: "center" }}>Enter your PIN</h1>
        <PinPad
          error={error}
          onSubmit={async (pin) => {
            setError(null);
            const staff = await onLogin(pin);
            if (!staff) setError("Wrong PIN. Try again.");
          }}
        />
        <p style={{ textAlign: "center", fontSize: 14, color: "#bdb8ad", margin: 0 }}>
          Every bill, void and expense is saved under your name.
        </p>
      </section>
    </main>
  );
}
