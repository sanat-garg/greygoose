/* ============================================================================
   GREYGOOSE — site.js
   Drives index.html (members + gallery) and parties.html (parties), reading
   everything from data.json. Motion mirrors the reference site: a per-character
   hero reveal, folders settling into the stack on scroll, scrapbook float-in.
   ========================================================================== */

(function () {
  "use strict";

  const PAGE = document.body.dataset.page; // home | parties | gallery | party
  let FIELDS = { members: [], parties: [] };   // shared field order, from data.json
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const $ = (s, r = document) => r.querySelector(s);
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
  const inkOn = (mode) => (mode === "dark" ? "#191919" : "#ffffff");
  const pad2 = (n) => String(n).padStart(2, "0");

  /* stable pseudo-random, so the scrapbook scatter doesn't jump on reload */
  const rng = (seed) => {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  };
  const hash = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = (h ^ str.charCodeAt(i)) * 16777619;
    return h >>> 0;
  };
  const debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  /* ---------- scroll motion ------------------------------------------------ */

  const revealer = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        revealer.unobserve(e.target);
      });
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.05 }
  );

  function watch(node, delay) {
    if (delay) node.style.setProperty("--d", delay + "s");
    if (REDUCED) { node.classList.add("is-in"); return; }
    revealer.observe(node);
  }
  const watchAll = (nodes, step = 0.06, base = 0) =>
    [...nodes].forEach((n, i) => watch(n, base + i * step));

  /* Each letter rises out of its own mask, staggered across the line — the
     reference site's effect, driven by GSAP there and by CSS here. */
  function splitText(node, text) {
    node.textContent = "";
    const words = String(text).split(" ");
    words.forEach((word, wi) => {
      const w = el("span", "word");
      [...word].forEach((ch) => {
        const mask = el("span", "char-mask");
        mask.appendChild(el("span", "char", esc(ch)));
        w.appendChild(mask);
      });
      node.appendChild(w);
      if (wi < words.length - 1) node.appendChild(document.createTextNode(" "));
    });

    const chars = node.querySelectorAll(".char");
    chars.forEach((c, i) => c.style.setProperty("--d", (0.1 + i * 0.035).toFixed(3) + "s"));
    if (REDUCED) { chars.forEach((c) => c.classList.add("is-in")); return; }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => chars.forEach((c) => c.classList.add("is-in")))
    );
  }

  /* ---------- record table -------------------------------------------------- */

  /* Standard fields first, in the order set in data.json, then anything that
     only this one person has. Blank values are skipped entirely. */
  function recordTable(record, order) {
    const wrap = el("div", "record");
    const rec = record || {};
    const seen = new Set();
    const rows = [];

    (order || []).forEach((label) => {
      seen.add(label);
      if (rec[label]) rows.push([label, rec[label]]);
    });
    Object.entries(rec).forEach(([k, v]) => {
      if (!seen.has(k) && v) rows.push([k, v]);
    });

    rows.forEach(([k, v]) => {
      const row = el("div", "record__row");
      row.append(el("div", "record__k", esc(k)), el("div", "record__v", esc(v)));
      wrap.appendChild(row);
    });
    return wrap;
  }

  /* ---------- scrapbook ----------------------------------------------------- */

  const label = (src) =>
    String(src).split("/").pop().replace(/\.[a-z0-9]+$/i, "").toUpperCase();

  function buildScrapbook(seedKey, photos, note) {
    const book = el("div", "scrapbook");
    const items = [];

    const shots = photos || [];
    shots.forEach((src, i) => {
      const fig = el("figure", "scrap scrap--photo");
      fig.innerHTML =
        `<span class="scrap__clip"></span>` +
        `<img src="${esc(src)}" alt="" loading="lazy">` +
        `<figcaption>${esc(label(src))}</figcaption>`;
      /* arrows step through this person's own photos, not the whole gallery */
      fig.querySelector("img").addEventListener("click", () => openLightbox(src, shots, i));
      items.push(fig);
    });

    if (note && note.text) {
      const n = el("figure", "scrap scrap--note");
      n.innerHTML = `<h3>${esc(note.title)}</h3><p>${esc(note.text)}</p>`;
      items.push(n);
    }

    items.forEach((it) => book.appendChild(it));
    watchAll(items, 0.09);
    scatter(book, items, seedKey);

    /* images decide the collage height, so re-measure once each one lands */
    book.querySelectorAll("img").forEach((img) => {
      if (img.complete) return;
      img.addEventListener("load", () => book._relayout && book._relayout(), { once: true });
      img.addEventListener("error", () => book._relayout && book._relayout(), { once: true });
    });
    return book;
  }

  /* loose two-column collage on wide screens, plain stack on narrow */
  function scatter(book, items, seedKey) {
    const apply = () => {
      const wide = window.matchMedia("(min-width: 900px)").matches;
      if (!wide || !items.length) {
        book.classList.remove("is-scatter");
        items.forEach((it) => {
          it.style.left = it.style.top = it.style.width = "";
          it.style.rotate = "";
        });
        return;
      }
      book.classList.add("is-scatter");
      const rand = rng(hash(seedKey));
      const bw = book.clientWidth || 900;
      const colW = Math.min(430, Math.max(300, bw * 0.42));
      let y = 20, bottom = 0, col = 0;
      items.forEach((it) => {
        const w = colW * (0.82 + rand() * 0.3);
        it.style.width = w + "px";
        const left = col === 0
          ? bw * 0.02 + rand() * 40
          : bw - w - (bw * 0.02 + rand() * 40);
        const top = y + rand() * 40;
        const rot = (rand() - 0.5) * 5;
        it.style.left = Math.max(0, left) + "px";
        it.style.top = top + "px";
        it.style.rotate = rot.toFixed(2) + "deg";
        it.dataset.rot = rot;
        const h = it.offsetHeight || 300;
        bottom = Math.max(bottom, top + h);
        col ^= 1;
        if (col === 0) y = top + h * 0.35;
      });
      book.style.setProperty("--scrap-h", bottom + 40 + "px");
    };
    book._relayout = apply;
    requestAnimationFrame(() => requestAnimationFrame(apply));
    window.addEventListener("resize", debounce(apply, 200));
  }

  /* ---------- files --------------------------------------------------------- */

  /* cross-fade one file out and the next one in, then re-measure the folder */
  function swapFile(host, run) {
    host.classList.add("is-swapping");
    setTimeout(() => {
      run();
      host.classList.remove("is-swapping");
      const folder = host.closest(".folder");
      if (folder) {
        sizeBody(folder);
        [60, 300].forEach((t) => setTimeout(() => sizeBody(folder), t));
        settleOpen(folder);
      }
    }, 200);
  }

  function fileNav(idx, total, hasNextFolder) {
    const nav = el("div", "file__nav");
    const prev = el("button", null, "‹ Prev");
    const next = el("button", null, "Next ›");
    prev.disabled = idx === 0;
    next.disabled = idx === total - 1;
    prev.dataset.go = "prev";
    next.dataset.go = "next";
    nav.append(prev, el("span", null, `${pad2(idx + 1)} / ${pad2(total)}`), next);
    if (hasNextFolder) {
      const nf = el("button", null, "Next folder →");
      nf.dataset.go = "folder";
      nav.appendChild(nf);
    }
    return nav;
  }

  function wireNav(file, host, list, idx, render) {
    file.querySelectorAll(".file__nav button").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const folder = file.closest(".folder");
        if (b.dataset.go === "folder") {
          const all = [...document.querySelectorAll(".folder")];
          const nxt = all[all.indexOf(folder) + 1] || all[0];
          openFolder(nxt, true);
          return;
        }
        const ni = b.dataset.go === "next" ? idx + 1 : idx - 1;
        if (ni < 0 || ni >= list.length) return;
        folder.querySelectorAll(".folder__tab").forEach((t, i) =>
          t.classList.toggle("is-active", i === ni)
        );
        swapFile(host, () => render(host, list[ni], ni, list));
      })
    );
  }

  function renderMember(host, m, idx, list) {
    host.innerHTML = "";
    const file = el("div", "file");
    file.appendChild(el("h1", "file__name", esc(m.name)));

    const sheet = el("div", "sheet");
    const left = el("div");
    if (m.photo) {
      left.innerHTML =
        `<div class="sheet__photo"><img src="${esc(m.photo)}" alt="${esc(m.name)}"></div>`;
    }
    left.appendChild(recordTable(m.record, FIELDS.members));

    const right = el("div");
    right.appendChild(el("div", "sheet__desc", `<p>${esc(m.blurb)}</p>`));
    const quote = m.record && m.record["Catchphrase"];
    if (quote) right.appendChild(el("p", "sheet__quote", "“" + esc(quote) + "”"));
    if (m.socials && m.socials.instagram) {
      right.appendChild(
        el("div", "sheet__socials",
          `<a href="https://instagram.com/${esc(m.socials.instagram)}" target="_blank" rel="noopener">@${esc(m.socials.instagram)}</a>`)
      );
    }
    sheet.append(left, right);
    file.appendChild(sheet);

    const likely = m.record && m.record["Most likely to"];
    file.appendChild(
      buildScrapbook(m.id, m.photos, likely ? { title: "Most likely to", text: likely } : null)
    );

    file.appendChild(fileNav(idx, list.length, true));
    host.appendChild(file);
    wireNav(file, host, list, idx, renderMember);
  }

  const CURRENCY = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

  /* Entry fee for a party. The button points at whatever payment link is on
     the party — PayU or anything else — and stays inert until one is set. */
  function paymentBlock(p) {
    const pay = p.payment;
    if (!pay || !pay.enabled || p.status === "past") return null;

    const box = el("div", "pay");
    const sym = CURRENCY[pay.currency] || "";
    const amount = String(pay.price || "").trim();

    box.appendChild(el("div", "pay__label", amount ? "Entry" : "Entry required"));
    if (amount) {
      box.appendChild(
        el("p", "pay__price", esc(sym + amount) +
          (sym ? "" : " " + esc(pay.currency || "")))
      );
    }
    if (pay.note) box.appendChild(el("p", "pay__note", esc(pay.note)));

    if (pay.link) {
      const a = el("a", "pay__btn", "Pay and get on the list");
      a.href = pay.link;
      a.target = "_blank";
      a.rel = "noopener";
      box.appendChild(a);
    } else {
      const b = el("span", "pay__btn", "Pay and get on the list");
      b.setAttribute("aria-disabled", "true");
      box.appendChild(b);
      box.appendChild(el("p", "pay__soon", "Payment link opens closer to the date."));
    }
    return box;
  }

  function renderParty(host, p, idx, list) {
    host.innerHTML = "";
    const file = el("div", "file");
    file.appendChild(el("h1", "file__name", esc(p.name)));

    const sheet = el("div", "sheet");
    const left = el("div");
    if (p.photos && p.photos[0]) {
      left.innerHTML =
        `<div class="sheet__photo"><img src="${esc(p.photos[0])}" alt="${esc(p.name)}"></div>`;
    }
    left.appendChild(recordTable(p.record, FIELDS.parties));

    const right = el("div");
    right.appendChild(
      el("span", "sheet__status", p.status === "past" ? "Past" : "Upcoming")
    );
    right.appendChild(el("div", "sheet__desc", `<p>${esc(p.blurb)}</p>`));
    const pay = paymentBlock(p);
    if (pay) right.appendChild(pay);
    sheet.append(left, right);
    file.appendChild(sheet);

    const noteText = (p.record && (p.record["Damage report"] || p.record["House rule"])) || "";
    const noteTitle = p.record && p.record["Damage report"] ? "Damage report" : "House rule";
    file.appendChild(
      buildScrapbook(p.id, (p.photos || []).slice(1), noteText ? { title: noteTitle, text: noteText } : null)
    );

    file.appendChild(fileNav(idx, list.length, list.length > 1));
    host.appendChild(file);
    wireNav(file, host, list, idx, renderParty);
  }

  /* ---------- folders ------------------------------------------------------- */

  const stack = $("#stack");

  function makeFolder({ id, name, color, text, blurb, count, names }) {
    const f = el("div", "folder");
    f.id = "f-" + id;
    f.style.setProperty("--c", color);
    f.style.setProperty("--on", inkOn(text));
    const tally = count ? `${pad2(count)} ${count === 1 ? "file" : "files"}` : "";
    /* The closed cover carries the name, the count and the blurb, so a folder
       reads as a real panel rather than an empty bar. */
    f.innerHTML = `
      <div class="folder__tabs"></div>
      <div class="folder__cover">
        <div class="folder__cover-top">
          <span class="folder__cover-name">${esc(name)}</span>
          <span class="folder__category">
            <span class="folder__count">${esc(tally)}</span>
            <span class="folder__chev"></span>
          </span>
        </div>
        ${names ? `<p class="folder__names">${esc(names)}</p>` : ""}
        ${blurb ? `<p class="folder__blurb">${esc(blurb)}</p>` : ""}
      </div>
      <div class="folder__body"><div class="folder__body-inner">
        <div class="folder__host"></div>
      </div></div>`;
    f.querySelector(".folder__cover").addEventListener("click", () =>
      f.classList.contains("is-open") ? closeFolder(f) : openFolder(f, true)
    );
    return f;
  }

  function addTabs(folder, labels, onPick) {
    const bar = folder.querySelector(".folder__tabs");
    labels.forEach((lab, i) => {
      const t = el("button", "folder__tab" + (i === 0 ? " is-active" : ""), esc(lab));
      t.addEventListener("click", (e) => {
        e.stopPropagation();
        bar.querySelectorAll(".folder__tab").forEach((x, j) =>
          x.classList.toggle("is-active", j === i)
        );
        const host = folder.querySelector(".folder__host");
        if (!folder.classList.contains("is-open")) openFolder(folder, false);
        swapFile(host, () => onPick(i));
      });
      bar.appendChild(t);
    });
  }

  /* Height handling deliberately avoids resting on a transitioned value.
     A running max-height transition wins over even an !important inline style,
     so if the animation never gets a paint frame (backgrounded tab, zero-size
     viewport, bfcache restore) the folder stays stuck shut. We animate to the
     measured height, then hand control back to the content with `none`. */
  const OPEN_MS = 780;

  function bodyOf(f) { return f.querySelector(".folder__body"); }
  function innerOf(f) { return f.querySelector(".folder__body-inner"); }

  function sizeBody(f) {
    const body = bodyOf(f);
    if (!f.classList.contains("is-open")) return;
    if (body.style.maxHeight === "none") return;   /* already content-driven */
    body.style.maxHeight = innerOf(f).scrollHeight + "px";
  }

  function settleOpen(f) {
    const body = bodyOf(f);
    clearTimeout(f._settle);
    f._settle = setTimeout(() => {
      if (f.classList.contains("is-open")) body.style.maxHeight = "none";
    }, REDUCED ? 0 : OPEN_MS);
  }

  function openFolder(f, scroll) {
    document.querySelectorAll(".folder.is-open").forEach((o) => {
      if (o !== f) closeFolder(o);
    });
    const body = bodyOf(f);
    f.classList.add("is-in", "is-open");
    f.style.zIndex = 100;
    if (stack) stack.classList.add("has-open");

    if (REDUCED) {
      body.style.maxHeight = "none";
    } else {
      body.style.maxHeight = innerOf(f).scrollHeight + "px";
      settleOpen(f);
    }

    if (!f._ro) {
      let raf = 0;
      f._ro = new ResizeObserver(() => {
        if (!f.classList.contains("is-open")) return;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => sizeBody(f));
      });
    }
    f._ro.observe(innerOf(f));
    window.dispatchEvent(new Event("resize"));
    f.querySelectorAll("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", () => sizeBody(f), { once: true });
    });
    [120, 400].forEach((t) => setTimeout(() => sizeBody(f), t));

    if (scroll) setTimeout(() => f.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  function closeFolder(f) {
    const body = bodyOf(f);
    clearTimeout(f._settle);
    /* pin the real height first, otherwise closing from `none` has nothing to
       animate from and the folder simply vanishes */
    if (body.style.maxHeight === "none" || !body.style.maxHeight) {
      body.style.maxHeight = innerOf(f).scrollHeight + "px";
      void body.offsetHeight;
    }
    f.classList.remove("is-open");
    f.style.zIndex = "";
    requestAnimationFrame(() => { body.style.maxHeight = "0px"; });
    if (f._ro) f._ro.disconnect();
  }

  /* header swaps the wordmark for the open file's name once it passes under */
  function subheadWatcher() {
    const out = $("[data-subhead]");
    if (!out) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const open = $(".folder.is-open");
      let show = "";
      if (open) {
        const r = open.getBoundingClientRect();
        const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 57;
        if (r.top < h && r.bottom > h * 3) {
          const active = open.querySelector(".folder__tab.is-active");
          show = (active && active.textContent) || open.querySelector(".folder__cover-name").textContent;
        }
      }
      if (show) out.textContent = show;
      document.body.classList.toggle("show-subhead", !!show);
    };
    window.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    update();
  }

  /* ---------- lightbox ------------------------------------------------------ */

  const lb = $("#lightbox");
  const lbImg = $(".lightbox__img");
  const lbCount = $(".lightbox__count");
  let lbList = [];
  let lbAt = 0;

  function openLightbox(src, list, index) {
    lbList = list && list.length ? list : [src];
    lbAt = typeof index === "number" ? index : Math.max(0, lbList.indexOf(src));
    paintLightbox();
    lb.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function paintLightbox() {
    lbImg.src = lbList[lbAt];
    const many = lbList.length > 1;
    lb.classList.toggle("has-nav", many);
    if (lbCount) lbCount.textContent = many ? `${lbAt + 1} / ${lbList.length}` : "";
  }
  function stepLightbox(by) {
    if (lbList.length < 2) return;
    lbAt = (lbAt + by + lbList.length) % lbList.length;   /* wraps both ways */
    paintLightbox();
  }
  function closeLightbox() {
    lb.hidden = true;
    lbImg.src = "";
    document.body.style.overflow = "";
  }

  lb.addEventListener("click", (e) => {
    if (e.target.closest(".lightbox__nav")) {
      stepLightbox(e.target.closest(".lightbox__nav--prev") ? -1 : 1);
      return;
    }
    if (e.target === lb || e.target.classList.contains("lightbox__close")) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (lb.hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") stepLightbox(-1);
    if (e.key === "ArrowRight") stepLightbox(1);
  });

  /* ---------- build --------------------------------------------------------- */

  function buildHome(data) {
    splitText($(".hero__title"), data.hero.title || "GREYGOOSE");
    $(".hero__desc").textContent = data.hero.desc || "";
    $(".hero__meta").textContent =
      `${pad2(data.members.length)} members · ${pad2(data.parties.length)} parties · ${pad2(data.gallery.length)} photos on file`;
    const cue = el("p", "hero__cue", "Open a file");
    $(".hero__meta").after(cue);
    watch(cue, 1.1);

    data.crews.forEach((crew, ci) => {
      const members = data.members.filter((m) => m.crew === crew.id);
      if (!members.length) return;
      const f = makeFolder(Object.assign(
        { count: members.length, names: members.map((m) => m.name).join("  ·  ") },
        crew
      ));
      f.style.zIndex = ci + 1;
      const host = f.querySelector(".folder__host");
      addTabs(f, members.map((m) => m.name), (i) => renderMember(host, members[i], i, members));
      renderMember(host, members[0], 0, members);
      stack.appendChild(f);
    });

    hookAnchor("#members", () => stack.firstElementChild);
  }

  /* ---------- gallery page --------------------------------------------------- */

  function buildGallery(data) {
    splitText($(".hero__title"), "GALLERY");
    const photos = data.gallery || [];
    $(".hero__meta").textContent = pad2(photos.length) + " photos on file";

    const grid = $("#gallery-grid");
    const rand = rng(hash("gallery"));
    photos.forEach((src, i) => {
      const fig = el("figure");
      fig.style.setProperty("--r", ((rand() - 0.5) * 5).toFixed(2) + "deg");
      fig.innerHTML = `<img src="${esc(src)}" alt="" loading="lazy">`;
      fig.addEventListener("click", () => openLightbox(src, photos, i));
      grid.appendChild(fig);
    });
    watchAll(grid.children, 0.035);

    if (!photos.length) {
      grid.after(
        el("p", "gallery-add",
          `Nothing here yet — add photos from the <a href="admin.html">admin panel</a>.`)
      );
    }
  }

  function buildParties(data) {
    splitText($(".hero__title"), "PARTIES");
    const up = data.parties.filter((p) => p.status !== "past");
    const past = data.parties.filter((p) => p.status === "past");
    $(".hero__meta").textContent =
      `${pad2(up.length)} coming up · ${pad2(past.length)} on record`;

    const groups = [
      { id: "upcoming", name: "Coming Up", color: "#FFE927", text: "dark",
        blurb: "Get on the list. Doors are the time we say, not the time you arrive.",
        list: up },
      { id: "past", name: "On Record", color: "#D71E1E", text: "light",
        blurb: "Already happened. Filed here so nobody can rewrite history.",
        list: past },
    ];

    groups.forEach((g, gi) => {
      if (!g.list.length) return;
      const f = makeFolder(Object.assign(
        { count: g.list.length, names: g.list.map((p) => p.name).join("  ·  ") },
        g
      ));
      f.style.zIndex = gi + 1;
      const host = f.querySelector(".folder__host");
      addTabs(f, g.list.map((p) => p.name), (i) => renderParty(host, g.list[i], i, g.list));
      renderParty(host, g.list[0], 0, g.list);
      stack.appendChild(f);
    });
  }

  /* Big navigation at the end of every page — the header bar is deliberately
     small, so the sections get a proper set of links here too. */
  function buildPageNav(counts) {
    const items = [
      { href: "index.html#members", no: "01", label: "Members", page: "home",
        note: counts.members + " on file" },
      { href: "parties.html", no: "02", label: "Parties", page: "parties",
        note: counts.parties + " logged" },
      { href: "gallery.html", no: "03", label: "Gallery", page: "gallery",
        note: counts.gallery + " photos" },
    ];
    const nav = el("nav", "page-nav");
    nav.setAttribute("aria-label", "Sections");
    items.forEach((it) => {
      const a = el("a");
      a.href = it.href;
      if (it.page === PAGE) a.setAttribute("aria-current", "page");
      a.innerHTML =
        `<span class="page-nav__no">${it.no}</span>` +
        `<span class="page-nav__label">${esc(it.label)}</span>` +
        `<span class="page-nav__note">${esc(it.note)}</span>`;
      nav.appendChild(a);
    });
    const foot = $(".site-footer");
    if (foot) foot.parentNode.insertBefore(nav, foot);
    else $("main").appendChild(nav);
    watchAll(nav.children, 0.08);
  }

  function hookAnchor(sel, get) {
    document.querySelectorAll('a[href="' + sel + '"]').forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const f = get();
        if (f) openFolder(f, true);
      })
    );
  }

  /* ---------- single-party share page --------------------------------------- */

  /* A share link shows exactly one party and nothing else: no members, no
     gallery, no other parties. The server enforces this when it is running;
     on static hosting we filter here instead. */
  async function loadSharedParty(id, key) {
    try {
      const r = await fetch(
        `api/party?id=${encodeURIComponent(id)}&k=${encodeURIComponent(key)}`,
        { cache: "no-store" }
      );
      if (r.ok) return await r.json();
      if (r.status === 404 || r.status === 403) return null;
    } catch { /* no server — fall through */ }

    const r = await fetch("data.json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    const p = (d.parties || []).find((x) => x.id === id);
    return p && p.share && p.share === key ? p : null;
  }

  function buildSharedParty(p) {
    /* the hero carries the name and the when/where; the blurb lives in the
       file below it, so neither is said twice */
    splitText($(".hero__title"), p.name);
    $(".hero__desc").remove();
    $(".hero__meta").textContent =
      (p.record && p.record.Date ? p.record.Date + "  ·  " : "") +
      (p.record && p.record.Where ? p.record.Where : "");
    document.title = p.name + " — Greygoose";

    const holder = $("#share-file");
    const folder = makeFolder({
      id: "share",
      name: p.name,
      color: p.status === "past" ? "#D71E1E" : "#FFE927",
      text: p.status === "past" ? "light" : "dark",
      blurb: "",
    });
    folder.classList.add("is-in", "is-open");
    holder.appendChild(folder);
    renderParty(folder.querySelector(".folder__host"), p, 0, [p]);
    folder.querySelector(".file__nav")?.remove();
  }

  /* ---------- go ------------------------------------------------------------ */

  async function start() {
    if (PAGE === "party") {
      const q = new URLSearchParams(location.search);
      const id = q.get("id") || "";
      const key = q.get("k") || "";
      const banner = $("#share-msg");
      try {
        const p = id && key ? await loadSharedParty(id, key) : null;
        if (!p) {
          banner.textContent = "That invite link is not valid any more.";
          $(".hero__title").textContent = "NOT FOUND";
          return;
        }
        buildSharedParty(p);
      } catch (err) {
        banner.textContent = "Could not load this invite (" + err.message + ").";
      }
      return;
    }

    /* every other page waits for the gate before it fetches anything */
    await (window.GGGate ? window.GGGate.ready : Promise.resolve());

    let data;
    try {
      const r = await fetch("data.json", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      data = await r.json();
    } catch (err) {
      const msg = el("p", "gallery-add",
        `Could not load <code>data.json</code> (${esc(err.message)}).<br>
         The site needs to be served over http — run <code>python3 server.py</code> in this folder.`);
      (stack || $("#gallery-grid") || $("main")).replaceChildren(msg);
      return;
    }

    FIELDS = Object.assign({ members: [], parties: [] }, data.fields);

    if (PAGE === "parties") buildParties(data);
    else if (PAGE === "gallery") buildGallery(data);
    else buildHome(data);

    buildPageNav({
      members: pad2(data.members.length),
      parties: pad2(data.parties.length),
      gallery: pad2((data.gallery || []).length),
    });

    /* every folder is there from the start — no scrolling to make them appear */
    if (stack) {
      const folders = stack.querySelectorAll(".folder");
      folders.forEach((f) => f.style.setProperty("--d", "0s"));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => folders.forEach((f) => f.classList.add("is-in")))
      );
    }
    document.querySelectorAll("[data-reveal]").forEach((n, i) => watch(n, 0.5 + i * 0.12));
    subheadWatcher();

    const target = location.hash && document.getElementById("f" + location.hash.replace("#", "-"));
    if (target) setTimeout(() => openFolder(target, true), 400);
  }

  start();
})();
