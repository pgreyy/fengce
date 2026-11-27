// Home hero background: vinyl grooves (wallets), moving dots (transactions), the needle (the circuit).
export function startVinyl(canvas, opts) {
  var ctx = canvas.getContext("2d"), dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, cx = 0, cy = 0, rMin = 0, rMax = 0, grooves = null, raf = 0, t0 = performance.now(), last = 0, mx = 0, tmx = 0;
  var dark = function () { return opts.isDark(); };
  var accent = function () { return opts.accent(); };
  var dots = [];
  var thetaN = -1.3; // needle angle (radians, 0 = right, negative = up)
  var tipR = 0, pvx = 0, pvy = 0, narrow = false; // needle radius and tonearm pivot, set in layout()
  function layout() {
    var r = canvas.parentNode.getBoundingClientRect(); W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px";
    narrow = W < 768;
    if (narrow) {
      // phones: background for the live proof card in the middle of the hero (lower opacity is set in CSS); the record's
      // visible half sits behind the card and the arm reaches in from the right edge
      cx = W * 0.86; cy = H * 0.8; rMin = W * 0.12; rMax = H * 0.44;
      var nxp = W * 0.52, nyp = H * 0.64;
      thetaN = Math.atan2(nyp - cy, nxp - cx); tipR = Math.hypot(nxp - cx, nyp - cy);
      pvx = W * 0.94; pvy = H * 0.42;
    } else {
      cx = W * 0.74; cy = H * 1.32; rMin = H * 0.42; rMax = Math.hypot(cx, cy) + 20;
      thetaN = -1.3; tipR = rMin + (rMax - rMin) * 0.22; pvx = W * 0.95; pvy = -H * 0.02;
    }
    grooves = document.createElement("canvas"); grooves.width = W * dpr; grooves.height = H * dpr;
    var g = grooves.getContext("2d"); g.scale(dpr, dpr);
    var ink = dark() ? "255,255,255" : "0,0,0";
    for (var rr = rMin + 26, i = 0; rr < rMax; rr += 6.5, i++) {
      var track = i % 22 === 0;
      g.strokeStyle = "rgba(" + ink + "," + (track ? (dark() ? 0.09 : 0.1) : (dark() ? 0.048 : 0.06)) + ")";
      g.lineWidth = track ? 1.2 : 0.8; g.beginPath(); g.arc(cx, cy, rr, Math.PI, 2 * Math.PI); g.stroke();
    }
    // label (peeking)
    g.fillStyle = dark() ? "rgba(255,255,255,.018)" : "rgba(0,0,0,.025)"; g.beginPath(); g.arc(cx, cy, rMin, 0, 2 * Math.PI); g.fill();
    g.strokeStyle = "rgba(" + ink + ",.10)"; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, rMin, Math.PI, 2 * Math.PI); g.stroke();
    g.strokeStyle = accent(); g.globalAlpha = 0.35; g.beginPath(); g.arc(cx, cy, rMin - 10, Math.PI * 1.08, Math.PI * 1.92); g.stroke(); g.globalAlpha = 1;
    seed();
  }
  function seed() {
    dots = [];
    var n = narrow ? 7 : Math.round(Math.min(34, Math.max(14, W / 48)));
    for (var i = 0; i < n; i++) dots.push(newDot(true));
  }
  function newDot(anywhere) {
    var k = Math.floor(Math.random() * ((rMax - rMin - 40) / 6.5));
    var r = rMin + 26 + 6.5 * k;
    // angle where the groove enters the screen on the left
    var aStart = Math.PI + Math.acos(Math.min(1, Math.max(-1, (cx - 0) / r))) * 0; 
    var a = anywhere ? (Math.PI + Math.random() * Math.PI) : (Math.PI + 0.05 + Math.random() * 0.3);
    return { r: r, a: a, sp: (0.018 + Math.random() * 0.03) * (420 / r), bad: Math.random() < 0.16, hit: -1, size: 1.4 + Math.random() * 1.1 };
  }
  function draw(now) {
    raf = requestAnimationFrame(draw);
    if (now - last < 30) return; var dt = Math.min(0.06, (now - last) / 1000); last = now;
    var T = (now - t0) / 1000; mx += (tmx - mx) * 0.05;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.save(); ctx.translate(mx * 10, 0);
    ctx.drawImage(grooves, 0, 0, W, H);
    // rotating sheen (two wedges)
    if (ctx.createConicGradient) {
      var cg = ctx.createConicGradient(T * 0.12, cx, cy), a = dark() ? 0.05 : 0.06, c = dark() ? "255,255,255" : "255,255,255";
      cg.addColorStop(0, "rgba(" + c + ",0)"); cg.addColorStop(0.04, "rgba(" + c + "," + a + ")"); cg.addColorStop(0.09, "rgba(" + c + ",0)");
      cg.addColorStop(0.5, "rgba(" + c + ",0)"); cg.addColorStop(0.54, "rgba(" + c + "," + a * 0.7 + ")"); cg.addColorStop(0.59, "rgba(" + c + ",0)"); cg.addColorStop(1, "rgba(" + c + ",0)");
      ctx.globalCompositeOperation = dark() ? "lighter" : "source-over";
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, rMax, Math.PI, 2 * Math.PI); ctx.arc(cx, cy, rMin, 2 * Math.PI, Math.PI, true); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    // scan line along the needle's radius
    var nx = Math.cos(thetaN), ny = Math.sin(thetaN);
    var lg = ctx.createLinearGradient(cx + nx * rMin, cy + ny * rMin, cx + nx * rMax, cy + ny * rMax);
    lg.addColorStop(0, "rgba(240,83,63,0)"); lg.addColorStop(0.35, "rgba(240,83,63,.16)"); lg.addColorStop(0.75, "rgba(240,83,63,.05)"); lg.addColorStop(1, "rgba(240,83,63,0)");
    ctx.strokeStyle = lg; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx + nx * rMin, cy + ny * rMin); ctx.lineTo(cx + nx * rMax, cy + ny * rMax); ctx.stroke();
    // dots
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i]; var prev = d.a; d.a += d.sp * dt;
      if (prev < thetaN + 2 * Math.PI && d.a >= thetaN + 2 * Math.PI && d.hit < 0) d.hit = T;
      var x = cx + Math.cos(d.a) * d.r, y = cy + Math.sin(d.a) * d.r;
      if (d.a > 2 * Math.PI + 0.02 || x > W + 20 || (d.bad && d.hit > 0 && T - d.hit > 0.9)) { dots[i] = newDot(false); continue; }
      if (y < -10 || x < -10) continue;
      var fadeL = Math.min(1, Math.max(0, (x / W - 0.18) / 0.32)); // keep text area clean
      var al = 0.55 * fadeL;
      var col = dark() ? "237,237,232" : "20,20,20";
      if (d.hit > 0) {
        var s = T - d.hit;
        if (d.bad) { col = "240,83,63"; al = Math.max(0, 0.95 - s) * Math.max(fadeL, .6);
          ctx.strokeStyle = "rgba(240,83,63," + Math.max(0, 0.5 - s * 0.55) + ")"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 3 + s * 22, 0, 2 * Math.PI); ctx.stroke();
        } else { col = s < 0.5 ? "79,201,138" : col; al = s < 0.5 ? 0.9 * fadeL + 0.1 : al; }
      }
      var tl = Math.min(0.09, 26 / d.r); ctx.lineCap = "round";
      for (var q = 0; q < 6; q++) { ctx.strokeStyle = "rgba(" + col + "," + (al * (q + 1) / 14) + ")"; ctx.lineWidth = d.size * 1.3; ctx.beginPath(); ctx.arc(cx, cy, d.r, d.a - tl * (6 - q) / 6, d.a - tl * (5 - q) / 6); ctx.stroke(); }
      ctx.fillStyle = "rgba(" + col + "," + al + ")"; ctx.beginPath(); ctx.arc(x, y, d.size, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.restore();
    // tonearm (no parallax)
    var px = pvx, py = pvy;
    var tx = cx + nx * tipR, ty = cy + ny * tipR;
    var ink2 = dark() ? "237,237,232" : "20,20,20";
    ctx.strokeStyle = "rgba(" + ink2 + ",.35)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.strokeStyle = "rgba(240,83,63,.12)"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.fillStyle = dark() ? "#1d1d1d" : "#e3e3df"; ctx.strokeStyle = "rgba(" + ink2 + ",.2)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, py, narrow ? 11 : 16, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    var ang = Math.atan2(ty - py, tx - px); ctx.save(); ctx.translate(tx, ty); ctx.rotate(ang); ctx.fillStyle = "rgba(240,83,63,.85)"; ctx.fillRect(-14, -5, 18, 10); ctx.restore();
    var glow = ctx.createRadialGradient(tx, ty, 0, tx, ty, 60); glow.addColorStop(0, "rgba(240,83,63,.14)"); glow.addColorStop(1, "rgba(240,83,63,0)"); ctx.fillStyle = glow; ctx.fillRect(tx - 60, ty - 60, 120, 120);
  }
  function onMove(e) { tmx = (e.clientX / window.innerWidth - 0.5); }
  layout();
  // A still frame only when the viewer asked for reduced motion; phones and tablets animate like desktops.
  var still = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (still) { last = -100; draw(performance.now()); cancelAnimationFrame(raf); } else { raf = requestAnimationFrame(draw); }
  var lastW = W, lastH = H;
  var relayout = function () {
    var r = canvas.parentNode.getBoundingClientRect();
    if (Math.abs(r.width - lastW) < 1 && Math.abs(r.height - lastH) < 1) return;
    layout(); lastW = W; lastH = H;
    if (still) { last = -100; draw(performance.now()); cancelAnimationFrame(raf); }
  };
  // size from the container whenever it changes (fonts loading, address bar on phones, rotation), not only on load
  var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(relayout) : null;
  if (ro) ro.observe(canvas.parentNode); else window.addEventListener("resize", relayout);
  window.addEventListener("pointermove", onMove, { passive: true });
  return function stop() { cancelAnimationFrame(raf); if (ro) ro.disconnect(); else window.removeEventListener("resize", relayout); window.removeEventListener("pointermove", onMove); };
}
