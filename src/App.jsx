import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://wjuwxumshijallenlxev.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqdXd4dW1zaGlqYWxsZW5seGV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMDIzMDksImV4cCI6MjA5MDY3ODMwOX0.W6Ufu92HIJmtOpN0ft4W9_zxiwTa8kDSa9_J8gFRYZ4";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const STOCKROOMS = [
  "Red Bin Room","Red Stockroom","Red Med Room",
  "Yellow Stockroom","Yellow Med Room","Yellow Hallway Pyxis",
  "Ortho Stockroom","Green Stockroom","Green Med Room",
  "Peds Stockroom","Peds Mini Stockroom","Peds Med Room",
];

const SPECIFICS = ["Front","Back","Left","Right","Pyxis"];

function compressImage(file, maxWidth = 800) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.75);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [view, setView] = useState("search");
  const [newNames, setNewNames] = useState([""]);
  const [newRoom, setNewRoom] = useState("");
  const [newSpecific, setNewSpecific] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newPhoto, setNewPhoto] = useState(null);
  const [newPhotoPreview, setNewPhotoPreview] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editNames, setEditNames] = useState([""]);
  const [editRoom, setEditRoom] = useState("");
  const [editSpecific, setEditSpecific] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editPhoto, setEditPhoto] = useState(null);
  const [editPhotoPreview, setEditPhotoPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [toast, setToast] = useState(null);
  const searchRef = useRef(null);
  const searchWrapRef = useRef(null);
  const newPhotoRef = useRef(null);
  const editPhotoRef = useRef(null);

  useEffect(() => { fetchItems(); }, []);

  useEffect(() => {
    function handleClick(e) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target))
        setShowSuggestions(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function fetchItems() {
    setLoading(true);
    const { data, error } = await supabase.from("items").select("*").order("created_at");
    if (!error) setItems(data || []);
    setLoading(false);
  }

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function uploadPhoto(file, itemId) {
    const blob = await compressImage(file);
    const path = `${itemId}-${Date.now()}.jpg`;
    const { error } = await supabase.storage.from("Photos").upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from("Photos").getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleNewPhotoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setNewPhoto(file);
    setNewPhotoPreview(URL.createObjectURL(file));
  }

  async function handleEditPhotoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setEditPhoto(file);
    setEditPhotoPreview(URL.createObjectURL(file));
  }

  async function addItem() {
    const names = newNames.map(n => n.trim()).filter(Boolean);
    const room = newRoom.trim();
    if (names.length === 0 || !room) return showToast("Add at least one name and a location", "error");
    setSaving(true);
    const tempId = Date.now();
    let photo_url = null;
    const { data, error } = await supabase.from("items").insert([{ names, room, specific: newSpecific || null, notes: newNotes.trim() || null, photo_url: null }]).select().single();
    if (error) { showToast("Failed to save", "error"); setSaving(false); return; }
    if (newPhoto) {
      photo_url = await uploadPhoto(newPhoto, data.id);
      if (photo_url) await supabase.from("items").update({ photo_url }).eq("id", data.id);
    }
    setNewNames([""]);
    setNewRoom("");
    setNewSpecific("");
    setNewNotes("");
    setNewPhoto(null);
    setNewPhotoPreview(null);
    showToast(`"${names[0]}" added`);
    setSaving(false);
    fetchItems();
  }

  function updateNewName(i, val) {
    const updated = [...newNames];
    updated[i] = val;
    setNewNames(updated);
  }

  function addNewNameField() { setNewNames([...newNames, ""]); }
  function removeNewNameField(i) {
    if (newNames.length === 1) return;
    setNewNames(newNames.filter((_, idx) => idx !== i));
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditNames([...item.names]);
    setEditRoom(item.room);
    setEditSpecific(item.specific || "");
    setEditNotes(item.notes || "");
    setEditPhoto(null);
    setEditPhotoPreview(item.photo_url || null);
  }

  function updateEditName(i, val) {
    const updated = [...editNames];
    updated[i] = val;
    setEditNames(updated);
  }

  function addEditNameField() { setEditNames([...editNames, ""]); }
  function removeEditNameField(i) {
    if (editNames.length === 1) return;
    setEditNames(editNames.filter((_, idx) => idx !== i));
  }

  async function saveEdit() {
    const names = editNames.map(n => n.trim()).filter(Boolean);
    const room = editRoom.trim();
    if (names.length === 0 || !room) return;
    setSaving(true);
    let photo_url = items.find(i => i.id === editingId)?.photo_url || null;
    if (editPhoto) {
      const url = await uploadPhoto(editPhoto, editingId);
      if (url) photo_url = url;
    }
    await supabase.from("items").update({ names, room, specific: editSpecific || null, notes: editNotes.trim() || null, photo_url }).eq("id", editingId);
    setEditingId(null);
    setEditPhoto(null);
    setEditPhotoPreview(null);
    showToast("Updated");
    setSaving(false);
    fetchItems();
  }

  async function deleteItem(id) {
    await supabase.from("items").delete().eq("id", id);
    showToast("Item removed");
    fetchItems();
  }

  const filtered = query.trim()
    ? items.filter(i => i.names.some(n => n.toLowerCase().includes(query.toLowerCase())))
    : [];

  function handleQueryChange(e) {
    const val = e.target.value;
    setQuery(val);
    setSelectedItem(null);
    setShowSuggestions(val.trim().length > 0);
  }

  function selectSuggestion(item) {
    setSelectedItem(item);
    setQuery(item.names[0]);
    setShowSuggestions(false);
  }

  function handleClear() {
    setQuery("");
    setSelectedItem(null);
    setShowSuggestions(false);
    searchRef.current?.focus();
  }

  function highlight(text, q) {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (<>{text.slice(0, idx)}<span style={s.highlight}>{text.slice(idx, idx + q.length)}</span>{text.slice(idx + q.length)}</>);
  }

  function getMatchingName(item) {
    const q = query.toLowerCase();
    return item.names.find(n => n.toLowerCase().includes(q)) || item.names[0];
  }

  function locationLabel(item) {
    return item.room + (item.specific ? ` (${item.specific})` : "");
  }

  return (
    <div style={s.root}>
      {lightbox && (
        <div style={s.lightboxOverlay} onClick={() => setLightbox(null)}>
          <img src={lightbox} style={s.lightboxImg} onClick={e => e.stopPropagation()} />
          <button style={s.lightboxClose} onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}

      <div style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logo}>
            <span style={s.cross}>✚</span>
            <div>
              <div style={s.title}>Item Finder</div>
              <div style={s.subtitle}>Stamford ED</div>
            </div>
          </div>
          <div style={s.tabs}>
            {["search","add","manage"].map(t => (
              <button key={t} style={{ ...s.tab, ...(view === t ? s.tabActive : {}) }}
                onClick={() => { setView(t); if (t === "search") setTimeout(() => searchRef.current?.focus(), 100); }}>
                {t === "add" ? "+ Add" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={s.body}>

        {/* SEARCH */}
        {view === "search" && (
          <div style={s.section}>
            <div style={s.searchOuter} ref={searchWrapRef}>
              <div style={s.searchWrap}>
                <span style={s.searchIcon}>⌕</span>
                <input ref={searchRef} autoFocus style={s.searchInput}
                  placeholder="Type any name..." value={query}
                  onChange={handleQueryChange}
                  onFocus={() => query.trim() && setShowSuggestions(true)}
                  autoComplete="off" />
                {query && <button style={s.clearBtn} onClick={handleClear}>✕</button>}
              </div>

              {showSuggestions && filtered.length > 0 && (
                <div style={s.dropdown}>
                  {filtered.map(item => {
                    const matched = getMatchingName(item);
                    const isFirst = matched === item.names[0];
                    return (
                      <button key={item.id} style={s.suggestion} onMouseDown={() => selectSuggestion(item)}>
                        <div style={s.suggestionLeft}>
                          <div style={s.suggestionName}>{highlight(matched, query)}</div>
                          {!isFirst && <div style={s.suggestionSub}>also: {item.names[0]}</div>}
                        </div>
                        <div style={s.suggestionRoom}>{locationLabel(item)}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              {showSuggestions && query.trim() && filtered.length === 0 && (
                <div style={s.dropdown}>
                  <div style={s.noMatch}>No match — <span style={s.noMatchLink} onMouseDown={() => { setNewNames([query]); setView("add"); setShowSuggestions(false); }}>add "{query}"</span></div>
                </div>
              )}
            </div>

            {selectedItem && !showSuggestions && (
              <div style={s.resultCard}>
                <div style={s.resultTop}>
                  <div style={s.resultNames}>{selectedItem.names.join("  ·  ")}</div>
                  <div style={s.roomBadge}>{locationLabel(selectedItem)}</div>
                </div>
                {selectedItem.notes && (
                  <div style={s.notesBox}>
                    <span style={s.notesIcon}>📝</span>
                    <span style={s.notesText}>{selectedItem.notes}</span>
                  </div>
                )}
                {selectedItem.photo_url && (
                  <img src={selectedItem.photo_url} style={s.resultPhoto} onClick={() => setLightbox(selectedItem.photo_url)} />
                )}
              </div>
            )}

            {!query && loading && <div style={s.hint}>Loading...</div>}
            {!query && !loading && items.length === 0 && (
              <div style={s.emptyState}>
                <div style={s.emptyIcon}>📦</div>
                <div style={s.emptyText}>No items yet.</div>
                <button style={s.addHintBtn} onClick={() => setView("add")}>Add your first item →</button>
              </div>
            )}
            {!query && !loading && items.length > 0 && (
              <div style={s.hint}>{items.length} item{items.length !== 1 ? "s" : ""} in inventory</div>
            )}
          </div>
        )}

        {/* ADD */}
        {view === "add" && (
          <div style={s.section}>
            <div style={s.formCard}>
              <div style={s.formTitle}>Add New Item</div>
              <label style={s.label}>Names</label>
              {newNames.map((name, i) => (
                <div key={i} style={s.nameRow}>
                  <input style={{ ...s.input, flex: 1 }}
                    placeholder={i === 0 ? "e.g. Butterfly needle" : "e.g. Winged infusion set"}
                    value={name} onChange={e => updateNewName(i, e.target.value)}
                    autoFocus={i === newNames.length - 1 && i > 0} />
                  {newNames.length > 1 && <button style={s.removeNameBtn} onClick={() => removeNewNameField(i)}>✕</button>}
                </div>
              ))}
              <button style={s.addNameBtn} onClick={addNewNameField}>+ Add another name</button>

              <label style={s.label}>Location</label>
              <select style={s.select} value={newRoom} onChange={e => setNewRoom(e.target.value)}>
                <option value="">Select a location...</option>
                {STOCKROOMS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>

              <label style={s.label}>More Specific <span style={s.optional}>(optional)</span></label>
              <select style={s.select} value={newSpecific} onChange={e => setNewSpecific(e.target.value)}>
                <option value="">Select...</option>
                {SPECIFICS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>

              <label style={s.label}>Notes <span style={s.optional}>(optional)</span></label>
              <textarea style={s.textarea} placeholder="e.g. Used to stop bleeding via compression"
                value={newNotes} onChange={e => setNewNotes(e.target.value)} rows={2} />

              <label style={s.label}>Photo <span style={s.optional}>(optional)</span></label>
              {newPhotoPreview && <img src={newPhotoPreview} style={s.photoPreview} />}
              <button style={s.photoBtn} onClick={() => newPhotoRef.current.click()}>
                {newPhotoPreview ? "Change Photo" : "📷 Take or Upload Photo"}
              </button>
              <input ref={newPhotoRef} type="file" accept="image/*" capture="environment"
                style={{ display: "none" }} onChange={handleNewPhotoChange} />

              <button style={{ ...s.primaryBtn, opacity: saving ? 0.6 : 1 }} onClick={addItem} disabled={saving}>
                {saving ? "Saving..." : "Add Item"}
              </button>
            </div>
          </div>
        )}

        {/* MANAGE */}
        {view === "manage" && (
          <div style={s.section}>
            {loading && <div style={s.hint}>Loading...</div>}
            {!loading && items.length === 0 && (
              <div style={s.emptyState}>
                <div style={s.emptyIcon}>📦</div>
                <div style={s.emptyText}>No items to manage yet.</div>
              </div>
            )}
            {items.map(item => (
              <div key={item.id} style={s.manageCard}>
                {editingId === item.id ? (
                  <div style={s.editRow}>
                    <label style={s.label}>Names</label>
                    {editNames.map((name, i) => (
                      <div key={i} style={s.nameRow}>
                        <input style={{ ...s.input, flex: 1, marginBottom: 6 }}
                          value={name} onChange={e => updateEditName(i, e.target.value)} />
                        {editNames.length > 1 && <button style={s.removeNameBtn} onClick={() => removeEditNameField(i)}>✕</button>}
                      </div>
                    ))}
                    <button style={s.addNameBtn} onClick={addEditNameField}>+ Add another name</button>

                    <label style={{ ...s.label, marginTop: 12 }}>Location</label>
                    <select style={{ ...s.select, marginBottom: 8 }} value={editRoom} onChange={e => setEditRoom(e.target.value)}>
                      <option value="">Select a location...</option>
                      {STOCKROOMS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>

                    <label style={s.label}>More Specific <span style={s.optional}>(optional)</span></label>
                    <select style={{ ...s.select, marginBottom: 8 }} value={editSpecific} onChange={e => setEditSpecific(e.target.value)}>
                      <option value="">Select...</option>
                      {SPECIFICS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>

                    <label style={s.label}>Notes <span style={s.optional}>(optional)</span></label>
                    <textarea style={{ ...s.textarea, marginBottom: 8 }} value={editNotes}
                      onChange={e => setEditNotes(e.target.value)} rows={2}
                      placeholder="e.g. Used to stop bleeding via compression" />

                    <label style={s.label}>Photo <span style={s.optional}>(optional)</span></label>
                    {editPhotoPreview && <img src={editPhotoPreview} style={s.photoPreview} />}
                    <button style={{ ...s.photoBtn, marginBottom: 12 }} onClick={() => editPhotoRef.current.click()}>
                      {editPhotoPreview ? "Change Photo" : "📷 Take or Upload Photo"}
                    </button>
                    <input ref={editPhotoRef} type="file" accept="image/*" capture="environment"
                      style={{ display: "none" }} onChange={handleEditPhotoChange} />

                    <div style={s.editActions}>
                      <button style={{ ...s.saveBtn, opacity: saving ? 0.6 : 1 }} onClick={saveEdit} disabled={saving}>
                        {saving ? "Saving..." : "Save"}
                      </button>
                      <button style={s.cancelBtn} onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={s.manageRow}>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 10, alignItems: "center" }}>
                      {item.photo_url && (
                        <img src={item.photo_url} style={s.manageThumb} onClick={() => setLightbox(item.photo_url)} />
                      )}
                      <div>
                        {item.names.map((n, i) => <div key={i} style={s.manageName}>{n}</div>)}
                        <div style={s.manageRoom}>{locationLabel(item)}</div>
                        {item.notes && <div style={s.manageNotes}>📝 {item.notes}</div>}
                      </div>
                    </div>
                    <div style={s.manageActions}>
                      <button style={s.editBtn} onClick={() => startEdit(item)}>Edit</button>
                      <button style={s.deleteBtn} onClick={() => deleteItem(item.id)}>✕</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div style={{ ...s.toast, ...(toast.type === "error" ? s.toastError : {}) }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

const C = { bg: "#0d1117", surface: "#161b22", border: "#21262d", accent: "#e63946", text: "#e6edf3", muted: "#8b949e", green: "#3fb950", blue: "#58a6ff" };

const s = {
  root: { fontFamily: "'DM Sans', 'Segoe UI', sans-serif", background: C.bg, minHeight: "100vh", color: C.text, maxWidth: 480, margin: "0 auto", position: "relative" },
  header: { background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "16px 20px 0", position: "sticky", top: 0, zIndex: 10 },
  headerInner: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  logo: { display: "flex", alignItems: "center", gap: 10 },
  cross: { fontSize: 22, color: C.accent, lineHeight: 1 },
  title: { fontSize: 16, fontWeight: 700, letterSpacing: "0.03em", lineHeight: 1.2 },
  subtitle: { fontSize: 11, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase" },
  tabs: { display: "flex", gap: 4 },
  tab: { background: "transparent", border: "none", color: C.muted, fontSize: 13, fontWeight: 500, padding: "6px 12px", borderRadius: 6, cursor: "pointer" },
  tabActive: { background: C.accent, color: "#fff" },
  body: { padding: "20px 16px" },
  section: { display: "flex", flexDirection: "column", gap: 10 },
  searchOuter: { position: "relative" },
  searchWrap: { position: "relative", display: "flex", alignItems: "center" },
  searchIcon: { position: "absolute", left: 14, fontSize: 20, color: C.muted, pointerEvents: "none" },
  searchInput: { width: "100%", background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 16, padding: "13px 40px 13px 42px", outline: "none", boxSizing: "border-box" },
  clearBtn: { position: "absolute", right: 12, background: "transparent", border: "none", color: C.muted, fontSize: 14, cursor: "pointer", padding: 4 },
  dropdown: { position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, zIndex: 50, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" },
  suggestion: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, color: C.text, padding: "12px 14px", cursor: "pointer", textAlign: "left", gap: 10 },
  suggestionLeft: { flex: 1, minWidth: 0 },
  suggestionName: { fontSize: 14, fontWeight: 500 },
  suggestionSub: { fontSize: 11, color: C.muted, marginTop: 2 },
  suggestionRoom: { fontSize: 12, color: C.blue, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 },
  highlight: { color: C.accent, fontWeight: 700 },
  noMatch: { padding: "14px 16px", fontSize: 13, color: C.muted },
  noMatchLink: { color: C.blue, cursor: "pointer", textDecoration: "underline" },
  resultCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px", display: "flex", flexDirection: "column", gap: 10 },
  resultTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  resultNames: { fontSize: 14, color: C.text, lineHeight: 1.7, flex: 1 },
  roomBadge: { background: "#1a2332", border: `1px solid #2d4a6b`, color: C.blue, borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" },
  notesBox: { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", display: "flex", gap: 8, alignItems: "flex-start" },
  notesIcon: { fontSize: 13, flexShrink: 0, marginTop: 1 },
  notesText: { fontSize: 13, color: C.muted, lineHeight: 1.5 },
  resultPhoto: { width: "100%", borderRadius: 8, cursor: "zoom-in", objectFit: "cover", maxHeight: 220 },
  lightboxOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" },
  lightboxImg: { maxWidth: "95vw", maxHeight: "90vh", borderRadius: 8, objectFit: "contain" },
  lightboxClose: { position: "absolute", top: 20, right: 20, background: "transparent", border: "none", color: "#fff", fontSize: 24, cursor: "pointer" },
  emptyState: { textAlign: "center", padding: "48px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 },
  emptyIcon: { fontSize: 36 },
  emptyText: { color: C.muted, fontSize: 14 },
  addHintBtn: { background: "transparent", border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, marginTop: 6 },
  hint: { textAlign: "center", color: C.muted, fontSize: 13, marginTop: 8 },
  formCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 18px", display: "flex", flexDirection: "column", gap: 4 },
  formTitle: { fontSize: 15, fontWeight: 700, marginBottom: 10 },
  label: { fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, marginTop: 8 },
  optional: { fontSize: 11, color: C.muted, textTransform: "none", letterSpacing: 0, fontWeight: 400 },
  nameRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  removeNameBtn: { background: "transparent", border: `1px solid #3d1a1a`, color: "#f85149", borderRadius: 6, padding: "8px 10px", cursor: "pointer", fontSize: 12, flexShrink: 0 },
  addNameBtn: { background: "transparent", border: `1px dashed ${C.border}`, color: C.muted, borderRadius: 8, padding: "8px", cursor: "pointer", fontSize: 13, marginTop: 2, marginBottom: 4, width: "100%" },
  input: { background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 15, padding: "11px 13px", outline: "none", width: "100%", boxSizing: "border-box" },
  select: { background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 15, padding: "11px 13px", outline: "none", width: "100%", boxSizing: "border-box", appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238b949e' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 13px center" },
  textarea: { background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 14, padding: "11px 13px", outline: "none", width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 },
  photoBtn: { background: "transparent", border: `1px dashed ${C.border}`, color: C.muted, borderRadius: 8, padding: "10px", cursor: "pointer", fontSize: 13, width: "100%", marginTop: 4 },
  photoPreview: { width: "100%", borderRadius: 8, objectFit: "cover", maxHeight: 180, marginBottom: 6 },
  primaryBtn: { marginTop: 14, background: C.accent, border: "none", borderRadius: 8, color: "#fff", fontSize: 15, fontWeight: 600, padding: "13px", cursor: "pointer", width: "100%" },
  manageCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" },
  manageRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 },
  manageThumb: { width: 48, height: 48, borderRadius: 6, objectFit: "cover", flexShrink: 0, cursor: "zoom-in" },
  manageName: { fontSize: 14, fontWeight: 500, lineHeight: 1.6 },
  manageRoom: { fontSize: 12, color: C.blue, marginTop: 2 },
  manageNotes: { fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.4 },
  manageActions: { display: "flex", gap: 6, flexShrink: 0 },
  editBtn: { background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12 },
  deleteBtn: { background: "transparent", border: `1px solid #3d1a1a`, color: "#f85149", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12 },
  editRow: { display: "flex", flexDirection: "column" },
  editActions: { display: "flex", gap: 8 },
  saveBtn: { background: C.green, border: "none", borderRadius: 6, color: "#fff", padding: "7px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600, flex: 1 },
  cancelBtn: { background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, padding: "7px 18px", cursor: "pointer", fontSize: 13, flex: 1 },
  toast: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: C.green, color: "#fff", borderRadius: 8, padding: "10px 22px", fontSize: 14, fontWeight: 600, zIndex: 100, boxShadow: "0 4px 20px rgba(0,0,0,0.4)" },
  toastError: { background: C.accent },
};
