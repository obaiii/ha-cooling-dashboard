const CARD_VERSION = "3.0.0";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const validValue = (value) => value !== undefined && value !== null && !["unknown", "unavailable", "none", ""].includes(String(value));

class CoolingDashboard extends HTMLElement {
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
    const raw = this._value(entityId, attribute);
    if (!validValue(raw) || typeof raw === 'boolean') return null;
    const value = Number(raw);
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
      const raw = state?.attributes?.[attribute];
      if (!validValue(raw) || typeof raw === 'boolean') continue;
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  _temperature(state) {
    const value = Number(state?.attributes?.current_temperature);
    return Number.isFinite(value) ? value : null;
  }

  _airQuality(item) {
    const pm25 = this._number(item.pm2_5);
    if (pm25 === null) return null;
    if (pm25 <= 12) return { level: "good", label: "Good air quality", pm25 };
    if (pm25 <= 35) return { level: "moderate", label: "Moderate air quality", pm25 };
    return { level: "poor", label: "Poor air quality", pm25 };
  }

  _formatPower(value) {
    if (!Number.isFinite(value)) return "—";
    return `${Math.round(value).toLocaleString()} W`;
  }

  _signatureForRender() {
    if (!this._config || !this._hass) return "waiting";
    const ids = new Set([this._config.weather, this._config.outside_humidity]);
    for (const item of [...this._config.air_conditioners, ...this._config.fans]) {
      [item.entity, item.humidity, item.power, item.led, item.pm2_5, item.holiday_mode,
        item.optimisation?.enabled, item.optimisation?.minimum, item.optimisation?.maximum,
        ...(item.air_quality || []).map(sensor => sensor.entity)].filter(Boolean).forEach((id) => ids.add(id));
    }
    return JSON.stringify([...ids].map((id) => {
      const state = this._state(id);
      return [id, state?.state, state?.last_updated, state?.attributes];
    }));
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;
    this._details = entityId;
    this._detailsFocus = true;
    this._optimiseOpen = false;
    this._renderDetails();
  }

  _nativeMoreInfo(entityId) {
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
    const minimum = Number(state.attributes.min_temp ?? 16), maximum = Number(state.attributes.max_temp ?? 30);
    const temperature = Math.max(minimum, Math.min(maximum, current + Number(delta)));
    if(temperature === current) return;
    await this._hass.callService("climate", "set_temperature", { entity_id: entityId, temperature });
  }

  async _setFanMode(entityId, fanMode) {
    await this._hass.callService("climate", "set_fan_mode", { entity_id: entityId, fan_mode: fanMode });
  }

  async _setFanSpeed(entityId, percentage) {
    if (this._state(entityId)?.state !== "on") return;
    await this._hass.callService("fan", "set_percentage", { entity_id: entityId, percentage: Number(percentage) });
  }

  async _toggleOscillation(entityId) {
    if (this._state(entityId)?.state !== "on") return;
    const oscillating = Boolean(this._state(entityId)?.attributes?.oscillating);
    await this._hass.callService("fan", "oscillate", { entity_id: entityId, oscillating: !oscillating });
  }

  _sweepIcon(angle) {
    if (angle >= 300) return '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M23 10a10 10 0 1 0 0 8M23 5v6h-6"/></svg>';
    const half = Math.min(angle || 45, 180) * Math.PI / 360;
    const x = 11 * Math.sin(half), y = 11 * Math.cos(half);
    return `<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M14 22L${14-x} ${22-y}A11 11 0 0 1 ${14+x} ${22-y}Z"/></svg>`;
  }

