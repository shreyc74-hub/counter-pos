"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { marginOf } from "@/lib/admin/menu";
import { photoToDataUrl } from "@/lib/admin/photo";
import { sellableName } from "@/lib/admin/metrics";
import type { AdminCombo, AdminItem, AdminMenu, AdminModifier, AdminStore, AdminVariant, PricePoint } from "@/lib/admin/types";
import { formatRupees, rupeesToPaise } from "@/lib/domain/money";

type Tab = "items" | "addons" | "combos" | "favourites";

interface Props {
  store: AdminStore;
  outletId: string;
  menu: AdminMenu;
  onChanged: () => Promise<void>;
}

const toText = (p: number | null | undefined) => (p == null ? "" : String(p / 100));
const parse = (t: string) => (t.trim() === "" ? null : rupeesToPaise(t));

export function MenuEditor(props: Props) {
  const [tab, setTab] = useState<Tab>("items");
  const missing = props.menu.variants.filter((v) => v.active && v.costPaise == null).length;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1 style={{ fontSize: 26 }}>Menu & prices</h1>
        <span className="small muted">
          Changes reach the counter the next time it loads. Old bills keep the price and cost they were sold at.
        </span>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }} role="tablist">
        {(
          [
            ["items", "Items, sizes & costs"],
            ["addons", "Add-ons"],
            ["combos", "Combos"],
            ["favourites", "Favourites (counter)"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" className="chip" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {missing && tab === "items" ? (
        <div className="notice small">
          <strong>{missing} size{missing === 1 ? " has" : "s have"} no cost yet.</strong> Rough costs are fine: without them, margin
          insights skip those items.
        </div>
      ) : null}
      {tab === "items" ? <ItemsTab {...props} /> : null}
      {tab === "addons" ? <AddonsTab {...props} /> : null}
      {tab === "combos" ? <CombosTab {...props} /> : null}
      {tab === "favourites" ? <FavouritesTab {...props} /> : null}
    </div>
  );
}

function useSaver(onChanged: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await fn();
      await onChanged();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, saved, run };
}

// ---------------------------------------------------------------- items

function ItemsTab({ store, outletId, menu, onChanged }: Props) {
  const cats = [...menu.categories].sort((a, b) => a.sort - b.sort);
  const [catId, setCatId] = useState<string | null>(cats[0]?.id ?? null);
  const [newCat, setNewCat] = useState("");
  const [newItem, setNewItem] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const saver = useSaver(onChanged);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const reloadPhotos = useCallback(async () => setPhotos(await store.itemPhotos(outletId)), [store, outletId]);
  useEffect(() => {
    reloadPhotos().catch(() => undefined);
  }, [reloadPhotos]);
  const cat = menu.categories.find((c) => c.id === catId) ?? null;
  const items = menu.items
    .filter((i) => i.categoryId === catId)
    .filter((i) => !onlyMissing || menu.variants.some((v) => v.itemId === i.id && v.costPaise == null))
    .sort((a, b) => a.sort - b.sort);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {cats.map((c) => (
          <button key={c.id} type="button" className="tab" aria-pressed={catId === c.id} onClick={() => setCatId(c.id)} style={c.active ? undefined : { opacity: 0.6 }}>
            {c.name}
            {c.active ? "" : " (hidden)"}
          </button>
        ))}
        <form
          className="row"
          style={{ gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!newCat.trim()) return;
            void saver.run(async () => {
              const id = await store.saveCategory(outletId, { id: null, name: newCat, sort: cats.length + 1, active: true });
              setNewCat("");
              setCatId(id);
            });
          }}
        >
          <input className="input" style={{ minHeight: 44, fontSize: 15, width: 170 }} placeholder="New category" aria-label="New category name" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <button type="submit" className="btn" disabled={!newCat.trim() || saver.saving}>
            Add
          </button>
        </form>
        <label className="row small" style={{ gap: 6, marginLeft: "auto" }}>
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Only items missing a cost
        </label>
      </div>
      {saver.error ? <div className="error small">{saver.error}</div> : null}

      {cat ? (
        <div className="row small" style={{ gap: 10 }}>
          <span className="muted">Category “{cat.name}”</span>
          <button
            type="button"
            className="btn"
            style={{ minHeight: 36 }}
            onClick={() => void saver.run(() => store.saveCategory(outletId, { ...cat, active: !cat.active }))}
          >
            {cat.active ? "Hide on counter" : "Show on counter"}
          </button>
        </div>
      ) : null}

      {items.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          store={store}
          outletId={outletId}
          menu={menu}
          onChanged={onChanged}
          photo={photos[item.id] ?? null}
          onPhotoChanged={reloadPhotos}
        />
      ))}
      {items.length === 0 ? <p className="muted">No items here yet.</p> : null}

      {catId ? (
        <form
          className="card row"
          style={{ flexWrap: "wrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!newItem.trim()) return;
            void saver.run(async () => {
              await store.saveItem(outletId, {
                id: null,
                categoryId: catId,
                name: newItem,
                batchCooked: false,
                sort: items.length + 1,
                active: true,
                modifierIds: [],
              });
              setNewItem("");
            });
          }}
        >
          <strong>Add an item to {cat?.name}</strong>
          <input className="input grow" style={{ minHeight: 44, fontSize: 16 }} placeholder="e.g. Tandoori Momos" aria-label="New item name" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
          <button type="submit" className="btn btn-dark" disabled={!newItem.trim() || saver.saving}>
            Add item
          </button>
        </form>
      ) : null}
    </div>
  );
}

