const CARD_VERSION = "1.1.0";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const validValue = (value) => value !== undefined && value !== null && !["unknown", "unavailable", "none", ""].includes(String(value));

class LcarsCoolingDashboard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._signature = "";
  }

  setConfig(config) {
    if (!Array.isArray(config.air_conditioners) && !Array.isArray(config.fans)) {
      throw new Error("Add air_conditioners and/or fans to the card configuration");
    }
    this._config = {
      title: "COOLING SYSTEMS",
      ac_columns: 3,
      fan_columns: 3,
      show_summary: true,
      ...config,
      air_conditioners: config.air_conditioners || [],
      fans: config.fans || [],
    };
    this._signature = "";
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    const acRows = Math.ceil((this._config?.air_conditioners?.length || 0) / (this._config?.ac_columns || 3));
    const fanRows = Math.ceil((this._config?.fans?.length || 0) / (this._config?.fan_columns || 3));
    return 2 + (acRows + fanRows) * 2;
  }

  _state(entityId) {
    return entityId ? this._hass?.states?.[entityId] : undefined;
  }

  _value(entityId, attribute) {
    const state = this._state(entityId);
    return attribute ? state?.attributes?.[attribute] : state?.state;
  }

  _number(entityId, attribute) {
    const value = Number(this._value(entityId, attribute));
    return Number.isFinite(value) ? value : null;
  }

  _humidity(item, state) {
    const sensorValue = this._number(item.humidity);
    if (sensorValue !== null) return sensorValue;
    const attributeValue = Number(state?.attributes?.humidity);
    return Number.isFinite(attributeValue) ? attributeValue : null;
  }

  _power(item, state) {
    const sensorValue = this._number(item.power);
    if (sensorValue !== null) return sensorValue;
    for (const attribute of [item.power_attribute, "compressor_power", "realtime_power", "power"] .filter(Boolean)) {
      const value = Number(state?.attributes?.[attribute]);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  _temperature(state) {
    const value = Number(state?.attributes?.current_temperature);
    return Number.isFinite(value) ? value : null;
  }

  _formatPower(value) {
    if (!Number.isFinite(value)) return "—";
    return `${Math.round(value).toLocaleString()} W`;
  }

  _signatureForRender() {
    if (!this._config || !this._hass) return "waiting";
    const ids = new Set([this._config.weather, this._config.outside_humidity]);
    for (const item of [...this._config.air_conditioners, ...this._config.fans]) {
      [item.entity, item.humidity, item.power, item.led].filter(Boolean).forEach((id) => ids.add(id));
    }
    return JSON.stringify([...ids].map((id) => {
      const state = this._state(id);
      return [id, state?.state, state?.last_updated, state?.attributes];
    }));
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId },
    }));
  }

  async _toggle(entityId) {
    const state = this._state(entityId);
    if (!state || ["unavailable", "unknown"].includes(state.state)) return;
    const domain = entityId.split(".")[0];
    if (domain === "climate") {
      await this._hass.callService("climate", state.state === "off" ? "turn_on" : "turn_off", { entity_id: entityId });
    } else if (domain === "fan") {
      await this._hass.callService("fan", "toggle", { entity_id: entityId });
    } else if (domain === "switch") {
      await this._hass.callService("switch", "toggle", { entity_id: entityId });
    }
  }

  async _adjustTemperature(entityId, delta) {
    const state = this._state(entityId);
    const current = Number(state?.attributes?.temperature);
    if (!Number.isFinite(current)) return;
    await this._hass.callService("climate", "set_temperature", { entity_id: entityId, temperature: current + Number(delta) });
  }

  async _setFanMode(entityId, fanMode) {
    await this._hass.callService("climate", "set_fan_mode", { entity_id: entityId, fan_mode: fanMode });
  }

  async _setFanSpeed(entityId, percentage) {
    await this._hass.callService("fan", "set_percentage", { entity_id: entityId, percentage: Number(percentage) });
  }

  async _toggleOscillation(entityId) {
    const oscillating = Boolean(this._state(entityId)?.attributes?.oscillating);
    await this._hass.callService("fan", "oscillate", { entity_id: entityId, oscillating: !oscillating });
  }

  _weatherCard() {
    const state = this._state(this._config.weather);
    if (!state) return "";
    const temperature = state.attributes?.temperature;
    const humidity = this._number(this._config.outside_humidity) ?? Number(state.attributes?.humidity);
    const condition = String(state.state || "unknown").replaceAll("-", " ");
    return `
      <button class="weather entity-card" data-entity="${escapeHtml(this._config.weather)}">
        <ha-icon icon="mdi:weather-${escapeHtml(state.state === "partlycloudy" ? "partly-cloudy" : state.state || "cloudy")}"></ha-icon>
        <span class="weather-copy"><strong>${escapeHtml(this._config.weather_name || "Outside")}</strong><small>${escapeHtml(condition)}</small></span>
        <span class="weather-reading">${validValue(temperature) ? `${escapeHtml(temperature)}°` : "—"}${Number.isFinite(humidity) ? `<small>${Math.round(humidity)}% RH</small>` : ""}</span>
      </button>`;
  }

  _climateCard(item, coldest) {
    const state = this._state(item.entity);
    const unavailable = !state || ["unavailable", "unknown"].includes(state.state);
    const running = !unavailable && state.state !== "off";
    const current = this._temperature(state);
    const target = Number(state?.attributes?.temperature);
    const humidity = this._humidity(item, state);
    const power = this._power(item, state);
    const isColdest = running && current !== null && current === coldest;
    const mode = unavailable ? "Unavailable" : running ? String(state.state).replaceAll("_", " ") : "Off";
    const fanModes = state?.attributes?.fan_modes || [];
    const fanMode = state?.attributes?.fan_mode;
    return `
      <article class="entity-card climate ${running ? "running" : ""} ${isColdest ? "coldest" : ""} ${unavailable ? "unavailable" : ""}" data-entity="${escapeHtml(item.entity)}">
        <div class="card-top"><ha-icon icon="${escapeHtml(item.icon || "mdi:air-conditioner")}"></ha-icon><strong>${escapeHtml(item.name || state?.attributes?.friendly_name || item.entity)}</strong></div>
        <div class="primary-reading">${current === null ? "—" : `${current.toFixed(1)}°C`}</div>
        <div class="details">
          <span>${escapeHtml(mode)}${running && Number.isFinite(target) ? ` · ${target}°C` : ""}</span>
          ${humidity === null ? "" : `<span><ha-icon icon="mdi:water-percent"></ha-icon>${Math.round(humidity)}%</span>`}
          ${power === null ? "" : `<span><ha-icon icon="mdi:lightning-bolt"></ha-icon>${escapeHtml(this._formatPower(power))}</span>`}
        </div>
        <div class="temperature-control">
          <button data-temperature="${escapeHtml(item.entity)}" data-delta="-1" title="Lower target temperature">−</button>
          <strong>${Number.isFinite(target) ? `${target.toFixed(1)}°C` : "—"}</strong>
          <button data-temperature="${escapeHtml(item.entity)}" data-delta="1" title="Raise target temperature">+</button>
        </div>
        ${fanModes.length ? `<label class="mode-control"><ha-icon icon="mdi:fan-auto"></ha-icon><select data-fan-mode="${escapeHtml(item.entity)}">${fanModes.map((option) => `<option value="${escapeHtml(option)}" ${option === fanMode ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>` : ""}
        <div class="actions">
          <button class="action power ${running ? "active" : ""}" data-toggle="${escapeHtml(item.entity)}" title="Power"><ha-icon icon="mdi:power"></ha-icon></button>
          ${item.led ? `<button class="action led ${this._value(item.led) === "on" ? "active" : ""}" data-toggle="${escapeHtml(item.led)}" title="Display light"><ha-icon icon="mdi:television-ambient-light"></ha-icon></button>` : ""}
          <span>Tap card for controls</span>
        </div>
      </article>`;
  }

  _fanCard(item) {
    const state = this._state(item.entity);
    const unavailable = !state || ["unavailable", "unknown"].includes(state.state);
    const running = !unavailable && state.state === "on";
    const humidity = this._humidity(item, state);
    const power = this._power(item, state);
    const percentage = Number(state?.attributes?.percentage);
    const oscillating = Boolean(state?.attributes?.oscillating);
    return `
      <article class="entity-card fan ${running ? "running" : ""} ${unavailable ? "unavailable" : ""}" data-entity="${escapeHtml(item.entity)}">
        <div class="card-top"><ha-icon class="fan-icon" icon="${escapeHtml(item.icon || "mdi:fan")}"></ha-icon><strong>${escapeHtml(item.name || state?.attributes?.friendly_name || item.entity)}</strong></div>
        <div class="primary-reading">${unavailable ? "—" : running ? `${Number.isFinite(percentage) ? Math.round(percentage) : 100}%` : "OFF"}</div>
        <div class="details">
          ${humidity === null ? "" : `<span><ha-icon icon="mdi:water-percent"></ha-icon>${Math.round(humidity)}%</span>`}
          ${power === null ? "" : `<span><ha-icon icon="mdi:lightning-bolt"></ha-icon>${escapeHtml(this._formatPower(power))}</span>`}
        </div>
        <input class="speed" data-fan-speed="${escapeHtml(item.entity)}" type="range" min="0" max="100" step="10" value="${Number.isFinite(percentage) ? percentage : 0}" aria-label="Fan speed">
        <div class="fan-actions"><button class="feature-button" data-toggle="${escapeHtml(item.entity)}" title="Power"><ha-icon icon="mdi:power"></ha-icon></button><button class="feature-button ${oscillating ? "active" : ""}" data-oscillate="${escapeHtml(item.entity)}" title="Oscillation"><ha-icon icon="mdi:rotate-360"></ha-icon></button></div>
      </article>`;
  }

  _render() {
    if (!this._config || !this._hass) return;
    const signature = this._signatureForRender();
    if (signature === this._signature) return;
    this._signature = signature;

    const climates = this._config.air_conditioners.map((item) => ({ item, state: this._state(item.entity) }));
    const runningTemperatures = climates
      .filter(({ state }) => state && !["off", "unavailable", "unknown"].includes(state.state))
      .map(({ state }) => this._temperature(state))
      .filter((value) => value !== null);
    const coldest = runningTemperatures.length ? Math.min(...runningTemperatures) : null;
    const totalPower = [...this._config.air_conditioners, ...this._config.fans]
      .map((item) => this._power(item, this._state(item.entity)))
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0);

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; --cooling-ac-columns:${Number(this._config.ac_columns) || 3}; --cooling-fan-columns:${Number(this._config.fan_columns) || 3}; }
        * { box-sizing:border-box; }
        ha-card { padding:16px; overflow:hidden; background:var(--ha-card-background,var(--card-background-color)); }
        .header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:14px; padding:2px 4px; }
        .header h2 { margin:0; font-size:1.25rem; letter-spacing:.08em; }
        .summary { display:flex; align-items:center; gap:14px; color:var(--secondary-text-color); font-weight:700; }
        .summary span { display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
        .summary ha-icon { width:19px; color:#ffca28; }
        .weather { width:100%; min-height:82px; display:flex; align-items:center; gap:14px; margin:0 0 16px; padding:14px 18px; border:1px solid var(--divider-color); border-radius:16px; background:rgba(41,182,246,.07); color:var(--primary-text-color); text-align:left; cursor:pointer; }
        .weather > ha-icon { width:38px; height:38px; color:#66ccff; }
        .weather-copy { display:flex; flex-direction:column; flex:1; text-transform:capitalize; }
        .weather-copy strong { font-size:1.05rem; }
        .weather-copy small,.weather-reading small { color:var(--secondary-text-color); }
        .weather-reading { display:flex; flex-direction:column; align-items:flex-end; font-size:1.7rem; font-weight:800; }
        .section-title { margin:18px 2px 10px; font-size:.9rem; color:var(--secondary-text-color); letter-spacing:.12em; }
        .grid { display:grid; gap:12px; }
        .ac-grid { grid-template-columns:repeat(var(--cooling-ac-columns),minmax(0,1fr)); }
        .fan-grid { grid-template-columns:repeat(var(--cooling-fan-columns),minmax(0,1fr)); }
        .entity-card { position:relative; min-width:0; min-height:228px; padding:15px; border:1px solid var(--divider-color); border-radius:16px; background:rgba(255,255,255,.025); color:var(--primary-text-color); cursor:pointer; transition:transform .15s ease,box-shadow .25s ease,border-color .25s ease; }
        .entity-card:hover { transform:translateY(-1px); }
        .entity-card.running { border-color:rgba(33,150,243,.85); animation:running-glow 3.2s ease-in-out infinite; }
        .entity-card.coldest { animation:coldest-glow 1.7s ease-in-out infinite; }
        .entity-card.fan.running { border-color:rgba(255,255,255,.92); animation:white-glow 2.2s ease-in-out infinite; }
        .entity-card.unavailable { opacity:.48; }
        .card-top { display:flex; align-items:center; gap:9px; min-width:0; }
        .card-top strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .card-top ha-icon { width:22px; color:#42a5f5; }
        .fan.running .fan-icon { animation:spin 2.2s linear infinite; }
        .primary-reading { margin:16px 0 8px; font-size:1.55rem; font-weight:800; }
        .details { min-height:24px; display:flex; flex-wrap:wrap; gap:7px 12px; color:var(--secondary-text-color); font-size:.86rem; text-transform:capitalize; }
        .details span { display:inline-flex; align-items:center; gap:3px; }
        .details ha-icon { width:16px; }
        .actions { display:flex; align-items:center; gap:7px; margin-top:11px; color:var(--secondary-text-color); font-size:.72rem; }
        .temperature-control { height:54px; display:grid; grid-template-columns:44px 1fr 44px; align-items:center; margin-top:12px; border-radius:13px; background:rgba(255,255,255,.055); text-align:center; }
        .temperature-control button { height:100%; border:0; background:transparent; color:var(--primary-text-color); font-size:1.45rem; cursor:pointer; }
        .mode-control { height:48px; display:flex; align-items:center; gap:9px; margin-top:10px; padding:0 14px; border-radius:13px; background:rgba(255,255,255,.055); }
        .mode-control ha-icon { width:20px; }
        .mode-control select { flex:1; min-width:0; border:0; background:transparent; color:var(--primary-text-color); font:inherit; text-transform:capitalize; }
        .speed { width:100%; height:56px; margin:10px 0 8px; accent-color:#10bed5; }
        .fan-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .feature-button { height:48px; border:0; border-radius:13px; background:rgba(255,255,255,.055); color:var(--primary-text-color); cursor:pointer; }
        .feature-button.active { background:#e7e7e7; color:#222; }
        .action { width:32px; height:32px; display:grid; place-items:center; padding:0; border:1px solid var(--divider-color); border-radius:50%; background:var(--card-background-color); color:var(--secondary-text-color); cursor:pointer; }
        .action.active.power { color:#091d10; background:#5cff9a; border-color:#5cff9a; }
        .action.active.led { color:#2b2300; background:#ffe55c; border-color:#ffe55c; }
        .action ha-icon { width:18px; }
        @keyframes running-glow { 0%,100%{box-shadow:0 0 3px rgba(33,150,243,.28)} 50%{box-shadow:0 0 16px 3px rgba(33,150,243,.58)} }
        @keyframes coldest-glow { 0%,100%{box-shadow:0 0 5px rgba(0,229,255,.35)} 50%{box-shadow:0 0 22px 5px rgba(0,229,255,.82)} }
        @keyframes white-glow { 0%,100%{box-shadow:0 0 4px rgba(255,255,255,.28)} 50%{box-shadow:0 0 18px 3px rgba(255,255,255,.72)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @media(max-width:800px){ :host{--cooling-ac-columns:2;--cooling-fan-columns:2}.header{align-items:flex-start;flex-direction:column}.summary{flex-wrap:wrap}.entity-card{min-height:148px} }
        @media(max-width:480px){ ha-card{padding:11px}.grid{gap:9px}.entity-card{padding:12px}.actions span{display:none} }
      </style>
      <ha-card>
        <div class="header"><h2>⬡ ${escapeHtml(this._config.title)}</h2>${this._config.show_summary ? `<div class="summary"><span><ha-icon icon="mdi:air-conditioner"></ha-icon>${this._config.air_conditioners.length} AC</span><span><ha-icon icon="mdi:fan"></ha-icon>${this._config.fans.length} fans</span><span><ha-icon icon="mdi:lightning-bolt"></ha-icon>${escapeHtml(this._formatPower(totalPower))}</span></div>` : ""}</div>
        ${this._weatherCard()}
        ${this._config.air_conditioners.length ? `<h3 class="section-title">AIR CONDITIONING</h3><div class="grid ac-grid">${climates.map(({ item }) => this._climateCard(item, coldest)).join("")}</div>` : ""}
        ${this._config.fans.length ? `<h3 class="section-title">FANS</h3><div class="grid fan-grid">${this._config.fans.map((item) => this._fanCard(item)).join("")}</div>` : ""}
      </ha-card>`;

    this.shadowRoot.querySelectorAll(".entity-card").forEach((card) => card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      this._openMoreInfo(card.dataset.entity);
    }));
    this.shadowRoot.querySelectorAll("[data-toggle]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._toggle(button.dataset.toggle);
    }));
    this.shadowRoot.querySelectorAll("[data-temperature]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      this._adjustTemperature(button.dataset.temperature, button.dataset.delta);
    }));
    this.shadowRoot.querySelectorAll("[data-fan-mode]").forEach((select) => select.addEventListener("change", (event) => {
      event.stopPropagation(); this._setFanMode(select.dataset.fanMode, select.value);
    }));
    this.shadowRoot.querySelectorAll("[data-fan-speed]").forEach((slider) => slider.addEventListener("change", (event) => {
      event.stopPropagation(); this._setFanSpeed(slider.dataset.fanSpeed, slider.value);
    }));
    this.shadowRoot.querySelectorAll("[data-oscillate]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation(); this._toggleOscillation(button.dataset.oscillate);
    }));
  }
}

if (!customElements.get("lcars-cooling-dashboard")) {
  customElements.define("lcars-cooling-dashboard", LcarsCoolingDashboard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "lcars-cooling-dashboard",
  name: "LCARS Cooling Dashboard",
  description: "A responsive Home Assistant dashboard for climate units, fans, humidity, power and weather.",
  preview: true,
  documentationURL: "https://github.com/obaiii/ha-lcars-cooling-dashboard",
});

console.info(`%c LCARS COOLING DASHBOARD %c v${CARD_VERSION} `, "color:#101010;background:#66ccff;font-weight:700", "color:#66ccff;background:#101010");