  async _cycleSweep(item) {
    const state = this._state(item.entity);
    if (state?.state !== "on" || !item.sweep || this._sweepBusy) return;
    const config = {service:"dyson_local.set_angle", low_attribute:"angle_low", high_attribute:"angle_high", minimum:5, maximum:355, ...item.sweep};
    const pending = this._sweepPending?.[item.entity];
    const usePending = pending && pending.until > Date.now();
    const low = usePending ? pending.low : Number(state.attributes[config.low_attribute]);
    const high = usePending ? pending.high : Number(state.attributes[config.high_attribute]);
    const width = Number.isFinite(low + high) ? Math.abs(high-low) : 0;
    const angle = [45,90,180,350].find(value => value > width + 0.5) || 45;
    const centre = Number.isFinite(low+high) ? (low+high)/2 : 180;
    const start = Math.max(config.minimum, Math.min(config.maximum-angle, Math.round(centre-angle/2)));
    const [domain, service] = config.service.split(".");
    this._sweepBusy = true;
    try {
      await this._hass.callService(domain, service, {entity_id:item.entity, angle_low:start, angle_high:start+angle});
      if (!state.attributes.oscillating) await this._hass.callService("fan", "oscillate", {entity_id:item.entity,oscillating:true});
      this._sweepPending ||= {};
      this._sweepPending[item.entity] = {low:start,high:start+angle,until:Date.now()+4000};
      this._signature = "";
      this._render();
    } finally { this._sweepBusy = false; }
  }

  _sweepWidth(item, state) {
    const pending=this._sweepPending?.[item.entity];
    if(pending && pending.until>Date.now()) return pending.high-pending.low;
    const low=Number(state?.attributes?.[item.sweep?.low_attribute || 'angle_low']);
    const high=Number(state?.attributes?.[item.sweep?.high_attribute || 'angle_high']);
    return Number.isFinite(low+high)?Math.abs(high-low):0;
  }