function ItemCard({
  item,
  store,
  outletId,
  menu,
  onChanged,
  photo,
  onPhotoChanged,
}: { item: AdminItem; photo: string | null; onPhotoChanged: () => Promise<void> } & Props) {
  const [name, setName] = useState(item.name);
  const [batch, setBatch] = useState(item.batchCooked);
  const [mods, setMods] = useState(item.modifierIds);
  const saver = useSaver(onChanged);
  const dirty = name !== item.name || batch !== item.batchCooked || mods.join() !== item.modifierIds.join();
  const variants = menu.variants.filter((v) => v.itemId === item.id).sort((a, b) => a.sort - b.sort);
  const save = (patch: Partial<AdminItem> = {}) =>
    saver.run(() => store.saveItem(outletId, { ...item, name, batchCooked: batch, modifierIds: mods, ...patch }));

  return (
    <section className="card stack" style={{ gap: 12, opacity: item.active ? 1 : 0.7 }} aria-label={item.name}>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <PhotoPicker photo={photo} name={item.name} onPick={(data) => store.setItemPhoto(outletId, item.id, data).then(onPhotoChanged)} />
        <input className="input grow" style={{ fontWeight: 700, fontSize: 18, minHeight: 46 }} value={name} aria-label="Item name" onChange={(e) => setName(e.target.value)} />
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={batch} onChange={(e) => setBatch(e.target.checked)} /> Cooked in batches (prep forecast)
        </label>
        <button type="button" className="btn" onClick={() => void save({ active: !item.active })}>
          {item.active ? "Hide on counter" : "Show on counter"}
        </button>
        <button type="button" className="btn btn-dark" disabled={!dirty || saver.saving} onClick={() => void save()}>
          {saver.saved ? "Saved" : "Save item"}
        </button>
      </div>
      {menu.modifiers.length ? (
        <div className="row small" style={{ flexWrap: "wrap", gap: 6 }}>
          <span className="muted">Add-ons offered:</span>
          {menu.modifiers.map((m) => (
            <button
              key={m.id}
              type="button"
              className="chip"
              style={{ minHeight: 34, fontSize: 13 }}
              aria-pressed={mods.includes(m.id)}
              onClick={() => setMods((x) => (x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id]))}
            >
              {m.name}
            </button>
          ))}
        </div>
      ) : null}
      {saver.error ? <div className="error small">{saver.error}</div> : null}
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Size / option</th>
              <th scope="col">Price ₹</th>
              <th scope="col">Cost ₹</th>
              <th scope="col" className="num">
                Margin
              </th>
              <th scope="col">On counter</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <VariantRow key={v.id} variant={v} item={item} store={store} outletId={outletId} onChanged={onChanged} />
            ))}
            <VariantRow key={`new-${variants.length}`} variant={null} item={item} store={store} outletId={outletId} onChanged={onChanged} nextSort={variants.length + 1} />
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Dish photo: tap to take or choose one (it is shrunk on this device before upload). */
function PhotoPicker({ photo, name, onPick }: { photo: string | null; name: string; onPick: (data: string | null) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      await onPick(await f());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the photo.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="photo-pick">
      <button type="button" className="photo-thumb" onClick={() => input.current?.click()} disabled={busy} aria-label={photo ? `Change photo of ${name}` : `Add a photo of ${name}`}>
        {photo ? <img src={photo} alt="" /> : <span>{busy ? "Saving…" : "+ Photo"}</span>}
      </button>
      {photo ? (
        <button type="button" className="btn photo-remove" disabled={busy} onClick={() => void run(async () => null)}>
          Remove
        </button>
      ) : null}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void run(() => photoToDataUrl(file));
        }}
      />
      {error ? <span className="error small">{error}</span> : null}
    </div>
  );
}

