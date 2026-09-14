/* ============================================================================
   GREYGOOSE — admin.js
   Edits data.json in the browser and saves it through server.py.
   Saving REQUIRES server.py — `python3 -m http.server` has no /api/save, so
   nothing can be written. We check for it on load and say so plainly rather
   than letting you make edits that quietly go nowhere.
   ========================================================================== */

(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  /* the fields a new member / party starts with — the data template */
  const MEMBER_FIELDS = [
    "Class of", "Hometown", "Lives", "Studying", "In greygoose since",
    "Signature drink", "Party job", "Undefeated at", "Most likely to", "Catchphrase",
  ];
  const PARTY_FIELDS_UPCOMING = ["Date", "Theme", "Where", "Headcount", "Soundtrack", "House rule"];
  const PARTY_FIELDS_PAST = ["Date", "Theme", "Where", "Headcount", "Soundtrack", "Damage report", "MVP"];

  let data = null;
  let dirty = false;
  /* question id -> the answer hash as it currently exists on disk. Clearing an
     answer box restores from this, so it can never resurrect a stale hash or
     silently drop the one you just typed. */
  let savedHashes = {};
  let hasServer = true;
  let selMember = 0;
  let selParty = 0;

  const statusEl = $("#status");
  const saveBtn = $("#save");

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = "status" + (cls ? " " + cls : "");
  }
  function markDirty() {
    dirty = true;
    saveBtn.disabled = false;
    setStatus("unsaved changes", "is-dirty");
  }

  window.addEventListener("beforeunload", (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------- admin lock ------------------------------------------------------
     The editor is what actually changes the site, so it gets its own password,
     stored server-side in .adminpass and never in data.json. */

  const lock = $("#lock");
  let lockMode = "login";     // "login" | "setup" | "change"

  function showLock(mode, title, intro, btn) {
    lockMode = mode;
    $("#lock-title").textContent = title;
    $("#lock-intro").textContent = intro;
    $("#lock-go").textContent = btn;
    $("#lock-pw").value = "";
    $("#lock-pw2").value = "";
    $("#lock-pw2").hidden = mode === "login";
    $("#lock-pw").placeholder =
      mode === "change" ? "current password" : mode === "setup" ? "new password" : "admin password";
    $("#lock-pw").autocomplete = mode === "login" ? "current-password" : "new-password";
    $("#lock-msg").textContent = "";
    lock.hidden = false;
    document.body.classList.add("is-locked");
    setTimeout(() => $("#lock-pw").focus(), 50);
  }
  function hideLock() {
    lock.hidden = true;
    document.body.classList.remove("is-locked");
  }
  function lockError(msg) {
    $("#lock-msg").textContent = msg;
    const box = $(".lock__box");
    box.classList.remove("is-wrong");
    void box.offsetWidth;
    box.classList.add("is-wrong");
  }

  $("#lock-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("#lock-pw").value;
    const pw2 = $("#lock-pw2").value;
    try {
      if (lockMode === "login") {
        const r = await fetch("api/admin-login.php", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw }),
        });
        const out = await r.json();
        if (!out.ok) return lockError(out.error || "wrong password");
        hideLock();
        boot();
        return;
      }
      const body = lockMode === "change"
        ? { current: pw, new: pw2 }
        : { new: pw };
      if (lockMode === "setup" && pw !== pw2) return lockError("the two entries do not match");
      const r = await fetch("api/admin-password.php", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await r.json();
      if (!out.ok) return lockError(out.error || "could not set the password");
      hideLock();
      if (lockMode === "change") setStatus("admin password changed ✓", "is-ok");
      else boot();
    } catch (err) {
      lockError("could not reach server.py");
    }
  });

  (async function guard() {
    let st;
    try {
      st = await (await fetch("api/admin-status.php", { cache: "no-store" })).json();
    } catch {
      boot();                       /* no server: the read-only banner covers it */
      return;
    }
    if (!st.configured) {
      showLock("setup", "Set a password",
        "Nobody has set one yet. Pick a password for this editor — it is stored on your machine, never in data.json.",
        "Set password");
    } else if (!st.authed) {
      showLock("login", "Locked", "Enter the admin password to edit the site.", "Unlock");
    } else {
      boot();
    }
  })();

  /* ---------- load / save --------------------------------------------------- */

  function boot() {
  fetch("api/data.php", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then((d) => {
      data = d;
      data.crews = data.crews || [];
      data.members = data.members || [];
      data.parties = data.parties || [];
      data.gallery = data.gallery || [];
      data.fields = data.fields || {};
      data.fields.members = healFields(data.fields.members, data.members);
      data.fields.parties = healFields(data.fields.parties, data.parties);
      data.access = data.access || { enabled: false, title: "", intro: "", questions: [] };
      data.access.questions = data.access.questions || [];
      data.submissions = data.submissions || [];
      data.joinForm = Object.assign(defaultJoinForm(), data.joinForm || {});
      snapshotAnswers();
      setStatus("loaded");
      renderAll();
    })
    .catch((err) => {
      const locked = String(err.message).includes("403");
      setStatus(locked ? "locked — unlock the site first" : "could not load data.json", "is-err");
      $("#member-editor").innerHTML = locked
        ? `<p class="empty">The server is running with <code>--gate</code>.<br>
           Open <a href="index.html">the site</a>, answer a question, then reload this page.</p>`
        : `<p class="empty">Start the server first:<br><code>python3 server.py</code><br><br>${esc(err.message)}</p>`;
    });
  }

  saveBtn.addEventListener("click", save);

  /* Tell the user before they type anything whether this page can save at all. */
  (async function checkServer() {
    try {
      const r = await fetch("api/ping.php", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      await r.json();
      hasServer = true;
      connChip("live");
    } catch {
      hasServer = false;
      connChip("dead");
      banner("noserver").innerHTML = whyNoServer();
    }
  })();

  /* The old message always said "run server.py", which is wrong advice when
     the page is opened from disk or from the published copy. Work out which
     of the three it actually is. */
  function whyNoServer() {
    const host = location.hostname;
    const onDisk = location.protocol === "file:";
    const local = ["localhost", "127.0.0.1", "::1", "[::1]", ""].includes(host);

    if (onDisk) {
      return `<b>Opened straight from disk.</b> This page is at
        <code>${esc(location.href.split("?")[0])}</code>, so it has no server to save to
        — double-clicking the file cannot work.
        <br><br>
        From the greygoose folder run:<br><code>python3 server.py</code><br>
        then open <code>http://127.0.0.1:8777/admin.html</code>.`;
    }
    if (!local) {
      return `<b>This is the published copy, not your editor.</b> You are on
        <code>${esc(host)}</code>, which only serves files — it cannot run
        <code>server.py</code>, so nothing here can be saved.
        <br><br>
        Edit on your own machine instead: run <code>python3 server.py</code> in the
        greygoose folder, open <code>http://127.0.0.1:8777/admin.html</code>, make your
        changes, then commit and push <code>data.json</code> to update this copy.`;
    }
    return `<b>Nothing was saved.</b> This page is not talking to
      <code>server.py</code> — your changes are still only in this browser tab,
      and the website will not show them.
      <br><br>
      Saving needs <code>server.py</code>, not <code>python3 -m http.server</code>.
      Stop whatever is serving this folder, then from the greygoose folder run:
      <br><code>python3 server.py</code><br>
      reload this page and make the change again.`;
  }

  function connChip(state) {
    let chip = $("#conn");
    if (!chip) {
      chip = el("span", "chip");
      chip.id = "conn";
      statusEl.parentNode.insertBefore(chip, statusEl);
    }
    chip.className = "chip is-" + state;
    chip.textContent = state === "live" ? "server.py" : "no server";
    chip.title = state === "live"
      ? "Connected to server.py — Save writes data.json"
      : "Not connected to server.py — nothing can be saved";
  }

  async function save() {
    /* A question with no text or no answer can never be answered — if the gate
       picks it, the visitor is locked out. Catch it before it reaches disk. */
    const incomplete = (data.access.questions || []).filter(
      (q) => !(q.question || "").trim() || !q.hash
    );
    if (incomplete.length) {
      const go = confirm(
        incomplete.length + " question" + (incomplete.length > 1 ? "s are" : " is") +
        " missing text or an answer.\n\nNobody can ever answer " +
        (incomplete.length > 1 ? "them" : "it") + ", and anyone who gets asked would be " +
        "locked out.\n\nOK to drop " + (incomplete.length > 1 ? "them" : "it") +
        " and save, or Cancel to go back and finish."
      );
      if (!go) { setStatus("not saved — finish the questions", "is-err"); return; }
      data.access.questions = data.access.questions.filter(
        (q) => (q.question || "").trim() && q.hash
      );
      renderAccess();
    }

    saveBtn.disabled = true;
    setStatus("saving…");
    banner("");
    try {
      const res = await fetch("api/save.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.status === 401) {
        showLock("login", "Session expired", "Sign in again to save your changes.", "Unlock");
        throw new Error("admin");
      }
      if (res.status === 403) throw new Error("locked");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const out = await res.json();
      if (!out.ok) throw new Error(out.error || "save failed");
      dirty = false;
      hasServer = true;
      snapshotAnswers();      /* what is on disk just changed */
      refreshAnswerRows();
      setStatus("saved ✓", "is-ok");
    } catch (err) {
      hasServer = false;
      saveBtn.disabled = false;
      setStatus("NOT saved", "is-err");
      failedSave(err);
    }
  }

  /* If the shared field list is empty while the records are full, the schema
     was lost — every field would show as "just this person" and renaming would
     stop propagating. Rebuild it from the keys the records actually use. */
  function healFields(current, items) {
    if (current && current.length) return current;
    const order = [], seen = new Set(), counts = {};
    (items || []).forEach((it) => {
      Object.keys(it.record || {}).forEach((k) => {
        counts[k] = (counts[k] || 0) + 1;
        if (!seen.has(k)) { seen.add(k); order.push(k); }
      });
    });
    const need = Math.max(1, Math.floor((items || []).length / 2));
    return order.filter((k) => counts[k] >= need);
  }

  function snapshotAnswers() {
    savedHashes = {};
    (data.access.questions || []).forEach((q) => { savedHashes[q.id] = q.hash || ""; });
  }

  /* after a save every row's "answer saved" state may have changed */
  function refreshAnswerRows() {
    $$("#q-list .q-row").forEach((row) => {
      const ai = row.querySelectorAll("input")[1];
      const note = row.querySelector(".q-note");
      const id = row.dataset.qid;
      const saved = savedHashes[id];
      ai.value = "";
      ai.placeholder = saved ? "answer saved — type to change it" : "the answer";
      note.textContent = saved ? "answer saved" : "no answer set";
      note.className = "q-note" + (saved ? "" : " is-err");
    });
  }

  /* A failed save used to quietly download a file, which looked like the save
     had worked somewhere odd. Say plainly what happened instead. */
  function failedSave(err) {
    const locked = err.message === "locked";
    const box = banner(locked ? "locked" : "noserver");
    box.innerHTML = locked
      ? `<b>Not saved — the server is locked.</b> It is running with
         <code>--gate</code>. Open <a href="index.html" target="_blank">the site</a>,
         answer a question, come back and press Save again.`
      : whyNoServer() + `<br><br><i>(${esc(err.message)})</i>`;

    if (!locked) {
      const dl = el("button", "btn btn--sm", "Download data.json instead");
      dl.addEventListener("click", download);
      box.appendChild(document.createElement("br"));
      box.appendChild(dl);
    }
  }

  function banner(kind) {
    let box = $("#banner");
    if (!box) {
      box = el("div", "banner");
      box.id = "banner";
      document.querySelector("main").prepend(box);
    }
    box.hidden = !kind;
    return box;
  }

  function download() {
    const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
    const a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = "data.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- tabs ---------------------------------------------------------- */

  $$(".tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      $$(".tabs button").forEach((x) => x.classList.toggle("is-active", x === b));
      $$(".panel").forEach((p) =>
        p.classList.toggle("is-active", p.dataset.panel === b.dataset.tab)
      );
    })
  );

  function renderAll() {
    renderMembers();
    renderParties();
    renderGallery();
    renderCrews();
    renderAccess();
    renderRequests();
    renderFields();
    renderJoinForm();
  }

  /* ---------- shared bits --------------------------------------------------- */

  function field(labelText, node) {
    const f = el("div", "field");
    f.appendChild(el("label", null, esc(labelText)));
    f.appendChild(node);
    return f;
  }

  function textInput(value, onInput) {
    const i = el("input");
    i.type = "text";
    i.value = value || "";
    i.addEventListener("input", () => { onInput(i.value); markDirty(); });
    return i;
  }

  function textArea(value, onInput) {
    const t = el("textarea");
    t.value = value || "";
    t.addEventListener("input", () => { onInput(t.value); markDirty(); });
    return t;
  }

  /* ---------- record editor ---------------------------------------------------
     Two kinds of row:
       · standard — the label lives in data.fields, so EVERY member (or party)
                    gets this box. Renaming it renames it for everyone.
       · one-off  — the label lives only in this record. Nobody else sees it.
     The chip on each row flips it between the two.
     -------------------------------------------------------------------------- */

  function recordEditor(record, kind, whoLabel, onChange) {
    const wrap = el("div");
    const box = el("div", "record-editor");
    const rec = record || {};
    const std = () => (data.fields[kind] = data.fields[kind] || []);

    /* Copy what is typed into the record itself, in place. Replacing the
       object would leave this editor holding a different one than the member. */
    const syncValues = () => {
      $$(".rec-row", box).forEach((row) => {
        const label = (row.dataset.label || "").trim();
        if (label) rec[label] = $(".rec-val", row).value;
      });
      onChange(rec);
    };

    const draw = () => {
      box.innerHTML = "";
      const standard = std();
      const seen = new Set(standard);
      const oneOffs = Object.keys(rec).filter((k) => !seen.has(k));

      standard.forEach((label) => addRow(label, true));
      if (oneOffs.length) {
        box.appendChild(el("div", "rec-divider", esc("Only on " + whoLabel)));
        oneOffs.forEach((label) => addRow(label, false));
      }
    };

    function addRow(label, isStandard) {
      const row = el("div", "rec-row");
      row.dataset.label = label;

      const name = el("input", "rec-key");
      name.type = "text";
      name.value = label;
      name.placeholder = "Field name";
      name.addEventListener("change", () => {
        const next = name.value.trim();
        if (!next || next === label) { name.value = label; return; }
        const clash = std().includes(next) || (!isStandard && next in rec);
        if (clash) { alert('"' + next + '" already exists.'); name.value = label; return; }
        restructure(() => {
          if (isStandard) {
            const list = std();
            const at = list.indexOf(label);
            if (at > -1) list[at] = next; else list.push(next);
            /* a shared field renames on everyone who filled it in */
            collection(kind).forEach((item) => {
              if (item.record && label in item.record) {
                item.record[next] = item.record[label];
                delete item.record[label];
              }
            });
          } else {
            rec[next] = rec[label];
            delete rec[label];
          }
        });
      });

      const val = el("input", "rec-val");
      val.type = "text";
      val.value = rec[label] || "";
      val.placeholder = isStandard ? "—" : "Value";
      val.addEventListener("input", () => {
        rec[label] = val.value;
        onChange(rec);
        markDirty();
      });

      const chip = el("button", "scope " + (isStandard ? "is-all" : "is-one"),
        isStandard ? "Everyone" : "Just " + whoLabel);
      chip.type = "button";
      chip.title = isStandard
        ? "Shown on everyone. Click to make it only this one."
        : "Only on this one. Click to give it to everyone.";
      chip.addEventListener("click", () => restructure(() => {
        const list = std();
        const at = list.indexOf(label);
        if (isStandard) {
          if (at > -1) list.splice(at, 1);       /* -1 would splice off the tail */
        } else if (at === -1) {
          list.push(label);
          /* everyone gets the box; only this person keeps a value in it */
          collection(kind).forEach((i) => {
            if (i.record && !(label in i.record)) i.record[label] = "";
          });
        }
      }));

      const del = el("button", "rec-del", "✕");
      del.type = "button";
      del.title = isStandard
        ? "Remove this field from everyone"
        : "Remove this field";
      del.addEventListener("click", () => {
        if (isStandard) {
          const used = collection(kind).filter((i) => i.record && i.record[label]).length;
          if (!confirm(
            `Remove "${label}" from every ${kind === "members" ? "member" : "party"}?` +
            (used ? `\n\n${used} of them have something written in it — that text is deleted too.` : "")
          )) return;
          restructure(() => {
            const list = std();
            const at = list.indexOf(label);
            if (at > -1) list.splice(at, 1);
            collection(kind).forEach((i) => { if (i.record) delete i.record[label]; });
          });
        } else {
          restructure(() => { delete rec[label]; });
        }
      });

      row.append(name, val, chip, del);
      box.appendChild(row);
    }

    /* Structural edits must read the DOM BEFORE they change anything — doing it
       afterwards re-added keys that had just been renamed away. */
    const restructure = (mutate) => {
      syncValues();
      mutate();
      markDirty();
      if (kind === "members") renderMembers(); else renderParties();
    };

    draw();

    const addAll = el("button", "btn btn--sm", "+ Field for everyone");
    addAll.addEventListener("click", () => {
      const label = prompt("Name of the new field — every " +
        (kind === "members" ? "member" : "party") + " will get this box:");
      if (!label || !label.trim()) return;
      const l = label.trim();
      if (std().includes(l)) { alert(`"${l}" already exists.`); return; }
      restructure(() => {
        std().push(l);
        collection(kind).forEach((i) => {
          if (i.record && !(l in i.record)) i.record[l] = "";
        });
      });
    });

    const addOne = el("button", "btn btn--sm", "+ Field just for " + whoLabel);
    addOne.addEventListener("click", () => {
      const label = prompt("Name of the new field — only " + whoLabel + " gets it:");
      if (!label || !label.trim()) return;
      const l = label.trim();
      if (std().includes(l) || l in rec) { alert(`"${l}" already exists.`); return; }
      restructure(() => { rec[l] = ""; });
    });

    const bar = el("div", "rec-add");
    bar.append(addAll, addOne);
    wrap.append(box, bar);
    return wrap;
  }

  const collection = (kind) => (kind === "members" ? data.members : data.parties);

  /* every photo the site knows about */
  function library() {
    const set = new Set(data.gallery || []);
    data.members.forEach((m) => {
      if (m.photo) set.add(m.photo);
      (m.photos || []).forEach((p) => set.add(p));
    });
    data.parties.forEach((p) => (p.photos || []).forEach((x) => set.add(x)));
    return [...set];
  }

  /* thumbnail strip with a + that opens the picker */
  function photoStrip(list, onChange, single) {
    const wrap = el("div", "photo-pick" + (single ? " photo-pick--single" : ""));
    const draw = () => {
      wrap.innerHTML = "";
      list.forEach((src, i) => {
        const fig = el("figure");
        fig.innerHTML = `<img src="${esc(src)}" alt="">`;
        const x = el("button", "x", "✕");
        x.title = "Remove";
        x.addEventListener("click", () => {
          list.splice(i, 1);
          onChange(list);
          markDirty();
          draw();
        });
        fig.appendChild(x);
        wrap.appendChild(fig);
      });
      const add = el("button", "add", single && list.length ? "Change" : "+");
      add.title = "Choose from the library";
      add.addEventListener("click", () =>
        openPicker(list, single, (picked) => {
          list.length = 0;
          list.push(...picked);
          onChange(list);
          markDirty();
          draw();
        })
      );
      wrap.appendChild(add);
    };
    draw();
    return wrap;
  }

  /* ---------- picker modal --------------------------------------------------- */

  const picker = $("#picker");
  const pickerGrid = $("#picker-grid");
  let pickerDone = null;

  function openPicker(current, single, done) {
    pickerDone = done;
    const chosen = [...current];
    $("#picker-title").textContent = single ? "Choose a photo" : "Choose photos";
    pickerGrid.innerHTML = "";

    library().forEach((src) => {
      const fig = el("figure");
      fig.innerHTML = `<img src="${esc(src)}" alt=""><span class="n"></span>`;
      const paint = () => {
        const i = chosen.indexOf(src);
        fig.classList.toggle("is-on", i > -1);
        $(".n", fig).textContent = i > -1 ? i + 1 : "";
      };
      fig.addEventListener("click", () => {
        const i = chosen.indexOf(src);
        if (i > -1) chosen.splice(i, 1);
        else if (single) { chosen.length = 0; chosen.push(src); }
        else chosen.push(src);
        $$("figure", pickerGrid).forEach((f) => f._paint());
      });
      fig._paint = paint;
      paint();
      pickerGrid.appendChild(fig);
    });

    picker.hidden = false;
    picker._chosen = chosen;
  }

  $("#picker-close").addEventListener("click", () => {
    picker.hidden = true;
    if (pickerDone) pickerDone(picker._chosen || []);
    pickerDone = null;
  });
  picker.addEventListener("click", (e) => {
    if (e.target === picker) $("#picker-close").click();
  });

  /* ---------- members -------------------------------------------------------- */

  function nextId(list, prefix) {
    let max = 0;
    list.forEach((x) => {
      const m = /(\d+)$/.exec(x.id || "");
      if (m) max = Math.max(max, +m[1]);
    });
    return prefix + String(max + 1).padStart(2, "0");
  }

  function crewOf(id) {
    return data.crews.find((c) => c.id === id) || data.crews[0] || { color: "#1E4BD7", name: "—" };
  }

  function renderMembers() {
    const ul = $("#member-list");
    ul.innerHTML = "";
    $("#member-count").textContent = data.members.length;

    data.members.forEach((m, i) => {
      const li = el("li");
      li.style.setProperty("--swatch", crewOf(m.crew).color);
      li.classList.toggle("is-active", i === selMember);
      li.innerHTML =
        (m.photo ? `<img src="${esc(m.photo)}" alt="">` : `<span class="dot"></span>`) +
        `<span>${esc(m.name || "Untitled")}</span>` +
        `<small>${esc(crewOf(m.crew).name)}</small>`;
      li.addEventListener("click", () => { selMember = i; renderMembers(); });
      ul.appendChild(li);
    });

    renderMemberEditor();
  }

  function renderMemberEditor() {
    const box = $("#member-editor");
    box.innerHTML = "";
    const m = data.members[selMember];
    if (!m) {
      box.appendChild(el("p", "empty", "No member selected. Add one to get started."));
      return;
    }

    const head = el("div", "editor__head");
    const title = el("div");
    title.appendChild(el("h2", null, esc(m.name || "Untitled")));
    title.appendChild(el("div", "id", "file " + esc(m.id)));
    const del = el("button", "btn btn--danger btn--sm", "Delete member");
    del.addEventListener("click", () => {
      if (!confirm(`Delete ${m.name}? This removes their file from the site.`)) return;
      data.members.splice(selMember, 1);
      selMember = Math.max(0, selMember - 1);
      markDirty();
      renderMembers();
    });
    head.append(title, del);
    box.appendChild(head);

    box.appendChild(
      field("Name", textInput(m.name, (v) => {
        m.name = v;
        $("h2", head).textContent = v || "Untitled";
        const li = $$("#member-list li")[selMember];
        if (li) $("span", li).textContent = v || "Untitled";
      }))
    );

    const crewSel = el("select");
    data.crews.forEach((c) => {
      const o = el("option", null, esc(c.name));
      o.value = c.id;
      if (c.id === m.crew) o.selected = true;
      crewSel.appendChild(o);
    });
    crewSel.addEventListener("change", () => {
      m.crew = crewSel.value;
      markDirty();
      renderMembers();
    });

    const igInput = textInput((m.socials && m.socials.instagram) || "", (v) => {
      m.socials = m.socials || {};
      if (v.trim()) m.socials.instagram = v.trim().replace(/^@/, "");
      else delete m.socials.instagram;
    });

    const row = el("div", "row");
    row.append(field("Crew", crewSel), field("Instagram handle", igInput));
    box.appendChild(row);

    const one = m.photo ? [m.photo] : [];
    box.appendChild(
      field("Portrait", photoStrip(one, (list) => {
        m.photo = list[0] || "";
        const li = $$("#member-list li")[selMember];
        const thumb = li && $("img", li);
        if (thumb) thumb.src = m.photo;
      }, true))
    );

    box.appendChild(
      field("Blurb — two or three sentences", textArea(m.blurb, (v) => (m.blurb = v)))
    );

    box.appendChild(
      field("The record", recordEditor(m.record, "members",
        (m.name || "them").split(" ")[0], (r) => (m.record = r)))
    );

    m.photos = m.photos || [];
    box.appendChild(
      field("Their photos — shown as the scrapbook", photoStrip(m.photos, (l) => (m.photos = l)))
    );
  }

  $("#add-member").addEventListener("click", () => {
    const record = {};
    (data.fields.members.length ? data.fields.members : MEMBER_FIELDS)
      .forEach((f) => (record[f] = ""));
    data.members.push({
      id: nextId(data.members, "gg-"),
      crew: (data.crews[0] || {}).id || "founders",
      name: "New friend",
      photo: "",
      record,
      blurb: "",
      photos: [],
      socials: {},
    });
    selMember = data.members.length - 1;
    markDirty();
    renderMembers();
  });

  /* ---------- parties -------------------------------------------------------- */

  function renderParties() {
    const ul = $("#party-list");
    ul.innerHTML = "";
    $("#party-count").textContent = data.parties.length;

    data.parties.forEach((p, i) => {
      const li = el("li");
      li.style.setProperty("--swatch", p.status === "past" ? "#D71E1E" : "#FFE927");
      li.classList.toggle("is-active", i === selParty);
      li.innerHTML =
        (p.photos && p.photos[0] ? `<img src="${esc(p.photos[0])}" alt="">` : `<span class="dot"></span>`) +
        `<span>${esc(p.name || "Untitled")}</span>` +
        `<small>${p.status === "past" ? "past" : "upcoming"}</small>`;
      li.addEventListener("click", () => { selParty = i; renderParties(); });
      ul.appendChild(li);
    });

    renderPartyEditor();
  }

  function renderPartyEditor() {
    const box = $("#party-editor");
    box.innerHTML = "";
    const p = data.parties[selParty];
    if (!p) {
      box.appendChild(el("p", "empty", "No party selected. Add one to get started."));
      return;
    }

    const head = el("div", "editor__head");
    const title = el("div");
    title.appendChild(el("h2", null, esc(p.name || "Untitled")));
    title.appendChild(el("div", "id", "file " + esc(p.id)));
    const del = el("button", "btn btn--danger btn--sm", "Delete party");
    del.addEventListener("click", () => {
      if (!confirm(`Delete ${p.name}?`)) return;
      data.parties.splice(selParty, 1);
      selParty = Math.max(0, selParty - 1);
      markDirty();
      renderParties();
    });
    head.append(title, del);
    box.appendChild(head);

    const nameInput = textInput(p.name, (v) => {
      p.name = v;
      $("h2", head).textContent = v || "Untitled";
      const li = $$("#party-list li")[selParty];
      if (li) $("span", li).textContent = v || "Untitled";
    });

    const statusSel = el("select");
    [["upcoming", "Upcoming"], ["past", "Past"]].forEach(([v, t]) => {
      const o = el("option", null, t);
      o.value = v;
      if (v === p.status) o.selected = true;
      statusSel.appendChild(o);
    });
    statusSel.addEventListener("change", () => {
      p.status = statusSel.value;
      markDirty();
      renderParties();
    });

    const row = el("div", "row");
    row.append(field("Name", nameInput), field("Status", statusSel));
    box.appendChild(row);

    box.appendChild(field("Blurb", textArea(p.blurb, (v) => (p.blurb = v))));
    box.appendChild(field("The record", recordEditor(p.record, "parties",
      "this party", (r) => (p.record = r))));

    p.photos = p.photos || [];
    box.appendChild(
      field("Photos — the first one goes on the file, the rest become the scrapbook",
        photoStrip(p.photos, (l) => { p.photos = l; renderParties(); }))
    );

    box.appendChild(paymentFields(p));
    box.appendChild(shareFields(p));
  }

  /* ---------- party: entry fee ---------------------------------------------- */

  function paymentFields(p) {
    p.payment = p.payment || { enabled: false, price: "", currency: "INR", note: "", link: "" };
    const pay = p.payment;

    const wrap = el("div", "subsection");
    wrap.appendChild(el("h3", null, "Entry fee"));

    const on = el("input");
    on.type = "checkbox";
    on.checked = !!pay.enabled;
    const onLabel = el("label", "check");
    onLabel.append(on, document.createTextNode(" Charge for this party"));

    const body = el("div");
    const paint = () => { body.style.display = on.checked ? "" : "none"; };
    on.addEventListener("change", () => { pay.enabled = on.checked; paint(); markDirty(); });

    const cur = el("select");
    [["INR", "₹ INR"], ["USD", "$ USD"], ["EUR", "€ EUR"], ["GBP", "£ GBP"]].forEach(([v, t]) => {
      const o = el("option", null, t);
      o.value = v;
      if (v === pay.currency) o.selected = true;
      cur.appendChild(o);
    });
    cur.addEventListener("change", () => { pay.currency = cur.value; markDirty(); });

    const row = el("div", "row");
    row.append(
      field("Amount", textInput(pay.price, (v) => (pay.price = v))),
      field("Currency", cur)
    );
    body.appendChild(row);
    body.appendChild(field("What it covers", textInput(pay.note, (v) => (pay.note = v))));

    const link = textInput(pay.link, (v) => (pay.link = v.trim()));
    link.placeholder = "https://… paste your PayU payment link here";
    body.appendChild(field("Payment link", link));
    body.appendChild(
      el("p", "hint",
        "Leave the link empty and the button shows but stays inert — useful while a " +
        "party is still being planned. Paste your PayU (or any) payment-page URL when " +
        "it is ready and the button starts working.")
    );

    wrap.append(onLabel, body);
    paint();
    return wrap;
  }

  /* ---------- party: share link --------------------------------------------- */

  function randomKey() {
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function shareFields(p) {
    const wrap = el("div", "subsection");
    wrap.appendChild(el("h3", null, "Share link"));
    wrap.appendChild(
      el("p", "hint",
        "Anyone with this link sees this one party and nothing else — no members, " +
        "no gallery, no other parties, and no password prompt. Regenerating the key " +
        "kills every link you have already sent.")
    );

    const out = el("input");
    out.type = "text";
    out.readOnly = true;

    const paint = () => {
      p.share = p.share || randomKey();
      out.value = new URL(
        "party.html?id=" + encodeURIComponent(p.id) + "&k=" + encodeURIComponent(p.share),
        location.href
      ).toString();
    };
    paint();

    const copy = el("button", "btn btn--sm", "Copy");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(out.value);
        copy.textContent = "Copied ✓";
      } catch {
        out.select();
        copy.textContent = "Press ⌘C";
      }
      setTimeout(() => (copy.textContent = "Copy"), 1800);
    });

    const open = el("a", "btn btn--sm", "Open ↗");
    open.href = out.value;
    open.target = "_blank";
    open.rel = "noopener";

    const regen = el("button", "btn btn--sm btn--danger", "New key");
    regen.addEventListener("click", () => {
      if (!confirm("Generate a new key?\n\nEvery link you have already shared for this party will stop working.")) return;
      p.share = randomKey();
      paint();
      open.href = out.value;
      markDirty();
    });

    const bar = el("div", "share-row");
    bar.append(out, copy, open, regen);
    wrap.appendChild(bar);
    wrap.appendChild(
      el("p", "hint",
        "The link only works once you have saved — it is the saved key the site checks.")
    );
    return wrap;
  }

  /* ---------- access gate ---------------------------------------------------- */

  function normalise(s) {
    return String(s == null ? "" : s)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      // keep only letters and digits, so capitals, spaces, hyphens and
      // apostrophes all stop mattering: "Arnold-Palmer" == "arnold palmer"
      .replace(/[^a-z0-9]+/g, "");
  }

  /* sha256.js, not crypto.subtle — so this works from any address */
  const hashAnswer = (answer) => "sha256:" + window.ggSha256(normalise(answer));

  function renderAccess() {
    const a = data.access;
    $("#access-on").checked = !!a.enabled;
    $("#access-on").onchange = (e) => { a.enabled = e.target.checked; markDirty(); };

    const title = $("#access-title");
    title.value = a.title || "";
    title.oninput = () => { a.title = title.value; markDirty(); };

    const intro = $("#access-intro");
    intro.value = a.intro || "";
    intro.oninput = () => { a.intro = intro.value; markDirty(); };

    const box = $("#q-list");
    box.innerHTML = "";
    a.questions.forEach((q) => box.appendChild(questionRow(q)));
    refreshQuestionCount();
  }

  function refreshQuestionCount() {
    const box = $("#q-list");
    const n = data.access.questions.length;
    $("#q-count").textContent = n;
    const empty = $("#q-empty", box);
    if (n) {
      if (empty) empty.remove();
    } else if (!empty) {
      const p = el("p", "hint", "No questions yet — add one, or the gate cannot open.");
      p.id = "q-empty";
      box.appendChild(p);
    }
  }

  /* One row, built once. Removing a question detaches only its own row, so
     answers half-typed in the other rows are not wiped out along with it. */
  function questionRow(q) {
    const row = el("div", "q-row");
    row.dataset.qid = q.id;

    const qi = el("input");
    qi.type = "text";
    qi.value = q.question || "";
    qi.placeholder = "Something only the group would know";
    qi.addEventListener("input", () => { q.question = qi.value; markDirty(); });

    const ai = el("input");
    ai.type = "text";
    ai.placeholder = q.hash ? "answer saved — type to change it" : "the answer";

    const note = el("div", "q-note", q.hash ? "answer saved" : "no answer set");
    if (!q.hash) note.className = "q-note is-err";

    ai.addEventListener("input", () => {
      const v = ai.value.trim();
      if (!v) {
        /* read the baseline live — a stale copy taken when the row was built
           would undo an answer that has since been saved */
        const base = savedHashes[q.id] || "";
        q.hash = base;
        note.textContent = base ? "answer unchanged" : "no answer set";
        note.className = "q-note" + (base ? "" : " is-err");
        markDirty();
        return;
      }
      q.hash = hashAnswer(v);
      note.textContent =
        '\u201c' + v + '\u201d — capitals, spaces and punctuation are ignored. Press Save.';
      note.className = "q-note is-ok";
      markDirty();
    });

    const del = el("button", "btn btn--sm btn--danger", "Remove");
    del.addEventListener("click", () => {
      const list = data.access.questions;
      if (list.length < 2 && data.access.enabled) {
        alert("Keep at least one question while the gate is on.");
        return;
      }
      if (!confirm("Remove this question?\n\nThe other questions and their answers are untouched.")) return;
      const at = list.indexOf(q);          /* by identity, never by a stale index */
      if (at > -1) list.splice(at, 1);
      row.remove();
      refreshQuestionCount();
      markDirty();
    });

    const grid = el("div", "q-grid");
    grid.append(qi, ai, del);
    row.append(grid, note);
    return row;
  }

  /* ---------- bulk field editor ------------------------------------------------
     One place to change the record rows for everyone at once, instead of
     opening a member and editing the shared list from inside their file. */

  function fieldsOf(kind) {
    data.fields[kind] = data.fields[kind] || [];
    return data.fields[kind];
  }

  function renderFields() {
    [["members", "#mfield-list", "#mf-count"],
     ["parties", "#pfield-list", "#pf-count"]].forEach(([kind, listSel, countSel]) => {
      const list = fieldsOf(kind);
      const box = $(listSel);
      box.innerHTML = "";
      $(countSel).textContent = list.length;

      if (!list.length) {
        box.appendChild(el("p", "fld-empty",
          "No shared fields. Add one and every " +
          (kind === "members" ? "member" : "party") + " gets that box."));
        return;
      }

      list.forEach((label, i) => box.appendChild(fieldRow(kind, label, i, list.length)));
    });
  }

  function fieldRow(kind, label, i, total) {
    const items = collection(kind);
    const used = items.filter((it) => (it.record || {})[label]).length;
    const row = el("div", "fld-row");

    /* reorder */
    const move = el("div", "fld-move");
    const up = el("button", null, "↑");
    const down = el("button", null, "↓");
    up.type = down.type = "button";
    up.title = "Move up"; down.title = "Move down";
    up.disabled = i === 0;
    down.disabled = i === total - 1;
    up.addEventListener("click", () => swapField(kind, i, i - 1));
    down.addEventListener("click", () => swapField(kind, i, i + 1));
    move.append(up, down);

    /* rename, for everyone */
    const name = el("input");
    name.type = "text";
    name.value = label;
    name.addEventListener("change", () => {
      const next = name.value.trim();
      if (!next || next === label) { name.value = label; return; }
      if (fieldsOf(kind).includes(next)) {
        alert(`"${next}" already exists.`);
        name.value = label;
        return;
      }
      const list = fieldsOf(kind);
      list[list.indexOf(label)] = next;
      items.forEach((it) => {
        if (it.record && label in it.record) {
          it.record[next] = it.record[label];
          delete it.record[label];
        }
      });
      markDirty();
      afterFieldChange(kind);
    });

    const usedTag = el("div", "fld-used" + (used ? "" : " is-empty"),
      used ? `${used}/${items.length} filled` : "blank on all");

    /* the bulk part: one value onto every file */
    const fill = el("button", "btn btn--sm", "Fill for everyone");
    fill.type = "button";
    fill.addEventListener("click", () => {
      const v = prompt(
        `Write the same "${label}" onto all ${items.length} ` +
        (kind === "members" ? "member files" : "parties") +
        ".\n\nLeave it empty to clear the field on everyone.",
        ""
      );
      if (v === null) return;
      const val = v.trim();
      const overwriting = items.filter((it) => (it.record || {})[label]).length;
      if (overwriting && !confirm(
        (val ? `Set "${label}" to "${val}"` : `Clear "${label}"`) +
        ` on all ${items.length}?\n\n${overwriting} already have something written there and will be overwritten.`
      )) return;
      items.forEach((it) => { it.record = it.record || {}; it.record[label] = val; });
      markDirty();
      afterFieldChange(kind);
    });

    /* remove, from everyone */
    const del = el("button", "btn btn--sm btn--danger", "Remove");
    del.type = "button";
    del.addEventListener("click", () => {
      if (!confirm(
        `Remove "${label}" from every ` + (kind === "members" ? "member" : "party") + "?" +
        (used ? `\n\n${used} have something written in it — that text goes too.` : "")
      )) return;
      const list = fieldsOf(kind);
      list.splice(list.indexOf(label), 1);
      items.forEach((it) => { if (it.record) delete it.record[label]; });
      markDirty();
      afterFieldChange(kind);
    });

    row.append(move, name, usedTag, fill, del);
    return row;
  }

  function swapField(kind, a, b) {
    const list = fieldsOf(kind);
    if (b < 0 || b >= list.length) return;
    [list[a], list[b]] = [list[b], list[a]];
    markDirty();
    afterFieldChange(kind);
  }

  /* every field change ripples into the record editors and the join form */
  function afterFieldChange(kind) {
    renderFields();
    if (kind === "members") { renderMembers(); renderJoinForm(); }
    else renderParties();
  }

  $("#add-mfield").addEventListener("click", () => addField("members"));
  $("#add-pfield").addEventListener("click", () => addField("parties"));

  function addField(kind) {
    const label = prompt("Name of the new field — every " +
      (kind === "members" ? "member" : "party") + " gets this box:");
    if (!label || !label.trim()) return;
    const l = label.trim();
    if (fieldsOf(kind).includes(l)) { alert(`"${l}" already exists.`); return; }
    fieldsOf(kind).push(l);
    collection(kind).forEach((it) => {
      it.record = it.record || {};
      if (!(l in it.record)) it.record[l] = "";
    });
    if (kind === "members") (data.joinForm.ask = data.joinForm.ask || []).push(l);
    markDirty();
    afterFieldChange(kind);
  }

  /* ---------- the join form ----------------------------------------------------
     What friends see at join.html. The questions are the shared member fields,
     so whatever they type lands in the right box on their file. */

  function defaultJoinForm() {
    return {
      title: "YOUR FILE",
      intro: "Fill this in and you get your own file in the archive. Skip anything you " +
             "would rather not answer — blanks simply do not show up.",
      doneTitle: "Got it",
      doneText: "Your file is with the group now. It shows up once someone waves it through.",
      askPhoto: true,
      askInstagram: true,
      askCrew: true,
      ask: ((data && data.fields && data.fields.members) || []).slice(),
      hints: {},
    };
  }

  function renderJoinForm() {
    const jf = data.joinForm;

    const bind = (sel, key) => {
      const n = $(sel);
      n.value = jf[key] || "";
      n.oninput = () => { jf[key] = n.value; markDirty(); };
    };
    bind("#join-title", "title");
    bind("#join-intro", "intro");
    bind("#join-done-title", "doneTitle");
    bind("#join-done-text", "doneText");

    const check = (sel, key) => {
      const n = $(sel);
      n.checked = !!jf[key];
      n.onchange = () => { jf[key] = n.checked; markDirty(); };
    };
    check("#join-ask-photo", "askPhoto");
    check("#join-ask-ig", "askInstagram");
    check("#join-ask-crew", "askCrew");

    jf.ask = jf.ask || [];
    jf.hints = jf.hints || {};

    const box = $("#join-ask-list");
    box.innerHTML = "";
    const fields = fieldsOf("members");
    $("#join-ask-count").textContent =
      fields.filter((f) => jf.ask.includes(f)).length + " of " + fields.length;

    if (!fields.length) {
      box.appendChild(el("p", "fld-empty",
        "No member fields yet — add some under Fields and they appear here."));
      return;
    }

    fields.forEach((label) => {
      const on = jf.ask.includes(label);
      const row = el("div", "ask-row" + (on ? "" : " is-off"));

      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = on;
      cb.addEventListener("change", () => {
        if (cb.checked) { if (!jf.ask.includes(label)) jf.ask.push(label); }
        else jf.ask = jf.ask.filter((x) => x !== label);
        markDirty();
        renderJoinForm();
      });

      const hint = el("input", "ask-hint");
      hint.type = "text";
      hint.value = jf.hints[label] || "";
      hint.placeholder = "hint shown in the box — optional";
      hint.addEventListener("input", () => {
        if (hint.value.trim()) jf.hints[label] = hint.value;
        else delete jf.hints[label];
        markDirty();
      });

      row.append(cb, el("span", "ask-name", esc(label)), hint);
      box.appendChild(row);
    });
  }

  /* ---------- join requests --------------------------------------------------- */

  function renderRequests() {
    const box = $("#req-list");
    const subs = data.submissions || [];
    box.innerHTML = "";
    $("#req-count").textContent = subs.length;
    const badge = $("#req-badge");
    badge.textContent = subs.length;
    badge.hidden = !subs.length;

    if (!subs.length) {
      box.appendChild(el("p", "hint",
        "Nobody waiting. Send a friend the form link above and their file turns up here."));
      return;
    }

    subs.forEach((sub) => {
      const card = el("div", "req");
      const head = el("div", "req__head");
      head.innerHTML =
        (sub.photo ? `<img src="${esc(sub.photo)}" alt="">` : "") +
        `<div><div class="req__name">${esc(sub.name)}</div>` +
        `<div class="req__when">${esc(sub.at || "")}${
          sub.crew ? " · " + esc((data.crews.find((c) => c.id === sub.crew) || {}).name || sub.crew) : ""
        }</div></div>`;

      const actions = el("div", "req__actions");
      const ok = el("button", "btn btn--sm btn--go", "Add to the site");
      ok.addEventListener("click", () => approve(sub));
      const no = el("button", "btn btn--sm btn--danger", "Discard");
      no.addEventListener("click", () => {
        if (!confirm(`Discard ${sub.name}'s file? This cannot be undone.`)) return;
        data.submissions = data.submissions.filter((s) => s !== sub);
        markDirty();
        renderRequests();
      });
      actions.append(ok, no);
      head.appendChild(actions);
      card.appendChild(head);

      const grid = el("dl", "req__grid");
      Object.entries(sub.record || {}).forEach(([k, v]) => {
        grid.append(el("dt", null, esc(k)), el("dd", null, esc(v)));
      });
      if (sub.instagram) grid.append(el("dt", null, "Instagram"), el("dd", null, "@" + esc(sub.instagram)));
      if (grid.children.length) card.appendChild(grid);
      if (sub.blurb) card.appendChild(el("p", "req__blurb", esc(sub.blurb)));

      box.appendChild(card);
    });
  }

  function approve(sub) {
    const crew = data.crews.find((c) => c.id === sub.crew) || data.crews[0];
    const record = {};
    /* shape it to the shared schema so the new file matches everyone else's */
    (data.fields.members || []).forEach((label) => {
      record[label] = (sub.record || {})[label] || "";
    });
    Object.entries(sub.record || {}).forEach(([k, v]) => {
      if (!(k in record)) record[k] = v;
    });

    data.members.push({
      id: nextId(data.members, "gg-"),
      crew: crew ? crew.id : "",
      name: sub.name,
      photo: sub.photo || "",
      record,
      blurb: sub.blurb || "",
      photos: sub.photo ? [sub.photo] : [],
      socials: sub.instagram ? { instagram: sub.instagram } : {},
    });
    if (sub.photo && !data.gallery.includes(sub.photo)) data.gallery.push(sub.photo);

    data.submissions = data.submissions.filter((s) => s !== sub);
    selMember = data.members.length - 1;
    markDirty();
    renderRequests();
    renderMembers();
    setStatus("added — press Save to publish", "is-dirty");
  }

  $("#copy-join").addEventListener("click", async (e) => {
    e.preventDefault();
    const url = new URL("join.html", location.href).toString();
    try {
      await navigator.clipboard.writeText(url);
      e.target.textContent = "Copied ✓";
    } catch {
      prompt("Copy this link:", url);
    }
    setTimeout(() => (e.target.textContent = "Copy the form link"), 1800);
  });

  $("#change-admin-pw").addEventListener("click", () => {
    showLock("change", "Change password",
      "Enter the current admin password, then the new one. Everyone signed in elsewhere gets signed out.",
      "Change it");
  });

  $("#add-question").addEventListener("click", () => {
    const q = {
      id: "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      question: "",
      hash: "",
    };
    data.access.questions.push(q);
    const row = questionRow(q);
    $("#q-list").appendChild(row);
    refreshQuestionCount();
    row.querySelector("input").focus();
    markDirty();
  });

  $("#add-party").addEventListener("click", () => {
    const record = {};
    (data.fields.parties.length ? data.fields.parties : PARTY_FIELDS_UPCOMING)
      .forEach((f) => (record[f] = ""));
    data.parties.push({
      id: nextId(data.parties, "ev-"),
      name: "New party",
      status: "upcoming",
      record,
      blurb: "",
      photos: [],
    });
    selParty = data.parties.length - 1;
    markDirty();
    renderParties();
  });

  /* ---------- gallery -------------------------------------------------------- */

  const dropzone = $("#dropzone");
  const fileInput = $("#file-input");
  const uploads = $("#uploads");

  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-over");
    })
  );
  dropzone.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
  fileInput.addEventListener("change", () => {
    handleFiles(fileInput.files);
    fileInput.value = "";
  });

  async function handleFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    uploads.hidden = false;

    for (const file of files) {
      const line = el("div", null, `${esc(file.name)} — uploading…`);
      uploads.appendChild(line);
      try {
        const dataUrl = await readAsDataURL(file);
        const res = await fetch("api/upload.php", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, dataUrl }),
        });
        const out = await res.json();
        if (!out.ok) throw new Error(out.error || "upload failed");
        data.gallery.push(out.path);
        line.className = "ok";
        line.textContent = `${file.name} → ${out.path}`;
        markDirty();
        renderGallery();
      } catch (err) {
        line.className = "err";
        line.textContent = `${file.name} — ${err.message}. Uploading needs server.py running.`;
      }
    }
    setTimeout(() => { uploads.innerHTML = ""; uploads.hidden = true; }, 6000);
  }

  const readAsDataURL = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

  let dragFrom = null;

  function renderGallery() {
    const grid = $("#gallery-grid");
    grid.innerHTML = "";
    $("#gallery-count").textContent = data.gallery.length;

    data.gallery.forEach((src, i) => {
      const fig = el("figure");
      fig.draggable = true;
      fig.innerHTML =
        `<img src="${esc(src)}" alt=""><figcaption>${esc(src.split("/").pop())}</figcaption>`;

      const x = el("button", "x", "✕");
      x.title = "Remove from gallery";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        removePhoto(src, i);
      });
      fig.appendChild(x);

      fig.addEventListener("dragstart", () => {
        dragFrom = i;
        fig.classList.add("is-drag");
      });
      fig.addEventListener("dragend", () => fig.classList.remove("is-drag"));
      fig.addEventListener("dragover", (e) => e.preventDefault());
      fig.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragFrom == null || dragFrom === i) return;
        const [moved] = data.gallery.splice(dragFrom, 1);
        data.gallery.splice(i, 0, moved);
        dragFrom = null;
        markDirty();
        renderGallery();
      });

      grid.appendChild(fig);
    });
  }

  function removePhoto(src, i) {
    if (!confirm(`Remove ${src.split("/").pop()} from the gallery?`)) return;
    data.gallery.splice(i, 1);
    markDirty();
    renderGallery();

    const stillUsed = library().includes(src);
    if (stillUsed) return;
    if (!hasServer) return;
    if (!confirm(`Nothing uses this photo any more.\n\nAlso delete the file ${src} from disk? This cannot be undone.`)) return;
    fetch("api/delete.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: src }),
    }).catch(() => {});
  }

  /* ---------- crews ---------------------------------------------------------- */

  function renderCrews() {
    const box = $("#crew-list");
    box.innerHTML = "";
    $("#crew-count").textContent = data.crews.length;

    data.crews.forEach((c, i) => {
      const row = el("div", "crew-row");

      const color = el("input");
      color.type = "color";
      color.value = c.color || "#1E4BD7";
      color.addEventListener("input", () => {
        c.color = color.value.toUpperCase();
        markDirty();
        renderMembers();
      });

      const name = textInput(c.name, (v) => { c.name = v; renderMembers(); });
      const blurb = textInput(c.blurb, (v) => (c.blurb = v));
      blurb.placeholder = "One line about this crew";

      const del = el("button", "btn btn--danger btn--sm", "Delete");
      del.addEventListener("click", () => {
        if (data.crews.length < 2) { alert("Keep at least one crew."); return; }
        const n = data.members.filter((m) => m.crew === c.id).length;
        if (!confirm(`Delete "${c.name}"?${n ? `\n\n${n} member(s) will move to "${data.crews.find((x) => x !== c).name}".` : ""}`)) return;
        const fallback = data.crews.find((x) => x !== c).id;
        data.members.forEach((m) => { if (m.crew === c.id) m.crew = fallback; });
        data.crews.splice(i, 1);
        markDirty();
        renderCrews();
        renderMembers();
      });

      row.append(color, name, blurb, del);
      box.appendChild(row);
    });
  }

  $("#add-crew").addEventListener("click", () => {
    const palette = ["#1E4BD7", "#0C7866", "#581E70", "#D71E1E", "#FFE927", "#000000"];
    data.crews.push({
      id: "crew-" + Date.now().toString(36),
      name: "New crew",
      color: palette[data.crews.length % palette.length],
      text: "light",
      blurb: "",
    });
    markDirty();
    renderCrews();
  });
})();
