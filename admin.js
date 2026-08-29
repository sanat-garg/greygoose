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

  /* ---------- load / save --------------------------------------------------- */

  fetch("data.json", { cache: "no-store" })
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
      data.fields.members = data.fields.members || [];
      data.fields.parties = data.fields.parties || [];
      data.access = data.access || { enabled: false, title: "", intro: "", questions: [] };
      data.access.questions = data.access.questions || [];
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

  saveBtn.addEventListener("click", save);

  /* Tell the user before they type anything whether this page can save at all. */
  (async function checkServer() {
    try {
      const r = await fetch("api/ping", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      await r.json();
      hasServer = true;
      connChip("live");
    } catch {
      hasServer = false;
      connChip("dead");
      const box = banner("noserver");
      box.innerHTML = `<b>Read-only — this page cannot save.</b> It is being served by
        something that is not <code>server.py</code>, so there is no place to write to.
        Anything you change here will be lost.
        <br><br>
        From the greygoose folder, stop the current server and run:
        <br><code>python3 server.py</code><br>
        then open <code>http://127.0.0.1:8777/admin.html</code>.`;
    }
  })();

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
    saveBtn.disabled = true;
    setStatus("saving…");
    banner("");
    try {
      const res = await fetch("api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.status === 403) throw new Error("locked");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const out = await res.json();
      if (!out.ok) throw new Error(out.error || "save failed");
      dirty = false;
      hasServer = true;
      setStatus("saved ✓", "is-ok");
    } catch (err) {
      hasServer = false;
      saveBtn.disabled = false;
      setStatus("NOT saved", "is-err");
      failedSave(err);
    }
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
      : `<b>Nothing was saved.</b> This page is not talking to
         <code>server.py</code> — your changes are still only in this browser tab,
         and the website will not show them.
         <br><br>
         Saving needs <code>server.py</code>, not <code>python3 -m http.server</code>.
         Stop whatever is serving this folder, then from the greygoose folder run:
         <br><code>python3 server.py</code><br>
         reload this page and make the change again.
         <br><br><i>(${esc(err.message)})</i>`;

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

    const commit = () => {
      const out = {};
      $$(".rec-row", box).forEach((row) => {
        const label = row.dataset.label.trim();
        if (label) out[label] = $(".rec-val", row).value;
      });
      onChange(out);
      markDirty();
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
        if (isStandard) {
          const list = std();
          list[list.indexOf(label)] = next;
          /* renaming a shared field renames it on everyone who filled it in */
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
        markDirty();
        redraw();
      });

      const val = el("input", "rec-val");
      val.type = "text";
      val.value = rec[label] || "";
      val.placeholder = isStandard ? "—" : "Value";
      val.addEventListener("input", commit);

      const chip = el("button", "scope " + (isStandard ? "is-all" : "is-one"),
        isStandard ? "Everyone" : "Just " + whoLabel);
      chip.type = "button";
      chip.title = isStandard
        ? "Shown on everyone. Click to make it only this one."
        : "Only on this one. Click to give it to everyone.";
      chip.addEventListener("click", () => {
        const list = std();
        if (isStandard) list.splice(list.indexOf(label), 1);
        else list.push(label);
        markDirty();
        redraw();
      });

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
          const list = std();
          list.splice(list.indexOf(label), 1);
          collection(kind).forEach((i) => { if (i.record) delete i.record[label]; });
        } else {
          delete rec[label];
        }
        markDirty();
        redraw();
      });

      row.append(name, val, chip, del);
      box.appendChild(row);
    }

    const redraw = () => {
      draw();
      onChange(collect());
      if (kind === "members") renderMembers(); else renderParties();
    };
    const collect = () => {
      const out = {};
      $$(".rec-row", box).forEach((row) => {
        const l = row.dataset.label.trim();
        if (l) out[l] = $(".rec-val", row).value;
      });
      return out;
    };

    draw();

    const addAll = el("button", "btn btn--sm", "+ Field for everyone");
    addAll.addEventListener("click", () => {
      const label = prompt("Name of the new field — every " +
        (kind === "members" ? "member" : "party") + " will get this box:");
      if (!label || !label.trim()) return;
      const l = label.trim();
      if (std().includes(l)) { alert(`"${l}" already exists.`); return; }
      std().push(l);
      markDirty();
      redraw();
    });

    const addOne = el("button", "btn btn--sm", "+ Field just for " + whoLabel);
    addOne.addEventListener("click", () => {
      const label = prompt("Name of the new field — only " + whoLabel + " gets it:");
      if (!label || !label.trim()) return;
      const l = label.trim();
      if (std().includes(l) || l in rec) { alert(`"${l}" already exists.`); return; }
      rec[l] = "";
      markDirty();
      redraw();
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

    /* the answer that was on disk, so clearing the box restores it rather
       than leaving a half-typed hash behind */
    const original = q.hash || "";
    ai.addEventListener("input", () => {
      const v = ai.value.trim();
      if (!v) {
        q.hash = original;
        note.textContent = original ? "answer unchanged" : "no answer set";
        note.className = "q-note" + (original ? "" : " is-err");
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
        const res = await fetch("api/upload", {
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
    fetch("api/delete", {
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
