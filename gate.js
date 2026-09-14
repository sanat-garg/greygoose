/* ============================================================================
   GREYGOOSE — gate.js
   A "one of us?" gate. Shows a random personal question from data.json and
   only lets the page render once it's answered.

   Answers are never stored in plain text — data.json holds a SHA-256 of the
   normalised answer, and the admin panel hashes as you type.

   Two levels of enforcement:
     · server.py --gate   the server checks the answer and refuses data.json
                          without a valid cookie. Real gating.
     · anywhere else      the check happens in the browser. It keeps strangers
                          out, but anyone determined can read data.json directly.
                          Use --gate (or a real backend) for anything sensitive.

   Exposes  window.GGGate.ready  — a promise site.js waits on before rendering.
   ========================================================================== */

window.GGGate = (function () {
  "use strict";

  const KEY = "gg_access_v1";
  const $ = (s, r = document) => r.querySelector(s);

  /* must match the normalisation used by server.py and admin.js */
  function normalise(s) {
    return String(s == null ? "" : s)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      // keep only letters and digits, so capitals, spaces, hyphens and
      // apostrophes all stop mattering: "Arnold-Palmer" == "arnold palmer"
      .replace(/[^a-z0-9]+/g, "");
  }

  /* sha256.js works on every origin — crypto.subtle only exists on https
     and localhost, which used to break the gate over a LAN address. */
  const sha256 = (text) => window.ggSha256(text);

  const unlocked = () => {
    try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
  };
  const remember = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* private mode — fine */ }
  };

  /* ---------- config ------------------------------------------------------- */

  /* Prefer the server: it hands back questions with the hashes stripped out.
     Falling back to data.json is what makes this work on static hosting. */
  async function loadConfig() {
    try {
      const r = await fetch("api/questions.php", { cache: "no-store" });
      if (r.ok) return Object.assign({ serverSide: true }, await r.json());
    } catch { /* no server — carry on */ }

    try {
      const r = await fetch("api/data.php", { cache: "no-store" });
      if (!r.ok) return null;
      const d = await r.json();
      const access = d.access || {};
      return Object.assign({}, access, {
        serverSide: false,
        /* a question with no text or no answer can never be satisfied — showing
           one locks the visitor out completely */
        questions: (access.questions || []).filter(
          (q) => (q.question || "").trim() && q.hash
        ),
      });
    } catch {
      return null;
    }
  }

  async function verify(cfg, question, answer) {
    if (cfg.serverSide) {
      const r = await fetch("api/unlock.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: question.id, answer }),
      });
      const out = await r.json().catch(() => ({}));
      return !!out.ok;
    }
    return question.hash === "sha256:" + sha256(normalise(answer));
  }

  /* ---------- ui ----------------------------------------------------------- */

  function build(cfg, resolve) {
    const pool = (cfg.questions || []).slice();
    let current = pool[Math.floor(Math.random() * pool.length)];

    const gate = document.createElement("div");
    gate.className = "gate";
    gate.innerHTML = `
      <div class="gate__box">
        <div class="gate__mark">Greygoose</div>
        <h1 class="gate__title"></h1>
        <p class="gate__intro"></p>
        <p class="gate__q"></p>
        <form class="gate__form">
          <input class="gate__input" type="text" autocomplete="off"
                 autocapitalize="off" spellcheck="false" placeholder="your answer" />
          <button class="gate__submit" type="submit">Enter</button>
        </form>
        <p class="gate__msg" role="status"></p>
        <button class="gate__swap" type="button">Ask me a different one</button>
      </div>`;

    $(".gate__title", gate).textContent = cfg.title || "Who's asking?";
    $(".gate__intro", gate).textContent = cfg.intro || "";

    const box = $(".gate__box", gate);
    const qEl = $(".gate__q", gate);
    const input = $(".gate__input", gate);
    const msg = $(".gate__msg", gate);

    const paint = () => {
      qEl.textContent = current.question;
      input.value = "";
      msg.textContent = "";
      input.focus();
    };

    $(".gate__swap", gate).addEventListener("click", () => {
      if (pool.length < 2) return;
      let next = current;
      while (next === current) next = pool[Math.floor(Math.random() * pool.length)];
      current = next;
      paint();
    });

    $(".gate__form", gate).addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      msg.textContent = "";
      try {
        if (await verify(cfg, current, input.value)) {
          remember();
          gate.style.transition = "opacity .45s cubic-bezier(.33,1,.68,1)";
          gate.style.opacity = "0";
          setTimeout(() => {
            gate.remove();
            document.body.classList.remove("is-locked");
            resolve();
          }, 450);
          return;
        }
        msg.textContent = "Not it. Try again, or ask for another question.";
      } catch (err) {
        msg.textContent = "Could not check that right now.";
      }
      box.classList.remove("is-wrong");
      void box.offsetWidth; /* restart the shake */
      box.classList.add("is-wrong");
      input.select();
    });

    document.body.appendChild(gate);
    document.body.classList.add("is-locked");
    paint();
  }

  /* ---------- go ----------------------------------------------------------- */

  const ready = (async () => {
    if (document.body.dataset.page === "party") return; /* share links skip the gate */
    if (unlocked()) return;

    const cfg = await loadConfig();
    if (!cfg || cfg.enabled === false || !(cfg.questions || []).length) return;

    await new Promise((resolve) => build(cfg, resolve));
  })();

  return { ready, normalise, sha256, KEY };
})();
