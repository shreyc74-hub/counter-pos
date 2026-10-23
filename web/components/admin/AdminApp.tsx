"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PinPad } from "@/components/counter/ui";
import { createAdminStore } from "@/lib/admin";
import type { AdminMenu } from "@/lib/admin/types";
import type { Outlet } from "@/lib/domain/types";
import { Dashboard } from "./Dashboard";
import { MenuEditor } from "./MenuEditor";

type Page = "dashboard" | "menu";

export function AdminApp() {
  const store = useMemo(() => createAdminStore(), []);
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [outlets, setOutlets] = useState<Outlet[] | null>(null);
  const [outletId, setOutletId] = useState<string | null>(null);
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [page, setPage] = useState<Page>("dashboard");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    store.currentUser().then(setUser).catch(() => setUser(null));
  }, [store]);

  useEffect(() => {
    if (!user) return;
    store
      .outlets()
      .then((o) => {
        setOutlets(o);
        setOutletId((cur) => cur ?? o[0]?.id ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load your outlets."));
  }, [store, user]);

  const reloadMenu = useCallback(async () => {
    if (outletId) setMenu(await store.menu(outletId));
  }, [store, outletId]);

  useEffect(() => {
    reloadMenu().catch((e) => setError(e instanceof Error ? e.message : "Could not load the menu."));
  }, [reloadMenu]);

  if (user === undefined) return <main className="page muted">Loading…</main>;
  if (!user) return <SignIn store={store} onSignedIn={setUser} />;

  const outlet = outlets?.find((o) => o.id === outletId) ?? null;
  const signOut = async () => {
    await store.signOut();
    setUser(null);
    setOutlets(null);
    setOutletId(null);
    setMenu(null);
  };

  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Admin">
        <div className="stack" style={{ gap: 4, padding: "0 10px 16px" }}>
          <strong style={{ fontSize: 18 }}>Counter POS</strong>
          {outlet ? (
            <span className="small" style={{ color: "#d6d3cc" }}>
              {outlet.name} {outlet.isDemo ? <span className="badge-demo" style={{ marginLeft: 4 }}>DEMO</span> : null}
            </span>
          ) : null}
        </div>
        {(
          [
            ["dashboard", "Dashboard"],
            ["menu", "Menu & prices"],
          ] as [Page, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" className="admin-link" aria-current={page === id ? "page" : undefined} onClick={() => setPage(id)}>
            {label}
          </button>
        ))}
        <a className="admin-link" href="/counter">
          Open counter
        </a>
        <span className="admin-soon small">Coming next: staff & devices, settings, insights, Telegram summary</span>
        <div className="admin-user small">
          <span>{user}</span>
          <button type="button" className="btn" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </nav>
      <main className="admin-main">
        {error ? <div className="error">{error}</div> : null}
        {outlets && outlets.length === 0 ? <NoOutlet email={user} /> : null}
        {outlet && page === "dashboard" ? <Dashboard store={store} outletId={outlet.id} menu={menu} /> : null}
        {outlet && page === "menu" && menu ? <MenuEditor store={store} outletId={outlet.id} menu={menu} onChanged={reloadMenu} /> : null}
      </main>
    </div>
  );
}

function SignIn({ store, onSignedIn }: { store: ReturnType<typeof createAdminStore>; onSignedIn: (u: string) => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (store.kind === "demo") {
    return (
      <main className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
        <div className="card stack" style={{ width: "min(440px, 100%)", gap: 16 }}>
          <h1 style={{ fontSize: 24 }}>Admin · demo</h1>
          <p className="muted" style={{ margin: 0 }}>
            Demo mode runs on made-up data in this browser. Enter the owner PIN (1234).
          </p>
          <PinPad
            light
            error={error}
            onSubmit={async (pin) => {
              if (await store.verifySignIn("", pin)) onSignedIn((await store.currentUser()) ?? "Owner");
              else setError("That is not the owner PIN.");
            }}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
      <form
        className="card stack"
        style={{ width: "min(440px, 100%)", gap: 16 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            if (!sent) {
              await store.startSignIn(email);
              setSent(true);
            } else if (await store.verifySignIn(email, code)) {
              onSignedIn(email);
            } else {
              setError("That code didn't work. Check the latest email, or send a new code.");
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not sign in.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 style={{ fontSize: 24 }}>Admin sign in</h1>
        <label className="field">
          Email
          <input className="input" type="email" autoComplete="email" value={email} disabled={sent} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {sent ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              We sent an email to {email}. Click the link in it, or type the 6-digit code here.
            </p>
            <label className="field">
              Code
              <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
          </>
        ) : null}
        {error ? <div className="error small">{error}</div> : null}
        <button type="submit" className="btn btn-dark btn-big" disabled={busy || !email || (sent && code.trim().length < 6)}>
          {busy ? "Please wait…" : sent ? "Sign in" : "Email me a sign-in link"}
        </button>
        {sent ? (
          <button type="button" className="btn" onClick={() => setSent(false)}>
            Use a different email
          </button>
        ) : null}
      </form>
    </main>
  );
}

function NoOutlet({ email }: { email: string }) {
  return (
    <div className="card stack">
      <h1 style={{ fontSize: 22 }}>Your email isn&apos;t linked to an outlet yet</h1>
      <p className="muted" style={{ margin: 0 }}>
        In Supabase, open the SQL editor and run this once, with your outlet&apos;s name. Then sign in again.
      </p>
      <pre className="receipt" style={{ whiteSpace: "pre-wrap" }}>
        {`update outlets set owner_email = '${email}' where name = 'Demo Momo Corner';`}
      </pre>
    </div>
  );
}
