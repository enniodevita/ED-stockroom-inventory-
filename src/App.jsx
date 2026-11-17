import { useState, useEffect, useRef, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://wjuwxumshijallenlxev.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqdXd4dW1zaGlqYWxsZW5seGV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMDIzMDksImV4cCI6MjA5MDY3ODMwOX0.W6Ufu92HIJmtOpN0ft4W9_zxiwTa8kDSa9_J8gFRYZ4";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const BUCKET = "Photos";

// To add or rename a location, edit this list.
const ROOMS = [
  "Red Bin Room", "Red Stockroom", "Red Med Room",
  "Yellow Stockroom", "Yellow Med Room", "Yellow Hallway Pyxis",
  "Green/Ortho Stockroom", "Green/Mobility Stockroom", "Green Med Room",
  "Peds Stockroom", "Peds Mini Stockroom", "Peds Med Room",
  "Cabinet between R44 and R43",
  "Cabinet between R43 and R42",
  "Cabinet near R45",
];
const SPECIFICS = ["Front", "Back", "Left", "Right", "Pyxis"];
const DOORS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const OTHER = "__other";

const CACHE_KEY = "itemfinder:items";
const EMAIL_KEY = "itemfinder:email";
const ROOM_KEY = "itemfinder:lastRoom";
const FAVS_KEY = "itemfinder:favorites";
const LIST_KEY = "itemfinder:supplyList"; // older name, still read once so nothing is lost
const RUN_KEY = "itemfinder:bundleRun";
const BUNDLES_KEY = "itemfinder:bundles";
const SIDES = ["Front", "Back", "Left", "Right"];

/* ───────────────────────── helpers ───────────────────────── */

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode etc.) — the app works without it */
  }
  return null;
}

// Which colour zone of the department a room belongs to.
function zoneOf(room) {
  const r = (room || "").toLowerCase();
  if (r.startsWith("red")) return "red";
  if (r.startsWith("yellow")) return "yellow";
  if (r.startsWith("green")) return "green";
  if (r.startsWith("peds")) return "peds";
  return "other";
}

const ZONES = [
  ["red", "Red"], ["yellow", "Yellow"], ["green", "Green"], ["peds", "Peds"], ["other", "Cabinets and other"],
];

function photosOf(row) {
  if (row.photo_urls && row.photo_urls.length > 0) return row.photo_urls;
  if (row.photo_url) return [row.photo_url];
  return [];
}

function uniq(list) {
  return [...new Set(list)];
}

// Same name typed twice with different capitals counts once.
function cleanNames(names) {
  const seen = new Set();
  const out = [];
  for (const raw of names) {
    const n = (raw || "").trim();
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

// Rows that share a name are the same item stocked in different places.
function buildEntries(rows) {
  const groups = [];
  const byName = new Map();
  for (const row of rows) {
    const keys = (row.names || []).map((n) => n.trim().toLowerCase()).filter(Boolean);
    let group = null;
    for (const k of keys) {
      if (byName.has(k)) { group = byName.get(k); break; }
    }
    if (!group) { group = []; groups.push(group); }
    group.push(row);
    for (const k of keys) if (!byName.has(k)) byName.set(k, group);
  }
  return groups.map((g) => ({
    rows: g,
    names: cleanNames(g.flatMap((r) => r.names || [])),
    notes: (g.find((r) => r.notes && r.notes.trim()) || {}).notes || "",
    photos: uniq(g.flatMap(photosOf)),
  }));
}

// Lower is a closer match. Infinity means no match.
function matchScore(entry, q) {
  const tokens = q.split(/\s+/).filter(Boolean);
  let best = Infinity;
  for (const name of entry.names) {
    const n = name.toLowerCase();
    let score = Infinity;
    if (n === q) score = 0;
    else if (n.startsWith(q)) score = 1;
    else if (n.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) score = 2;
    else if (n.includes(q)) score = 3;
    if (score < best) best = score;
  }
  if (best === Infinity && tokens.length > 1) {
    const all = entry.names.join(" ").toLowerCase();
    if (tokens.every((t) => all.includes(t))) best = 4;
  }
  if (best === Infinity && entry.notes && entry.notes.toLowerCase().includes(q)) best = 5;
  return best;
}

function bestName(entry, q) {
  if (!q) return entry.names[0];
  const scored = entry.names.map((name) => {
    const n = name.toLowerCase();
    if (n === q) return [0, name];
    if (n.startsWith(q)) return [1, name];
    if (n.includes(q)) return [2, name];
    return [3, name];
  });
  scored.sort((a, b) => a[0] - b[0]);
  return scored[0][1];
}

function locationLabel(row) {
  return row.room + (row.specific ? ` (${row.specific})` : "");
}

function bitCount(n) {
  let c = 0;
  while (n) { n &= n - 1; c++; }
  return c;
}

// Works out the smallest set of rooms that together hold every item on the list.
// Each item: { entry, skip } where skip holds the row ids the user marked "not here".
// `allowed` limits the search to those rooms; an empty list means every room.
function planStops(items, roomOrder, allowed = []) {
  const need = items.map((item) => {
    const live = item.entry.rows.filter((r) => !item.skip.includes(r.id));
    return { item, live, rows: allowed.length > 0 ? live.filter((r) => allowed.includes(r.room)) : live };
  });
  const missing = need.filter((n) => n.live.length === 0).map((n) => n.item);
  const outside = need.filter((n) => n.live.length > 0 && n.rows.length === 0).map((n) => ({ item: n.item, rows: n.live }));
  const todo = need.filter((n) => n.rows.length > 0);
  if (todo.length === 0) return { stops: [], missing, outside };

  const order = (room) => { const i = roomOrder.indexOf(room); return i === -1 ? 999 : i; };
  const roomList = uniq(todo.flatMap((n) => n.rows.map((r) => r.room))).sort((a, b) => order(a) - order(b));
  const bit = new Map(roomList.map((room, i) => [room, i]));
  const masks = todo.map((n) => n.rows.reduce((m, r) => m | (1 << bit.get(r.room)), 0));
  const zoneCount = (set) => new Set(roomList.filter((_, i) => (set >> i) & 1).map(zoneOf)).size;

  let best = 0;
  if (roomList.length <= 18) {
    // Small enough to try every combination: fewest rooms wins, then fewest colour zones.
    let bestRooms = Infinity, bestZones = Infinity;
    for (let set = 1; set < (1 << roomList.length); set++) {
      const count = bitCount(set);
      if (count > bestRooms || !masks.every((m) => m & set)) continue;
      const zones = zoneCount(set);
      if (count < bestRooms || zones < bestZones) { best = set; bestRooms = count; bestZones = zones; }
    }
  } else {
    // Very many rooms: repeatedly take the room that covers the most remaining items.
    let left = masks.map((_, i) => i);
    while (left.length > 0) {
      let pick = 0, most = -1;
      roomList.forEach((_, i) => {
        const n = left.filter((k) => (masks[k] >> i) & 1).length;
        if (n > most) { most = n; pick = i; }
      });
      best |= 1 << pick;
      left = left.filter((k) => !((masks[k] >> pick) & 1));
    }
  }

  const chosen = roomList.filter((_, i) => (best >> i) & 1);
  const stops = chosen.map((room) => ({ room, items: [] }));
  for (const n of todo) {
    const stop = stops.find((st) => n.rows.some((r) => r.room === st.room));
    stop.items.push({
      item: n.item,
      here: n.rows.filter((r) => r.room === stop.room),
      elsewhere: n.live.filter((r) => r.room !== stop.room),
    });
  }
  return { stops, missing, outside };
}

/* form <-> database row conversions for a location */
let keySeq = 0;
const newKey = () => `k${++keySeq}`;

function blankLoc(room = "") {
  return { key: newKey(), id: null, room, custom: "", specific: "", door: "" };
}

function rowToLoc(row) {
  const loc = blankLoc();
  loc.id = row.id;
  if (ROOMS.includes(row.room)) loc.room = row.room;
  else { loc.room = OTHER; loc.custom = row.room || ""; }
  const spec = row.specific || "";
  if (spec.startsWith("Pyxis Door ")) { loc.specific = "Pyxis"; loc.door = spec.replace("Pyxis Door ", ""); }
  else loc.specific = spec;
  return loc;
}

function locToRow(loc) {
  const room = (loc.room === OTHER ? loc.custom : loc.room).trim();
  let specific = loc.specific || null;
  if (loc.specific === "Pyxis" && loc.door) specific = `Pyxis Door ${loc.door}`;
  return { room, specific };
}

function compressImage(file, maxSide = 1200) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not read that photo"))), "image/jpeg", 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that photo")); };
    img.src = url;
  });
}

async function uploadPhoto(file) {
  const blob = await compressImage(file);
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error("Photo upload failed. " + (error.message || ""));
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function removeStoredPhotos(urls) {
  const marker = `/object/public/${BUCKET}/`;
  const paths = urls
    .filter((u) => u.includes(marker))
    .map((u) => decodeURIComponent(u.split(marker)[1].split("?")[0]));
  if (paths.length === 0) return;
  try { await supabase.storage.from(BUCKET).remove(paths); } catch { /* leftover files are harmless */ }
}

// Throws when the database refused a change, including the silent case where
// nothing was changed because editing is locked or the sign-in expired.
function must(result, expectRows) {
  if (result.error) throw new Error(result.error.message || "The change was not saved");
  if (expectRows && (!result.data || result.data.length === 0)) {
    throw new Error("The change was not saved. Unlock editing and try again.");
  }
  return result.data;
}

/* ───────────────────────── small pieces ───────────────────────── */

const Icon = {
  search: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  ),
  unlock: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 017.5-2" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.9l6-.9z" />
    </svg>
  ),
  starOn: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.9l6-.9z" />
    </svg>
  ),
  mark: (
    <svg className="brand-mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <g fill="none" stroke="var(--on-ink)" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="14" cy="14" r="7" />
        <path d="M19.2 19.2L25 25" />
        <path d="M14 10.8v6.4M10.8 14h6.4" />
      </g>
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  list: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5M4 18.5l1.5 1.5L8 17.5M11.5 7H20M11.5 13H20M11.5 19H20" />
    </svg>
  ),
  camera: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
    </svg>
  ),
};

