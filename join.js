/* ============================================================================
   GREYGOOSE — join.js
   The form a friend fills in to get their own file. It reads the same shared
   field list the admin panel uses, so the questions here always match the
   fields on the site — add a field in the admin panel and it appears here.

   Submissions go to the server's waiting list, not straight onto the site.
   ========================================================================== */

(function () {
  "use strict";

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

  /* the heading reveal, same as the rest of the site */
  function splitText(node, text) {
    node.textContent = "";
    String(text).split(" ").forEach((word, wi, arr) => {
      const w = el("span", "word");
      [...word].forEach((ch) => {
        const mask = el("span", "char-mask");
        mask.appendChild(el("span", "char", esc(ch)));
        w.appendChild(mask);
      });
      node.appendChild(w);
      if (wi < arr.length - 1) node.appendChild(document.createTextNode(" "));
    });
    const chars = node.querySelectorAll(".char");
    chars.forEach((c, i) => c.style.setProperty("--d", (0.1 + i * 0.035).toFixed(3) + "s"));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => chars.forEach((c) => c.classList.add("is-in")))
    );
  }

  const form = $("#join-form");
  const msg = $("#join-msg");
  let FIELDS = [];        /* only the questions the admin panel ticked on */

  /* hints for the fields we ship with, so the form is not a wall of blanks */
  const HINTS = {
    "Class of": "2027",
    "Hometown": "City, Country",
    "Lives": "Where you stay now",
    "Studying": "Your course, or your job",
    "In greygoose since": "Roughly when you joined",
    "Signature drink": "What you always order",
    "Party job": "What you end up doing at every party",
    "Undefeated at": "The thing nobody beats you at",
    "Most likely to": "The thing everyone expects of you",
    "Catchphrase": "The thing you always say",
  };

  /* everything the form says and asks is set in the admin panel's Form tab */
  fetch("data.json", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then((d) => {
      const jf = d.joinForm || {};
      const all = (d.fields && d.fields.members) || [];
      /* no `ask` list saved yet means "ask everything" */
      FIELDS = Array.isArray(jf.ask) ? all.filter((f) => jf.ask.includes(f)) : all;
      const hints = jf.hints || {};

      splitText($(".hero__title"), jf.title || "YOUR FILE");
      if (jf.intro) $(".hero__desc").textContent = jf.intro;
      if (jf.doneTitle) $("#join-done").querySelector("h2").textContent = jf.doneTitle;
      if (jf.doneText) $("#join-done").querySelector("p").textContent = jf.doneText;
      document.querySelectorAll("[data-reveal]").forEach((n) => n.classList.add("is-in"));

      const crew = $("#join-crew");
      if (jf.askCrew === false) {
        crew.closest(".join__field").hidden = true;
      } else {
        (d.crews || []).forEach((c) => {
          const o = el("option", null, esc(c.name));
          o.value = c.id;
          crew.appendChild(o);
        });
        const other = el("option", null, "Not sure yet");
        other.value = "";
        crew.appendChild(other);
      }

      const ig = form.querySelector('[name="instagram"]');
      if (jf.askInstagram === false && ig) ig.closest(".join__field").hidden = true;
      if (jf.askPhoto === false) $("#join-photo").closest(".join__field").hidden = true;

      const box = $("#join-fields");
      FIELDS.forEach((label) => {
        const f = el("label", "join__field");
        f.appendChild(el("span", null, esc(label)));
        const i = el("input");
        i.type = "text";
        i.name = "f:" + label;
        const hint = hints[label] || HINTS[label];
        if (hint) i.placeholder = hint;
        f.appendChild(i);
        box.appendChild(f);
      });
    })
    .catch((err) => {
      msg.textContent =
        "Could not load the form (" + err.message + "). The site needs to be served over http.";
      msg.className = "join__note is-err";
    });

  const readFile = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const go = $("#join-go");
    go.disabled = true;
    msg.textContent = "Sending…";
    msg.className = "join__note";

    try {
      const fd = new FormData(form);
      const record = {};
      FIELDS.forEach((label) => {
        const v = (fd.get("f:" + label) || "").toString().trim();
        if (v) record[label] = v;
      });

      const payload = {
        name: (fd.get("name") || "").toString().trim(),
        crew: (fd.get("crew") || "").toString(),
        blurb: (fd.get("blurb") || "").toString().trim(),
        instagram: (fd.get("instagram") || "").toString().trim().replace(/^@/, ""),
        record,
      };

      const photoInput = $("#join-photo");
      const file = photoInput.closest(".join__field").hidden ? null : photoInput.files[0];
      if (file) {
        if (file.size > 8 * 1024 * 1024) throw new Error("that photo is over 8MB");
        payload.photoName = file.name;
        payload.photoData = await readFile(file);
      }

      const res = await fetch("api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (!out.ok) throw new Error(out.error || "could not send that");

      form.hidden = true;
      $("#join-done").hidden = false;
      $("#join-done").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      msg.textContent = err.message + ".";
      msg.className = "join__note is-err";
      go.disabled = false;
    }
  });
})();
