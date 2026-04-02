import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "er-stockroom-inventory-v2";

function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveItemsToStorage(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

export default function App() {
  const [items, setItems] = useState(() => loadItems());
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [view, setView] = useState("search");
  const [newNames, setNewNames] = useState([""]);
  const [newRoom, setNewRoom] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editNames, setEditNames] = useState([""]);
  const [editRoom, setEditRoom] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [toast, setToast] = useState(null);
  const searchRef = useRef(null);
  const searchWrapRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target))
        setShowSuggestions(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function saveItems(updated) {
    setItems(updated);
    saveItemsToStorage(updated);
  }

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2200);
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

  function addItem() {
    const names = newNames.map(n => n.trim()).filter(Boolean);
    const room = newRoom.trim();
    if (names.length === 0 || !room) return showToast("Add at least one name and a room", "error");
    saveItems([...items, { id: Date.now(), names, room, notes: newNotes.trim() }]);
    setNewNames([""]);
    setNewRoom("");
    setNewNotes("");
    showToast(`"${names[0]}" added`);
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
    setEditNotes(item.notes || "");
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

  function saveEdit() {
    const names = editNames.map(n => n.trim()).filter(Boolean);
    const room = editRoom.trim();
    if (names.length === 0 || !room) return;
    saveItems(items.map(i => i.id === editingId ? { ...i, names, room, notes: editNotes.trim() } : i));
    setEditingId(null);
    showToast("Updated");
  }

  function deleteItem(id) {
    saveItems(items.filter(i => i.id !== id));
    showToast("Item removed");
  }

  const rooms = [...new Set(items.map(i => i.room))].sort();

  function highlight(text, q) {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span style={s.highlight}>{text.slice(idx, idx + q.length)}</span>
        {text.slice(idx + q.length)}
      </>
    );
  }

  function getMatchingName(item) {
    const q = query.toLowerCase();
    return item.names.find(n => n.toLowerCase().includes(q)) || item.names[0];
  }

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logo}>
            <span style={s.cross}>✚</span>
            <div>
              <div style={s.title}>StockRoom</div>
              <div style={s.subtitle}>Stamford ER</div>
            </div>
          </div>
          <div style={s.tabs}>
            {["search", "add", "manage"].map(t => (
              <button key={t} style={{ ...s.tab, ...(view === t ? s.tabActive : {}) }}
                onClick={() => { setView(t); if (t === "search") setTimeout(() => searchRef.current?.focus(), 100); }}>
                {t === "add" ? "+ Add" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={s.body}>

        {view === "search" && (
          <div style={s.section}>
            <div style={s.searchOuter} ref={searchWrapRef}>
              <div style={s.searchWrap}>
                <span style={s.searchIcon}>⌕</span>
                <input ref={searchRef} autoFocus style={s.searchInput}
                  placeholder="Type any name..."
                  value={query} onChange={handleQueryChange}
                  onFocus={() => query.trim() && setShowSuggestions(true)}
                  autoComplete="off" />
                {query && <button style={s.clearBtn} onClick={handleClear}>✕</button>}
              </div>

              {showSuggestions && filtered.length > 0 && (
                <div style={s.dropdown}>
                  {filtered.map(item => {
                    const matched = getMatchingName(item);
                    const isFirstName = matched === item.names[0];
                    return (
                      <button key={item.id} style={s.suggestion} onMouseDown={() => selectSuggestion(item)}>
                        <div style={s.suggestionLeft}>
                          <div style={s.suggestionName}>{highlight(matched, query)}</div>
                          {!isFirstName && <div style={s.suggestionSub}>also: {item.names[0]}</div>}
                        </div>
                        <div style={s.suggestionRoom}>{item.room}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              {showSuggestions && query.trim() && filtered.length === 0 && (
                <div style={s.dropdown}>
                  <div style={s.noMatch}>
                    No match —{" "}
                    <span style={s.noMatchLink} onMouseDown={() => {
                      setNewNames([query]); setNewRoom(""); setNewNotes(""); setView("add"); setShowSuggestions(false);
                    }}>add "{query}"</span>
                  </div>
                </div>
              )}
            </div>

            {selectedItem && !showSuggestions && (
              <div style={s.resultCard}>
                <div style={s.resultTop}>
                  <div style={s.resultNames}>{selectedItem.names.join("  ·  ")}</div>
                  <div style={s.roomBadge}>{selectedItem.room}</div>
                </div>
                {selectedItem.notes ? (
                  <div style={s.notesBox}>
                    <span style={s.notesIcon}>📝</span>
                    <span style={s.notesText}>{selectedItem.notes}</span>
                  </div>
                ) : null}
              </div>
            )}

            {!query && items.length === 0 && (
              <div style={s.emptyState}>
                <div style={s.emptyIcon}>📦</div>
                <div style={s.emptyText}>No items yet.</div>
                <button style={s.addHintBtn} onClick={() => setView("add")}>Add your first item →</button>
              </div>
            )}
            {!query && items.length > 0 && (
              <div style={s.hint}>{items.length} item{items.length !== 1 ? "s" : ""} in inventory</div>
            )}
          </div>
        )}

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
                  {newNames.length > 1 && (
                    <button style={s.removeNameBtn} onClick={() => removeNewNameField(i)}>✕</button>
                  )}
                </div>
              ))}
              <button style={s.addNameBtn} onClick={addNewNameField}>+ Add another name</button>
              <label style={s.label}>Stock Room</label>
              <input style={s.input} placeholder="e.g. Stockroom A"
                value={newRoom} onChange={e => setNewRoom(e.target.value)} list="rooms-list" />
              <datalist id="rooms-list">{rooms.map(r => <option key={r} value={r} />)}</datalist>
              <label style={s.label}>Notes <span style={s.optional}>(optional)</span></label>
              <textarea style={s.textarea} placeholder="e.g. Left side of the room, bottom shelf"
                value={newNotes} onChange={e => setNewNotes(e.target.value)} rows={2} />
              <button style={s.primaryBtn} onClick={addItem}>Add Item</button>
            </div>
          </div>
        )}

        {view === "manage" && (
          <div style={s.section}>
            {items.length === 0 && (
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
                        {editNames.length > 1 && (
                          <button style={s.removeNameBtn} onClick={() => removeEditNameField(i)}>✕</button>
                        )}
                      </div>
                    ))}
                    <button style={s.addNameBtn} onClick={addEditNameField}>+ Add another name</button>
                    <label style={{ ...s.label, marginTop: 12 }}>Stock Room</label>
                    <input style={{ ...s.input, marginBottom: 8 }} value={editRoom}
                      onChange={e => setEditRoom(e.target.value)} list="rooms-list" />
                    <label style={s.label}>Notes <span style={s.optional}>(optional)</span></label>
                    <textarea style={{ ...s.textarea, marginBottom: 12 }} value={editNotes}
                      onChange={e => setEditNotes(e.target.value)} rows={2}
                      placeholder="e.g. Left side of the room, bottom shelf" />
                    <div style={s.editActions}>
                      <button style={s.saveBtn} onClick={saveEdit}>Save</button>
                      <button style={s.cancelBtn} onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={s.manageRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {item.names.map((n, i) => (
                        <div key={i} style={s.manageName}>{n}</div>
                      ))}
                      <div style={s.manageRoom}>{item.room}</div>
                      {item.notes ? <div style={s.manageNotes}>📝 {item.notes}</div> : null}
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
  roomBadge: { background: "#1a2332", border: `1px solid #2d4a6b`, color: C.blue, borderRadius: 6, padding: "6px 12px", fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" },
  notesBox: { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", display: "flex", gap: 8, alignItems: "flex-start" },
  notesIcon: { fontSize: 13, flexShrink: 0, marginTop: 1 },
  notesText: { fontSize: 13, color: C.muted, lineHeight: 1.5 },
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
  textarea: { background: C.bg, border: `1.5px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 14, padding: "11px 13px", outline: "none", width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 },
  primaryBtn: { marginTop: 14, background: C.accent, border: "none", borderRadius: 8, color: "#fff", fontSize: 15, fontWeight: 600, padding: "13px", cursor: "pointer", width: "100%" },
  manageCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" },
  manageRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 },
  manageName: { fontSize: 14, fontWeight: 500, lineHeight: 1.6 },
  manageRoom: { fontSize: 12, color: C.blue, marginTop: 4 },
  manageNotes: { fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.4 },
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