function Highlight({ text, q }) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i === -1) return text;
  return (<>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>);
}

function Tag({ row }) {
  return (
    <span className="tag">
      <i className={`dot z-${zoneOf(row.room)}`} />
      {row.room}
      {row.specific && <span className="tag-spec">{row.specific}</span>}
    </span>
  );
}

function HelpButton({ onClick, label = "What do front, back, left and right mean?" }) {
  return (
    <button type="button" className="qmark" aria-label={label} title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}>?</button>
  );
}

// A simple floor plan showing what Front / Back / Left / Right mean, as seen walking in through the door.
function RoomGuide({ highlight, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const side = (name) => `guide-side ${highlight === name ? "on" : ""}`;
  const text = (name) => `guide-label ${highlight === name ? "on" : ""}`;
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Room guide" onClick={(e) => e.stopPropagation()}>
        <h2>{highlight ? `Where “${highlight}” is` : "Front, back, left and right"}</h2>
        <p className="sheet-body">Directions are as you walk in through the door and face into the room.</p>
        <svg className="guide" viewBox="0 0 300 330" role="img"
          aria-label="Floor plan of a square room. The door is on the front wall. Back is the wall opposite the door. Left and right are the side walls as you walk in.">
          <rect className={side("Back")} x="40" y="20" width="220" height="50" />
          <rect className={side("Front")} x="40" y="190" width="220" height="50" />
          <rect className={side("Left")} x="40" y="70" width="62" height="120" />
          <rect className={side("Right")} x="198" y="70" width="62" height="120" />
          {/* walls, with a gap in the front wall for the door */}
          <path className="guide-wall" d="M122 240H40V20H260V240H178" />
          {/* the door, swung open, and its arc */}
          <path className="guide-door" d="M122 240V296" />
          <path className="guide-arc" d="M122 296A56 56 0 0 0 178 240" />
          <text className={text("Back")} x="150" y="51">Back</text>
          <text className={text("Front")} x="150" y="221">Front</text>
          <text className={text("Left")} x="72" y="136">Left</text>
          <text className={text("Right")} x="228" y="136">Right</text>
          {/* you, walking in */}
          <path className="guide-arrow" d="M150 288V258M141 267l9-10 9 10" />
          <text className="guide-note" x="150" y="318">Door: you walk in here</text>
        </svg>
        <div className="row-btns">
          <button className="btn" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}

function Lightbox({ photos, startIndex, onClose }) {
  const [idx, setIdx] = useState(startIndex || 0);
  const touchX = useRef(null);
  const many = photos.length > 1;
  const step = (d) => setIdx((i) => (i + d + photos.length) % photos.length);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="lightbox" onClick={onClose}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current === null || !many) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close photo">{Icon.close}</button>
      <img src={photos[idx]} alt="" onClick={(e) => e.stopPropagation()} />
      {many && (
        <div className="lightbox-nav" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => step(-1)} aria-label="Previous photo">{Icon.back}</button>
          <span>{idx + 1} of {photos.length}</span>
          <button onClick={() => step(1)} aria-label="Next photo">{Icon.chevron}</button>
        </div>
      )}
    </div>
  );
}

function ConfirmSheet({ ask, onAnswer }) {
  return (
    <div className="scrim" onClick={() => onAnswer(false)}>
      <div className="sheet" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{ask.title}</h2>
        {ask.body && <p className="sheet-body">{ask.body}</p>}
        <div className="row-btns">
          <button className="btn ghost" onClick={() => onAnswer(false)}>Cancel</button>
          <button className={`btn ${ask.danger ? "danger" : ""}`} autoFocus onClick={() => onAnswer(true)}>{ask.confirm}</button>
        </div>
      </div>
    </div>
  );
}

