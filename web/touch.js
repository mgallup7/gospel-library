/* Touch: the gestures a finger expects of a book on an iPad or an iPhone.
   - A quick sideways flick on a page turns the chapter (left for the next, right for the one
     before), in the reader and in the page beside it.
   - Two fingers spread or pinched on a page step the text size, as the Aa buttons do.
   - On a phone the reader's bar slides away while the page is read downward and comes back the
     moment the page is pulled the other way, at the top, or when anything on it is tapped.
   Each has a button that does the same, so nothing here is the only way to anything, and
   Settings has one switch that turns them all off. Touch events only: they are what every
   Safari has had since the first iPhone. Nothing here runs with a mouse. */
(() => {
  const GL = window.GL;
  if (!GL || !("ontouchstart" in window)) return;
  // body.gest: the pages give up the browser's own pinch zoom (app.css, touch-action), so two
  // fingers there set the text size and nothing else. Read again at each touch, so the switch in
  // Settings takes hold at once.
  const on = () => {
    let v = true;
    try { v = GL.store.get("gestures") !== false; } catch (_) {}
    document.body.classList.toggle("gest", v);
    return v;
  };
  on();
  const wordsSelected = () => { try { const s = window.getSelection ? window.getSelection() : null; return !!(s && s.rangeCount && !s.isCollapsed && String(s).trim()); } catch (_) { return false; } };
  // which page a touch began on: the reader's, the one beside it, or neither
  const pageOf = (t) => {
    if (!t || !t.closest) return null;
    if (t.closest("#beside .bs-scroll .doc")) return "beside";
    if (t.closest("#reader .doc")) return "reader";
    return null;
  };

  // ---- a flick turns the chapter ------------------------------------------------
  // It moves 90pt sideways within 450 ms and stays within 45pt of level, begins away from the
  // screen's edges (those are Back and Forward), and never follows a press that rested first
  // (that is words being selected) or a second finger.
  const NEED = 90, LEVEL = 45, QUICK = 450, REST = 250, EDGE = 24;
  let flick = null;
  // ---- two fingers step the text size --------------------------------------------
  // Each quarter the fingers spread (or a fifth they close) is one step of the ten sizes.
  let pinch = null;
  const gap = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);

  document.addEventListener("touchstart", (e) => {
    flick = null;
    if (!on()) { pinch = null; return; }
    if (e.touches.length === 2) {
      pinch = pageOf(e.touches[0].target) && pageOf(e.touches[1].target) ? { d: gap(e) } : null;
      return;
    }
    pinch = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const page = pageOf(e.target);
    if (!page || wordsSelected()) return;
    if (e.target.closest("a, button, input, textarea, select, table, .note-mark") || document.querySelector("#reader.phrasing")) return;
    if (t.clientX <= EDGE || t.clientX >= window.innerWidth - EDGE) return;
    flick = { page, x: t.clientX, y: t.clientY, at: Date.now(), moved: false };
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (pinch && e.touches.length === 2) {
      const d = gap(e);
      if (pinch.d > 0 && d / pinch.d >= 1.25) { pinch.d = d; try { GL.resize(1); } catch (_) {} }
      else if (pinch.d > 0 && d / pinch.d <= 0.8) { pinch.d = d; try { GL.resize(-1); } catch (_) {} }
      return;
    }
    if (!flick) return;
    if (e.touches.length !== 1) { flick = null; return; }
    const t = e.touches[0];
    if (Math.abs(t.clientY - flick.y) > LEVEL) { flick = null; return; } // a scroll
    if (!flick.moved && Math.abs(t.clientX - flick.x) > 10) {
      if (Date.now() - flick.at > REST) flick = null; // the finger rested first: a long press
      else flick.moved = true;
    }
  }, { passive: true });

  document.addEventListener("touchcancel", () => { flick = null; pinch = null; }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (e.touches.length < 2) pinch = null;
    const go = flick;
    flick = null;
    if (!go || !on()) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - go.x;
    if (Math.abs(dx) < NEED || Math.abs(t.clientY - go.y) > LEVEL || Date.now() - go.at > QUICK || wordsSelected()) return;
    const dir = dx < 0 ? 1 : -1;
    try {
      if (go.page === "beside") window.Beside?.step?.(dir);
      else GL.step(dir);
    } catch (_) {}
  }, { passive: true });

  // ---- a phone's reader bar steps aside while reading ------------------------------
  // The page scrolls with the document there. Down by a little: the bar goes. Up by a little, the
  // top of the page, a jump (a link, a new chapter), a menu open on the bar, a selection: it is
  // back. An iPad's bars stay: it has the room, and two bars side by side would not move as one.
  const phone = () => !GL.wide;
  let lastY = 0, away = false;
  const setAway = (v) => { if (v === away) return; away = v; document.body.classList.toggle("bar-away", v); };
  window.addEventListener("scroll", () => {
    const y = window.scrollY || 0, d = y - lastY;
    lastY = y;
    if (!on() || !phone() || !document.body.classList.contains("reading")) { setAway(false); return; }
    if (parseFloat(document.documentElement.style.getPropertyValue("--head-h")) > 0) { setAway(false); return; } // Search keeps its box above the page: the bar stays under it
    if (y < 80 || Math.abs(d) > 300) { setAway(false); return; }
    if (document.querySelector("#reader .reader-bar [aria-expanded='true'], #reader.phrasing, #reader .doc .sel")) { setAway(false); return; }
    if (d > 8) setAway(true);
    else if (d < -8) setAway(false);
  }, { passive: true });
  // a tap on the page brings it back as well, and so does anything that redraws the reader
  document.addEventListener("click", () => setAway(false), true);
  window.addEventListener("hashchange", () => setAway(false));
  window.addEventListener("resize", () => setAway(false));
})();
