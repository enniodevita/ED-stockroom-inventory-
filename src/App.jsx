import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://wjuwxumshijallenlxev.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqdXd4dW1zaGlqYWxsZW5seGV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMDIzMDksImV4cCI6MjA5MDY3ODMwOX0.W6Ufu92HIJmtOpN0ft4W9_zxiwTa8kDSa9_J8gFRYZ4";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

const STOCKROOMS = [
  "Red Bin Room","Red Stockroom","Red Med Room",
  "Yellow Stockroom","Yellow Med Room","Yellow Hallway Pyxis",
  "Green/Ortho Stockroom","Green/Mobility Stockroom","Green Med Room",
  "Peds Stockroom","Peds Mini Stockroom","Peds Med Room",
  "Cabinet between R44 and R43",
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

function groupItems(items) {
  const groups = [];
  const visited = new Set();
  for (const item of items) {
    if (visited.has(item.id)) continue;
    const related = items.filter(other =>
      !visited.has(other.id) &&
      other.names.some(n => item.names.map(x => x.toLowerCase()).includes(n.toLowerCase()))
    );
    related.forEach(r => visited.add(r.id));
    groups.push(related);
  }
  return groups;
}

function getPhotoUrls(item) {
  if (item.photo_urls && item.photo_urls.length > 0) return item.photo_urls;
  if (item.photo_url) return [item.photo_url];
  return [];
}

function groupPhotos(group) {
  const seen = new Set();
  const result = [];
  for (const item of group) {
    for (const url of getPhotoUrls(item)) {
      if (!seen.has(url)) { seen.add(url); result.push(url); }
    }
  }
  return result;
}

function Lightbox({ photos, startIndex, onClose }) {
  const [idx, setIdx] = useState(startIndex || 0);
  return (
    <div style={s.lightboxOverlay} onClick={onClose}>
      <div style={s.lightboxInner} onClick={e => e.stopPropagation()}>
        <img src={photos[idx]} style={s.lightboxImg} />
        {photos.length > 1 && (
          <div style={s.lightboxNav}>
            <button style={s.lightboxNavBtn} onClick={() => setIdx((idx - 1 + photos.length) % photos.length)}>‹</button>
            <span style={s.lightboxCounter}>{idx + 1} / {photos.length}</span>
            <button style={s.lightboxNavBtn} onClick={() => setIdx((idx + 1) % photos.length)}>›</button>
          </div>
        )}
        <button style={s.lightboxClose} onClick={onClose}>✕</button>
      </div>
    </div>
  );
}

export default function App() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("search"); // search | add
  const [lightbox, setLightbox] = useState(null);

  // Search
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [roomFilter, setRoomFilter] = useState([]);
  const [showRoomFilter, setShowRoomFilter] = useState(false);
  const [detailGroup, setDetailGroup] = useState(null); // group being viewed/edited
  const [isEditing, setIsEditing] = useState(false);

  // Add form
  const [newNames, setNewNames] = useState([""]);
  const [newRoom, setNewRoom] = useState("");
  const [newSpecific, setNewSpecific] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newPhotos, setNewPhotos] = useState([]);
  const [sourcePhotoUrls, setSourcePhotoUrls] = useState([]);
  const [addSuggestions, setAddSuggestions] = useState([]);
  const [showAddSuggestions, setShowAddSuggestions] = useState(false);

  // Edit form
  const [editNames, setEditNames] = useState([""]);
  const [editNotes, setEditNotes] = useState("");
  const [editExistingPhotos, setEditExistingPhotos] = useState([]);
  const [editNewPhotos, setEditNewPhotos] = useState([]);
  const [newLocationRows, setNewLocationRows] = useState([]);

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const searchRef = useRef(null);
  const addSuggestWrapRef = useRef(null);
  const newPhotoRef = useRef(null);
  const editPhotoRef = useRef(null);

  useEffect(() => { fetchItems(); }, []);

  useEffect(() => {
    function handleClick(e) {
      if (addSuggestWrapRef.current && !addSuggestWrapRef.current.contains(e.target))
        setShowAddSuggestions(false);
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

  async function uploadPhoto(file, itemId, index) {
    const blob = await compressImage(file);
    const path = `${itemId}-${Date.now()}-${index}.jpg`;
    const { error } = await supabase.storage.from("Photos").upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (error) return null;
    return supabase.storage.from("Photos").getPublicUrl(path).data.publicUrl;
  }

  function locationLabel(item) {
    return item.room + (item.specific ? ` (${item.specific})` : "");
  }

  function toggleRoomFilter(room) {
    setRoomFilter(prev => prev.includes(room) ? prev.filter(r => r !== room) : [...prev, room]);
  }

  // --- SEARCH RESULTS ---
  const allGroups = groupItems(items);
  const isShowingResults = query.trim() || showAll;
  const visibleGroups = isShowingResults
    ? allGroups.filter(g => {
        const nameMatch = !query.trim() || g[0].names.some(n => n.toLowerCase().includes(query.trim().toLowerCase()));
        const roomMatch = roomFilter.length === 0 || g.some(item => roomFilter.includes(item.room));
        return nameMatch && roomMatch;
      }).sort((a, b) => {
        if (!query.trim()) {
          // Show all: alphabetical
          return a[0].names[0].localeCompare(b[0].names[0]);
        }
        // Typing: sort by closeness to query
        const q = query.trim().toLowerCase();
        function score(group) {
          let best = 3;
          for (const name of group[0].names) {
            const n = name.toLowerCase();
            if (n === q) best = Math.min(best, 0);
            else if (n.startsWith(q)) best = Math.min(best, 1);
            else if (n.includes(q)) best = Math.min(best, 2);
          }
          return best;
        }
        const diff = score(a) - score(b);
        if (diff !== 0) return diff;
        return a[0].names[0].localeCompare(b[0].names[0]);
      })
    : [];

  // For each group, which locations to show (filtered if room filter active)
  function visibleLocations(group) {
    if (roomFilter.length === 0) return group;
    return group.filter(item => roomFilter.includes(item.room));
  }

  // Item count respects room filter
  const inventoryCount = roomFilter.length > 0
    ? allGroups.filter(g => g.some(item => roomFilter.includes(item.room))).length
    : allGroups.length;

  function highlight(text, q) {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (<>{text.slice(0, idx)}<span style={s.highlight}>{text.slice(idx, idx + q.length)}</span>{text.slice(idx + q.length)}</>);
  }

  function openDetail(group) {
    setDetailGroup(group);
    setIsEditing(false);
  }

  function openEdit(group) {
    const photos = groupPhotos(group);
    setDetailGroup(group);
    setIsEditing(true);
    setEditNames([...group[0].names]);
    setEditNotes(group[0].notes || "");
    setEditExistingPhotos(photos);
    setEditNewPhotos([]);
    setNewLocationRows([]);
  }

  // --- ADD SUGGESTIONS ---
  function handleFirstNameChange(val) {
    updateNewName(0, val);
    if (val.trim().length > 0) {
      const matches = items.filter(i => i.names.some(n => n.toLowerCase().includes(val.toLowerCase())));
      const seen = new Set();
      const unique = matches.filter(item => {
        const key = item.names.slice().sort().join("|");
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      setAddSuggestions(unique);
      setShowAddSuggestions(unique.length > 0);
    } else {
      setAddSuggestions([]); setShowAddSuggestions(false);
    }
  }

  function selectAddSuggestion(item) {
    setNewNames([...item.names]);
    setNewNotes(item.notes || "");
    setSourcePhotoUrls(getPhotoUrls(item));
    setNewPhotos([]);
    setShowAddSuggestions(false);
  }

  // --- ADD ITEM ---
  async function addItem() {
    const names = newNames.map(n => n.trim()).filter(Boolean);
    const room = newRoom.trim();
    if (names.length === 0 || !room) return showToast("Add at least one name and a location", "error");
    setSaving(true);
    const { data, error } = await supabase.from("items").insert([{
      names, room, specific: newSpecific || null, notes: newNotes.trim() || null, photo_url: null, photo_urls: []
    }]).select().single();
    if (error) { showToast("Failed to save", "error"); setSaving(false); return; }
    let allUrls = [...sourcePhotoUrls];
    for (let i = 0; i < newPhotos.length; i++) {
      const url = await uploadPhoto(newPhotos[i].file, data.id, i);
      if (url) allUrls.push(url);
    }
    if (allUrls.length > 0) {
      await supabase.from("items").update({ photo_urls: allUrls, photo_url: allUrls[0] }).eq("id", data.id);
    }
    const siblings = items.filter(i => i.names.some(n => names.map(x => x.toLowerCase()).includes(n.toLowerCase())));
    if (siblings.length > 0) {
      await supabase.from("items").update({
        names, notes: newNotes.trim() || null, photo_urls: allUrls, photo_url: allUrls[0] || null
      }).in("id", siblings.map(i => i.id));
    }
    setNewNames([""]); setNewRoom(""); setNewSpecific(""); setNewNotes("");
    setNewPhotos([]); setSourcePhotoUrls([]);
    showToast(`"${names[0]}" added`);
    setSaving(false);
    setView("search");
    fetchItems();
  }

  function updateNewName(i, val) {
    const updated = [...newNames]; updated[i] = val; setNewNames(updated);
  }
  function addNewNameField() { setNewNames([...newNames, ""]); }
  function removeNewNameField(i) {
    if (newNames.length === 1) return;
    setNewNames(newNames.filter((_, idx) => idx !== i));
  }
  function handleNewPhotoAdd(e) {
    const files = Array.from(e.target.files);
    setNewPhotos(prev => [...prev, ...files.map(file => ({ file, preview: URL.createObjectURL(file) }))]);
    e.target.value = "";
  }
  function removeNewPhoto(i) { setNewPhotos(prev => prev.filter((_, idx) => idx !== i)); }
  function removeSourcePhoto(i) { setSourcePhotoUrls(prev => prev.filter((_, idx) => idx !== i)); }

  // --- SAVE EDIT ---
  async function saveEdit() {
    const names = editNames.map(n => n.trim()).filter(Boolean);
    if (names.length === 0) return;
    setSaving(true);
    let allUrls = [...editExistingPhotos];
    for (let i = 0; i < editNewPhotos.length; i++) {
      const url = await uploadPhoto(editNewPhotos[i].file, detailGroup[0].id, i + allUrls.length);
      if (url) allUrls.push(url);
    }
    const groupIds = detailGroup.map(i => i.id);
    await supabase.from("items").update({
      names, notes: editNotes.trim() || null, photo_urls: allUrls, photo_url: allUrls[0] || null
    }).in("id", groupIds);
    const validNewLocations = newLocationRows.filter(r => r.room.trim());
    if (validNewLocations.length > 0) {
      await supabase.from("items").insert(validNewLocations.map(r => ({
        names, room: r.room, specific: r.specific || null,
        notes: editNotes.trim() || null, photo_urls: allUrls, photo_url: allUrls[0] || null
      })));
    }
    showToast("Updated");
    setSaving(false);
    setIsEditing(false);
    await fetchItems();
    // Refresh detailGroup with updated data
    const { data } = await supabase.from("items").select("*").in("id", groupIds);
    if (data) setDetailGroup(data);
  }

  async function deleteItem(id) {
    await supabase.from("items").delete().eq("id", id);
    showToast("Item removed");
    const remaining = detailGroup.filter(i => i.id !== id);
    if (remaining.length === 0) { setDetailGroup(null); setIsEditing(false); }
    else setDetailGroup(remaining);
    fetchItems();
  }

  async function deleteGroup(group) {
    if (group.length > 1) {
      if (!window.confirm(`Delete all ${group.length} locations for "${group[0].names[0]}"?`)) return;
    }
    await Promise.all(group.map(i => supabase.from("items").delete().eq("id", i.id)));
    showToast("Deleted");
    setDetailGroup(null);
    setIsEditing(false);
    fetchItems();
  }

  function updateEditName(i, val) {
    const updated = [...editNames]; updated[i] = val; setEditNames(updated);
  }
  function addEditNameField() { setEditNames([...editNames, ""]); }
  function removeEditNameField(i) {
    if (editNames.length === 1) return;
    setEditNames(editNames.filter((_, idx) => idx !== i));
  }
  function handleEditPhotoAdd(e) {
    const files = Array.from(e.target.files);
    setEditNewPhotos(prev => [...prev, ...files.map(file => ({ file, preview: URL.createObjectURL(file) }))]);
    e.target.value = "";
  }

  // Sort names so matching one is first
  function sortedNames(names) {
    if (!query.trim()) return names;
    const q = query.toLowerCase();
    return [...names].sort((a, b) => {
      const aM = a.toLowerCase().includes(q);
      const bM = b.toLowerCase().includes(q);
      return aM === bM ? 0 : aM ? -1 : 1;
    });
  }

  return (
    <div style={s.root}>
      {lightbox && <Lightbox photos={lightbox.photos} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}

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
            {["search","add"].map(t => (
              <button key={t} style={{ ...s.tab, ...(view === t ? s.tabActive : {}) }}
                onClick={() => { setView(t); setDetailGroup(null); setIsEditing(false); if (t === "search") setTimeout(() => searchRef.current?.focus(), 100); }}>
                {t === "add" ? "+ Add" : "Search"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={s.body}>

        {/* ── SEARCH ── */}
        {view === "search" && !detailGroup && (
          <div style={s.section}>
            {/* Search input */}
            <div style={s.searchWrap}>
              <span style={s.searchIcon}>⌕</span>
              <input ref={searchRef} autoFocus style={s.searchInput}
                placeholder="Type any name..." value={query}
                onChange={e => { setQuery(e.target.value); setDetailGroup(null); setShowAll(false); }}
                autoComplete="off" />
              {(query || showAll) && <button style={s.clearBtn} onClick={() => { setQuery(""); setDetailGroup(null); setShowAll(false); }}>✕</button>}
            </div>

            {/* Room filter */}
            <div>
              <button style={s.filterToggle} onClick={() => setShowRoomFilter(f => !f)}>
                🏷 Filter by room{roomFilter.length > 0 ? ` (${roomFilter.length} selected)` : ""} {showRoomFilter ? "▲" : "▼"}
              </button>
              {showRoomFilter && (
                <div style={s.filterPanel}>
                  <div style={s.filterGrid}>
                    {STOCKROOMS.map(r => (
                      <label key={r} style={s.filterLabel}>
                        <input type="checkbox" checked={roomFilter.includes(r)}
                          onChange={() => toggleRoomFilter(r)} style={s.filterCheckbox} />
                        {r}
                      </label>
                    ))}
                  </div>
                  {roomFilter.length > 0 && <button style={s.filterClear} onClick={() => setRoomFilter([])}>Clear all</button>}
                </div>
              )}
            </div>

            {/* Results */}
            {!query.trim() && !showAll && (
              loading
                ? <div style={s.hint}>Loading...</div>
                : <div style={s.hintRow}>
                    <span style={s.hint}>{inventoryCount} item{inventoryCount !== 1 ? "s" : ""} in inventory{roomFilter.length > 0 ? " (filtered)" : ""} — start typing to search</span>
                    <button style={s.showAllBtn} onClick={() => setShowAll(true)}>Show all</button>
                  </div>
            )}
            {showAll && !query.trim() && (
              <div style={s.hintRow}>
                <span style={s.hint}>Showing all {visibleGroups.length} item{visibleGroups.length !== 1 ? "s" : ""}{roomFilter.length > 0 ? " (filtered)" : ""}</span>
                <button style={s.showAllBtn} onClick={() => setShowAll(false)}>Hide all</button>
              </div>
            )}

            {(query.trim() || roomFilter.length > 0) && visibleGroups.length === 0 && (
              <div style={s.emptyState}>
                <div style={s.emptyIcon}>?</div>
                <div style={s.emptyText}>No items found</div>
                {query.trim() && (
                  <button style={s.addHintBtn} onClick={() => { setNewNames([query]); setView("add"); }}>
                    Add "{query}" →
                  </button>
                )}
              </div>
            )}

            {visibleGroups.map((group, gi) => {
              const photos = groupPhotos(group);
              const names = sortedNames(group[0].names);
              return (
                <div key={gi} style={s.resultCard} onClick={() => openDetail(group)}>
                  <div style={s.cardRow}>
                    {photos.length > 0 && (
                      <div style={s.thumbWrap} onClick={e => { e.stopPropagation(); setLightbox({ photos, index: 0 }); }}>
                        <img src={photos[0]} style={s.manageThumb} />
                        {photos.length > 1 && <div style={s.thumbBadge}>+{photos.length - 1}</div>}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {names.map((n, i) => (
                        <div key={i} style={i === 0 ? s.cardName : s.cardAlias}>{highlight(n, query)}</div>
                      ))}
                      <div style={s.locationTagRow}>
                        {visibleLocations(group).map(item => (
                          <div key={item.id} style={s.locationTag}>{locationLabel(item)}</div>
                        ))}
                      </div>
                    </div>
                    <span style={s.chevron}>›</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── DETAIL / EDIT ── */}
        {view === "search" && detailGroup && (
          <div style={s.section}>
            <button style={s.backBtn} onClick={() => { setDetailGroup(null); setIsEditing(false); }}>‹ Back</button>

            {!isEditing ? (
              /* Detail view */
              <div style={s.detailCard}>
                <div style={s.detailHeader}>
                  <div style={{ flex: 1 }}>
                    {detailGroup[0].names.map((n, i) => (
                      <div key={i} style={i === 0 ? s.detailName : s.detailAlias}>{n}</div>
                    ))}
                  </div>
                  <div style={s.detailActions}>
                    <button style={s.editBtn} onClick={() => openEdit(detailGroup)}>Edit</button>
                    <button style={s.deleteBtn} onClick={() => deleteGroup(detailGroup)}>✕</button>
                  </div>
                </div>

                <div style={s.locationTagRow}>
                  {detailGroup.map(item => (
                    <div key={item.id} style={s.locationTag}>{locationLabel(item)}</div>
                  ))}
                </div>

                {detailGroup[0].notes && (
                  <div style={s.notesBox}>
                    <span style={s.notesIcon}>📝</span>
                    <span style={s.notesText}>{detailGroup[0].notes}</span>
                  </div>
                )}

                {(() => {
                  const photos = groupPhotos(detailGroup);
                  return photos.length > 0 ? (
                    <div style={s.photoGrid}>
                      {photos.map((url, i) => (
                        <div key={i} style={s.photoGridItem}>
                          <img src={url} style={s.photoGridImg} onClick={() => setLightbox({ photos, index: i })} />
                        </div>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
            ) : (
              /* Edit view */
              <div style={s.formCard}>
                <div style={s.formTitle}>Edit Item</div>

                <label style={s.label}>Names</label>
                {editNames.map((name, i) => (
                  <div key={i} style={s.nameRow}>
                    <input style={{ ...s.input, flex: 1, marginBottom: 6 }}
                      value={name} onChange={e => updateEditName(i, e.target.value)} />
                    {editNames.length > 1 && <button style={s.removeNameBtn} onClick={() => removeEditNameField(i)}>✕</button>}
                  </div>
                ))}
                <button style={s.addNameBtn} onClick={addEditNameField}>+ Add another name</button>

                <label style={s.label}>Notes <span style={s.optional}>(optional)</span></label>
                <textarea style={{ ...s.textarea, marginBottom: 8 }} value={editNotes}
                  onChange={e => setEditNotes(e.target.value)} rows={2}
                  placeholder="e.g. Used to stop bleeding via compression" />

                <label style={s.label}>Photos <span style={s.optional}>(optional)</span></label>
                {(editExistingPhotos.length > 0 || editNewPhotos.length > 0) && (
                  <div style={s.photoGrid}>
                    {editExistingPhotos.map((url, i) => (
                      <div key={`ex-${i}`} style={s.photoGridItem}>
                        <img src={url} style={s.photoGridImg} onClick={() => setLightbox({ photos: editExistingPhotos, index: i })} />
                        <button style={s.photoRemoveBtn} onClick={() => setEditExistingPhotos(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                      </div>
                    ))}
                    {editNewPhotos.map((p, i) => (
                      <div key={`enew-${i}`} style={s.photoGridItem}>
                        <img src={p.preview} style={s.photoGridImg} />
                        <button style={s.photoRemoveBtn} onClick={() => setEditNewPhotos(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <button style={{ ...s.photoBtn, marginBottom: 12 }} onClick={() => editPhotoRef.current.click()}>📷 Add Photo</button>
                <input ref={editPhotoRef} type="file" accept="image/*" capture="environment"
                  style={{ display: "none" }} onChange={handleEditPhotoAdd} />

                <label style={s.label}>Locations</label>
                {detailGroup.map(item => (
                  <div key={item.id} style={s.locationEditRow}>
                    <select style={{ ...s.select, flex: 1, fontSize: 13, padding: "8px 10px" }}
                      value={item.room}
                      onChange={async e => { await supabase.from("items").update({ room: e.target.value }).eq("id", item.id); fetchItems(); }}>
                      {STOCKROOMS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <select style={{ ...s.select, width: 90, fontSize: 13, padding: "8px 8px" }}
                      value={item.specific || ""}
                      onChange={async e => { await supabase.from("items").update({ specific: e.target.value || null }).eq("id", item.id); fetchItems(); }}>
                      <option value="">—</option>
                      {SPECIFICS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <button style={s.deleteBtn} onClick={() => deleteItem(item.id)}>✕</button>
                  </div>
                ))}
                {newLocationRows.map((row, i) => (
                  <div key={`nlr-${i}`} style={s.locationEditRow}>
                    <select style={{ ...s.select, flex: 1, fontSize: 13, padding: "8px 10px" }}
                      value={row.room}
                      onChange={e => { const u = [...newLocationRows]; u[i] = { ...u[i], room: e.target.value }; setNewLocationRows(u); }}>
                      <option value="">Select location...</option>
                      {STOCKROOMS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <select style={{ ...s.select, width: 90, fontSize: 13, padding: "8px 8px" }}
                      value={row.specific}
                      onChange={e => { const u = [...newLocationRows]; u[i] = { ...u[i], specific: e.target.value }; setNewLocationRows(u); }}>
                      <option value="">—</option>
                      {SPECIFICS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <button style={s.deleteBtn} onClick={() => setNewLocationRows(newLocationRows.filter((_, idx) => idx !== i))}>✕</button>
                  </div>
                ))}
                <button style={s.addNameBtn} onClick={() => setNewLocationRows([...newLocationRows, { room: "", specific: "" }])}>
                  + Add another location
                </button>

                <div style={s.editActions}>
                  <button style={{ ...s.saveBtn, opacity: saving ? 0.6 : 1 }} onClick={saveEdit} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button style={s.cancelBtn} onClick={() => { setIsEditing(false); setNewLocationRows([]); }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ADD ── */}
        {view === "add" && (
          <div style={s.section}>
            <div style={s.formCard}>
              <div style={s.formTitle}>Add New Item</div>
              <label style={s.label}>Names</label>
              <div style={{ position: "relative" }} ref={addSuggestWrapRef}>
                <div style={s.nameRow}>
                  <input style={{ ...s.input, flex: 1 }} placeholder="e.g. Butterfly needle"
                    value={newNames[0]} onChange={e => handleFirstNameChange(e.target.value)}
                    onFocus={() => newNames[0].trim() && addSuggestions.length > 0 && setShowAddSuggestions(true)}
                    autoComplete="off" />
                  {newNames.length > 1 && <button style={s.removeNameBtn} onClick={() => removeNewNameField(0)}>✕</button>}
                </div>
                {showAddSuggestions && (
                  <div style={{ ...s.dropdown, position: "absolute", top: "calc(100% + 2px)", zIndex: 60 }}>
                    {addSuggestions.map(item => {
                      const q = newNames[0].toLowerCase();
                      const matched = item.names.find(n => n.toLowerCase().includes(q)) || item.names[0];
                      const others = item.names.filter(n => n !== matched);
                      return (
                        <button key={item.id} style={s.suggestion} onMouseDown={() => selectAddSuggestion(item)}>
                          <div style={s.suggestionLeft}>
                            <div style={s.suggestionName}>{highlight(matched, newNames[0])}</div>
                            {others.length > 0 && <div style={s.suggestionSub}>{others.join(" · ")}</div>}
                          </div>
                          <div style={s.suggestionRoom}>{item.room}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {newNames.slice(1).map((name, i) => (
                <div key={i + 1} style={s.nameRow}>
                  <input style={{ ...s.input, flex: 1 }} placeholder="e.g. Winged infusion set"
                    value={name} onChange={e => updateNewName(i + 1, e.target.value)} />
                  <button style={s.removeNameBtn} onClick={() => removeNewNameField(i + 1)}>✕</button>
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

              <label style={s.label}>Photos <span style={s.optional}>(optional)</span></label>
              {(sourcePhotoUrls.length > 0 || newPhotos.length > 0) && (
                <div style={s.photoGrid}>
                  {sourcePhotoUrls.map((url, i) => (
                    <div key={`src-${i}`} style={s.photoGridItem}>
                      <img src={url} style={s.photoGridImg} onClick={() => setLightbox({ photos: sourcePhotoUrls, index: i })} />
                      <button style={s.photoRemoveBtn} onClick={() => removeSourcePhoto(i)}>✕</button>
                    </div>
                  ))}
                  {newPhotos.map((p, i) => (
                    <div key={`new-${i}`} style={s.photoGridItem}>
                      <img src={p.preview} style={s.photoGridImg} />
                      <button style={s.photoRemoveBtn} onClick={() => removeNewPhoto(i)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <button style={s.photoBtn} onClick={() => newPhotoRef.current.click()}>📷 Add Photo</button>
              <input ref={newPhotoRef} type="file" accept="image/*" capture="environment"
                style={{ display: "none" }} onChange={handleNewPhotoAdd} />

              <div style={s.editActions}>
                <button style={{ ...s.primaryBtn, marginTop: 14, flex: 1, opacity: saving ? 0.6 : 1 }} onClick={addItem} disabled={saving}>
                  {saving ? "Saving..." : "Add Item"}
                </button>
                <button style={{ ...s.cancelBtn, marginTop: 14 }} onClick={() => {
                  setNewNames([""]); setNewRoom(""); setNewSpecific(""); setNewNotes("");
                  setNewPhotos([]); setSourcePhotoUrls([]); setShowAddSuggestions(false);
                  setView("search");
                }}>Cancel</button>
              </div>
            </div>
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
  searchWrap: { position: "relative", display: "flex", alignItems: "center" },
  searchIcon: { position: "absolute", left: 14, fontSize: 20, color: C.muted, pointerEvents: "none" },
  searchInput: { width: "100%", background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 16, padding: "13px 40px 13px 42px", outline: "none", boxSizing: "border-box" },
  clearBtn: { position: "absolute", right: 12, background: "transparent", border: "none", color: C.muted, fontSize: 14, cursor: "pointer", padding: 4 },
  filterToggle: { background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 12, width: "100%", textAlign: "left" },
  filterPanel: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px", marginTop: 6 },
  filterGrid: { display: "flex", flexDirection: "column", gap: 8 },
  filterLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.text, cursor: "pointer" },
  filterCheckbox: { width: 16, height: 16, accentColor: C.accent, cursor: "pointer" },
  filterClear: { background: "transparent", border: "none", color: C.accent, fontSize: 12, cursor: "pointer", marginTop: 10, padding: 0 },
  hint: { textAlign: "center", color: C.muted, fontSize: 13, marginTop: 8 },
  hintRow: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 8 },
  showAllBtn: { background: "transparent", border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: "7px 18px", cursor: "pointer", fontSize: 13 },
  emptyState: { textAlign: "center", padding: "40px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 },
  emptyIcon: { fontSize: 36 },
  emptyText: { color: C.muted, fontSize: 14 },
  addHintBtn: { background: "transparent", border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, marginTop: 6 },
  // Result cards
  resultCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer" },
  cardRow: { display: "flex", alignItems: "center", gap: 10 },
  cardName: { fontSize: 14, fontWeight: 600, lineHeight: 1.4 },
  cardAlias: { fontSize: 12, color: C.muted, lineHeight: 1.4 },
  chevron: { color: C.muted, fontSize: 20, flexShrink: 0 },
  // Detail
  backBtn: { background: "transparent", border: "none", color: C.blue, fontSize: 14, cursor: "pointer", padding: "0 0 4px 0", textAlign: "left" },
  detailCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px", display: "flex", flexDirection: "column", gap: 12 },
  detailHeader: { display: "flex", alignItems: "flex-start", gap: 10 },
  detailName: { fontSize: 17, fontWeight: 700, lineHeight: 1.4 },
  detailAlias: { fontSize: 13, color: C.muted, lineHeight: 1.5 },
  detailActions: { display: "flex", gap: 6, flexShrink: 0 },
  // Shared
  locationTagRow: { display: "flex", flexWrap: "wrap", gap: 5 },
  locationTag: { background: "#1a2332", border: `1px solid #2d4a6b`, color: C.blue, borderRadius: 5, padding: "3px 8px", fontSize: 11, fontWeight: 600 },
  notesBox: { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", display: "flex", gap: 8, alignItems: "flex-start" },
  notesIcon: { fontSize: 13, flexShrink: 0, marginTop: 1 },
  notesText: { fontSize: 13, color: C.muted, lineHeight: 1.5 },
  thumbWrap: { position: "relative", cursor: "pointer", flexShrink: 0 },
  manageThumb: { width: 52, height: 52, borderRadius: 6, objectFit: "cover", display: "block" },
  thumbBadge: { position: "absolute", bottom: 3, right: 3, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 4px" },
  highlight: { color: C.accent, fontWeight: 700 },
  // Form
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
  photoGrid: { display: "flex", flexWrap: "wrap", gap: 8 },
  photoGridItem: { position: "relative" },
  photoGridImg: { width: 72, height: 72, borderRadius: 8, objectFit: "cover", cursor: "zoom-in", display: "block" },
  photoRemoveBtn: { position: "absolute", top: -6, right: -6, background: C.accent, border: "none", color: "#fff", borderRadius: "50%", width: 20, height: 20, fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 },
  primaryBtn: { background: C.accent, border: "none", borderRadius: 8, color: "#fff", fontSize: 15, fontWeight: 600, padding: "13px", cursor: "pointer", width: "100%" },
  editBtn: { background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12 },
  deleteBtn: { background: "transparent", border: `1px solid #3d1a1a`, color: "#f85149", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12 },
  locationEditRow: { display: "flex", gap: 6, alignItems: "center", marginBottom: 6 },
  editActions: { display: "flex", gap: 8 },
  saveBtn: { background: C.green, border: "none", borderRadius: 6, color: "#fff", padding: "7px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600, flex: 1 },
  cancelBtn: { background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, padding: "7px 18px", cursor: "pointer", fontSize: 13 },
  dropdown: { position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, zIndex: 50, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" },
  suggestion: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, color: C.text, padding: "12px 14px", cursor: "pointer", textAlign: "left", gap: 10 },
  suggestionLeft: { flex: 1, minWidth: 0 },
  suggestionName: { fontSize: 14, fontWeight: 500 },
  suggestionSub: { fontSize: 11, color: C.muted, marginTop: 2 },
  suggestionRoom: { fontSize: 12, color: C.blue, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 },
  lightboxOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" },
  lightboxInner: { position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, maxWidth: "95vw" },
  lightboxImg: { maxWidth: "95vw", maxHeight: "80vh", borderRadius: 8, objectFit: "contain" },
  lightboxNav: { display: "flex", alignItems: "center", gap: 20 },
  lightboxNavBtn: { background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 28, borderRadius: 8, padding: "6px 16px", cursor: "pointer" },
  lightboxCounter: { color: "#fff", fontSize: 13 },
  lightboxClose: { position: "absolute", top: -40, right: 0, background: "transparent", border: "none", color: "#fff", fontSize: 24, cursor: "pointer" },
  toast: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: C.green, color: "#fff", borderRadius: 8, padding: "10px 22px", fontSize: 14, fontWeight: 600, zIndex: 100, boxShadow: "0 4px 20px rgba(0,0,0,0.4)" },
  toastError: { background: C.accent },
};
