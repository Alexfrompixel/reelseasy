// Motion for the page. Inlined at the end of <body> as it is, so it runs before first paint settles.
(() => {
  const root = document.documentElement;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // One move failing must not stop the others.
  const safe = (fn) => { try { fn(); } catch (error) { console.error(error); } };

  // The download is not out yet: the button stays on the page and says so.
  $$("[data-download]").forEach((a) => a.addEventListener("click", (event) => {
    if (a.getAttribute("href") !== "#") return;
    event.preventDefault();
    const soon = $(".soon");
    if (soon) soon.scrollIntoView({ block: "center" });
  }));

  // Without IntersectionObserver the page stays as written: everything visible, nothing moving on scroll.
  if (!("IntersectionObserver" in window) || !window.matchMedia) return;

  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  const wide = matchMedia("(min-width: 901px)");

  // Arrival on scroll. The "js" class hides .rise elements, so it is only set once the observer that shows them exists.
  function reveal() {
    $$(".strip figure").forEach((figure, i) => figure.style.setProperty("--i", i));
    const seen = new IntersectionObserver((entries) => {
      let n = 0;
      for (const entry of entries) {
        const passed = entry.boundingClientRect.bottom < 0; // already above the screen: show it without waiting
        if (!entry.isIntersecting && !passed) continue;
        if (entry.isIntersecting) entry.target.style.setProperty("--d", Math.min(n++, 6) * 70 + "ms");
        entry.target.classList.add("in");
        seen.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -10% 0px" });
    root.classList.add("js");
    $$(".rise").forEach((el) => seen.observe(el));
  }
  try { reveal(); } catch (error) { root.classList.remove("js"); console.error(error); return; }

  // Top bar: larger and lighter at the very top, tight once the page has moved. The link of the section on screen is lit.
  const nav = $(".nav");
  function navState() { if (nav) nav.classList.toggle("scrolled", window.scrollY > 24); }
  function spy() {
    const links = new Map();
    $$(".nav .links a[href^='#']").forEach((a) => { const section = $(a.getAttribute("href")); if (section) links.set(section, a); });
    if (!links.size) return;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) links.get(entry.target).classList.toggle("on", entry.isIntersecting);
    }, { rootMargin: "-45% 0px -50% 0px" });
    links.forEach((a, section) => io.observe(section));
  }

  // The app window: tilted back and a little small below the fold, flat and full size by the middle of the screen.
  // Linked to the scroll position and computed on load too, so it never depends on a scroll event having happened.
  const stage = $(".stage");
  const win = stage && $(".window", stage);
  let flat = true;
  const pageTop = (el) => { let y = 0; for (let n = el; n; n = n.offsetParent) y += n.offsetTop; return y; };
  function flatten() {
    if (!stage || !win) return;
    let p = 1;
    if (!calm.matches) {
      const vh = window.innerHeight, h = stage.offsetHeight, top = pageTop(stage) - window.scrollY;
      const end = Math.max(vh * 0.08, (vh - h) / 2); // where the top of the window is when its middle reaches the middle of the screen
      p = clamp((vh - top) / Math.max(1, vh - end), 0, 1);
    }
    if (p >= 1) {
      if (!flat || stage.style.transform) { stage.style.transform = ""; win.style.removeProperty("--sheen"); }
      flat = true;
      return;
    }
    flat = false;
    const e = p * (2 - p), light = !wide.matches; // lighter on phones
    const angle = (1 - e) * (light ? 11 : 22), scale = 1 - (1 - e) * (light ? 0.06 : 0.1);
    stage.style.transform = `perspective(1600px) rotateX(${angle.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
    win.style.setProperty("--sheen", (1 - e).toFixed(3));
  }

  // Feature cards: the picture inside moves a little slower than its card (wide screens only). It uses "translate",
  // so it never overwrites the "transform" that tiltOnHover puts on the same element.
  const layers = new Map(), live = new Set();
  let drifting = false;
  function parallaxSetup() {
    $$(".card").forEach((card) => {
      const list = [
        ...$$(".shot.ui .pane", card).map((el) => ({ el, travel: 20 })),
        ...$$(".duo .phone", card).map((el, i) => ({ el, travel: i ? 24 : 12 })),
      ];
      if (list.length) layers.set(card, list);
    });
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.isIntersecting ? live.add(entry.target) : live.delete(entry.target);
      tick();
    }, { rootMargin: "10% 0px 10% 0px" });
    layers.forEach((list, card) => io.observe(card));
  }
  function parallax() {
    if (!wide.matches || calm.matches) {
      if (drifting) { layers.forEach((list) => list.forEach((l) => { l.el.style.translate = ""; l.el._shift = 0; })); drifting = false; }
      return;
    }
    drifting = true;
    const vh = window.innerHeight, reads = [];
    live.forEach((card) => { const r = card.getBoundingClientRect(); reads.push([card, clamp((r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2), -1, 1)]); });
    for (const [card, q] of reads) for (const l of layers.get(card)) { l.el._shift = -q * l.travel; l.el.style.translate = `0 ${l.el._shift.toFixed(1)}px`; }
  }

  // All scroll work goes through one requestAnimationFrame.
  let queued = false;
  function frame() { queued = false; navState(); flatten(); parallax(); }
  function tick() { if (!queued) { queued = true; requestAnimationFrame(frame); } }

  // Cards: a light under the cursor, shared by the cards of one group so the neighbours' edges catch it too.
  function cursorLight() {
    $$(".cards, .steps, .reasons").forEach((group) => {
      const cells = $$(".card, .step, .reason", group);
      let x = 0, y = 0, raf = 0;
      group.addEventListener("pointermove", (event) => {
        if (!fine.matches || event.pointerType === "touch") return;
        x = event.clientX; y = event.clientY;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const rects = cells.map((cell) => cell.getBoundingClientRect());
          cells.forEach((cell, i) => { cell.style.setProperty("--mx", Math.round(x - rects[i].left) + "px"); cell.style.setProperty("--my", Math.round(y - rects[i].top) + "px"); });
        });
      }, { passive: true });
    });
  }

  // Pictures that turn toward the cursor. The zone (which does not move) listens; each picture is tested against its
  // untransformed box, so a tilting edge cannot slip out from under the cursor and flicker. The side nearest the cursor
  // goes back. Leaving eases back to flat in about half a second, then the inline styles are removed again.
  function tiltOnHover(zone, pictures, { maxX, maxY, grow, ready, each }) {
    if (!zone || !pictures.length) return;
    const items = pictures.map((el) => ({ el, x: 0, y: 0, s: 0, on: false }));
    let px = 0, py = 0, inside = false, raf = 0, last = 0;
    const box = (el) => {
      const parent = el.offsetParent || document.body, r = parent.getBoundingClientRect();
      const left = r.left + parent.clientLeft + el.offsetLeft, top = r.top + parent.clientTop + el.offsetTop + (el._shift || 0);
      return { left, top, width: el.offsetWidth, height: el.offsetHeight };
    };
    function loop(now) {
      raf = 0;
      const dt = Math.min(64, now - (last || now - 16)); last = now;
      const allowed = inside && fine.matches && !calm.matches && (!ready || ready());
      let busy = false;
      for (const it of items) {
        let tx = 0, ty = 0, ts = 0;
        if (allowed) {
          const b = box(it.el);
          if (px >= b.left && px <= b.left + b.width && py >= b.top && py <= b.top + b.height) { tx = ((px - b.left) / b.width) * 2 - 1; ty = ((py - b.top) / b.height) * 2 - 1; ts = 1; }
        }
        const k = 1 - Math.exp(-dt / (ts ? 90 : 150));
        it.x += (tx - it.x) * k; it.y += (ty - it.y) * k; it.s += (ts - it.s) * k;
        if (!ts && Math.abs(it.x) < 0.004 && Math.abs(it.y) < 0.004 && it.s < 0.004) {
          if (it.on) { it.on = false; it.x = it.y = it.s = 0; it.el.style.transform = ""; it.el.style.willChange = ""; ["--sx", "--sy", "--so"].forEach((v) => it.el.style.removeProperty(v)); if (each) each(it, zone); }
          continue;
        }
        busy = true;
        if (!it.on) { it.on = true; it.el.style.willChange = "transform"; }
        it.el.style.transform = `rotateX(${(-it.y * maxX).toFixed(2)}deg) rotateY(${(it.x * maxY).toFixed(2)}deg) scale(${(1 + it.s * (grow - 1)).toFixed(4)})`;
        it.el.style.setProperty("--sx", ((it.x + 1) * 50).toFixed(1) + "%");
        it.el.style.setProperty("--sy", ((it.y + 1) * 50).toFixed(1) + "%");
        it.el.style.setProperty("--so", it.s.toFixed(3));
        if (each) each(it, zone);
      }
      if (busy) raf = requestAnimationFrame(loop); else last = 0;
    }
    const wake = () => { if (!raf) raf = requestAnimationFrame(loop); };
    zone.addEventListener("pointermove", (event) => { if (event.pointerType === "touch") return; px = event.clientX; py = event.clientY; inside = true; wake(); }, { passive: true });
    zone.addEventListener("pointerleave", () => { inside = false; wake(); }, { passive: true });
  }
  function tilts() {
    $$(".card .shot.ui").forEach((shot) => tiltOnHover(shot, $$(".pane", shot), { maxX: 5.5, maxY: 9, grow: 1.02 }));
    $$(".card .duo").forEach((duo) => tiltOnHover(duo, $$(".phone", duo), { maxX: 5.5, maxY: 9, grow: 1.02 }));
    // The hero window only turns once the scroll has laid it flat, so the two moves never fight. Its glow leans along.
    tiltOnHover(stage, win ? [win] : [], { maxX: 3, maxY: 4.5, grow: 1.01, ready: () => flat, each: (it, zone) => {
      if (it.on) { zone.style.setProperty("--gx", (it.x * 30).toFixed(1) + "px"); zone.style.setProperty("--go", it.s.toFixed(3)); }
      else { zone.style.removeProperty("--gx"); zone.style.removeProperty("--go"); }
    } });
  }

  // Loops rest while their block is off screen; the waveform starts the first time it is seen.
  function pauseOffscreen() {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle("is-off", !entry.isIntersecting);
        if (entry.isIntersecting && entry.target.classList.contains("wave")) entry.target.classList.add("play");
      }
    });
    $$(".hero, .halo, .cta, .belt, .wave").forEach((el) => io.observe(el));
  }

  // The tag row as a slow belt, only where the row is a single line anyway (wide screens) and motion is welcome.
  function marquee() {
    const belt = $(".belt"), list = belt && $(".tags", belt);
    if (!list) return;
    const room = matchMedia("(min-width: 1101px)");
    let built = false;
    const set = () => {
      const on = room.matches && !calm.matches;
      if (on && !built) {
        built = true;
        const items = [...list.children];
        for (let copy = 0; copy < 2; copy++) items.forEach((li) => { const twin = li.cloneNode(true); twin.setAttribute("aria-hidden", "true"); list.append(twin); });
      }
      belt.classList.toggle("run", on);
    };
    set();
    room.addEventListener("change", set);
    calm.addEventListener("change", set);
  }

  safe(parallaxSetup);
  safe(frame); // set the first state now, before the first paint
  safe(spy);
  safe(cursorLight);
  safe(tilts);
  safe(pauseOffscreen);
  safe(marquee);
  window.addEventListener("scroll", tick, { passive: true });
  window.addEventListener("resize", tick, { passive: true });
  window.addEventListener("load", tick);
  window.addEventListener("pageshow", tick);
  calm.addEventListener("change", tick);
  wide.addEventListener("change", tick);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(tick);
})();