function VariantRow({
  variant,
  item,
  store,
  outletId,
  onChanged,
  nextSort = 0,
}: {
  variant: AdminVariant | null;
  item: AdminItem;
  store: AdminStore;
  outletId: string;
  onChanged: () => Promise<void>;
  nextSort?: number;
}) {
  const [name, setName] = useState(variant?.name ?? "");
  const [price, setPrice] = useState(toText(variant?.pricePaise));
  const [cost, setCost] = useState(toText(variant?.costPaise));
  const [active, setActive] = useState(variant?.active ?? true);
  const [history, setHistory] = useState<PricePoint[] | null>(null);
  const saver = useSaver(onChanged);
  const p = parse(price);
  const c = parse(cost);
  const valid = name.trim() !== "" && p != null && (cost.trim() === "" || c != null);
  const dirty =
    !variant ||
    name !== variant.name ||
    p !== variant.pricePaise ||
    (cost.trim() === "" ? null : c) !== variant.costPaise ||
    active !== variant.active;
  const m = marginOf(p, c);
  const isNew = !variant;
  const save = () =>
    saver.run(async () => {
      await store.saveVariant(outletId, {
        id: variant?.id ?? null,
        itemId: item.id,
        name,
        sort: variant?.sort ?? nextSort,
        active,
        pricePaise: p,
        costPaise: cost.trim() === "" ? null : c,
      });
      if (isNew) {
        setName("");
        setPrice("");
        setCost("");
      }
    });
  return (
    <>
      <tr className={isNew ? "new-row" : undefined}>
        <td>
          <input className="input cell" value={name} placeholder={isNew ? "Add a size, e.g. Full" : ""} aria-label="Size name" onChange={(e) => setName(e.target.value)} />
        </td>
        <td>
          <input className="input cell num" inputMode="decimal" value={price} aria-label="Price in rupees" onChange={(e) => setPrice(e.target.value)} />
        </td>
        <td>
          <input
            className={`input cell num${!isNew && cost.trim() === "" ? " missing" : ""}`}
            inputMode="decimal"
            value={cost}
            placeholder={isNew ? "" : "add cost"}
            aria-label="Cost in rupees"
            onChange={(e) => setCost(e.target.value)}
          />
        </td>
        <td className="num">{m ? `${formatRupees(m.amount)} · ${Math.round(m.pct * 100)}%` : <span className="muted">–</span>}</td>
        <td>
          <input type="checkbox" checked={active} aria-label="Show on counter" onChange={(e) => setActive(e.target.checked)} style={{ width: 20, height: 20 }} />
        </td>
        <td>
          <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
            <button type="button" className="btn btn-dark" style={{ minHeight: 38 }} disabled={!dirty || !valid || saver.saving} onClick={() => void save()}>
              {saver.saved ? "Saved" : isNew ? "Add" : "Save"}
            </button>
            {!isNew ? (
              <button
                type="button"
                className="btn"
                style={{ minHeight: 38 }}
                onClick={async () => setHistory(history ? null : await store.priceHistory(outletId, variant.id))}
              >
                History
              </button>
            ) : null}
          </span>
        </td>
      </tr>
      {saver.error ? (
        <tr>
          <td colSpan={6}>
            <div className="error small">{saver.error}</div>
          </td>
        </tr>
      ) : null}
      {history ? (
        <tr>
          <td colSpan={6} className="small">
            {history.length === 0 ? "No history." : null}
            {history.map((h, i) => (
              <div key={i} className="muted">
                {new Date(h.from).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}: price {formatRupees(h.pricePaise)}, cost{" "}
                {h.costPaise == null ? "not set" : formatRupees(h.costPaise)}
              </div>
            ))}
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- add-ons

function AddonsTab({ store, outletId, menu, onChanged }: Props) {
  return (
    <section className="card">
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Add-on</th>
              <th scope="col">Price ₹</th>
              <th scope="col">Cost ₹</th>
              <th scope="col">On counter</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {menu.modifiers.map((m) => (
              <AddonRow key={m.id} mod={m} store={store} outletId={outletId} onChanged={onChanged} />
            ))}
            <AddonRow key={`new-${menu.modifiers.length}`} mod={null} store={store} outletId={outletId} onChanged={onChanged} />
          </tbody>
        </table>
      </div>
      <p className="small muted">Choose which items offer each add-on in “Items, sizes & costs”. Free add-ons (price 0) like “Less spicy” work as quick notes.</p>
    </section>
  );
}

function AddonRow({ mod, store, outletId, onChanged }: { mod: AdminModifier | null; store: AdminStore; outletId: string; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(mod?.name ?? "");
  const [price, setPrice] = useState(mod ? toText(mod.pricePaise) : "0");
  const [cost, setCost] = useState(toText(mod?.costPaise));
  const [active, setActive] = useState(mod?.active ?? true);
  const saver = useSaver(onChanged);
  const p = parse(price) ?? 0;
  const c = cost.trim() === "" ? null : parse(cost);
  const dirty = !mod || name !== mod.name || p !== mod.pricePaise || c !== mod.costPaise || active !== mod.active;
  return (
    <>
      <tr className={mod ? undefined : "new-row"}>
        <td>
          <input className="input cell" value={name} placeholder={mod ? "" : "New add-on"} aria-label="Add-on name" onChange={(e) => setName(e.target.value)} />
        </td>
        <td>
          <input className="input cell num" inputMode="decimal" value={price} aria-label="Price in rupees" onChange={(e) => setPrice(e.target.value)} />
        </td>
        <td>
          <input className="input cell num" inputMode="decimal" value={cost} aria-label="Cost in rupees" onChange={(e) => setCost(e.target.value)} />
        </td>
        <td>
          <input type="checkbox" checked={active} aria-label="Show on counter" onChange={(e) => setActive(e.target.checked)} style={{ width: 20, height: 20 }} />
        </td>
        <td>
          <button
            type="button"
            className="btn btn-dark"
            style={{ minHeight: 38 }}
            disabled={!dirty || !name.trim() || saver.saving}
            onClick={() =>
              void saver.run(async () => {
                await store.saveModifier(outletId, { id: mod?.id ?? null, name, active, pricePaise: p, costPaise: c });
                if (!mod) {
                  setName("");
                  setPrice("0");
                  setCost("");
                }
              })
            }
          >
            {saver.saved ? "Saved" : mod ? "Save" : "Add"}
          </button>
        </td>
      </tr>
      {saver.error ? (
        <tr>
          <td colSpan={5}>
            <div className="error small">{saver.error}</div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- combos

function CombosTab(props: Props) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      {props.menu.combos.map((c) => (
        <ComboCard key={c.id} combo={c} {...props} />
      ))}
      <ComboCard key={`new-${props.menu.combos.length}`} combo={null} {...props} />
    </div>
  );
}

function ComboCard({ combo, store, outletId, menu, onChanged }: { combo: AdminCombo | null } & Props) {
  const [name, setName] = useState(combo?.name ?? "");
  const [desc, setDesc] = useState(combo?.description ?? "");
  const [price, setPrice] = useState(toText(combo?.pricePaise));
  const [cost, setCost] = useState(toText(combo?.costPaise));
  const [active, setActive] = useState(combo?.active ?? true);
  const [parts, setParts] = useState(combo?.parts ?? []);
  const [adding, setAdding] = useState("");
  const saver = useSaver(onChanged);
  const p = parse(price);
  const c = cost.trim() === "" ? null : parse(cost);
  const m = marginOf(p, c);
  // What the parts cost separately, to show the customer's saving.
  const separately = parts.reduce((s, x) => s + (menu.variants.find((v) => v.id === x.variantId)?.pricePaise ?? 0) * x.qty, 0);
  const options = menu.variants.filter((v) => v.active);
  return (
    <section className="card stack" style={{ gap: 12 }} aria-label={combo ? combo.name : "New combo"}>
      <strong>{combo ? combo.name : "New combo"}</strong>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <label className="field grow">
          Name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field grow">
          Short description (shown on the tile)
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Veg Stm Full + drink 250" />
        </label>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="field">What&apos;s inside</span>
        {parts.map((x, i) => (
          <div key={x.variantId} className="row small">
            <span className="grow">{sellableName(menu, x.variantId).name}</span>
            <span className="qty">
              <button type="button" aria-label="One less" onClick={() => setParts((ps) => ps.map((y, j) => (j === i ? { ...y, qty: Math.max(1, y.qty - 1) } : y)))}>
                −
              </button>
              <strong>{x.qty}</strong>
              <button type="button" aria-label="One more" onClick={() => setParts((ps) => ps.map((y, j) => (j === i ? { ...y, qty: y.qty + 1 } : y)))}>
                +
              </button>
            </span>
            <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <div className="row">
          <select className="input grow" style={{ minHeight: 44, fontSize: 15 }} value={adding} aria-label="Add an item to the combo" onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add an item…</option>
            {options.map((v) => (
              <option key={v.id} value={v.id}>
                {sellableName(menu, v.id).name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={!adding}
            onClick={() => {
              setParts((ps) => (ps.some((x) => x.variantId === adding) ? ps : [...ps, { variantId: adding, qty: 1 }]));
              setAdding("");
            }}
          >
            Add
          </button>
        </div>
        {separately > 0 ? <span className="small muted">Bought separately: {formatRupees(separately)}</span> : null}
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <label className="field">
          Combo price ₹
          <input className="input num" style={{ width: 140 }} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="field">
          Cost ₹
          <input className="input num" style={{ width: 140 }} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </label>
        <span className="small" style={{ alignSelf: "flex-end", paddingBottom: 14 }}>
          {m ? `Margin ${formatRupees(m.amount)} · ${Math.round(m.pct * 100)}%` : ""}
          {p != null && separately > p ? ` · customer saves ${formatRupees(separately - p)}` : ""}
        </span>
        <label className="row small" style={{ gap: 6, alignSelf: "flex-end", paddingBottom: 14 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> On counter
        </label>
      </div>
      {saver.error ? <div className="error small">{saver.error}</div> : null}
      <button
        type="button"
        className="btn btn-dark"
        style={{ alignSelf: "flex-start" }}
        disabled={!name.trim() || p == null || !parts.length || saver.saving}
        onClick={() =>
          void saver.run(async () => {
            await store.saveCombo(outletId, { id: combo?.id ?? null, name, description: desc, active, pricePaise: p, costPaise: c, parts });
            if (!combo) {
              setName("");
              setDesc("");
              setPrice("");
              setCost("");
              setParts([]);
            }
          })
        }
      >
        {saver.saved ? "Saved" : combo ? "Save combo" : "Create combo"}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------- favourites

function FavouritesTab({ store, outletId, menu, onChanged }: Props) {
  const [ids, setIds] = useState(menu.favourites);
  const [adding, setAdding] = useState("");
  const saver = useSaver(onChanged);
  const options = [
    ...menu.variants.filter((v) => v.active).map((v) => v.id),
    ...menu.combos.filter((c) => c.active).map((c) => c.id),
  ].filter((id) => !ids.includes(id));
  const move = (i: number, d: number) =>
    setIds((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const next = [...xs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  return (
    <section className="card stack" style={{ gap: 10 }}>
      <p className="small muted" style={{ margin: 0 }}>
        These are the one-tap tiles on the counter&apos;s Favourites tab, in this order. Keep your 12 best sellers here.
      </p>
      {ids.map((id, i) => (
        <div key={id} className="list-row">
          <span>
            <span className="muted">{i + 1}.</span> {sellableName(menu, id).name}
          </span>
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn" style={{ minHeight: 36 }} aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button type="button" className="btn" style={{ minHeight: 36 }} aria-label="Move down" disabled={i === ids.length - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
            <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => setIds((xs) => xs.filter((x) => x !== id))}>
              Remove
            </button>
          </span>
        </div>
      ))}
      <div className="row">
        <select className="input grow" style={{ minHeight: 44, fontSize: 15 }} value={adding} aria-label="Add a favourite" onChange={(e) => setAdding(e.target.value)}>
          <option value="">Add a tile…</option>
          {options.map((id) => (
            <option key={id} value={id}>
              {sellableName(menu, id).name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={!adding}
          onClick={() => {
            setIds((xs) => [...xs, adding]);
            setAdding("");
          }}
        >
          Add
        </button>
      </div>
      {saver.error ? <div className="error small">{saver.error}</div> : null}
      <button
        type="button"
        className="btn btn-dark"
        style={{ alignSelf: "flex-start" }}
        disabled={saver.saving || ids.join() === menu.favourites.join()}
        onClick={() => void saver.run(() => store.setFavourites(outletId, ids))}
      >
        {saver.saved ? "Saved" : "Save favourites"}
      </button>
    </section>
  );
}
