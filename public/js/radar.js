// radar.js - loads data/radar.json and renders the Top Stocks Under Radar table.

async function loadRadar() {
  const res = await fetch("data/radar.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load radar data");
  return res.json();
}

async function initRadar() {
  const tbody = document.querySelector("#radar-table tbody");
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;">Loading...</td></tr>`;

  let data;
  try {
    data = await loadRadar();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#dc2626;padding:24px;">${err.message}</td></tr>`;
    return;
  }

  document.getElementById("methodology-text").textContent = data.methodology + " " + data.disclaimer;
  document.getElementById("radar-updated").textContent = "Generated " + data.generated_date;

  if (!data.stocks.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px;">No stocks currently qualify for this screen.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.stocks
    .map(
      (s) => `
    <tr>
      <td><strong>${s.symbol}</strong></td>
      <td>${s.name}<br><small style="color:#94a3b8;">${s.sector}</small></td>
      <td>&#8377;${s.buy_price.toLocaleString("en-IN")}</td>
      <td>&#8377;${s.target_price.toLocaleString("en-IN")}</td>
      <td class="radar-highlight">+${s.potential_profit_pct}%</td>
      <td>${s.pe}</td>
      <td>${s.roe}%</td>
    </tr>
  `
    )
    .join("");
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("radar-table")) {
    initRadar();
  }
});