function RoomSheet({ rooms, picked, onChange, onClose }) {
  const [pull, setPull] = useState(0);        // how far the panel is being dragged down, in px
  const [closing, setClosing] = useState(false);
  const listRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page behind stays put while the panel scrolls
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []);

  const toggle = (room) => onChange(picked.includes(room) ? picked.filter((r) => r !== room) : [...picked, room]);

  // Swipe down to close. A swipe that starts inside the list only counts when the list is already at its top,
  // so scrolling the rooms never closes the panel by accident.
  function onTouchStart(e) {
    const list = listRef.current;
    const inList = list && list.contains(e.target);
    drag.current = { y: e.touches[0].clientY, ok: !inList || list.scrollTop <= 0 };
  }
  function onTouchMove(e) {
    const d = drag.current;
    if (!d || !d.ok) return;
    const dy = e.touches[0].clientY - d.y;
    if (dy < -6) { d.ok = false; setPull(0); return; } // moving up: this is a scroll, not a dismiss
    setPull(Math.max(0, dy));
  }
  function onTouchEnd() {
    drag.current = null;
    if (pull > 90) { setClosing(true); setTimeout(onClose, 160); }
    else setPull(0);
  }

  const style = closing
    ? { transform: "translateY(100%)", transition: "transform .16s ease-in" }
    : { transform: `translateY(${pull}px)`, transition: pull ? "none" : "transform .18s ease-out" };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet room-sheet" role="dialog" aria-modal="true" aria-label="Filter by room" style={style}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <div className="grabber" aria-hidden="true" />
        <div className="room-sheet-head">
          <h2>Filter by room</h2>
          {picked.length > 0 && <button className="link" onClick={() => onChange([])}>Clear all</button>}
        </div>
        <div className="rooms" ref={listRef}>
          {ZONES.map(([zone, label]) => {
            const inZone = rooms.filter((r) => zoneOf(r) === zone);
            if (inZone.length === 0) return null;
            const allOn = inZone.every((r) => picked.includes(r));
            const toggleZone = () =>
              onChange(allOn ? picked.filter((r) => !inZone.includes(r)) : uniq([...picked, ...inZone]));
            return (
              <section className="zone" key={zone}>
                <button className="zone-head" onClick={toggleZone} aria-pressed={allOn}
                  aria-label={`${allOn ? "Clear" : "Select"} all ${label} rooms`}>
                  <i className={`dot z-${zone}`} />
                  <span className="zone-name">{label}</span>
                  <span className="zone-all">{allOn ? "Clear" : "Select all"}</span>
                </button>
                {inZone.map((room) => {
                  const on = picked.includes(room);
                  return (
                    <button key={room} className={`room-row ${on ? "on" : ""}`} role="checkbox" aria-checked={on}
                      onClick={() => toggle(room)}>
                      <span className="check" aria-hidden="true">{on && Icon.check}</span>
                      {room}
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
        <div className="room-sheet-foot">
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function NameSheet({ title, body, initial, confirmLabel, onSave, onClose }) {
  const [name, setName] = useState(initial || "");
  return (
    <div className="scrim" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
        <h2>{title}</h2>
        {body && <p className="sheet-body">{body}</p>}
        <label className="label" htmlFor="bundle-name">Name</label>
        <input id="bundle-name" className="input" value={name} placeholder="e.g. Wound cleaning" autoComplete="off" autoFocus
          onChange={(e) => setName(e.target.value)} />
        <div className="row-btns">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={!name.trim()}>{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}

function SignInSheet({ onClose, onSignedIn }) {
  const [email, setEmail] = useState(() => store(EMAIL_KEY) || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !password) return setError("Enter your email and password.");
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) return setError("That email and password did not match.");
    store(EMAIL_KEY, email.trim());
    onSignedIn();
  }

  return (
    <div className="scrim" onClick={onClose}>
      <form className="sheet" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h2>Unlock editing</h2>
        <p className="sheet-body">Searching is open to everyone. Adding, editing and deleting items needs the editor sign-in.</p>
        <label className="label" htmlFor="si-email">Email</label>
        <input id="si-email" className="input" type="email" autoComplete="username" autoCapitalize="none"
          value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!email} />
        <label className="label" htmlFor="si-pass">Password</label>
        <input id="si-pass" className="input" type="password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={!!email} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="row-btns">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy}>{busy ? "Unlocking…" : "Unlock editing"}</button>
        </div>
      </form>
    </div>
  );
}

/* ───────────────────────── add / edit form ───────────────────────── */

function ItemForm({ mode, initial, entries, saving, onPickExisting, onSubmit, onCancel, onDelete, onOpenPhotos, onHelp }) {
  const [names, setNames] = useState(initial.names.length ? initial.names : [""]);
  const [notes, setNotes] = useState(initial.notes || "");
  const [kept, setKept] = useState(initial.photos || []);
  const [fresh, setFresh] = useState([]);
  const [locs, setLocs] = useState(initial.locations);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  const q = names[0].trim().toLowerCase();
  const existing = mode === "add" && q.length >= 2
    ? entries.filter((e) => e.names.some((n) => n.toLowerCase().includes(q))).slice(0, 5)
    : [];

  const setName = (i, v) => setNames(names.map((n, idx) => (idx === i ? v : n)));
  const setLoc = (key, patch) => setLocs(locs.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function addPhotos(e) {
    const files = Array.from(e.target.files || []);
    setFresh((prev) => [...prev, ...files.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
    e.target.value = "";
  }

  function submit(e) {
    e.preventDefault();
    const finalNames = cleanNames(names);
    if (finalNames.length === 0) return setError("Give the item at least one name.");
    if (locs.some((l) => l.room === OTHER && !l.custom.trim())) return setError("Type a name for the “Other” location.");
    const filled = locs.filter((l) => l.room);
    if (filled.length === 0) {
      return setError(mode === "edit"
        ? "Keep at least one location. To remove the item everywhere, use Delete item."
        : "Choose where the item is kept.");
    }
    setError("");
    onSubmit({ names: finalNames, notes: notes.trim(), kept, fresh, locations: filled });
  }

  return (
    <form className="form" onSubmit={submit}>
      <h1 className="page-title">{mode === "add" ? "Add an item" : "Edit item"}</h1>

      <section className="field">
        <span className="label">Names</span>
        <p className="help">Every name staff might call it. Searching any of them finds the item.</p>
        {names.map((name, i) => (
          <div className="inline" key={i}>
            <input className="input" value={name} aria-label={`Name ${i + 1}`}
              placeholder={i === 0 ? "e.g. Butterfly needle" : "Another name"}
              autoComplete="off" autoFocus={mode === "add" && i === 0 && !name}
              onChange={(e) => setName(i, e.target.value)} />
            {names.length > 1 && (
              <button type="button" className="icon-btn" aria-label={`Remove name ${i + 1}`}
                onClick={() => setNames(names.filter((_, idx) => idx !== i))}>{Icon.close}</button>
            )}
          </div>
        ))}
        {existing.length > 0 && (
          <div className="existing">
            <p className="help">Already in the list. Tap one to add a location to it instead of making a duplicate.</p>
            {existing.map((entry) => (
              <button type="button" className="existing-row" key={entry.rows[0].id} onClick={() => onPickExisting(entry)}>
                <span className="existing-name"><Highlight text={bestName(entry, q)} q={q} /></span>
                <span className="existing-where">{entry.rows.map((r) => r.room).join(", ")}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="btn dashed" onClick={() => setNames([...names, ""])}>Add another name</button>
      </section>

      <section className="field">
        <span className="label with-help">{locs.length > 1 ? "Locations" : "Location"} <HelpButton onClick={() => onHelp(null)} /></span>
        {locs.map((loc, i) => (
          <div className="loc-edit" key={loc.key}>
            <i className={`loc-bar z-${zoneOf(loc.room === OTHER ? loc.custom : loc.room)}`} />
            <div className="loc-fields">
              <select className="input" value={loc.room} aria-label={`Location ${i + 1}`}
                onChange={(e) => setLoc(loc.key, { room: e.target.value })}>
                <option value="">Choose a location…</option>
                {ROOMS.map((r) => <option key={r} value={r}>{r}</option>)}
                <option value={OTHER}>Other (type it in)</option>
              </select>
              {loc.room === OTHER && (
                <input className="input" placeholder="Location name" value={loc.custom} aria-label="Other location name"
                  onChange={(e) => setLoc(loc.key, { custom: e.target.value })} />
              )}
              <div className="inline">
                <select className="input" value={loc.specific} aria-label="More specific"
                  onChange={(e) => setLoc(loc.key, { specific: e.target.value, door: "" })}>
                  <option value="">More specific (optional)</option>
                  {uniq([...SPECIFICS, loc.specific].filter(Boolean)).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                {loc.specific === "Pyxis" && (
                  <select className="input" value={loc.door} aria-label="Pyxis door"
                    onChange={(e) => setLoc(loc.key, { door: e.target.value })}>
                    <option value="">Door…</option>
                    {DOORS.map((d) => <option key={d} value={d}>Door {d}</option>)}
                  </select>
                )}
              </div>
            </div>
            {locs.length > 1 && (
              <button type="button" className="icon-btn" aria-label={`Remove location ${i + 1}`}
                onClick={() => setLocs(locs.filter((l) => l.key !== loc.key))}>{Icon.close}</button>
            )}
          </div>
        ))}
        <button type="button" className="btn dashed" onClick={() => setLocs([...locs, blankLoc()])}>Add another location</button>
      </section>

      <section className="field">
        <label className="label" htmlFor="f-notes">Notes <span className="optional">optional</span></label>
        <textarea id="f-notes" className="input" rows={3} value={notes}
          placeholder="e.g. Used to stop bleeding via compression"
          onChange={(e) => setNotes(e.target.value)} />
      </section>

      <section className="field">
        <span className="label">Photos <span className="optional">optional</span></span>
        {(kept.length > 0 || fresh.length > 0) && (
          <div className="photo-grid">
            {kept.map((url, i) => (
              <div className="photo-cell" key={url}>
                <img src={url} alt="" onClick={() => onOpenPhotos(kept, i)} />
                <button type="button" className="photo-x" aria-label="Remove photo"
                  onClick={() => setKept(kept.filter((u) => u !== url))}>{Icon.close}</button>
              </div>
            ))}
            {fresh.map((p, i) => (
              <div className="photo-cell" key={p.preview}>
                <img src={p.preview} alt="" />
                <button type="button" className="photo-x" aria-label="Remove photo"
                  onClick={() => setFresh(fresh.filter((_, idx) => idx !== i))}>{Icon.close}</button>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="btn dashed" onClick={() => fileRef.current.click()}>
          {Icon.camera} Take or choose photos
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={addPhotos} />
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Saving…" : mode === "add" ? "Add item" : "Save changes"}
        </button>
      </div>

      {mode === "edit" && (
        <button type="button" className="btn danger-ghost wide" onClick={onDelete} disabled={saving}>Delete item</button>
      )}
    </form>
  );
}

/* ───────────────────────── app ───────────────────────── */

export default function App() {
  const [rows, setRows] = useState(() => {
    try { return JSON.parse(store(CACHE_KEY) || "[]"); } catch { return []; }
  });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [session, setSession] = useState(null);
  // Favorites are kept on this phone or computer only, so everyone has their own.
  const [favs, setFavs] = useState(() => {
    try { return JSON.parse(store(FAVS_KEY) || "[]"); } catch { return []; }
  });

  const [screen, setScreen] = useState("search"); // search | detail | edit | add | favorites | list | bundle
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [favQuery, setFavQuery] = useState("");
  // The new bundle being built, and the saved bundles, are kept on this phone or computer only, like favorites.
  const [draft, setDraft] = useState(() => {
    try {
      const saved = JSON.parse(store(RUN_KEY) || "null");
      if (saved && Array.isArray(saved.items)) {
        return saved.active ? { items: [], rooms: [] } : { items: saved.items, rooms: saved.rooms || [] };
      }
      const old = JSON.parse(store(LIST_KEY) || "[]");
      return { items: Array.isArray(old) ? old : [], rooms: [] };
    } catch { return { items: [], rooms: [] }; }
  });
  // An opened saved bundle gets its own working copy, so opening one never touches the new bundle being built.
  const [openB, setOpenB] = useState(null); // { id, items, rooms }
  const [bundles, setBundles] = useState(() => {
    try { const b = JSON.parse(store(BUNDLES_KEY) || "[]"); return Array.isArray(b) ? b : []; } catch { return []; }
  });
  const [bundleFilterOpen, setBundleFilterOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [guide, setGuide] = useState(null); // { side } while the room guide is open
  const listSearchRef = useRef(null);
  const [roomFilter, setRoomFilter] = useState([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailIds, setDetailIds] = useState([]);
  const [formSeed, setFormSeed] = useState(null); // starting values for the add / edit form
  const [formKey, setFormKey] = useState(0);

  const [signInOpen, setSignInOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [ask, setAsk] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const searchRef = useRef(null);
  const screenRef = useRef("search");
  const stack = useRef(["search"]);   // screens opened on top of each other
  const scrolls = useRef([0]);        // where each one was scrolled to
  const nextScroll = useRef(0);
  const askResolve = useRef(null);
  const toastTimer = useRef(null);

  const canEdit = !!session;

  /* data + session */
  async function fetchRows() {
    const { data, error } = await supabase.from("items").select("*").order("created_at");
    if (error) { setLoadError(true); setLoaded(true); return null; }
    setRows(data || []);
    setLoadError(false);
    setLoaded(true);
    store(CACHE_KEY, JSON.stringify(data || []));
    return data || [];
  }

  useEffect(() => {
    document.title = "Item Finder – Stamford ED";
    // After a refresh the app restarts on the search screen, so mark this history entry as the start.
    window.history.replaceState({ depth: 0 }, "");
    fetchRows();
    supabase.auth.getSession().then(({ data }) => setSession(data ? data.session : null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    // Pick up coworkers' changes whenever the app comes back to the front.
    const onVisible = () => { if (document.visibilityState === "visible") fetchRows(); };
    document.addEventListener("visibilitychange", onVisible);
    // The phone's back gesture returns to the results instead of leaving the app.
    const onPop = (e) => {
      const depth = Math.min((e.state && e.state.depth) || 0, stack.current.length - 1);
      stack.current.length = depth + 1;
      nextScroll.current = scrolls.current[depth] || 0;
      setScreen(stack.current[depth]);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      sub.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useEffect(() => {
    screenRef.current = screen;
    window.scrollTo(0, nextScroll.current);
  }, [screen]);

  // open a screen on top of the current one
  function push(next) {
    const depth = stack.current.length - 1;
    scrolls.current[depth] = window.scrollY;
    stack.current.push(next);
    window.history.pushState({ depth: depth + 1 }, "");
    nextScroll.current = 0;
    setScreen(next);
  }
  // switch the current screen in place (item page <-> its edit form)
  function swap(next) {
    stack.current[stack.current.length - 1] = next;
    nextScroll.current = 0;
    setScreen(next);
  }
  // go back one screen; the phone's back gesture does the same thing
  function back() {
    if (stack.current.length > 1) window.history.back();
  }

  function notify(msg, type = "ok") {
    clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), type === "error" ? 5000 : 2500);
  }

  function confirm(opts) {
    return new Promise((resolve) => { askResolve.current = resolve; setAsk(opts); });
  }
  function answer(value) {
    setAsk(null);
    if (askResolve.current) askResolve.current(value);
    askResolve.current = null;
  }

  /* derived lists */
  const entries = useMemo(() => buildEntries(rows), [rows]);

  const rooms = useMemo(() => {
    const custom = uniq(rows.map((r) => r.room).filter((r) => r && !ROOMS.includes(r))).sort();
    return [...ROOMS, ...custom];
  }, [rows]);

  const q = query.trim().toLowerCase();
  const inRooms = (entry) => roomFilter.length === 0 || entry.rows.some((r) => roomFilter.includes(r.room));
  const filteredCount = useMemo(() => entries.filter(inRooms).length, [entries, roomFilter]);

  const results = useMemo(() => {
    if (!q && !showAll && roomFilter.length === 0) return [];
    const pool = entries.filter(inRooms);
    if (!q) return pool.sort((a, b) => a.names[0].localeCompare(b.names[0]));
    return pool
      .map((entry) => ({ entry, score: matchScore(entry, q) }))
      .filter((x) => x.score !== Infinity)
      .sort((a, b) => a.score - b.score || a.entry.names[0].localeCompare(b.entry.names[0]))
      .map((x) => x.entry);
  }, [entries, q, showAll, roomFilter]);

  const detail = useMemo(
    () => entries.find((e) => e.rows.some((r) => detailIds.includes(r.id))) || null,
    [entries, detailIds]
  );

  const isFav = (entry) => entry.rows.some((r) => favs.includes(r.id));
  function toggleFav(entry) {
    const ids = entry.rows.map((r) => r.id);
    const next = isFav(entry) ? favs.filter((id) => !ids.includes(id)) : [...favs, ...ids];
    setFavs(next);
    store(FAVS_KEY, JSON.stringify(next));
  }
  const favorites = useMemo(
    () => entries.filter(isFav).sort((a, b) => a.names[0].localeCompare(b.names[0])),
    [entries, favs]
  );
  const fq = favQuery.trim().toLowerCase();
  const favResults = useMemo(() => {
    if (!fq) return favorites;
    return favorites
      .map((entry) => ({ entry, score: matchScore(entry, fq) }))
      .filter((x) => x.score !== Infinity)
      .sort((a, b) => a.score - b.score || a.entry.names[0].localeCompare(b.entry.names[0]))
      .map((x) => x.entry);
  }, [favorites, fq]);

  /* bundle search */
  const inBundle = screen === "bundle" && !!openB;
  const run = inBundle ? openB : draft;
  const saveRun = (next) => {
    if (inBundle) { setOpenB({ ...openB, items: next.items, rooms: next.rooms }); return; }
    const d = { items: next.items, rooms: next.rooms };
    setDraft(d);
    store(RUN_KEY, JSON.stringify(d));
  };
  const saveBundles = (next) => { setBundles(next); store(BUNDLES_KEY, JSON.stringify(next)); };
  const list = run.items;
  const saveList = (items) => saveRun({ ...run, items });
  const listItems = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const raw of list) {
      const entry = entries.find((e) => e.rows.some((r) => raw.ids.includes(r.id)));
      if (!entry || seen.has(entry)) continue;
      seen.add(entry);
      out.push({ raw, entry, done: !!raw.done, skip: [] });
    }
    return out;
  }, [list, entries]);
  const onList = (entry) => listItems.some((x) => x.entry === entry);
  const addToList = (entry) => {
    if (!onList(entry)) saveList([...list, { ids: entry.rows.map((r) => r.id), done: false, skip: [] }]);
  };
  const removeFromList = (entry) => saveList(list.filter((raw) => !entry.rows.some((r) => raw.ids.includes(r.id))));
  const patchListItem = (item, patch) => saveList(list.map((raw) => (raw === item.raw ? { ...raw, ...patch } : raw)));

  const plan = useMemo(() => planStops(listItems, rooms, run.rooms), [listItems, rooms, run.rooms]);
  const lq = listQuery.trim().toLowerCase();
  const listMatches = useMemo(() => {
    if (!lq) return [];
    return entries
      .map((entry) => ({ entry, score: matchScore(entry, lq) }))
      .filter((x) => x.score !== Infinity)
      .sort((a, b) => a.score - b.score || a.entry.names[0].localeCompare(b.entry.names[0]))
      .slice(0, 8)
      .map((x) => x.entry);
  }, [entries, lq]);


  // saved bundles
  const entryFor = (ids) => entries.find((e) => e.rows.some((r) => ids.includes(r.id)));
  const signature = (idLists, roomList) =>
    uniq(idLists.map(entryFor).filter(Boolean).map((e) => e.rows[0].id)).sort().join(",") + "|" + [...roomList].sort().join(",");
  const activeBundle = inBundle ? bundles.find((b) => b.id === openB.id) || null : null;
  const dirty = !!activeBundle && signature(activeBundle.items, activeBundle.rooms) !== signature(list.map((x) => x.ids), run.rooms);

  // Saving always ends on the Bundle search screen with nothing left on it but the saved bundles.
  function saveBundle(name) {
    const items = listItems.map((x) => x.entry.rows.map((r) => r.id));
    const existing = bundles.find((b) => b.name.toLowerCase() === name.toLowerCase());
    const id = existing ? existing.id : `b${Date.now()}`;
    const saved = { id, name, items, rooms: run.rooms };
    saveBundles(existing ? bundles.map((b) => (b.id === id ? saved : b)) : [...bundles, saved]);
    setNaming(false);
    setListQuery("");
    if (inBundle) { setOpenB(null); back(); }
    else saveRun({ items: [], rooms: [] });
    notify(existing ? `Updated “${name}”` : `Saved “${name}”`);
  }

  function openBundle(bundle) {
    setOpenB({ id: bundle.id, items: bundle.items.map((ids) => ({ ids, done: false, skip: [] })), rooms: bundle.rooms || [] });
    setListQuery("");
    push("bundle");
  }

  async function deleteBundle(bundle) {
    const ok = await confirm({ title: `Delete the bundle “${bundle.name}”?`, body: "This cannot be undone.", confirm: "Delete bundle", danger: true });
    if (!ok) return;
    saveBundles(bundles.filter((b) => b.id !== bundle.id));
  }

  async function clearList() {
    const ok = await confirm({ title: "Clear these items?", body: "This removes every item from the new bundle.", confirm: "Clear items", danger: true });
    if (ok) saveRun({ items: [], rooms: [] });
  }

  const shownRows = (entry) => (roomFilter.length === 0 ? entry.rows : entry.rows.filter((r) => roomFilter.includes(r.room)));

  /* navigation */
  function openDetail(entry) {
    setDetailIds(entry.rows.map((r) => r.id));
    push("detail");
  }

  function startAdd(name = "") {
    setFormSeed({ names: [name], notes: "", photos: [], locations: [blankLoc(store(ROOM_KEY) || "")] });
    setFormKey((k) => k + 1);
    push("add");
  }

  function startEdit(entry, withBlankLocation = false) {
    setDetailIds(entry.rows.map((r) => r.id));
    setFormSeed({
      names: entry.names,
      notes: entry.notes,
      photos: entry.photos,
      locations: [...entry.rows.map(rowToLoc), ...(withBlankLocation ? [blankLoc()] : [])],
    });
    setFormKey((k) => k + 1);
    swap("edit");
  }

  /* saving */
  async function saveItem(draft, editing) {
    // Adding a name that already exists means "this item is also kept here", so merge instead of duplicating.
    const lower = draft.names.map((n) => n.toLowerCase());
    const target = editing || entries.find((e) => e.names.some((n) => lower.includes(n.toLowerCase()))) || null;

    const wanted = draft.locations.map((l) => ({ id: l.id, ...locToRow(l) }));
    const removed = editing ? editing.rows.filter((r) => !wanted.some((w) => w.id === r.id)) : [];

    if (removed.length > 0) {
      const ok = await confirm({
        title: `Remove from ${removed.length === 1 ? "this location" : "these locations"}?`,
        body: removed.map(locationLabel).join(", "),
        confirm: "Remove",
        danger: true,
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      let names = draft.names;
      let notes = draft.notes;
      let photos = [...draft.kept];
      if (!editing && target) {
        names = cleanNames([...target.names, ...draft.names]);
        notes = notes || target.notes;
        photos = uniq([...target.photos, ...photos]);
      }
      for (const p of draft.fresh) photos.push(await uploadPhoto(p.file));

      const shared = { names, notes: notes || null, photo_urls: photos, photo_url: photos[0] || null };
      const ids = [];

      if (editing) {
        for (const w of wanted.filter((x) => x.id)) {
          must(await supabase.from("items").update({ ...shared, room: w.room, specific: w.specific }).eq("id", w.id).select("id"), true);
          ids.push(w.id);
        }
      } else if (target) {
        const targetIds = target.rows.map((r) => r.id);
        must(await supabase.from("items").update(shared).in("id", targetIds).select("id"), true);
        ids.push(...targetIds);
      }

      const taken = new Set((target ? target.rows : []).filter((r) => !removed.includes(r)).map(locationLabel));
      const fresh = [];
      for (const w of wanted.filter((x) => !x.id)) {
        const label = locationLabel(w);
        if (taken.has(label)) continue;
        taken.add(label);
        fresh.push({ ...shared, room: w.room, specific: w.specific });
      }
      if (fresh.length > 0) {
        const inserted = must(await supabase.from("items").insert(fresh).select("id"), true);
        ids.push(...inserted.map((r) => r.id));
      }

      if (removed.length > 0) {
        must(await supabase.from("items").delete().in("id", removed.map((r) => r.id)).select("id"), true);
      }

      const lastNew = wanted.filter((x) => !x.id).pop();
      if (lastNew && ROOMS.includes(lastNew.room)) store(ROOM_KEY, lastNew.room);

      const latest = await fetchRows();
      if (editing && latest) {
        const dropped = editing.photos.filter((u) => !photos.includes(u) && !latest.some((r) => photosOf(r).includes(u)));
        removeStoredPhotos(dropped);
      }

      if (editing && isFav(editing)) {
        const next = uniq([...favs, ...ids]);
        setFavs(next);
        store(FAVS_KEY, JSON.stringify(next));
      }
      setDetailIds(ids);
      if (editing) { notify("Saved"); swap("detail"); }
      else {
        notify(target ? `Added a location to “${target.names[0]}”` : `Added “${names[0]}”`);
        back();
      }
    } catch (err) {
      notify(err.message || "The change was not saved", "error");
      fetchRows();
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entry) {
    const n = entry.rows.length;
    const ok = await confirm({
      title: `Delete “${entry.names[0]}”?`,
      body: n > 1 ? `This removes it from all ${n} locations. It cannot be undone.` : "This cannot be undone.",
      confirm: "Delete item",
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      must(await supabase.from("items").delete().in("id", entry.rows.map((r) => r.id)).select("id"), true);
      const latest = await fetchRows();
      if (latest) removeStoredPhotos(entry.photos.filter((u) => !latest.some((r) => photosOf(r).includes(u))));
      notify(`Deleted “${entry.names[0]}”`);
      back();
    } catch (err) {
      notify(err.message || "The item was not deleted", "error");
    } finally {
      setSaving(false);
    }
  }

  async function lock() {
    await supabase.auth.signOut();
    setSession(null);
    if (screenRef.current === "edit" || screenRef.current === "add") back();
    notify("Editing locked");
  }

  // One tag per picked room; a fully picked zone collapses into a single "All Peds rooms" tag.
  const tagsFor = (filter) => ZONES.flatMap(([zone, label]) => {
    const inZone = rooms.filter((r) => zoneOf(r) === zone);
    const on = inZone.filter((r) => filter.includes(r));
    if (inZone.length > 1 && on.length === inZone.length) {
      return [{ zone, label: zone === "other" ? "All cabinets and other" : `All ${label} rooms`, rooms: inZone }];
    }
    return on.map((room) => ({ zone, label: room, rooms: [room] }));
  });
  const pickedTags = tagsFor(roomFilter);
  const bundleTags = tagsFor(run.rooms);
  const setBundleRooms = (next) => saveRun({ ...run, rooms: next });

  const clearSearch = () => { setQuery(""); searchRef.current && searchRef.current.focus(); };

  function renderRow(entry, term, rowsShown) {
    const main = bestName(entry, term);
    const others = entry.names.filter((n) => n !== main);
    const fav = isFav(entry);
    return (
      <li key={entry.rows[0].id} className="result">
        <button className="result-main" onClick={() => openDetail(entry)}>
          {entry.photos.length > 0 ? (
            <span className="thumb">
              <img src={entry.photos[0]} alt="" loading="lazy" />
              {entry.photos.length > 1 && <span className="thumb-count">{entry.photos.length}</span>}
            </span>
          ) : (
            <span className="thumb blank" aria-hidden="true">{main.charAt(0).toUpperCase()}</span>
          )}
          <span className="result-text">
            <span className="result-name"><Highlight text={main} q={term} /></span>
            {others.length > 0 && (
              <span className="result-also">
                {others.map((n, i) => (<span key={n}>{i > 0 && ", "}<Highlight text={n} q={term} /></span>))}
              </span>
            )}
            <span className="tags">{rowsShown.map((r) => <Tag key={r.id} row={r} />)}</span>
          </span>
        </button>
        <button className={`star ${fav ? "on" : ""}`} aria-pressed={fav}
          aria-label={fav ? `Remove ${main} from favorites` : `Add ${main} to favorites`}
          onClick={() => toggleFav(entry)}>
          {fav ? Icon.starOn : Icon.star}
        </button>
      </li>
    );
  }

  /* ── render ── */
  const filtered = roomFilter.length > 0;
  const countText = `${filteredCount} item${filteredCount === 1 ? "" : "s"}${filtered ? " in the selected rooms" : ""}`;

  return (
    <div className="app">
      <style>{CSS}</style>

      <header className="top">
        <div className="bar">
          {screen === "search" ? (
            <div className="brand">
              {Icon.mark}
              <span className="brand-name">Item Finder</span>
              <span className="brand-site">Stamford ED</span>
            </div>
          ) : (
            <button className="back" onClick={() => (screen === "edit" ? swap("detail") : back())}>
              {Icon.back} {screen === "edit" ? "Cancel" : "Back"}
            </button>
          )}
          <div className="bar-actions">
            {canEdit && screen === "search" && (
              <button className="btn small" onClick={() => startAdd()}>Add item</button>
            )}
            <button className={`icon-btn ${canEdit ? "on" : ""}`}
              aria-label={canEdit ? "Lock editing" : "Unlock editing"}
              title={canEdit ? "Lock editing" : "Unlock editing"}
              onClick={() => (canEdit ? lock() : setSignInOpen(true))}>
              {canEdit ? Icon.unlock : Icon.lock}
            </button>
          </div>
        </div>

        {screen === "favorites" && favorites.length > 0 && (
          <div className="searchbox">
            <span className="searchbox-icon">{Icon.search}</span>
            <input className="input search-input" type="search" inputMode="search" enterKeyHint="search"
              placeholder="Search your favorites" aria-label="Search favorites" autoComplete="off" autoCorrect="off"
              value={favQuery} onChange={(e) => setFavQuery(e.target.value)} />
            {favQuery && (
              <button className="searchbox-clear" onClick={() => setFavQuery("")} aria-label="Clear search">{Icon.close}</button>
            )}
          </div>
        )}

        {(screen === "list" || screen === "bundle") && (
          <div className="searchbox">
            <span className="searchbox-icon">{Icon.search}</span>
            <input ref={listSearchRef} className="input search-input" type="search" inputMode="search" enterKeyHint="search"
              placeholder="Add an item" aria-label="Add an item to the list" autoComplete="off" autoCorrect="off"
              value={listQuery} onChange={(e) => setListQuery(e.target.value)} />
            {listQuery && (
              <button className="searchbox-clear" onClick={() => setListQuery("")} aria-label="Clear search">{Icon.close}</button>
            )}
          </div>
        )}

        {screen === "search" && (
          <div className="searchbox">
            <span className="searchbox-icon">{Icon.search}</span>
            <input ref={searchRef} className="input search-input" type="search" inputMode="search" enterKeyHint="search"
              placeholder="Search" aria-label="Search items" autoComplete="off" autoCorrect="off"
              value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && (
              <button className="searchbox-clear" onClick={clearSearch} aria-label="Clear search">{Icon.close}</button>
            )}
          </div>
        )}
      </header>

      <main className="main">
        {/* ── search ── */}
        {screen === "search" && (
          <>
            <div className="filterbar">
              <button className={`chip ${filtered ? "active" : ""}`} aria-haspopup="dialog" onClick={() => setFilterOpen(true)}>
                {filtered ? `Rooms (${roomFilter.length})` : "Filter by room"}
              </button>
              <button className="chip" onClick={() => { setFavQuery(""); push("favorites"); }}>
                <span className={`chip-star ${favorites.length > 0 ? "on" : ""}`}>{favorites.length > 0 ? Icon.starOn : Icon.star}</span>
                Favorites{favorites.length > 0 ? ` (${favorites.length})` : ""}
              </button>
            </div>
            {filtered && (
              <div className="picked-rooms">
                {pickedTags.map((tag) => (
                  <button key={tag.label} className="picked-room" aria-label={`Remove ${tag.label} from the filter`}
                    onClick={() => setRoomFilter(roomFilter.filter((r) => !tag.rooms.includes(r)))}>
                    <i className={`dot z-${tag.zone}`} />{tag.label}<span className="picked-x">{Icon.close}</span>
                  </button>
                ))}
                {pickedTags.length > 1 && <button className="link" onClick={() => setRoomFilter([])}>Clear all</button>}
              </div>
            )}

            {loadError && (
              <p className="banner" role="alert">
                Could not reach the item list{rows.length > 0 ? ", so this may be out of date" : ""}.{" "}
                <button className="link" onClick={fetchRows}>Try again</button>
              </p>
            )}

            {!q && (
              <div className={`landing ${filtered ? "compact" : ""}`}>
                <p className="muted">
                  {!loaded && rows.length === 0 ? "Loading items…"
                    : filtered ? (filteredCount === 0 ? "Nothing is stored in the selected rooms yet." : countText)
                    : showAll ? `Showing ${countText}` : `${countText}. Type a name to search.`}
                </p>
                {!filtered && (loaded || rows.length > 0) && filteredCount > 0 && (
                  <button className="btn ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? "Hide all" : "Show all"}</button>
                )}
              </div>
            )}

            {q && results.length === 0 && (
              <div className="empty">
                <p>Nothing matches “{query.trim()}”{filtered ? " in the selected rooms" : ""}.</p>
                {filtered && <button className="btn ghost" onClick={() => setRoomFilter([])}>Search every room</button>}
                {canEdit && <button className="btn" onClick={() => startAdd(query.trim())}>Add “{query.trim()}”</button>}
              </div>
            )}

            <ul className="results">
              {results.map((entry) => renderRow(entry, q, shownRows(entry)))}
            </ul>
          </>
        )}

        {/* ── favorites ── */}
        {screen === "favorites" && (
          <>
            <h1 className="page-title">Favorites</h1>
            {favorites.length === 0 && (
              <div className="empty">
                <p>No favorites yet.</p>
                <p className="muted">Tap the star on any item to keep it here. Favorites are saved on this device only.</p>
              </div>
            )}
            {favorites.length > 0 && favResults.length === 0 && (
              <div className="empty"><p>None of your favorites match “{favQuery.trim()}”.</p></div>
            )}
            <ul className="results">
              {favResults.map((entry) => renderRow(entry, fq, entry.rows))}
            </ul>
          </>
        )}

        {/* ── supply list ── */}
        {(screen === "list" || screen === "bundle") && lq && (
          <>
            {listMatches.length === 0 && <div className="empty"><p>Nothing matches “{listQuery.trim()}”.</p></div>}
            <ul className="results">
              {listMatches.map((entry) => {
                const main = bestName(entry, lq);
                const added = onList(entry);
                return (
                  <li key={entry.rows[0].id} className="result">
                    <button className="result-main pad-img" disabled={added}
                      onClick={() => { addToList(entry); setListQuery(""); listSearchRef.current && listSearchRef.current.focus(); }}>
                      {entry.photos.length > 0 ? (
                        <span className="thumb"><img src={entry.photos[0]} alt="" loading="lazy" /></span>
                      ) : (
                        <span className="thumb blank" aria-hidden="true">{main.charAt(0).toUpperCase()}</span>
                      )}
                      <span className="result-text">
                        <span className="result-name"><Highlight text={main} q={lq} /></span>
                        {entry.names.length > 1 && <span className="result-also">{entry.names.filter((n) => n !== main).join(", ")}</span>}
                      </span>
                      <span className={`add-pill ${added ? "done" : ""}`}>{added ? "On list" : "Add"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {(screen === "list" || (screen === "bundle" && inBundle)) && !lq && (
          <>
            {inBundle ? (
              <>
                <h1 className="page-title">{activeBundle ? activeBundle.name : "Bundle"}</h1>
                <p className="aka">Saved bundle{dirty ? ", with unsaved changes" : ""}</p>
              </>
            ) : (
              <h1 className="page-title">Bundle search</h1>
            )}
            {listItems.length === 0 && (
              <div className={`empty ${inBundle || bundles.length === 0 ? "" : "compact"}`}>
                {inBundle ? <p>This bundle has no items. Search above to add some.</p> : (
                  <>
                    <p>Start a new bundle</p>
                    <p className="muted">Search above and tap each item you need. The app works out the fewest rooms to visit.</p>
                  </>
                )}
              </div>
            )}
            {listItems.length > 0 && (
              <div className="filterbar bundle-filter">
                <button className={`chip ${run.rooms.length > 0 ? "active" : ""}`} aria-haspopup="dialog" onClick={() => setBundleFilterOpen(true)}>
                  {run.rooms.length > 0 ? `Rooms (${run.rooms.length})` : "Filter by room"}
                </button>
              </div>
            )}
            {listItems.length > 0 && run.rooms.length > 0 && (
              <div className="picked-rooms">
                {bundleTags.map((tag) => (
                  <button key={tag.label} className="picked-room" aria-label={`Remove ${tag.label} from the filter`}
                    onClick={() => setBundleRooms(run.rooms.filter((r) => !tag.rooms.includes(r)))}>
                    <i className={`dot z-${tag.zone}`} />{tag.label}<span className="picked-x">{Icon.close}</span>
                  </button>
                ))}
                {bundleTags.length > 1 && <button className="link" onClick={() => setBundleRooms([])}>Clear all</button>}
              </div>
            )}

            {plan.stops.map((stop, i) => (
              <section className="stop" key={stop.room}>
                <header className="stop-head">
                  <i className={`loc-bar z-${zoneOf(stop.room)}`} />
                  <span className="stop-num">{i + 1}</span>
                  <h2 className="stop-room">{stop.room}</h2>
                </header>
                <ul>
                  {stop.items.map(({ item, here, elsewhere }) => {
                    const name = item.entry.names[0];
                    const spots = uniq(here.map((r) => r.specific).filter(Boolean));
                    return (
                      <li className="run-item" key={item.entry.rows[0].id}>
                        <button className={`check big ${item.done ? "on" : ""}`} role="checkbox" aria-checked={item.done}
                          aria-label={`${name} collected`} onClick={() => patchListItem(item, { done: !item.done })}>
                          {item.done && Icon.check}
                        </button>
                        <div className="run-text">
                          <button className="run-name" onClick={() => openDetail(item.entry)}>{name}</button>
                          {spots.length > 0 && <span className="run-spot">{spots.join(", ")}</span>}
                          {elsewhere.length > 0 && (
                            <span className="run-alt">Also in {uniq(elsewhere.map(locationLabel)).join(", ")}</span>
                          )}
                          {elsewhere.length === 0 && <span className="run-alt">Only kept here</span>}
                        </div>
                        <button className="run-x" aria-label={`Remove ${name} from the list`} onClick={() => removeFromList(item.entry)}>{Icon.close}</button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

            {plan.outside.length > 0 && (
              <section className="stop">
                <header className="stop-head">
                  <i className="loc-bar z-other" />
                  <h2 className="stop-room pad">Not in the selected rooms</h2>
                </header>
                <ul>
                  {plan.outside.map(({ item, rows: kept }) => (
                    <li className="run-item" key={item.entry.rows[0].id}>
                      <div className="run-text">
                        <button className="run-name" onClick={() => openDetail(item.entry)}>{item.entry.names[0]}</button>
                        <span className="run-alt">Kept in {uniq(kept.map(locationLabel)).join(", ")}</span>
                      </div>
                      <button className="run-x" aria-label={`Remove ${item.entry.names[0]} from the list`} onClick={() => removeFromList(item.entry)}>{Icon.close}</button>
                    </li>
                  ))}
                </ul>
                <div className="stop-foot"><button className="link" onClick={() => setBundleRooms([])}>Search every room</button></div>
              </section>
            )}



            {!inBundle && listItems.length > 0 && (
              <div className="bundle-actions">
                <button className="btn wide" onClick={() => setNaming(true)}>Save as bundle</button>
                <button className="btn danger-ghost wide" onClick={clearList}>Clear items</button>
              </div>
            )}
            {inBundle && dirty && (
              <div className="bundle-actions">
                {activeBundle && listItems.length > 0 && (
                  <button className="btn wide" onClick={() => saveBundle(activeBundle.name)}>Save changes to “{activeBundle.name}”</button>
                )}
                {listItems.length > 0 && <button className="btn ghost wide" onClick={() => setNaming(true)}>Save as a new bundle</button>}
              </div>
            )}

            {!inBundle && bundles.length > 0 && (
              <>
                <h2 className="section">Saved bundles</h2>
                <ul className="results bundles">
                  {bundles.map((b) => {
                    const count = uniq(b.items.map(entryFor).filter(Boolean)).length;
                    return (
                      <li key={b.id} className="result">
                        <button className="result-main pad" onClick={() => openBundle(b)}>
                          <span className="result-text">
                            <span className="result-name">{b.name}</span>
                            <span className="result-also">
                              {count} item{count === 1 ? "" : "s"}, {(b.rooms || []).length > 0 ? `filtered to ${b.rooms.length} room${b.rooms.length === 1 ? "" : "s"}` : "all rooms"}
                            </span>
                          </span>
                        </button>
                        <button className="star" aria-label={`Delete the bundle ${b.name}`} onClick={() => deleteBundle(b)}>{Icon.close}</button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}

        {/* ── detail ── */}
        {screen === "detail" && !detail && (
          <div className="empty"><p>This item is no longer in the list.</p></div>
        )}
        {screen === "detail" && detail && (
          <article className="detail">
            <div className="title-row">
              <h1 className="page-title">{detail.names[0]}</h1>
              <button className={`star boxed ${isFav(detail) ? "on" : ""}`} aria-pressed={isFav(detail)}
                aria-label={isFav(detail) ? "Remove from favorites" : "Add to favorites"}
                onClick={() => toggleFav(detail)}>
                {isFav(detail) ? Icon.starOn : Icon.star}
              </button>
            </div>
            {detail.names.length > 1 && <p className="aka">Also called {detail.names.slice(1).join(", ")}</p>}

            <h2 className="section">Where to find it</h2>
            <ul className="plates">
              {detail.rows.map((r) => (
                <li className="plate" key={r.id}>
                  <i className={`loc-bar z-${zoneOf(r.room)}`} />
                  <span className="plate-room">{r.room}</span>
                  {r.specific && <span className="plate-spec">{r.specific}</span>}
                  {SIDES.includes(r.specific) && (
                    <HelpButton label={`Where is “${r.specific}” in a room?`} onClick={() => setGuide({ side: r.specific })} />
                  )}
                </li>
              ))}
            </ul>

            {detail.notes && (
              <>
                <h2 className="section">Notes</h2>
                <p className="notes">{detail.notes}</p>
              </>
            )}

            {detail.photos.length > 0 && (
              <>
                <h2 className="section">{detail.photos.length > 1 ? "Photos" : "Photo"}</h2>
                <button className="hero-photo" onClick={() => setLightbox({ photos: detail.photos, index: 0 })} aria-label="Open photo">
                  <img src={detail.photos[0]} alt={detail.names[0]} />
                </button>
                {detail.photos.length > 1 && (
                  <div className="photo-grid">
                    {detail.photos.slice(1).map((url, i) => (
                      <button className="photo-cell" key={url} aria-label={`Open photo ${i + 2}`}
                        onClick={() => setLightbox({ photos: detail.photos, index: i + 1 })}>
                        <img src={url} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {canEdit && (
              <div className="form-actions">
                <button className="btn danger-ghost" onClick={() => deleteEntry(detail)} disabled={saving}>Delete item</button>
                <button className="btn" onClick={() => startEdit(detail)}>Edit item</button>
              </div>
            )}
          </article>
        )}

        {/* ── add / edit ── */}
        {(screen === "add" || screen === "edit") && formSeed && canEdit && (
          <ItemForm
            key={formKey}
            mode={screen}
            initial={formSeed}
            entries={entries}
            saving={saving}
            onPickExisting={(entry) => startEdit(entry, true)}
            onSubmit={(draft) => saveItem(draft, screen === "edit" ? detail : null)}
            onCancel={() => (screen === "edit" ? swap("detail") : back())}
            onDelete={() => detail && deleteEntry(detail)}
            onOpenPhotos={(photos, index) => setLightbox({ photos, index })}
            onHelp={(side) => setGuide({ side })}
          />
        )}
      </main>

      {signInOpen && (
        <SignInSheet onClose={() => setSignInOpen(false)}
          onSignedIn={() => { setSignInOpen(false); notify("Editing unlocked"); }} />
      )}
      {screen === "search" && !q && !showAll && roomFilter.length === 0 && (
        <button className="fab" onClick={() => { setListQuery(""); push("list"); }}>
          {Icon.list} Bundle search{listItems.length > 0 ? ` (${listItems.length})` : ""}
        </button>
      )}
      {guide && <RoomGuide highlight={guide.side} onClose={() => setGuide(null)} />}
      {lightbox && <Lightbox photos={lightbox.photos} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}
      {bundleFilterOpen && (
        <RoomSheet rooms={rooms} picked={run.rooms} onChange={setBundleRooms} onClose={() => setBundleFilterOpen(false)} />
      )}
      {naming && (
        <NameSheet title="Save as a bundle" confirmLabel="Save bundle"
          body="Saves these items and the room filter under a name, so you can open them again later. Using a name you already have replaces that bundle."
          initial="" onSave={saveBundle} onClose={() => setNaming(false)} />
      )}
      {filterOpen && (
        <RoomSheet rooms={rooms} picked={roomFilter} onChange={setRoomFilter} onClose={() => setFilterOpen(false)} />
      )}
      {ask && <ConfirmSheet ask={ask} onAnswer={answer} />}
      {toast && <div className={`toast ${toast.type}`} role="status">{toast.msg}</div>}
    </div>
  );
}

/* ───────────────────────── styles ───────────────────────── */

// Faint supply-icon wallpaper. Tinted blue so it never reads as text or a button outline.
const pattern = (color, opacity) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240'%3E%3Cg fill='none' stroke='%23${color}' stroke-opacity='${opacity}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M30 20v20M20 30h20'/%3E%3Cg transform='rotate(30 120 40)'%3E%3Crect x='100' y='32' width='40' height='16' rx='8'/%3E%3Cpath d='M120 32v16'/%3E%3C/g%3E%3Ccircle cx='212' cy='36' r='9'/%3E%3Cpath d='M205.600 42.400l12.800-12.800'/%3E%3Cg transform='rotate(-35 196 112)'%3E%3Crect x='172' y='103' width='48' height='18' rx='9'/%3E%3Crect x='188' y='103' width='16' height='18'/%3E%3C/g%3E%3Cg transform='rotate(45 62 128)'%3E%3Crect x='44' y='122' width='30' height='12' rx='2'/%3E%3Cpath d='M74 128h14M44 128H34M34 121v14M52 122v5M60 122v5'/%3E%3C/g%3E%3Cpath d='M128 96c8 10 12 16 12 21a12 12 0 0 1-24 0c0-5 4-11 12-21z'/%3E%3Cpath d='M10 206h20l8-14 10 28 8-14h24'/%3E%3Cpath d='M136 172h30v24h-30zM136 172l5-8h20l5 8M151 164v8'/%3E%3Cpath d='M214 196v20M204 206h20'/%3E%3C/g%3E%3C/svg%3E`;

const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap");

:root {
  --bg: #0F151B; --surface: #19222B; --field: #111920; --ink: #E8EDF2; --muted: #98A6B3;
  --line: #2B3743; --link: #8AB8FF; --danger: #FF8A80; --match: #F2545B;
  --on-ink: #0F151B; --shadow: none;
  --z-red: #D23B30; --z-yellow: #F2B705; --z-green: #2F9E5B; --z-peds: #7E57C2; --z-other: #7B8794;
  color-scheme: dark;
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg) url("${pattern("6FA0F0", ".07")}") top center / 240px 240px repeat; }
.app {
  font-family: "Atkinson Hyperlegible", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--ink); min-height: 100vh; min-height: 100dvh;
  max-width: 560px; margin: 0 auto; font-size: 16px; line-height: 1.4;
  padding-bottom: calc(96px + env(safe-area-inset-bottom));
}
.app :where(button, input, select, textarea) { font: inherit; color: inherit; }
.app :where(button) { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.app :focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
.app h1, .app h2, .app p, .app ul { margin: 0; }
.app ul { list-style: none; padding: 0; }

/* header */
.top {
  position: sticky; top: 0; z-index: 10; background: var(--bg);
  padding: calc(10px + env(safe-area-inset-top)) 16px 10px; border-bottom: 1px solid var(--line);
}
.bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; }
.brand { display: flex; align-items: center; gap: 9px; }
.brand-mark { flex: none; display: block; }
.brand-site { align-self: flex-end; padding-bottom: 5px; }
.brand-name { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; white-space: nowrap; }
@media (max-width: 359px) { .brand-site { display: none; } }
.brand-site { font-size: 14px; color: var(--muted); }
.bar-actions { display: flex; align-items: center; gap: 8px; }
.back {
  display: inline-flex; align-items: center; gap: 2px; background: none; border: 0; padding: 0 8px 0 0;
  min-height: 44px; font-weight: 700; color: var(--link);
}
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 44px; height: 44px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--surface); color: var(--muted);
}
.icon-btn.on { color: var(--ink); border-color: var(--ink); }

.searchbox { position: relative; margin-top: 8px; }
.searchbox-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--muted); display: flex; pointer-events: none; }
.search-input { height: 52px; padding-left: 44px !important; padding-right: 48px !important; font-size: 18px !important; background: var(--surface) !important; border-radius: 12px !important; }
.search-input::-webkit-search-cancel-button { display: none; }
.searchbox-clear {
  position: absolute; right: 4px; top: 4px; width: 44px; height: 44px; border: 0; background: none;
  color: var(--muted); display: flex; align-items: center; justify-content: center;
}

.main { padding: 12px 16px 0; }

/* controls */
.input {
  display: block; width: 100%; min-height: 48px; padding: 11px 13px; font-size: 16px;
  background: var(--field); border: 1.5px solid var(--line); border-radius: 10px; -webkit-appearance: none; appearance: none;
}
.app textarea.input { resize: vertical; line-height: 1.45; }
.app select.input {
  padding-right: 36px; background-repeat: no-repeat; background-position: right 13px center;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='none' stroke='%237B8794' stroke-width='2' stroke-linecap='round' d='M1 1.5l5 5 5-5'/%3E%3C/svg%3E");
}
.input:focus { border-color: var(--link); outline: none; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; padding: 0 18px;
  border-radius: 10px; border: 1.5px solid var(--ink); background: var(--ink); color: var(--on-ink); font-weight: 700;
}
.btn:disabled { opacity: .55; }
.btn.small { min-height: 44px; padding: 0 14px; }
.btn.ghost { background: transparent; color: var(--ink); border-color: var(--line); }
.btn.dashed { width: 100%; background: transparent; color: var(--muted); border: 1.5px dashed var(--line); font-weight: 400; }
.btn.danger { background: var(--danger); border-color: var(--danger); color: var(--on-ink); }
.btn.danger-ghost { background: transparent; color: var(--danger); border-color: var(--line); }
.btn.wide { width: 100%; margin-top: 12px; }
.link { background: none; border: 0; padding: 0; color: var(--link); font-weight: 700; text-decoration: underline; min-height: 32px; }
.muted { color: var(--muted); }

/* zone colours */
.z-red { background: var(--z-red); } .z-yellow { background: var(--z-yellow); } .z-green { background: var(--z-green); }
.z-peds { background: var(--z-peds); } .z-other { background: var(--z-other); }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: none; }

/* filter */
.filterbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; }
.chip {
  display: inline-flex; align-items: center; gap: 7px; min-height: 40px; padding: 0 13px; border-radius: 20px;
  border: 1.5px solid var(--line); background: var(--surface); font-size: 15px; text-align: left;
}
.chip.active { border-color: var(--ink); font-weight: 700; }
.picked-rooms { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-top: 10px; }
.picked-room {
  display: inline-flex; align-items: center; gap: 7px; min-height: 40px; padding: 0 6px 0 11px; border-radius: 8px;
  border: 1.5px solid var(--line); background: var(--surface); font-size: 15px; font-weight: 700; text-align: left;
}
.picked-x { display: flex; color: var(--muted); }
.picked-x svg { width: 16px; height: 16px; }

/* room picker panel */
.sheet.room-sheet { display: flex; flex-direction: column; padding: 0; max-height: 86vh; max-height: 86dvh; overflow: hidden; }
.grabber { flex: none; width: 44px; height: 5px; border-radius: 3px; background: var(--line); margin: 10px auto 0; }
.room-sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 18px 12px; border-bottom: 1px solid var(--line); }
.rooms { flex: 1; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 4px 18px 12px; }
.zone { margin-top: 14px; }
.zone-head { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 44px; padding: 0; background: none; border: 0; text-align: left; }
.zone-name { flex: 1; font-size: 14px; font-weight: 700; color: var(--muted); }
.zone-all { font-size: 14px; font-weight: 700; color: var(--link); }
.room-row {
  display: flex; align-items: center; gap: 12px; width: 100%; min-height: 50px; padding: 8px 12px; margin-top: 6px;
  background: var(--field); border: 1.5px solid var(--line); border-radius: 10px; text-align: left; font-size: 16px;
}
.room-row.on { border-color: var(--ink); background: var(--bg); font-weight: 700; }
.check { flex: none; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; border: 1.5px solid var(--muted); }
.room-row.on .check { background: var(--ink); border-color: var(--ink); color: var(--on-ink); }
.room-sheet-foot { padding: 12px 18px calc(14px + env(safe-area-inset-bottom)); border-top: 1px solid var(--line); }
.room-sheet-foot .btn { width: 100%; }

.banner { margin-top: 12px; padding: 10px 12px; border-radius: 10px; border: 1.5px solid var(--z-yellow); background: var(--surface); font-size: 15px; }
.landing.compact { padding: 14px 8px 0; }
.landing { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 22px 8px 4px; text-align: center; }
.empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 36px 8px; text-align: center; }

/* results */
.results { display: flex; flex-direction: column; gap: 8px; margin-top: 12px !important; }
.result {
  display: flex; align-items: stretch; background: var(--surface); border: 1px solid var(--line);
  border-radius: 12px; box-shadow: var(--shadow); overflow: hidden;
}
.result-main {
  display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; padding: 10px 0 10px 10px;
  text-align: left; background: none; border: 0;
}
.star { flex: none; width: 50px; display: flex; align-items: center; justify-content: center; background: none; border: 0; color: var(--muted); }
.star.on { color: var(--z-yellow); }
.star.boxed { width: 48px; height: 48px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
.title-row { display: flex; align-items: flex-start; gap: 12px; }
.title-row .page-title { flex: 1; }
.chip-star { display: flex; color: var(--muted); }
.chip-star.on { color: var(--z-yellow); }
.chip-star svg { width: 18px; height: 18px; }
.thumb { position: relative; flex: none; width: 60px; height: 60px; border-radius: 8px; overflow: hidden; background: var(--field); }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb.blank { display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; color: var(--line); border: 1.5px solid var(--line); }
.thumb-count { position: absolute; right: 3px; bottom: 3px; padding: 0 5px; border-radius: 5px; background: rgba(0,0,0,.72); color: #fff; font-size: 12px; font-weight: 700; }
.result-text { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.result-name { font-size: 17px; font-weight: 700; line-height: 1.25; }
.result-also { font-size: 14px; color: var(--muted); line-height: 1.3; }
.result-go { flex: none; color: var(--muted); display: flex; }
.app mark { background: none; color: var(--match); font-weight: 700; }
.tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 3px; }
.tag {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px 3px 7px; border-radius: 6px;
  background: var(--field); border: 1px solid var(--line); font-size: 13.5px; font-weight: 700; line-height: 1.3;
}
.tag-spec { font-weight: 400; color: var(--muted); white-space: nowrap; }

/* detail */
.page-title { font-size: 26px; line-height: 1.15; letter-spacing: -0.01em; margin-top: 6px !important; }
.aka { color: var(--muted); margin-top: 4px !important; }
.section { font-size: 14px; font-weight: 700; color: var(--muted); margin: 22px 0 8px !important; }
.plates { display: flex; flex-direction: column; gap: 8px; }
.plate {
  display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 10px 14px 10px 0; overflow: hidden;
  background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow);
}
.loc-bar { align-self: stretch; width: 10px; flex: none; border-radius: 0; }
.plate .loc-bar { margin: -10px 0; }
.plate-room { flex: 1; font-size: 19px; font-weight: 700; line-height: 1.2; }
.plate-spec { flex: none; padding: 4px 10px; border-radius: 6px; background: var(--field); border: 1px solid var(--line); font-weight: 700; font-size: 15px; }
.notes { padding: 12px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; white-space: pre-wrap; }
.hero-photo { display: block; width: 100%; padding: 0; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--field); }
.hero-photo img { display: block; width: 100%; max-height: 320px; object-fit: cover; }
.photo-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0; }
.photo-cell { position: relative; aspect-ratio: 1; padding: 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--field); }
.photo-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.photo-x {
  position: absolute; top: 3px; right: 3px; width: 30px; height: 30px; border-radius: 50%; border: 0;
  background: rgba(0,0,0,.72); color: #fff; display: flex; align-items: center; justify-content: center;
}

/* form */
.form .field { display: flex; flex-direction: column; gap: 8px; margin-top: 22px; }
.label { font-size: 14px; font-weight: 700; color: var(--muted); display: block; }
.sheet .label { margin: 12px 0 6px; }
.optional { font-weight: 400; }
.help { font-size: 14px; color: var(--muted); margin-top: -4px !important; }
.inline { display: flex; gap: 8px; align-items: center; }
.inline > .input { flex: 1; min-width: 0; }
.existing { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1.5px solid var(--z-yellow); border-radius: 10px; background: var(--surface); }
.existing .help { margin-top: 0 !important; }
.existing-row { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 10px 12px; text-align: left; background: var(--field); border: 1px solid var(--line); border-radius: 8px; }
.existing-name { font-weight: 700; }
.existing-where { font-size: 14px; color: var(--muted); }
.loc-edit { display: flex; align-items: flex-start; gap: 10px; padding: 10px 10px 10px 0; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.loc-edit .loc-bar { margin: -10px 0; }
.loc-fields { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
.form-error { color: var(--danger); font-weight: 700; margin-top: 14px !important; }
.form-actions { display: flex; gap: 10px; margin-top: 24px; }
.form-actions .btn { flex: 1; }
.row-btns { display: flex; gap: 10px; margin-top: 18px; }
.row-btns .btn { flex: 1; }

/* help button + room guide */
.qmark {
  position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  border-radius: 50%; border: 1.5px solid var(--muted); background: none; color: var(--muted); font-size: 15px; font-weight: 700; line-height: 1; padding: 0;
}
.qmark::after { content: ""; position: absolute; inset: -8px; }
.label.with-help { display: flex; align-items: center; gap: 10px; }
.guide { display: block; width: 100%; max-width: 320px; margin: 14px auto 0; }
.guide-side { fill: var(--field); }
.guide-side.on { fill: var(--link); fill-opacity: .3; }
.guide-wall { fill: none; stroke: var(--ink); stroke-width: 4; stroke-linejoin: miter; }
.guide-door { fill: none; stroke: var(--ink); stroke-width: 4; stroke-linecap: round; }
.guide-arc { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 4 4; }
.guide-arrow { fill: none; stroke: var(--link); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.guide-label { fill: var(--muted); font-size: 17px; font-weight: 700; text-anchor: middle; }
.guide-label.on { fill: var(--ink); }
.guide-note { fill: var(--muted); font-size: 13px; text-anchor: middle; }

/* bundle search */
.bundle-filter { margin-top: 12px; }
.bundle-actions { display: flex; flex-direction: column; margin-top: 8px; }
.stop-foot { padding: 4px 14px 12px; }
.empty.compact { padding: 20px 8px 8px; }
.result-main.pad-img { padding: 10px 12px 10px 10px; }
.fab {
  position: fixed; z-index: 20; right: max(16px, calc(50vw - 264px)); bottom: calc(18px + env(safe-area-inset-bottom));
  display: inline-flex; align-items: center; gap: 8px; min-height: 50px; padding: 0 18px; border-radius: 25px;
  border: 1.5px solid var(--ink); background: var(--ink); color: var(--on-ink); font-weight: 700; box-shadow: 0 6px 18px rgba(0,0,0,.45);
}
.result-main.pad { padding: 12px 12px 12px 14px; }
.result-main:disabled { opacity: 1; cursor: default; }
.add-pill { flex: none; padding: 6px 14px; border-radius: 16px; background: var(--ink); color: var(--on-ink); font-weight: 700; font-size: 15px; }
.add-pill.done { background: none; color: var(--muted); border: 1.5px solid var(--line); }
.stop { margin-top: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.stop-head { display: flex; align-items: center; gap: 12px; min-height: 54px; border-bottom: 1px solid var(--line); }
.stop-num { flex: none; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: var(--ink); color: var(--on-ink); font-weight: 700; font-size: 15px; }
.stop-room { font-size: 19px; line-height: 1.2; padding: 10px 12px 10px 0; }
.stop-room.pad { padding-left: 14px; }
.run-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px 6px 12px 14px; }
.run-item + .run-item { border-top: 1px solid var(--line); }
.check.big { width: 30px; height: 30px; border-radius: 8px; margin-top: 1px; background: none; padding: 0; color: var(--on-ink); }
.check.big.on { background: var(--ink); border-color: var(--ink); }
.check.big svg { width: 18px; height: 18px; }
.run-text { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; flex: 1; min-width: 0; }
.run-name { background: none; border: 0; padding: 0; font-size: 17px; font-weight: 700; text-align: left; line-height: 1.25; }
.run-spot { padding: 2px 9px; border-radius: 6px; background: var(--field); border: 1px solid var(--line); font-weight: 700; font-size: 14px; }
.run-alt { font-size: 14px; color: var(--muted); line-height: 1.35; }
.run-x { flex: none; width: 44px; height: 44px; margin-top: -7px; display: flex; align-items: center; justify-content: center; background: none; border: 0; color: var(--muted); }

/* overlays */
.scrim { position: fixed; inset: 0; z-index: 40; background: rgba(8,13,18,.6); display: flex; align-items: flex-end; justify-content: center; }
.sheet {
  width: 100%; max-width: 560px; background: var(--surface); border-radius: 18px 18px 0 0;
  padding: 22px 18px calc(20px + env(safe-area-inset-bottom)); max-height: 92vh; overflow: auto;
}
.sheet h2 { font-size: 20px; }
.sheet-body { color: var(--muted); margin-top: 6px !important; }
@media (min-width: 600px) { .scrim { align-items: center; } .sheet { border-radius: 18px; } }

.lightbox { position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,.94); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
.lightbox img { max-width: 100vw; max-height: 78vh; object-fit: contain; }
.lightbox-close { position: absolute; top: calc(10px + env(safe-area-inset-top)); right: 10px; width: 48px; height: 48px; border-radius: 50%; border: 0; background: rgba(255,255,255,.16); color: #fff; display: flex; align-items: center; justify-content: center; }
.lightbox-nav { display: flex; align-items: center; gap: 18px; color: #fff; }
.lightbox-nav button { width: 52px; height: 48px; border-radius: 10px; border: 0; background: rgba(255,255,255,.16); color: #fff; display: flex; align-items: center; justify-content: center; }

.toast {
  position: fixed; left: 50%; top: calc(64px + env(safe-area-inset-top)); transform: translateX(-50%); z-index: 60;
  max-width: calc(100vw - 32px); padding: 12px 18px; border-radius: 10px; background: var(--ink); color: var(--on-ink);
  font-weight: 700; text-align: center; box-shadow: 0 6px 20px rgba(0,0,0,.3);
}
.toast.error { background: var(--danger); }
`;
