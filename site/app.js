(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const PAGE = 50;
  const state = { data: null, mode: "wallets", sort: "deposited", dir: "desc", q: "", page: 0 };

  // Entity = display name with a trailing counter removed ("paperstrategy12" -> "paperstrategy").
  // Grouping is by name only; wallets without a name are not attributed to anyone.
  const entityOf = (name) => (name ? name.trim().replace(/[\s_\-#.]*\d+$/, "").toLowerCase() : "") || null;

  const big = (s) => BigInt(s);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  // Each comparator sorts descending; direction is applied on top.
  const SORTERS = {
    wallet: (a, b) => cmp(b.address, a.address),
    deposited: (a, b) => cmp(big(b.depositedUsdc), big(a.depositedUsdc)),
    withdrawn: (a, b) => cmp(big(b.withdrawnUsdc), big(a.withdrawnUsdc)),
    net: (a, b) => cmp(big(b.netUsdc), big(a.netUsdc)),
    count: (a, b) => b.depositCount - a.depositCount,
    largest: (a, b) => cmp(big(b.largestUsdc), big(a.largestUsdc)),
    first: (a, b) => b.firstBlock - a.firstBlock,
    last: (a, b) => b.lastBlock - a.lastBlock,
  };

  // Amounts carry 8 decimals (HyperCore USDC scale).
  function usd(s, cents = true) {
    let n = big(s);
    const neg = n < 0n;
    if (neg) n = -n;
    const whole = (n / 100000000n).toLocaleString("en-US");
    const frac = (n % 100000000n).toString().padStart(8, "0").slice(0, 2);
    return `${neg ? "-" : ""}$${whole}${cents ? "." + frac : ""}`;
  }
  const usd18 = (s) => usd((big(s) / 10000000000n).toString(), false);
  function compact(s) {
    const n = Number(big(s) / 100000000n);
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
    return `$${n}`;
  }
  // Times are shown in the viewer's local time zone.
  const when = (ts) => (ts == null ? "–" : new Date(ts * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }));
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function renderTape(d) {
    const t = d.totals;
    const items = [
      ["depositors", t.depositors.toLocaleString("en-US")],
      ["deposited", compact(t.depositedUsdc)],
      ["withdrawn", compact(t.withdrawnUsdc)],
      ["net", compact(t.netUsdc)],
      ["block", d.toBlock.toLocaleString("en-US")],
    ];
    $("tape").innerHTML = items.map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join("");
  }

  function entities() {
    const groups = new Map();
    for (const r of state.data.rows) {
      const key = entityOf(r.name);
      if (!key) continue;
      let g = groups.get(key);
      if (!g) {
        g = { address: key, name: key, wallets: [], depositedUsdc: 0n, withdrawnUsdc: 0n, netUsdc: 0n, depositCount: 0, largestUsdc: 0n, firstBlock: Infinity, lastBlock: -Infinity, firstTs: null, lastTs: null };
        groups.set(key, g);
      }
      g.wallets.push(r);
      g.depositedUsdc += big(r.depositedUsdc);
      g.withdrawnUsdc += big(r.withdrawnUsdc);
      g.netUsdc += big(r.netUsdc);
      g.depositCount += r.depositCount;
      if (big(r.largestUsdc) > g.largestUsdc) g.largestUsdc = big(r.largestUsdc);
      if (r.firstBlock < g.firstBlock) { g.firstBlock = r.firstBlock; g.firstTs = r.firstTs; }
      if (r.lastBlock > g.lastBlock) { g.lastBlock = r.lastBlock; g.lastTs = r.lastTs; }
    }
    return [...groups.values()].map((g) => ({ ...g, depositedUsdc: g.depositedUsdc.toString(), withdrawnUsdc: g.withdrawnUsdc.toString(), netUsdc: g.netUsdc.toString(), largestUsdc: g.largestUsdc.toString() }));
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    let rows = state.mode === "entities" ? entities() : state.data.rows;
    if (state.mode === "entities") {
      if (q) rows = rows.filter((g) => g.name.includes(q) || g.wallets.some((r) => r.address.includes(q)));
      const sign = state.dir === "asc" ? -1 : 1;
      return [...rows].sort((a, b) => sign * SORTERS[state.sort](a, b) || cmp(a.name, b.name));
    }
    if (q) rows = rows.filter((r) => r.address.includes(q) || (r.name && r.name.toLowerCase().includes(q)) || (r.proxy && r.proxy.includes(q)));
    const sign = state.dir === "asc" ? -1 : 1;
    return [...rows].sort((a, b) => sign * SORTERS[state.sort](a, b) || a.firstBlock - b.firstBlock || cmp(a.address, b.address));
  }

  function renderTable() {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    state.page = Math.min(state.page, pages - 1);
    const slice = rows.slice(state.page * PAGE, (state.page + 1) * PAGE);
    const ex = state.data.explorer;
    $("th-wallet").textContent = state.mode === "entities" ? "entity" : "wallet";
    $("rows").innerHTML = slice.map((r, i) => {
      const rank = state.page * PAGE + i + 1;
      const wd = big(r.withdrawnUsdc) > 0n;
      const who = state.mode === "entities"
        ? `<td class="ent"><a data-entity="${esc(r.name)}" title="show wallets">${esc(r.name)}</a><span class="n">${r.wallets.length} wallet${r.wallets.length === 1 ? "" : "s"}</span></td>`
        : `<td class="addr"><a href="${ex}/address/${r.address}" target="_blank" rel="noopener" title="${r.address}">${short(r.address)}</a>${r.name ? `<span class="name">${esc(r.name)}</span>` : ""}</td>`;
      return `<tr>
        <td class="num rank">${rank}</td>
        ${who}
        <td class="num">${usd(r.depositedUsdc)}</td>
        <td class="num ${wd ? "neg" : "dim"}">${wd ? usd(r.withdrawnUsdc) : "–"}</td>
        <td class="num"><button type="button" class="cnt" data-hist="${state.mode === "entities" ? r.wallets.map((w) => w.address).join(",") : r.address}" title="show transactions">${r.depositCount}</button></td>
        <td class="num">${usd(r.largestUsdc)}</td>
        <td class="num dim">${when(r.firstTs)}</td>
        <td class="num dim">${when(r.lastTs)}</td>
      </tr>`;
    }).join("");
    $("empty").hidden = rows.length > 0;
    $("pageinfo").textContent = `${state.page + 1} / ${pages}`;
    $("prev").disabled = state.page === 0;
    $("next").disabled = state.page >= pages - 1;
  }

  function renderMeta(d) {
    const lines = [
      `source: deposit and withdrawal events of the exchange contract <a href="${d.explorer}/address/${d.exchange}" target="_blank" rel="noopener">${d.exchange}</a> on hyperevm (chain 999)`,
      `blocks ${d.fromBlock.toLocaleString("en-US")} – ${d.toBlock.toLocaleString("en-US")} · generated ${new Date(d.generatedAt).toLocaleString("en-US", { hour12: false })}`,
      `amounts are usdc as emitted (8 decimals); times are interpolated from sampled block timestamps`,
    ];
    if (d.crossCheck && d.crossCheck.apiTrackedBalance18) lines.push(`cross-check: official api tracked balance ${usd18(d.crossCheck.apiTrackedBalance18)} vs net deposits ${usd(d.totals.netUsdc, false)}`);
    $("meta").innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
  }

  async function load() {
    try {
      const res = await fetch(`data/ranking.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.data = await res.json();
    } catch (e) {
      $("tape").innerHTML = `<span>no data yet — run <b>npm run depositors:index</b> (${esc(e.message)})</span>`;
      return;
    }
    renderTape(state.data);
    $("updated").textContent = `updated ${when(Math.floor(new Date(state.data.generatedAt).getTime() / 1000))}`;
    renderMeta(state.data);
    renderTable();
  }

  $("q").addEventListener("input", (e) => { state.q = e.target.value; state.page = 0; renderTable(); });
  function renderSortMarks() {
    for (const b of document.querySelectorAll("th button[data-sort]")) {
      const on = b.dataset.sort === state.sort;
      b.classList.toggle("on", on);
      b.classList.toggle("asc", on && state.dir === "asc");
    }
  }
  document.querySelector("thead").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sort]");
    if (!b) return;
    const key = b.dataset.sort;
    if (state.sort === key) state.dir = state.dir === "desc" ? "asc" : "desc";
    else { state.sort = key; state.dir = key === "wallet" ? "asc" : "desc"; }
    state.page = 0;
    renderSortMarks();
    renderTable();
  });
  renderSortMarks();
  $("modes").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b) return;
    state.mode = b.dataset.mode;
    state.page = 0;
    for (const x of $("modes").children) x.classList.toggle("on", x === b);
    renderModeHint();
    renderTable();
  });
  function renderModeHint() {
    $("modehint").textContent = state.mode === "entities" ? "wallets grouped by display name (trailing numbers ignored)" : "one row per wallet";
  }
  let events = null;
  async function loadEvents() {
    if (events) return events;
    const res = await fetch(`data/events.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    events = await res.json();
    return events;
  }
  async function toggleHistory(btn) {
    const tr = btn.closest("tr");
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("hist")) { next.remove(); btn.classList.remove("open"); return; }
    for (const open of $("rows").querySelectorAll("tr.hist")) open.remove();
    for (const b of $("rows").querySelectorAll(".cnt.open")) b.classList.remove("open");
    btn.classList.add("open");
    const ev = await loadEvents().catch((e) => ({ error: e.message }));
    const ex = state.data.explorer;
    const addrs = btn.dataset.hist.split(",");
    const list = ev.error ? [] : addrs.flatMap((a) => (ev.byUser[a] || []).map((x) => [a, ...x]));
    list.sort((a, b) => a[2] - b[2]);
    const rows = list.map(([a, kind, block, amount, tx, ts]) => `<tr>
        <td>${when(ts)}</td>
        <td class="${kind === "w" ? "w" : ""}">${kind === "w" ? "withdraw" : "deposit"}</td>
        <td class="num ${kind === "w" ? "w" : ""}">${kind === "w" ? "-" : ""}${usd(amount)}</td>
        ${addrs.length > 1 ? `<td class="num"><a href="${ex}/address/${a}" target="_blank" rel="noopener" title="${a}">${short(a)}</a></td>` : ""}
        <td><a href="${ex}/tx/${tx}" target="_blank" rel="noopener" title="${tx}">${tx.slice(0, 10)}…</a></td>
      </tr>`).join("");
    const hist = document.createElement("tr");
    hist.className = "hist";
    hist.innerHTML = `<td colspan="8">${ev.error ? `<span class="dim">transactions unavailable (${esc(ev.error)})</span>` : `<table><tbody>${rows}</tbody></table>`}</td>`;
    tr.after(hist);
  }
  $("rows").addEventListener("click", (e) => {
    const c = e.target.closest("button.cnt");
    if (c) { void toggleHistory(c); return; }
    const a = e.target.closest("a[data-entity]");
    if (!a) return;
    state.mode = "wallets";
    state.q = a.dataset.entity;
    $("q").value = state.q;
    state.page = 0;
    for (const x of $("modes").children) x.classList.toggle("on", x.dataset.mode === "wallets");
    renderModeHint();
    renderTable();
  });
  $("prev").addEventListener("click", () => { state.page--; renderTable(); });
  $("next").addEventListener("click", () => { state.page++; renderTable(); });
  load();
  setInterval(load, 60000);
})();
