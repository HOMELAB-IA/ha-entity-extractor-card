/* Entity Extractor Card for Home Assistant
 * Browse, search, select and export entities as IDs, YAML, JSON or CSV.
 * Single file, no build step. Install: copy to /config/www/ and add as a
 * dashboard resource (JavaScript module).
 */

const CARD_VERSION = "1.1.0";

const FORMATS = [
  { id: "ids", label: "Entity IDs (one per line)", ext: "txt", mime: "text/plain" },
  { id: "yaml-entities", label: "YAML — entities card", ext: "yaml", mime: "text/yaml" },
  { id: "yaml-detailed", label: "YAML — detailed list", ext: "yaml", mime: "text/yaml" },
  { id: "json", label: "JSON — detailed", ext: "json", mime: "application/json" },
  { id: "csv", label: "CSV — spreadsheet", ext: "csv", mime: "text/csv" },
];

/* Fallback icons when the entity has none and ha-state-icon is unavailable */
const DOMAIN_ICONS = {
  air_quality: "mdi:air-filter",
  alarm_control_panel: "mdi:shield-home",
  automation: "mdi:robot",
  binary_sensor: "mdi:checkbox-blank-circle-outline",
  button: "mdi:gesture-tap-button",
  calendar: "mdi:calendar",
  camera: "mdi:video",
  climate: "mdi:thermostat",
  cover: "mdi:window-shutter",
  device_tracker: "mdi:account",
  fan: "mdi:fan",
  humidifier: "mdi:air-humidifier",
  input_boolean: "mdi:toggle-switch",
  input_number: "mdi:ray-vertex",
  input_select: "mdi:format-list-bulleted",
  input_text: "mdi:form-textbox",
  light: "mdi:lightbulb",
  lock: "mdi:lock",
  media_player: "mdi:cast",
  number: "mdi:ray-vertex",
  person: "mdi:account",
  remote: "mdi:remote",
  scene: "mdi:palette",
  script: "mdi:script-text",
  select: "mdi:format-list-bulleted",
  sensor: "mdi:eye",
  siren: "mdi:bullhorn",
  sun: "mdi:white-balance-sunny",
  switch: "mdi:flash",
  timer: "mdi:timer-outline",
  update: "mdi:package-up",
  vacuum: "mdi:robot-vacuum",
  water_heater: "mdi:water-boiler",
  weather: "mdi:weather-partly-cloudy",
  zone: "mdi:map-marker-radius",
};

const TOGGLEABLE_DOMAINS = [
  "switch", "light", "script", "scene", "button", "input_boolean",
  "lock", "cover", "fan", "automation", "siren", "vacuum",
];

const MAX_GALLERY = 18;

class EntityExtractorCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._selected = new Set();
    this._search = "";
    this._domain = "";
    this._area = "";
    this._format = "yaml-entities";
    this._rowEls = new Map();
    this._built = false;
    this._entityCount = -1;
    this._searchTimer = null;
    this._galleryOpen = false;
    this._galleryCards = [];
    this._galleryTimer = null;
    this._galleryGen = 0;
    this._helpersPromise = null;
  }

  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = Object.assign({ title: "Entity Extractor", max_rows: 200 }, config || {});
  }

  set hass(hass) {
    this._hass = hass;
    if (!hass) return;
    if (!this._built) {
      this._build();
      this._built = true;
    }
    const count = Object.keys(hass.states).length;
    if (count !== this._entityCount) {
      this._entityCount = count;
      this._fillDomainOptions();
      this._fillAreaOptions();
      this._renderList();
    } else {
      this._updateStates();
    }
    for (const el of this._galleryCards) {
      try {
        el.hass = hass;
      } catch (_) {
        /* preview element may not accept hass yet */
      }
    }
  }

  getCardSize() {
    return 10;
  }

  /* ---------- build static DOM once ---------- */

  _build() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px; }
        .header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
        .title { font-size: 1.25rem; font-weight: 500; color: var(--primary-text-color); }
        .count { font-size: 0.85rem; color: var(--secondary-text-color); }
        .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
        input[type="search"] {
          flex: 2 1 180px; min-width: 140px; padding: 8px 10px;
          border: 1px solid var(--divider-color, #444); border-radius: 8px;
          background: var(--card-background-color); color: var(--primary-text-color);
          font: inherit; outline: none;
        }
        input[type="search"]:focus { border-color: var(--primary-color); }
        select {
          flex: 1 1 120px; min-width: 110px; padding: 8px 6px;
          border: 1px solid var(--divider-color, #444); border-radius: 8px;
          background: var(--card-background-color); color: var(--primary-text-color);
          font: inherit; outline: none;
        }
        .actions { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .flex { flex: 1; }
        button {
          padding: 6px 12px; border: 1px solid var(--divider-color, #444); border-radius: 8px;
          background: transparent; color: var(--primary-text-color); font: inherit;
          cursor: pointer;
        }
        button:hover { border-color: var(--primary-color); color: var(--primary-color); }
        button.primary {
          background: var(--primary-color); border-color: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }
        button.primary:hover { opacity: 0.9; }
        .selcount { font-size: 0.85rem; color: var(--secondary-text-color); }
        .list {
          max-height: 380px; overflow-y: auto;
          border: 1px solid var(--divider-color, #444); border-radius: 8px;
        }
        .row {
          display: flex; align-items: center; gap: 10px; padding: 6px 10px;
          border-bottom: 1px solid var(--divider-color, #333); cursor: pointer;
        }
        .row:last-child { border-bottom: none; }
        .row:hover { background: var(--secondary-background-color); }
        .row input[type="checkbox"] { cursor: pointer; accent-color: var(--primary-color); }
        .row .info { flex: 1; min-width: 0; }
        .row .name {
          color: var(--primary-text-color); white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis;
        }
        .row .eid {
          font-family: var(--code-font-family, monospace); font-size: 0.78rem;
          color: var(--secondary-text-color); white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis;
        }
        .row .state {
          font-size: 0.85rem; color: var(--secondary-text-color);
          max-width: 110px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .row .copy1 { border: none; padding: 4px 6px; font-size: 0.8rem; opacity: 0.6; }
        .row .copy1:hover { opacity: 1; }
        .empty, .note { padding: 10px; font-size: 0.85rem; color: var(--secondary-text-color); text-align: center; }
        .export { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
        .export select { flex: 1 1 180px; }
        textarea {
          width: 100%; box-sizing: border-box; margin-top: 8px; min-height: 110px;
          resize: vertical; padding: 8px 10px;
          border: 1px solid var(--divider-color, #444); border-radius: 8px;
          background: var(--secondary-background-color); color: var(--primary-text-color);
          font-family: var(--code-font-family, monospace); font-size: 0.8rem; outline: none;
        }
        .row ha-state-icon, .row ha-icon {
          flex: 0 0 auto;
          color: var(--state-icon-color, var(--paper-item-icon-color, #44739e));
        }
        .gallery-bar { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
        .gallery-note { font-size: 0.8rem; color: var(--secondary-text-color); }
        .gallery {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 12px; margin-top: 12px;
        }
        .gcard {
          border: 1px solid var(--divider-color, #444); border-radius: 8px;
          padding: 8px; display: flex; flex-direction: column; gap: 8px; min-width: 0;
        }
        .ghead { display: flex; align-items: center; gap: 8px; }
        .gtype { font-weight: 600; font-size: 0.9rem; color: var(--primary-text-color); white-space: nowrap; }
        .gtarget {
          flex: 1; font-family: var(--code-font-family, monospace); font-size: 0.72rem;
          color: var(--secondary-text-color); white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis; text-align: right;
        }
        .gcopy { padding: 4px 10px; font-size: 0.8rem; }
        .gpreview { pointer-events: none; }
        .gpreview > * { width: 100%; }
        .gpreview pre {
          margin: 0; padding: 8px; overflow-x: auto; border-radius: 6px;
          background: var(--secondary-background-color); color: var(--primary-text-color);
          font-family: var(--code-font-family, monospace); font-size: 0.75rem;
        }
        .toast {
          position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
          background: var(--primary-color); color: var(--text-primary-color, #fff);
          padding: 8px 16px; border-radius: 8px; font-size: 0.9rem;
          opacity: 0; pointer-events: none; transition: opacity 0.2s; z-index: 10;
        }
        .toast.show { opacity: 1; }
      </style>
      <ha-card>
        <div class="header">
          <div class="title"></div>
          <div class="count"></div>
        </div>
        <div class="toolbar">
          <input id="search" type="search" placeholder="Search name or entity ID…">
          <select id="domain"><option value="">All domains</option></select>
          <select id="area"><option value="">All areas</option></select>
        </div>
        <div class="actions">
          <button id="selectAll">Select all</button>
          <button id="clearSel">Clear</button>
          <span class="flex"></span>
          <span class="selcount">0 selected</span>
        </div>
        <div class="list"></div>
        <div class="note"></div>
        <div class="export">
          <select id="format"></select>
          <button id="copy" class="primary">Copy</button>
          <button id="download" class="primary">Download file</button>
        </div>
        <textarea id="preview" readonly placeholder="Select entities above — the export preview appears here."></textarea>
        <div class="gallery-bar">
          <button id="galleryToggle">Show card gallery</button>
          <span class="gallery-note">Live previews of cards that fit your selection</span>
        </div>
        <div class="gallery" hidden></div>
        <div class="toast"></div>
      </ha-card>
    `;

    const $ = (sel) => this.shadowRoot.querySelector(sel);
    this._el = {
      title: $(".title"),
      count: $(".count"),
      search: $("#search"),
      domain: $("#domain"),
      area: $("#area"),
      selectAll: $("#selectAll"),
      clearSel: $("#clearSel"),
      selcount: $(".selcount"),
      list: $(".list"),
      note: $(".note"),
      format: $("#format"),
      copy: $("#copy"),
      download: $("#download"),
      preview: $("#preview"),
      galleryToggle: $("#galleryToggle"),
      galleryNote: $(".gallery-note"),
      gallery: $(".gallery"),
      toast: $(".toast"),
    };

    this._el.title.textContent = this._config.title;

    for (const f of FORMATS) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.label;
      this._el.format.appendChild(opt);
    }
    this._el.format.value = this._format;

    this._el.search.addEventListener("input", () => {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this._search = this._el.search.value.trim().toLowerCase();
        this._renderList();
      }, 120);
    });
    this._el.domain.addEventListener("change", () => {
      this._domain = this._el.domain.value;
      this._renderList();
    });
    this._el.area.addEventListener("change", () => {
      this._area = this._el.area.value;
      this._renderList();
    });
    this._el.selectAll.addEventListener("click", () => {
      for (const id of this._filtered || []) this._selected.add(id);
      this._renderList();
      this._updateOutput();
    });
    this._el.clearSel.addEventListener("click", () => {
      this._selected.clear();
      this._renderList();
      this._updateOutput();
    });
    this._el.format.addEventListener("change", () => {
      this._format = this._el.format.value;
      this._updateOutput();
    });
    this._el.copy.addEventListener("click", async () => {
      const text = this._generate();
      if (!text) return this._toast("Nothing selected");
      const ok = await this._copyText(text);
      this._toast(ok ? `Copied ${this._selected.size} entit${this._selected.size === 1 ? "y" : "ies"}` : "Copy failed");
    });
    this._el.download.addEventListener("click", () => {
      const text = this._generate();
      if (!text) return this._toast("Nothing selected");
      const fmt = FORMATS.find((f) => f.id === this._format);
      const blob = new Blob([text], { type: fmt.mime + ";charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `entities.${fmt.ext}`;
      this.shadowRoot.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      this._toast(`Downloaded entities.${fmt.ext}`);
    });
    this._el.galleryToggle.addEventListener("click", () => {
      this._galleryOpen = !this._galleryOpen;
      this._el.galleryToggle.textContent = this._galleryOpen ? "Hide card gallery" : "Show card gallery";
      this._el.gallery.hidden = !this._galleryOpen;
      if (this._galleryOpen) this._renderGallery();
      else {
        this._galleryCards = [];
        this._el.galleryNote.textContent = "Live previews of cards that fit your selection";
      }
    });
  }

  /* ---------- filter options ---------- */

  _fillDomainOptions() {
    const domains = new Set();
    for (const id of Object.keys(this._hass.states)) domains.add(id.split(".")[0]);
    const current = this._domain;
    const sel = this._el.domain;
    sel.innerHTML = '<option value="">All domains</option>';
    for (const d of [...domains].sort()) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      sel.appendChild(opt);
    }
    sel.value = domains.has(current) ? current : "";
    this._domain = sel.value;
  }

  _fillAreaOptions() {
    const sel = this._el.area;
    const areas = this._hass.areas;
    if (!areas || !Object.keys(areas).length) {
      sel.style.display = "none";
      this._area = "";
      return;
    }
    sel.style.display = "";
    const current = this._area;
    sel.innerHTML = '<option value="">All areas</option>';
    const sorted = Object.values(areas).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    for (const a of sorted) {
      const opt = document.createElement("option");
      opt.value = a.area_id;
      opt.textContent = a.name || a.area_id;
      sel.appendChild(opt);
    }
    sel.value = areas[current] ? current : "";
    this._area = sel.value;
  }

  _areaIdOf(entityId) {
    const reg = (this._hass.entities || {})[entityId];
    if (!reg) return null;
    if (reg.area_id) return reg.area_id;
    const dev = (this._hass.devices || {})[reg.device_id];
    return (dev && dev.area_id) || null;
  }

  /* ---------- entity list ---------- */

  _filteredIds() {
    const states = this._hass.states;
    const q = this._search;
    const out = [];
    for (const id of Object.keys(states)) {
      if (this._domain && id.split(".")[0] !== this._domain) continue;
      if (this._area && this._areaIdOf(id) !== this._area) continue;
      if (q) {
        const name = (states[id].attributes.friendly_name || "").toLowerCase();
        if (!id.toLowerCase().includes(q) && !name.includes(q)) continue;
      }
      out.push(id);
    }
    return out.sort();
  }

  _renderList() {
    if (!this._hass) return;
    const ids = this._filteredIds();
    this._filtered = ids;
    const cap = Number(this._config.max_rows) || 200;
    const shown = ids.slice(0, cap);

    const list = this._el.list;
    list.innerHTML = "";
    this._rowEls.clear();

    if (!shown.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No entities match your filters.";
      list.appendChild(empty);
    }

    for (const id of shown) {
      const st = this._hass.states[id];
      const row = document.createElement("div");
      row.className = "row";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = this._selected.has(id);
      cb.addEventListener("click", (ev) => ev.stopPropagation());
      cb.addEventListener("change", () => {
        if (cb.checked) this._selected.add(id);
        else this._selected.delete(id);
        this._updateOutput();
      });

      const info = document.createElement("div");
      info.className = "info";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = st.attributes.friendly_name || id;
      const eid = document.createElement("div");
      eid.className = "eid";
      eid.textContent = id;
      info.appendChild(name);
      info.appendChild(eid);

      const state = document.createElement("div");
      state.className = "state";
      state.textContent = this._stateText(st);

      const copy1 = document.createElement("button");
      copy1.className = "copy1";
      copy1.title = "Copy entity ID";
      copy1.textContent = "⧉"; // ⧉
      copy1.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const ok = await this._copyText(id);
        this._toast(ok ? `Copied ${id}` : "Copy failed");
      });

      row.addEventListener("click", () => {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change"));
      });

      const icon = this._makeIcon(st);

      row.appendChild(cb);
      row.appendChild(icon);
      row.appendChild(info);
      row.appendChild(state);
      row.appendChild(copy1);
      list.appendChild(row);
      this._rowEls.set(id, { cb, state, icon });
    }

    this._el.count.textContent = `${ids.length} / ${this._entityCount} entities`;
    this._el.note.textContent =
      ids.length > cap ? `Showing first ${cap} of ${ids.length} — refine your search to see more.` : "";
    this._updateSelCount();
  }

  _stateText(st) {
    const unit = st.attributes.unit_of_measurement;
    return unit ? `${st.state} ${unit}` : st.state;
  }

  _updateStates() {
    if (!this._rowEls.size) return;
    for (const [id, els] of this._rowEls) {
      const st = this._hass.states[id];
      if (!st) continue;
      const text = this._stateText(st);
      if (els.state.textContent !== text) els.state.textContent = text;
      if (els.icon && els.icon.tagName === "HA-STATE-ICON") {
        els.icon.hass = this._hass;
        els.icon.stateObj = st;
      }
    }
  }

  _makeIcon(st) {
    /* ha-state-icon (HA's own element) picks the correct icon for the
     * entity — registry icon, device_class, state — exactly like the UI. */
    if (customElements.get("ha-state-icon")) {
      const el = document.createElement("ha-state-icon");
      el.hass = this._hass;
      el.stateObj = st;
      return el;
    }
    const el = document.createElement("ha-icon");
    const domain = st.entity_id.split(".")[0];
    el.setAttribute("icon", st.attributes.icon || DOMAIN_ICONS[domain] || "mdi:shape");
    return el;
  }

  _updateSelCount() {
    const n = this._selected.size;
    this._el.selcount.textContent = `${n} selected`;
  }

  _updateOutput() {
    this._updateSelCount();
    this._el.preview.value = this._generate();
    if (this._galleryOpen) {
      clearTimeout(this._galleryTimer);
      this._galleryTimer = setTimeout(() => this._renderGallery(), 300);
    }
  }

  /* ---------- export generation ---------- */

  _entityData(id) {
    const st = this._hass.states[id] || { state: "unknown", attributes: {} };
    const attrs = st.attributes || {};
    const reg = (this._hass.entities || {})[id] || {};
    const dev = (this._hass.devices || {})[reg.device_id] || null;
    const areaId = reg.area_id || (dev && dev.area_id) || null;
    const areaObj = areaId && this._hass.areas ? this._hass.areas[areaId] : null;
    return {
      entity_id: id,
      name: attrs.friendly_name || id,
      domain: id.split(".")[0],
      area: areaObj ? areaObj.name || areaId : null,
      device: dev ? dev.name_by_user || dev.name || null : null,
      state: st.state,
      unit: attrs.unit_of_measurement || null,
      icon: attrs.icon || null,
    };
  }

  _yamlStr(value) {
    const s = String(value);
    const plain =
      /^[A-Za-z_][A-Za-z0-9_.\- ]*$/.test(s) &&
      !/^(true|false|yes|no|on|off|null)$/i.test(s) &&
      !/\s$/.test(s);
    return plain ? s : JSON.stringify(s);
  }

  _generate() {
    const ids = [...this._selected].sort();
    if (!ids.length) return "";
    const data = ids.map((id) => this._entityData(id));

    switch (this._format) {
      case "ids":
        return ids.join("\n") + "\n";

      case "yaml-entities": {
        const lines = ["type: entities", "entities:"];
        for (const id of ids) lines.push(`  - ${id}`);
        return lines.join("\n") + "\n";
      }

      case "yaml-detailed": {
        const lines = ["entities:"];
        for (const d of data) {
          lines.push(`  - entity: ${d.entity_id}`);
          lines.push(`    name: ${this._yamlStr(d.name)}`);
          lines.push(`    domain: ${d.domain}`);
          if (d.area) lines.push(`    area: ${this._yamlStr(d.area)}`);
          if (d.device) lines.push(`    device: ${this._yamlStr(d.device)}`);
          lines.push(`    state: ${this._yamlStr(d.state)}`);
          if (d.unit) lines.push(`    unit: ${this._yamlStr(d.unit)}`);
          if (d.icon) lines.push(`    icon: ${this._yamlStr(d.icon)}`);
        }
        return lines.join("\n") + "\n";
      }

      case "json":
        return JSON.stringify(data, null, 2) + "\n";

      case "csv": {
        const esc = (v) => (v == null ? "" : `"${String(v).replace(/"/g, '""')}"`);
        const header = "entity_id,name,domain,area,device,state,unit";
        const rows = data.map((d) =>
          [d.entity_id, d.name, d.domain, d.area, d.device, d.state, d.unit].map(esc).join(",")
        );
        return [header, ...rows].join("\n") + "\n";
      }

      default:
        return "";
    }
  }

  /* ---------- card gallery ---------- */

  _suggestions() {
    const ids = [...this._selected].sort();
    if (!ids.length) return [];
    const data = ids.map((id) => ({ id, st: this._hass.states[id] })).filter((d) => d.st);
    const domainOf = (id) => id.split(".")[0];
    const isNumeric = (d) => d.st.state !== "" && !isNaN(parseFloat(d.st.state)) && isFinite(d.st.state);
    const sugg = [];

    /* Multi-entity cards */
    sugg.push({ title: "Entities", target: `${ids.length} entities`, config: { type: "entities", entities: ids } });
    sugg.push({ title: "Glance", target: `${ids.length} entities`, config: { type: "glance", entities: ids } });

    const numeric = data.filter(isNumeric).map((d) => d.id);
    if (numeric.length) {
      sugg.push({
        title: "History graph",
        target: `${numeric.length} numeric`,
        config: { type: "history-graph", entities: numeric },
      });
    }

    const mappable = ids.filter((id) => ["device_tracker", "person", "zone"].includes(domainOf(id)));
    if (mappable.length) {
      sugg.push({ title: "Map", target: `${mappable.length} entities`, config: { type: "map", entities: mappable } });
    }

    /* Per-entity cards */
    const PER_DOMAIN = {
      light: [["Light", (id) => ({ type: "light", entity: id })]],
      climate: [["Thermostat", (id) => ({ type: "thermostat", entity: id })]],
      humidifier: [["Humidifier", (id) => ({ type: "humidifier", entity: id })]],
      media_player: [["Media control", (id) => ({ type: "media-control", entity: id })]],
      weather: [["Weather forecast", (id) => ({ type: "weather-forecast", entity: id })]],
      camera: [["Picture entity", (id) => ({ type: "picture-entity", entity: id, camera_image: id })]],
      alarm_control_panel: [["Alarm panel", (id) => ({ type: "alarm-panel", entity: id })]],
    };

    for (const d of data) {
      const dom = domainOf(d.id);
      for (const [title, make] of PER_DOMAIN[dom] || []) {
        sugg.push({ title, target: d.id, config: make(d.id) });
      }
      if (isNumeric(d) && ["sensor", "number", "input_number"].includes(dom)) {
        sugg.push({ title: "Gauge", target: d.id, config: { type: "gauge", entity: d.id } });
        sugg.push({ title: "Sensor graph", target: d.id, config: { type: "sensor", entity: d.id, graph: "line" } });
      }
      sugg.push({ title: "Tile", target: d.id, config: { type: "tile", entity: d.id } });
      if (TOGGLEABLE_DOMAINS.includes(dom)) {
        sugg.push({ title: "Button", target: d.id, config: { type: "button", entity: d.id } });
      }
    }
    return sugg;
  }

  _yamlScalar(v) {
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return this._yamlStr(v);
  }

  _toYaml(obj, indent = 0) {
    const pad = "  ".repeat(indent);
    const lines = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        lines.push(`${pad}${k}:`);
        for (const item of v) {
          if (item !== null && typeof item === "object") {
            const sub = this._toYaml(item, indent + 2).split("\n");
            sub[0] = `${pad}  - ${sub[0].trim()}`;
            lines.push(...sub);
          } else {
            lines.push(`${pad}  - ${this._yamlScalar(item)}`);
          }
        }
      } else if (typeof v === "object") {
        lines.push(`${pad}${k}:`);
        lines.push(this._toYaml(v, indent + 1));
      } else {
        lines.push(`${pad}${k}: ${this._yamlScalar(v)}`);
      }
    }
    return lines.join("\n");
  }

  async _renderGallery() {
    const gen = ++this._galleryGen;
    const gal = this._el.gallery;
    const all = this._suggestions();

    if (!all.length) {
      gal.innerHTML = '<div class="empty">Select entities in the list to see matching card suggestions.</div>';
      this._galleryCards = [];
      this._el.galleryNote.textContent = "Live previews of cards that fit your selection";
      return;
    }

    const shown = all.slice(0, MAX_GALLERY);
    this._el.galleryNote.textContent =
      all.length > MAX_GALLERY
        ? `Showing ${MAX_GALLERY} of ${all.length} suggestions — narrow your selection to see the rest.`
        : `${all.length} card suggestion${all.length === 1 ? "" : "s"}`;

    if (!this._helpersPromise && window.loadCardHelpers) {
      this._helpersPromise = window.loadCardHelpers().catch(() => null);
    }
    const helpers = this._helpersPromise ? await this._helpersPromise : null;
    if (gen !== this._galleryGen) return; // selection changed while loading

    gal.innerHTML = "";
    this._galleryCards = [];

    for (const s of shown) {
      const yaml = this._toYaml(s.config) + "\n";

      const box = document.createElement("div");
      box.className = "gcard";

      const head = document.createElement("div");
      head.className = "ghead";
      const type = document.createElement("span");
      type.className = "gtype";
      type.textContent = s.title;
      const target = document.createElement("span");
      target.className = "gtarget";
      target.textContent = s.target || "";
      target.title = s.target || "";
      const copyBtn = document.createElement("button");
      copyBtn.className = "gcopy";
      copyBtn.textContent = "Copy YAML";
      copyBtn.addEventListener("click", async () => {
        const ok = await this._copyText(yaml);
        this._toast(ok ? `Copied ${s.title} YAML` : "Copy failed");
      });
      head.appendChild(type);
      head.appendChild(target);
      head.appendChild(copyBtn);

      const prev = document.createElement("div");
      prev.className = "gpreview";
      if (helpers) {
        try {
          const cardEl = helpers.createCardElement(s.config);
          cardEl.hass = this._hass;
          prev.appendChild(cardEl);
          this._galleryCards.push(cardEl);
        } catch (_) {
          prev.innerHTML = "";
          const pre = document.createElement("pre");
          pre.textContent = yaml;
          prev.appendChild(pre);
        }
      } else {
        const pre = document.createElement("pre");
        pre.textContent = yaml;
        prev.appendChild(pre);
      }

      box.appendChild(head);
      box.appendChild(prev);
      gal.appendChild(box);
    }
  }

  /* ---------- helpers ---------- */

  async _copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      this.shadowRoot.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (_) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  _toast(message) {
    const t = this._el.toast;
    t.textContent = message;
    t.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
  }
}

customElements.define("entity-extractor-card", EntityExtractorCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "entity-extractor-card",
  name: "Entity Extractor Card",
  description: "Search, select and export entities as IDs, YAML, JSON or CSV for use in other card-building tools.",
});

console.info(
  `%c ENTITY-EXTRACTOR-CARD %c v${CARD_VERSION} `,
  "background: #03a9f4; color: #fff; font-weight: 600;",
  "background: #444; color: #fff;"
);