  _renderDetails() {
    this.shadowRoot.querySelector(".details-overlay")?.remove();
    if (!this._details) return;
    const item = [...this._config.air_conditioners, ...this._config.fans].find(item => item.entity === this._details);
    if (!item) return;
    const state = this._state(item.entity), isFan = item.entity.startsWith("fan.");
    const overlay = document.createElement("div");
    overlay.className = "details-overlay";
    overlay.innerHTML = `<section class="details-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(item.name || item.entity)} controls">
      <div class="dialog-head"><button class="dialog-close" aria-label="Close">×</button><div><h2>${escapeHtml(item.name || state?.attributes?.friendly_name || item.entity)}</h2>${item.model ? `<p>${escapeHtml(item.model)}</p>` : ""}</div>
      ${isFan && item.holiday_mode ? `<button class="dialog-mode ${this._value(item.holiday_mode)==='on'?'enabled':''}" data-holiday>Holiday Mode · ${this._value(item.holiday_mode)==='on'?'On':'Off'}</button>` : ""}
      ${!isFan && item.optimisation ? `<button class="dialog-mode ${this._value(item.optimisation.enabled)==='on'?'enabled':''}" data-optimise>Optimise Cooling · ${this._value(item.optimisation.enabled)==='on'?'On':'Off'}</button>` : ""}</div>
      <div class="optimise-panel" ${this._optimiseOpen ? "" : "hidden"}></div>
      ${isFan ? `<div class="quality-grid">${(item.air_quality || []).map(sensor => {const s=this._state(sensor.entity);return `<div><span>${escapeHtml(sensor.name || s?.attributes?.friendly_name || sensor.entity)}</span><strong>${escapeHtml(validValue(s?.state)?s.state:'—')} ${escapeHtml(s?.attributes?.unit_of_measurement || '')}</strong></div>`;}).join("") || '<p>Configure air_quality sensors to show this fan’s environmental readings.</p>'}</div>` : `<div class="dialog-reading">${this._temperature(state) ?? '—'}°C<small>Current temperature</small></div><div class="dialog-controls"><button data-dialog-power>Power</button>${item.led?'<button data-dialog-led>Display light</button>':''}<button data-dialog-minus>−</button><strong>${escapeHtml(state?.attributes?.temperature ?? '—')}°C</strong><button data-dialog-plus>+</button></div>`}
      <button class="native-controls">More device controls</button><p class="dialog-error" role="alert"></p>
    </section>`;
    const fail = error => { overlay.querySelector(".dialog-error").textContent = error.message || "Could not apply setting"; };
    const close = () => {this._details = null; overlay.remove();};
    overlay.addEventListener("click", event => {if(event.target===overlay)close();});
    overlay.addEventListener("keydown", event => {if(event.key==='Escape')close();});
    overlay.querySelector(".dialog-close").addEventListener("click",close);
    overlay.querySelector(".native-controls").addEventListener("click",()=>{close();this._nativeMoreInfo(item.entity);});
    overlay.querySelector("[data-holiday]")?.addEventListener("click",async()=>{try{await this._hass.callService('input_boolean','toggle',{entity_id:item.holiday_mode});}catch(error){fail(error);}});
    overlay.querySelector("[data-optimise]")?.addEventListener("click",()=>{this._optimiseOpen=!this._optimiseOpen;this._draft={minimum:this._number(item.optimisation.minimum)??23,maximum:this._number(item.optimisation.maximum)??25};this._renderDetails();});
    overlay.querySelector("[data-dialog-power]")?.addEventListener("click",()=>this._toggle(item.entity).catch(fail));
    overlay.querySelector("[data-dialog-led]")?.addEventListener("click",()=>this._toggle(item.led).catch(fail));
    overlay.querySelector("[data-dialog-minus]")?.addEventListener("click",()=>this._adjustTemperature(item.entity,-0.5).catch(fail));
    overlay.querySelector("[data-dialog-plus]")?.addEventListener("click",()=>this._adjustTemperature(item.entity,0.5).catch(fail));
    if (this._optimiseOpen && item.optimisation) {
      const panel=overlay.querySelector('.optimise-panel'), options=item.optimisation;
      this._draft ||= {minimum:this._number(options.minimum)??23,maximum:this._number(options.maximum)??25};
      panel.innerHTML=`<p>Night cooling · 20:00–08:00<br>Minimum: Gen 60%. Maximum: full cooling, target 2°C below minimum (floor 16°C). Mapped fans run at 40% oscillating in both stages.</p>${['minimum','maximum'].map(key=>`<label>${key==='minimum'?'Minimum':'Maximum'} °C<input data-number="${key}" aria-label="${key} temperature" type="number" min="16" max="30" step="0.5" value="${this._draft[key]}"></label><input data-range="${key}" aria-label="${key} temperature slider" type="range" min="16" max="30" step="0.5" value="${this._draft[key]}">`).join('')}<div class="dialog-controls"><button data-save>Save & Enable</button><button data-disable>Switch Off</button></div>`;
      panel.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>{const key=input.dataset.number||input.dataset.range;this._draft[key]=Number(input.value);panel.querySelectorAll(`[data-number="${key}"],[data-range="${key}"]`).forEach(other=>{if(other!==input)other.value=input.value;});}));
      const save=async enabled=>{try{const {minimum,maximum}=this._draft;if(!Number.isFinite(minimum+maximum)||minimum<16||maximum>30||minimum>=maximum||minimum*2%1||maximum*2%1)throw new Error('Choose a minimum below maximum in 0.5°C steps, from 16–30°C.');await this._hass.callService('script',options.save_script||'cooling_dashboard_save_optimisation',{enabled_helper:options.enabled,minimum_helper:options.minimum,maximum_helper:options.maximum,minimum,maximum,enabled});this._optimiseOpen=false;this._renderDetails();}catch(error){fail(error);}};
      panel.querySelector('[data-save]').addEventListener('click',()=>save(true));
      panel.querySelector('[data-disable]').addEventListener('click',()=>save(false));
    }
    if(isFan)overlay.querySelector('.quality-grid').addEventListener('click',close);
    this.shadowRoot.appendChild(overlay);
    if(this._detailsFocus){overlay.querySelector('.dialog-close').focus();this._detailsFocus=false;}
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
        <div class="card-top"><button class="icon-power" data-toggle="${escapeHtml(item.entity)}" aria-label="${escapeHtml(item.name || 'AC')} power" ${unavailable?'disabled':''}><ha-icon icon="${escapeHtml(item.icon || "mdi:air-conditioner")}"></ha-icon></button><strong>${escapeHtml(item.name || state?.attributes?.friendly_name || item.entity)}</strong></div>
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
    const sweepWidth = this._sweepWidth(item,state);
    const airQuality = this._airQuality(item);
    return `
      <article class="entity-card fan ${running ? "running" : ""} ${item.holiday_mode && this._value(item.holiday_mode)==='on'?'holiday':''} ${airQuality ? `air-${airQuality.level}` : ""} ${unavailable ? "unavailable" : ""}" data-entity="${escapeHtml(item.entity)}">
        <div class="card-top"><button class="icon-power" data-toggle="${escapeHtml(item.entity)}" aria-label="${escapeHtml(item.name || 'Fan')} power" ${unavailable?'disabled':''}><ha-icon class="fan-icon" icon="${escapeHtml(item.icon || "mdi:fan")}"></ha-icon></button><strong>${escapeHtml(item.name || state?.attributes?.friendly_name || item.entity)}</strong></div>
        <div class="primary-reading">${unavailable ? "—" : running ? `${Number.isFinite(percentage) ? Math.round(percentage) : 100}%` : "OFF"}</div>
        <div class="details">
          ${humidity === null ? "" : `<span><ha-icon icon="mdi:water-percent"></ha-icon>${Math.round(humidity)}%</span>`}
          ${power === null ? "" : `<span><ha-icon icon="mdi:lightning-bolt"></ha-icon>${escapeHtml(this._formatPower(power))}</span>`}
          ${airQuality ? `<span class="air-badge ${airQuality.level}">${escapeHtml(airQuality.label)}</span>` : ""}
        </div>
        <input class="speed" data-fan-speed="${escapeHtml(item.entity)}" type="range" min="0" max="100" step="10" value="${Number.isFinite(percentage) ? percentage : 0}" aria-label="Fan speed" ${running ? "" : "disabled"}>
        <div class="fan-actions ${item.sweep?'has-sweep':''}"><button class="feature-button" data-toggle="${escapeHtml(item.entity)}" title="Power"><ha-icon icon="mdi:power"></ha-icon></button>${item.sweep?`<button class="feature-button ${!oscillating?'active':''}" data-sweep-off="${escapeHtml(item.entity)}" title="Sweep off" ${running?'':'disabled'}><ha-icon icon="mdi:rotate-3d-variant"></ha-icon></button><button class="feature-button ${oscillating?'active':''}" data-sweep="${escapeHtml(item.entity)}" title="Next sweep angle" ${running?'':'disabled'}>${this._sweepIcon(sweepWidth)} ${escapeHtml(sweepWidth||'—')}°</button>`:`<button class="feature-button ${oscillating ? "active" : ""}" data-oscillate="${escapeHtml(item.entity)}" title="Oscillation" ${running ? "" : "disabled"}><ha-icon icon="mdi:rotate-360"></ha-icon></button>`}</div>
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
        ha-card { display:block; padding:16px; overflow:hidden; background:var(--ha-card-background,var(--card-background-color)); }
        .header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:14px; padding:2px 4px; }
        .header h2 { margin:0; font-size:1.25rem; letter-spacing:.08em; }
        .summary { display:flex; align-items:center; gap:14px; color:var(--secondary-text-color); font-weight:700; }
        .summary span { display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
        .summary ha-icon { width:19px; color:#ffca28; }
        .weather.entity-card { width:100%; min-height:82px; display:flex; align-items:center; gap:14px; margin:0 0 16px; padding:14px 18px; border:1px solid var(--divider-color); border-radius:16px; background:rgba(41,182,246,.07); color:var(--primary-text-color); text-align:left; cursor:pointer; }
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
        .entity-card.fan.running.air-poor { animation:poor-air-glow .9s ease-in-out infinite; }
        .entity-card.unavailable { opacity:.48; }
        .card-top { display:flex; align-items:center; gap:9px; min-width:0; }
        .card-top strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .card-top ha-icon { width:22px; color:#42a5f5; }
        .fan.running .fan-icon { animation:spin 2.2s linear infinite; }
        .primary-reading { margin:16px 0 8px; font-size:1.55rem; font-weight:800; }
        .details { min-height:24px; display:flex; flex-wrap:wrap; gap:7px 12px; color:var(--secondary-text-color); font-size:.86rem; text-transform:capitalize; }
        .details span { display:inline-flex; align-items:center; gap:3px; }
        .details ha-icon { width:16px; }
        .air-badge { padding:3px 8px; border-radius:11px; font-weight:800; text-transform:none; }
        .air-badge.good { background:rgba(76,175,80,.15); color:#78e08f; }
        .air-badge.moderate { background:rgba(255,152,0,.18); color:#ffb74d; }
        .air-badge.poor { background:rgba(244,67,54,.2); color:#ff6b6b; }
        .actions { display:flex; align-items:center; gap:7px; margin-top:11px; color:var(--secondary-text-color); font-size:.72rem; }
        .temperature-control { height:54px; display:grid; grid-template-columns:44px 1fr 44px; align-items:center; margin-top:12px; border-radius:13px; background:rgba(255,255,255,.055); text-align:center; }
        .temperature-control button { height:100%; border:0; background:transparent; color:var(--primary-text-color); font-size:1.45rem; cursor:pointer; }
        .mode-control { height:48px; display:flex; align-items:center; gap:9px; margin-top:10px; padding:0 14px; border-radius:13px; background:rgba(255,255,255,.055); }
        .mode-control ha-icon { width:20px; }
        .mode-control select { flex:1; min-width:0; border:0; background:transparent; color:var(--primary-text-color); font:inherit; text-transform:capitalize; }
        .speed { width:100%; height:56px; margin:10px 0 8px; accent-color:#10bed5; }
        .fan-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .icon-power{display:inline-grid;place-items:center;border:0;background:transparent;color:inherit;padding:0;cursor:pointer}.icon-power:disabled{opacity:.4;cursor:default}
        .fan-actions.has-sweep{grid-template-columns:1fr 1fr 1.4fr}.feature-button svg{width:24px;height:24px;vertical-align:middle;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.fan.holiday{animation:holiday-glow 1.35s ease-in-out infinite!important}
        .feature-button { height:48px; min-width:0; display:flex; align-items:center; justify-content:center; gap:4px; padding:2px 4px; white-space:nowrap; font-size:12px; border:0; border-radius:13px; background:rgba(255,255,255,.055); color:var(--primary-text-color); cursor:pointer; }
        .feature-button:disabled,.speed:disabled { cursor:not-allowed; opacity:.38; }
        .feature-button.active { background:#e7e7e7; color:#222; }
        .action { width:32px; height:32px; display:grid; place-items:center; padding:0; border:1px solid var(--divider-color); border-radius:50%; background:var(--card-background-color); color:var(--secondary-text-color); cursor:pointer; }
        .action.active.power { color:#091d10; background:#5cff9a; border-color:#5cff9a; }
        .action.active.led { color:#2b2300; background:#ffe55c; border-color:#ffe55c; }
        .action ha-icon { width:18px; }
        @keyframes running-glow { 0%,100%{box-shadow:0 0 3px rgba(33,150,243,.28)} 50%{box-shadow:0 0 16px 3px rgba(33,150,243,.58)} }
        @keyframes coldest-glow { 0%,100%{box-shadow:0 0 5px rgba(0,229,255,.35)} 50%{box-shadow:0 0 22px 5px rgba(0,229,255,.82)} }
        @keyframes white-glow { 0%,100%{box-shadow:0 0 4px rgba(255,255,255,.28)} 50%{box-shadow:0 0 18px 3px rgba(255,255,255,.72)} }
        @keyframes poor-air-glow { 0%,100%{border-color:rgba(255,45,45,.98);box-shadow:inset 0 0 0 2px rgba(255,45,45,.98),0 0 18px 4px rgba(255,35,35,.78)} 50%{border-color:rgba(255,255,255,.98);box-shadow:inset 0 0 0 2px rgba(255,255,255,.98),0 0 18px 4px rgba(255,255,255,.72)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes holiday-glow{0%,100%{border-color:#37d269;box-shadow:inset 0 0 0 2px #37d269,0 0 16px #2dc85f99}50%{border-color:#ffdc37;box-shadow:inset 0 0 0 2px #ffdc37,0 0 18px #ffcd23aa}}
        .details-overlay{position:fixed;inset:0;z-index:1000;background:#0009;display:grid;place-items:center;padding:18px}.details-dialog{width:min(680px,100%);max-height:90vh;overflow:auto;padding:24px;background:var(--card-background-color,#222);color:var(--primary-text-color,#fff);border-radius:22px;box-shadow:0 18px 60px #0008}.dialog-head{display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap}.dialog-head h2{font-size:20px;margin:0}.dialog-head p{margin:5px 0;color:var(--secondary-text-color)}.dialog-head .dialog-mode{margin-left:auto}.details-dialog button{font:600 13px sans-serif;border:1px solid var(--divider-color,#555);border-radius:18px;padding:10px;background:var(--card-background-color,#222);color:inherit;cursor:pointer}.details-dialog .enabled{color:#90caf9;border-color:#42a5f5}.quality-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.quality-grid>div{border:1px solid var(--divider-color);padding:16px;border-radius:12px;display:flex;gap:10px;justify-content:space-between}.quality-grid span{color:var(--secondary-text-color)}.dialog-reading{text-align:center;font-size:40px;padding:24px}.dialog-reading small{display:block;font-size:13px}.dialog-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0}.optimise-panel{padding:16px;border:1px solid var(--divider-color);border-radius:16px;margin:16px 0}.optimise-panel p{font-size:13px;line-height:1.5}.optimise-panel label{display:flex;justify-content:space-between;align-items:center}.optimise-panel input[type=number]{width:75px;padding:7px;background:transparent;color:inherit;border:1px solid var(--divider-color);border-radius:6px}.optimise-panel input[type=range]{width:100%;margin:12px 0 20px}.dialog-error{color:#ff8a80}.native-controls{margin-top:20px}[hidden]{display:none!important}
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
      if (event.target.closest("button,input,select,label")) return;
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
    this.shadowRoot.querySelectorAll('[data-sweep]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();this._cycleSweep(this._config.fans.find(item=>item.entity===button.dataset.sweep)).catch(error=>console.error('Sweep control',error));}));
    this.shadowRoot.querySelectorAll('[data-sweep-off]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();if(this._state(button.dataset.sweepOff)?.state==='on')this._hass.callService('fan','oscillate',{entity_id:button.dataset.sweepOff,oscillating:false});}));
    this._renderDetails();
  }
}

if (!customElements.get("cooling-dashboard")) {
  customElements.define("cooling-dashboard", CoolingDashboard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "cooling-dashboard",
  name: "Cooling Dashboard",
  description: "A responsive Home Assistant dashboard for climate units, fans, humidity, power and weather.",
  preview: true,
  documentationURL: "https://github.com/obaiii/ha-cooling-dashboard",
});

console.info(`%c COOLING DASHBOARD %c v${CARD_VERSION} `, "color:#101010;background:#66ccff;font-weight:700", "color:#66ccff;background:#101010");
