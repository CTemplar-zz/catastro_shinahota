// =======================================================
// CONFIG
// =======================================================
const CONFIG = {
  shpPaths: {
    caminos: "./Shapefiles/Caminos.zip",
    estanques: "./Shapefiles/Estanques_Shinahota.zip",
    sindicatos: "./Shapefiles/Sindicatos.zip",
    catastro: "./Shapefiles/Catastro.zip",
  },
  photosFolder: "./FotosCatastro",
  homeView: { center: [-16.98, -65.40], zoom: 12 },
  LABEL_MIN_ZOOM: 13,
  supabase: {
    url: "https://asqwevtvvdlqblpjxzxv.supabase.co",
    key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzcXdldnR2dmRscWJscGp4enh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MjEyNzMsImV4cCI6MjA4NTQ5NzI3M30.o2ejqw6V90qIAQe6ZN412w4_g6S-McyJz9g-jKphP_M",
    table: "catastro",
    storageBucket: "fotos_catastro"
  }
};

let supabaseClient = null;
if (typeof supabaseClient === 'undefined' || !supabaseClient) {
  try {
    if (window.supabase) {
      supabaseClient = window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.key);
    }
  } catch (e) {
    console.warn("Supabase not initialized:", e);
  }
}

// =======================================================
// HELPERS
// =======================================================
function setLoading(isLoading) {
  document.getElementById("loader").classList.toggle("hidden", !isLoading);
}
function safeVal(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
function toNumber(v) {
  const s = safeVal(v).replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
function parseSpeciesList(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function normalizeSpeciesName(v) {
  // tolerante a tildes / mayúsculas / espacios
  let s = safeVal(v).toLowerCase();
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function hasSpecies(speciesArr, key) {
  // key: "Tambaqui","Pacú","Surubí","Tilapia","Pangacio"
  const set = new Set(speciesArr.map(normalizeSpeciesName));
  return set.has(normalizeSpeciesName(key));
}
function fmtInt(n) {
  try { return new Intl.NumberFormat("es-BO").format(n); }
  catch { return String(n); }
}
function normalizeSiNo(v) {
  let s = safeVal(v).toLowerCase();
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.startsWith("s")) return "si";
  if (s.startsWith("n")) return "no";
  return "";
}
function normalizeEstado(v) {
  let s = safeVal(v).toLowerCase();
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s === "completo") return "completo";
  if (s === "parcial") return "parcial";
  if (s === "sin datos" || s === "sindatos") return "sin datos";
  if (s.includes("parcial")) return "parcial";
  if (s.includes("sin") && s.includes("dato")) return "sin datos";
  if (s.includes("completo")) return "completo";
  return s;
}

// Campos tolerantes
function getEstadoRaw(p) { return safeVal(p["Estado"] ?? p["ESTADO"] ?? p["estado"] ?? ""); }
function getCatastroSindicacto(p) {
  return safeVal(p["Sindicacto"] ?? p["SINDICACTO"] ?? p["SINDICATO"] ?? p["Sindicato"] ?? "");
}
function getCatastroCentral(p) { return safeVal(p["CENTRAL"] ?? p["Central"] ?? ""); }
function getSindicatosNombre(p) {
  return safeVal(p["Sindicacto"] ?? p["SINDICACTO"] ?? p["SINDICATO"] ?? "");
}
function getSindicatosCentral(p) { return safeVal(p["CENTRAL"] ?? p["Central"] ?? ""); }

function uniqueSorted(arr) {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

// =======================================================
// STATE (filters)
// =======================================================
let currentFilters = {
  central: "",
  sindicato: "",
  // dashboard interaction filters
  estado: "",    // "completo" | "parcial" | "sin datos" | ""
  runsa: "",     // "si" | "no" | ""
  species: ""    // normalized species name, e.g. "pacu" | "tambaqui" | ""
};

function passesFiltersCatastro(p) {
  const c = currentFilters.central;
  const s = currentFilters.sindicato;
  if (c && getCatastroCentral(p) !== c) return false;
  if (s && getCatastroSindicacto(p) !== s) return false;

  // dashboard state filters
  const e = currentFilters.estado;
  if (e) {
    const estado = normalizeEstado(getEstadoRaw(p));
    if (estado !== e) return false;
  }
  const r = currentFilters.runsa;
  if (r) {
    const sn = normalizeSiNo(p["Tiene_RUNS"]);
    if (sn !== r) return false;
  }

  // filtro por especie (desde gráfico)
  const spFilter = currentFilters.species;
  if (spFilter) {
    const raw = safeVal(p["Que_especi"] ?? p["QUE_ESPECI"] ?? "");
    const arr = parseSpeciesList(raw).map(normalizeSpeciesName);
    if (!arr.includes(spFilter)) return false;
  }

  return true;
}

function passesFiltersSindicatos(p) {
  // solo central/sindicato (no depende de estado/runsa)
  const c = currentFilters.central;
  const s = currentFilters.sindicato;
  if (c && getSindicatosCentral(p) !== c) return false;
  if (s && getSindicatosNombre(p) !== s) return false;
  return true;
}

// =======================================================
// BASEMAPS
// =======================================================
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: "&copy; OpenStreetMap"
});

const esriImagery = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 20, attribution: "Tiles &copy; Esri" }
);

const cartoDark = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  { maxZoom: 20, attribution: "&copy; CARTO" }
);

const baseMaps = {
  "Satélite (ESRI)": esriImagery,
  "OpenStreetMap": osm,
  "Carto Dark": cartoDark
};

// =======================================================
// MAP INIT
// =======================================================
const map = L.map("map", { center: CONFIG.homeView.center, zoom: CONFIG.homeView.zoom, preferCanvas: true });
esriImagery.addTo(map);

const overlayMaps = {};
let layersControl = L.control.layers(baseMaps, overlayMaps, { collapsed: false }).addTo(map);

// ocultar control capas por defecto
let layersControlVisible = false;
function setLayersControlVisible(v) {
  layersControlVisible = v;
  const ctl = document.querySelector(".leaflet-control-layers");
  if (ctl) ctl.style.display = v ? "block" : "none";
}
setLayersControlVisible(false);

// leyenda por defecto oculta
const legendEl = document.getElementById("legend");
const legendContentEl = document.getElementById("legend-content");
function setLegendVisible(v) { legendEl.classList.toggle("hidden", !v); }
setLegendVisible(false);

document.getElementById("btn-toggle-layers").addEventListener("click", () => {
  setLayersControlVisible(!layersControlVisible);
});
document.getElementById("btn-toggle-legend").addEventListener("click", () => {
  setLegendVisible(legendEl.classList.contains("hidden"));
});
document.getElementById("legend-close").addEventListener("click", () => setLegendVisible(false));
document.getElementById("btn-home").addEventListener("click", () => {
  map.setView(CONFIG.homeView.center, CONFIG.homeView.zoom, { animate: true });
});

// =======================================================
// DATA CACHE
// =======================================================
let caminosGJ_ALL = null;
let estanquesGJ_ALL = null;
let sindicatosGJ_ALL = null;
let catastroGJ_ALL = null;

// Layers
let layerCaminos = null;              // NO activo por defecto
let layerEstanquesFiltered = null;
let layerSindicatos = null;
let layerSindicatosLabels = null;

let layerCatastroDatos = null;        // SOLO Estado no vacío
let layerCatastroTotal = null;        // gris (apagado por defecto)

let runsaChart = null;
let chartMode = "runsa"; // "runsa" | "species"
let labelsWanted = true;

// tabla: features actuales filtradas
let currentFilteredCatastroFeatures = [];

// =======================================================
// STYLES
// =======================================================
function styleCaminos(feature) {
  const ref = (feature.properties?.ref || "").toString().trim().toLowerCase();
  let color = "#04868b";
  let weight = 2.6;
  let dashArray = null;

  if (ref.includes("asfalto")) { color = "#efffff"; weight = 3.6; }
  else if (ref.includes("tierra")) { color = "#aa700b"; weight = 1.6; dashArray = "6,6"; }
  else if (ref.includes("comunal")) { color = "#f9f906"; weight = 1.3; dashArray = "2,6"; }
  else if (ref.includes("secund")) { color = "#00868d"; weight = 1.4; }
  else { color = "#037663"; weight = 2.0; dashArray = "4,8"; }

  const s = { color, weight, opacity: 0.95 };
  if (dashArray) s.dashArray = dashArray;
  return s;
}
function styleEstanques() {
  return { color: "#fefefe", weight: 1.4, opacity: 0.85, fillOpacity: 0.0 };
}
function styleSindicatos() {
  return { color: "#efffff", weight: 1.1, opacity: 0.85, fillOpacity: 0.0 };
}
function styleCatastro(feature) {
  const p = feature.properties || {};
  const estado = normalizeEstado(getEstadoRaw(p));
  let fillColor = "#037663";
  let fillOpacity = 0.35;

  if (estado === "sin datos") { fillColor = "#8b0d04"; fillOpacity = 0.22; }
  else if (estado === "parcial") { fillColor = "#c56817"; fillOpacity = 0.38; }
  else if (estado === "completo") { fillColor = "#56ff9d"; fillOpacity = 0.38; }

  return {
    color: "#021a1d",
    weight: 1.1,
    opacity: 0.75,
    fillColor,
    fillOpacity
  };
}
function styleCatastroTotal() {
  return { color: "rgba(239,255,255,.45)", weight: 0.8, opacity: 0.65, fillOpacity: 0.0 };
}

// =======================================================
// POPUP (solo catastro con datos)
// =======================================================
const CAT_FIELDS = [
  ["Estado", "Estado del catastro"],
  ["Nombre", "Nombre del propietario"],
  ["Celular", "Celular"],
  ["Asociacion", "Asociacion"],
  ["Estanques", "Estanques registrados"],
  ["Est_Obser", "Estanques identificados"],
  ["Nro_Bombas", "Nro Bombas hidraulicas"],
  ["Tiene_RUNS", "Tiene RUNSA?"],
  ["RUNSA", "RUNSA"],
  ["Que_especi", "Que especies cultiva?"],
  ["Que_tipo_d", "Que tipo de procesamiento realiza a su pescado?"],
  ["Sindicacto", "Sindicato"],
  ["CENTRAL", "Central"],
  ["FEDERACION", "Federacion"],
  ["ID_12", "Foto de estanques"]
];

function buildCatastroPopup(feature) {
  const p = feature.properties || {};

  // Lista de especies reportadas en el predio
  const speciesVal = safeVal(p["Que_especi"] ?? p["QUE_ESPECI"] ?? "");
  const speciesArr = parseSpeciesList(speciesVal);

  // Preguntas de cantidad por especie (solo mostrar si la especie está en Que_especi)
  const SPEC_Q_FIELDS = [
    { species: "Tambaqui", field: "Cuanto_Tam", label: "Cuanto tambaqui produjo?" },
    { species: "Pacu", field: "Cuanto_Pac", label: "Cuanto Pacú produjo?" },
    { species: "Surubi", field: "Cuanto_Sur", label: "Cuanto Surubí produjo?" },
    { species: "Tilapia", field: "Cuanto_Til", label: "Cuanta Tilapia produjo?" },
    { species: "Pangacio", field: "Cuanto_Pan", label: "Cuanto Pangacio produjo?" },
  ];

  const qtyRows = SPEC_Q_FIELDS
    .filter(x => hasSpecies(speciesArr, x.species))
    .map(x => {
      const val = safeVal(p[x.field] ?? p[x.field.toUpperCase()] ?? "");
      return `
        <tr>
          <td class="popup-k">${x.label}</td>
          <td class="popup-v">${val || "-"}</td>
        </tr>
      `;
    })
    .join("");

  const rows = CAT_FIELDS
    .filter(([k]) => k !== "ID_12")
    .map(([k, label]) => {
      const val = safeVal(p[k] ?? p[String(k).toUpperCase()] ?? "");
      const baseRow = `
        <tr>
          <td class="popup-k">${label}</td>
          <td class="popup-v">${val || "-"}</td>
        </tr>
      `;

      // Insertar dinámicamente las preguntas de cantidad justo después de "Que_especi"
      if (String(k) === "Que_especi") return baseRow + qtyRows;
      return baseRow;
    })
    .join("");

  const id = parseInt(safeVal(p["ID_12"] || "0"), 10);

  let photoBlock = `
    <div class="popup-photo">
      <div class="no-photo">Sin foto de estanques (ID_12 = 0)</div>
    </div>
  `;

  if (!Number.isNaN(id) && id > 0) {
    const jpg = `${CONFIG.photosFolder}/${id}.jpg`;
    const png = `${CONFIG.photosFolder}/${id}.png`;
    photoBlock = `
      <div class="popup-photo">
        <img src="${jpg}" alt="Foto estanques ${id}"
             onerror="this.onerror=null; this.src='${png}';" />
      </div>
    `;
  }

  return `
    <div class="popup-wrap">
      <div class="popup-header">Predio (Catastro)</div>
      <div class="popup-scroll">
        <table class="popup-table">${rows}</table>
      </div>
      ${photoBlock}
      <div class="popup-actions" style="margin-top: 10px; display: flex; gap: 8px;">
        <button class="btn-edit-feature" style="flex: 1; padding: 6px; cursor: pointer; background: var(--c1); color: white; border: none; border-radius: 6px;" 
                onclick='event.stopPropagation(); handleEditClick(${p._uid})'>
          <i class="fa-solid fa-pen-to-square"></i> Editar
        </button>
      </div>
    </div>
  `;
}

// Global handler for edit click
window.handleEditClick = function (uid) {
  const feat = catastroGJ_ALL.features.find(f => f.properties._uid === uid);
  const popup = map._popup;
  if (popup && feat) {
    popup.setContent(renderEditForm(feat.properties));
    popup.update();
  }
};

function renderEditForm(p) {
  const fields = [
    { key: "Estado", label: "Estado del catastro", type: "select", options: ["Completo", "Parcial", "Sin Datos"] },
    { key: "Nombre", label: "Nombre del propietario" },
    { key: "Celular", label: "Celular" },
    { key: "Asociacion", label: "Asociacion" },
    { key: "Estanques", label: "Estanques registrados" },
    { key: "Est_Obser", label: "Estanques identificados" },
    { key: "Nro_Bombas", label: "Nro Bombas hidraulicas" },
    { key: "Tiene_RUNS", label: "Tiene RUNSA?", type: "select", options: ["Si", "No"] },
    { key: "RUNSA", label: "RUNSA" },
    { key: "Que_especi", label: "Que especies cultiva?" },
    { key: "Cuanto_Tam", label: "Cuanto tambaqui produjo?" },
    { key: "Cuanto_Pac", label: "Cuanto Pacú produjo?" },
    { key: "Cuanto_Sur", label: "Cuanto Surubí produjo?" },
    { key: "Cuanto_Til", label: "Cuanta Tilapia produjo?" },
    { key: "Cuanto_Pan", label: "Cuanto Pangacio produjo?" },
    { key: "Que_tipo_d", label: "Que tipo de procesamiento realiza a su pescado?" },
    { key: "Sindicacto", label: "Sindicato" },
    { key: "CENTRAL", label: "Central" },
    { key: "FEDERACION", label: "Federacion" }
  ];

  const rows = fields.map(f => {
    let input = "";
    const val = safeVal(p[f.key] ?? p[f.key.toUpperCase()] ?? "");

    if (f.type === "select") {
      input = `
        <select name="${f.key}" class="edit-input">
          ${f.options.map(opt => `<option value="${opt}" ${val.toLowerCase() === opt.toLowerCase() ? 'selected' : ''}>${opt}</option>`).join("")}
        </select>
      `;
    } else {
      input = `<input type="text" name="${f.key}" class="edit-input" value="${val}">`;
    }

    return `
      <tr>
        <td class="popup-k">${f.label}</td>
        <td class="popup-v">${input}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="popup-wrap edit-mode">
      <div class="popup-header">Editar Predio</div>
      <form id="edit-feature-form" onsubmit="window.handleSave(event, ${p._uid})">
        <div class="popup-scroll">
          <table class="popup-table">${rows}</table>
        </div>
        
        <div class="edit-photo-section" style="margin-top: 10px;">
          <label class="popup-k" style="display:block; margin-bottom: 5px;">Actualizar Foto:</label>
          <input type="file" id="edit-photo-input" accept="image/*" capture="environment" style="font-size: 11px; width: 100%;">
        </div>

        <div class="popup-actions" style="margin-top: 12px; display: flex; gap: 8px;">
          <button type="submit" class="btn-save" style="flex: 1; padding: 8px; background: var(--c5); color: white; border: none; border-radius: 6px; cursor: pointer;">
            Guardar
          </button>
          <button type="button" class="btn-cancel" style="flex: 1; padding: 8px; background: #666; color: white; border: none; border-radius: 6px; cursor: pointer;"
                  onclick='event.stopPropagation(); window.handleCancelEdit(${p._uid})'>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  `;
}
window.handleCancelEdit = function (uid) {
  const feat = catastroGJ_ALL.features.find(f => f.properties._uid === uid);
  const popup = map._popup;
  if (popup && feat) {
    popup.setContent(buildCatastroPopup(feat));
    popup.update();
  }
};

window.handleSave = async function (event, uid) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const fileInput = document.getElementById("edit-photo-input");
  const file = fileInput.files[0];

  const updateData = {};
  formData.forEach((value, key) => {
    // Convertir a número campos que suelen serlo en la DB para evitar errores de tipo
    const numericFields = ["Estanques", "Est_Obser", "Nro_Bombas", "Cuanto_Tam", "Cuanto_Pac", "Cuanto_Sur", "Cuanto_Til", "Cuanto_Pan", "ID_12"];
    if (numericFields.includes(key)) {
      updateData[key] = toNumber(value);
    } else {
      updateData[key] = value;
    }
  });

  const feature = catastroGJ_ALL.features.find(f => f.properties._uid === uid);
  if (!feature) {
    alert("Error: no se pudo encontrar el predio original.");
    return;
  }

  const id12 = parseInt(safeVal(feature.properties["ID_12"] || "0"), 10) || 0;

  setLoading(true);

  let currentStep = "Iniciando";
  let insertData = null;
  try {
    if (!supabaseClient) throw new Error("Supabase no configurado");

    // 1. Upload photo if exists
    if (file) {
      currentStep = "Subiendo foto a Storage";
      const fileName = `${id12 || Date.now()}.jpg`;
      const { data: uploadData, error: uploadError } = await supabaseClient.storage
        .from(CONFIG.supabase.storageBucket)
        .upload(fileName, file, { upsert: true });

      if (uploadError) {
        uploadError.message = `[Error en Storage] ${uploadError.message}`;
        throw uploadError;
      }
    }

    // 2. Insert into catastro_ediciones instead of direct update
    currentStep = "Enviando propuesta a la tabla";
    insertData = {
      id_catastro: feature.properties.id || feature.properties.OBJECTID || null,
      datos_anteriores: feature.properties,
      datos_nuevos: updateData,
      estado: 'pendiente',
      fecha_creacion: new Date().toISOString()
    };

    const { error: dbError } = await supabaseClient
      .from("catastro_ediciones")
      .insert(insertData);

    if (dbError) {
      dbError.message = `[Error en Tabla] ${dbError.message}`;
      throw dbError;
    }

    alert("Éxito: Los cambios han sido enviados a revisión correctamente.");
    map.closePopup();

  } catch (err) {
    console.error("Error detallado:", err);
    const dataInfo = insertData ? `\n\nDatos:\n${JSON.stringify(insertData, null, 2)}` : "";
    alert(`⚠️ Fallo en: ${currentStep}\n\nMensaje: ${err.message}${dataInfo}`);
  } finally {
    setLoading(false);
  }
}

function onEachCatastro(feature, layer) {
  layer.bindPopup(buildCatastroPopup(feature), { maxWidth: 380 });
}

// =======================================================
// LABELS (zoom-based, filtered by central/sindicato)
// =======================================================
function buildSindicatosLabelsLayer() {
  const markers = [];
  (sindicatosGJ_ALL.features || []).forEach(f => {
    const p = f.properties || {};
    if (!passesFiltersSindicatos(p)) return;

    const name = getSindicatosNombre(p);
    if (!name) return;

    const tmp = L.geoJSON(f);
    const b = tmp.getBounds();
    if (!b || !b.isValid()) return;

    const center = b.getCenter();
    markers.push(
      L.marker(center, {
        interactive: false,
        icon: L.divIcon({ className: "sindicato-label", html: name })
      })
    );
  });

  return L.layerGroup(markers);
}

function updateLabelsVisibility() {
  if (!labelsWanted) {
    if (layerSindicatosLabels && map.hasLayer(layerSindicatosLabels)) map.removeLayer(layerSindicatosLabels);
    return;
  }
  const z = map.getZoom();
  if (z >= CONFIG.LABEL_MIN_ZOOM) {
    if (layerSindicatosLabels && !map.hasLayer(layerSindicatosLabels)) map.addLayer(layerSindicatosLabels);
  } else {
    if (layerSindicatosLabels && map.hasLayer(layerSindicatosLabels)) map.removeLayer(layerSindicatosLabels);
  }
}

// =======================================================
// OVERLAY STATE PRESERVATION (when filtering)
// =======================================================
function getOverlayState() {
  return {
    sindicatos: layerSindicatos ? map.hasLayer(layerSindicatos) : true,
    labels: layerSindicatosLabels ? map.hasLayer(layerSindicatosLabels) : labelsWanted,
    catastroDatos: layerCatastroDatos ? map.hasLayer(layerCatastroDatos) : true,
    catastroTotal: layerCatastroTotal ? map.hasLayer(layerCatastroTotal) : false,
    estanques: layerEstanquesFiltered ? map.hasLayer(layerEstanquesFiltered) : true,
    caminos: layerCaminos ? map.hasLayer(layerCaminos) : false, // ✅ caminos apagado por defecto
  };
}

function applyOverlayState(state) {
  // Nota: labels se controlan por zoom
  if (state.sindicatos) map.addLayer(layerSindicatos); else map.removeLayer(layerSindicatos);
  if (state.catastroDatos) map.addLayer(layerCatastroDatos); else map.removeLayer(layerCatastroDatos);
  if (state.catastroTotal) map.addLayer(layerCatastroTotal); else map.removeLayer(layerCatastroTotal);
  if (state.estanques) map.addLayer(layerEstanquesFiltered); else map.removeLayer(layerEstanquesFiltered);
  if (state.caminos) map.addLayer(layerCaminos); else map.removeLayer(layerCaminos);

  labelsWanted = !!state.labels;
  updateLabelsVisibility();
}

// =======================================================
// DASHBOARD + TABLE
// =======================================================
function setActiveKpiButtons() {
  document.getElementById("kpi-btn-completo").classList.toggle("active", currentFilters.estado === "completo");
  document.getElementById("kpi-btn-parcial").classList.toggle("active", currentFilters.estado === "parcial");
  document.getElementById("kpi-btn-sindatos").classList.toggle("active", currentFilters.estado === "sin datos");
}

function computeSpeciesProducers(features) {
  // Devuelve {labels: [], values: []} contando Nº de productores que reportan cada especie
  const counts = new Map();
  for (const f of features) {
    const p = f.properties || {};
    const raw = safeVal(p["Que_especi"] ?? p["QUE_ESPECI"] ?? "");
    const arr = parseSpeciesList(raw);
    const uniq = new Set(arr.map(normalizeSpeciesName));
    for (const sp of uniq) {
      if (!sp) continue;
      counts.set(sp, (counts.get(sp) || 0) + 1);
    }
  }

  // Etiquetas bonitas (si coincide con nuestras especies principales, poner tildes)
  const pretty = (norm) => {
    const m = {
      "tambaqui": "Tambaqui",
      "pacu": "Pacú",
      "surubi": "Surubí",
      "tilapia": "Tilapia",
      "pangacio": "Pangacio",
    };
    if (m[norm]) return m[norm];
    // Title case simple
    return norm.split(" ").map(w => w ? (w[0].toUpperCase() + w.slice(1)) : "").join(" ");
  };

  const pairs = Array.from(counts.entries())
    .map(([k, v]) => ({ k, label: pretty(k), v }))
    .sort((a, b) => b.v - a.v);

  return {
    labels: pairs.map(x => x.label),
    values: pairs.map(x => x.v),
    norms: pairs.map(x => x.k) // nombre normalizado (sin tildes)
  };
}

function setChartTabsUI() {
  const btnR = document.getElementById("tab-chart-runsa");
  const btnS = document.getElementById("tab-chart-species");
  if (!btnR || !btnS) return;

  const isR = chartMode === "runsa";
  btnR.classList.toggle("active", isR);
  btnS.classList.toggle("active", !isR);
  btnR.setAttribute("aria-selected", isR ? "true" : "false");
  btnS.setAttribute("aria-selected", !isR ? "true" : "false");
}

function renderActiveChart(features, runsaSi, runsaNo) {
  const titleEl = document.getElementById("chart-title");
  const footEl = document.getElementById("chart-footnote");
  const ctx = document.getElementById("chart-runsa");
  if (!ctx) return;

  setChartTabsUI();

  if (runsaChart) runsaChart.destroy();

  if (chartMode === "species") {
    const { labels, values, norms } = computeSpeciesProducers(features);
    if (titleEl) titleEl.textContent = "Especies producidas (Nº productores)";
    if (footEl) {
      const active = currentFilters.species ? ` (Filtro activo: ${labels[norms.indexOf(currentFilters.species)] || ""})` : "";
      footEl.textContent = `Click en una especie para filtrar${active}`;
    }

    const palette = ["#07b14d", "#04868b", "#01907a", "#00868d", "#037663", "#efffff"]; // usa paleta existente

    runsaChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: labels.length ? labels : ["Sin datos"],
        datasets: [{
          data: values.length ? values : [1],
          backgroundColor: (values.length ? labels : ["Sin datos"]).map((_, i) => palette[i % palette.length]),
          borderColor: "rgba(239,255,255,.18)",
          borderWidth: 1.2
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom", labels: { color: "#efffff" } },
          tooltip: { callbacks: { label: (item) => `${item.label}: ${item.raw}` } }
        },
        cutout: "62%",
        onClick: (evt, elements) => {
          if (!elements || !elements.length) return;
          // Evitar clicks en placeholder
          if (!values.length) return;

          const idx = elements[0].index;
          const norm = norms[idx];
          if (!norm) return;

          // toggle especie
          currentFilters.species = (currentFilters.species === norm) ? "" : norm;
          rebuildFilteredLayers();
        }
      }
    });

    return;
  }

  // Modo RUNSA (por defecto)
  if (titleEl) titleEl.textContent = "Tiene RUNSA?";
  if (footEl) footEl.textContent = "Click en “Sí” o “No” para filtrar";

  runsaChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Si", "No"],
      datasets: [{
        data: [runsaSi, runsaNo],
        backgroundColor: ["#07b14d", "#04868b"],
        borderColor: "rgba(239,255,255,.18)",
        borderWidth: 1.2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { color: "#efffff" } },
        tooltip: { callbacks: { label: (item) => `${item.label}: ${item.raw}` } }
      },
      cutout: "62%",
      onClick: (evt, elements) => {
        if (!elements || !elements.length) return;
        const idx = elements[0].index;
        const label = runsaChart.data.labels[idx];
        // toggle RUNSA filter
        const wanted = (String(label).toLowerCase() === "si") ? "si" : "no";
        currentFilters.runsa = (currentFilters.runsa === wanted) ? "" : wanted;
        rebuildFilteredLayers(); // refresca mapa + dashboard + tabla
      }
    }
  });
}

function buildFilteredCatastroFeatures() {
  // catastro con datos (Estado no vacío) + filtros globales + filtros dashboard
  const feats = (catastroGJ_ALL.features || []).filter(f => {
    const p = f.properties || {};
    if (getEstadoRaw(p) === "") return false;      // solo con datos
    return passesFiltersCatastro(p);
  });
  return feats;
}

function renderDashboardAndTable() {
  const feats = buildFilteredCatastroFeatures();
  currentFilteredCatastroFeatures = feats;

  // KPIs
  let predios = feats.length;
  let completos = 0, parciales = 0, sinDatos = 0;
  let sumEstObser = 0;
  let runsaSi = 0, runsaNo = 0;

  for (const f of feats) {
    const p = f.properties || {};
    const estado = normalizeEstado(getEstadoRaw(p));
    if (estado === "completo") completos++;
    else if (estado === "parcial") parciales++;
    else if (estado === "sin datos") sinDatos++;

    sumEstObser += toNumber(p["Est_Obser"]);

    const sn = normalizeSiNo(p["Tiene_RUNS"]);
    if (sn === "si") runsaSi++;
    else if (sn === "no") runsaNo++;
  }

  document.getElementById("kpi-predios").textContent = fmtInt(predios);
  document.getElementById("kpi-completos").textContent = fmtInt(completos);
  document.getElementById("kpi-parciales").textContent = fmtInt(parciales);
  document.getElementById("kpi-sindatos").textContent = fmtInt(sinDatos);
  document.getElementById("kpi-est-obser").textContent = fmtInt(Math.round(sumEstObser));

  setActiveKpiButtons();

  // Chart (tabs: RUNSA | Especies)
  renderActiveChart(feats, runsaSi, runsaNo);

  // ordenar por mayor a menor estanques registrados
  feats.sort((a, b) => {
    const ea = toNumber((a.properties || {})["Estanques"]);
    const eb = toNumber((b.properties || {})["Estanques"]);
    return eb - ea; // mayor a menor
  });

  // TABLE
  renderTable(feats);
}

function renderTable(features) {
  const tbody = document.getElementById("table-body");
  const countEl = document.getElementById("drawer-count");
  countEl.textContent = `${features.length} predios`;

  const rows = features.map((f, idx) => {
    const p = f.properties || {};
    const nombre = safeVal(p["Nombre"]);
    const estado = safeVal(p["Estado"]);
    const celular = safeVal(p["Celular"]);
    const estanques = safeVal(p["Estanques"]);
    const estObser = safeVal(p["Est_Obser"]);
    const bombas = safeVal(p["Nro_Bombas"]);
    const sindicato = safeVal(p["Sindicacto"]);
    const central = safeVal(p["CENTRAL"]);
    const fed = safeVal(p["FEDERACION"]);

    // usamos idx como data-index para poder ubicar el feature
    return `
      <tr data-index="${idx}">
        <td>${nombre || "-"}</td>
        <td>${estado || "-"}</td>
        <td>${celular || "-"}</td>
        <td>${estanques || "-"}</td>
        <td>${estObser || "-"}</td>
        <td>${bombas || "-"}</td>
        <td>${sindicato || "-"}</td>
        <td>${central || "-"}</td>
        <td>${fed || "-"}</td>
      </tr>
    `;
  }).join("");

  tbody.innerHTML = rows;

  // Click en fila => zoom al predio
  tbody.querySelectorAll("tr").forEach(tr => {
    tr.addEventListener("click", () => {
      const i = parseInt(tr.getAttribute("data-index"), 10);
      const f = currentFilteredCatastroFeatures[i];
      if (!f) return;
      flyToFeature(f);
    });
  });
}

// =======================================================
// LEGEND
// =======================================================
function renderLegend() {
  const active = [];

  const addIfActive = (name, layer, html) => {
    if (layer && map.hasLayer(layer)) active.push({ name, html });
  };

  addIfActive("Predios con catastro", layerCatastroDatos, `
    <div class="legend-row"><span class="legend-swatch" style="background:#f52020"></span>Sin Datos</div>
    <div class="legend-row"><span class="legend-swatch" style="background:#e8a933"></span>Parcial</div>
    <div class="legend-row"><span class="legend-swatch" style="background:#8be874"></span>Completo</div>
  `);

  addIfActive("Predios totales", layerCatastroTotal, `
    <div class="legend-row">
      <span class="legend-swatch" style="background:transparent; border:2px solid rgba(239,255,255,.45)"></span>
      Borde gris claro (sin relleno)
    </div>
  `);

  addIfActive("Sindicatos", layerSindicatos, `
    <div class="legend-row"><span class="legend-swatch" style="background:transparent; border:2px solid #a9a9a9"></span>Sindicatos</div>
  `);

  addIfActive("Etiquetas Sindicatos", layerSindicatosLabels, `
    <div class="legend-row">Etiquetas visibles desde zoom <b>${CONFIG.LABEL_MIN_ZOOM}</b></div>
  `);

  addIfActive("Estanques", layerEstanquesFiltered, `
    <div class="legend-row"><span class="legend-swatch" style="background:transparent; border:2px solid #edf2f3"></span>Estanques acuicolas</div>
  `);

  addIfActive("Caminos (ref)", layerCaminos, `
    <div class="legend-row"><span class="legend-swatch" style="background:#efffff"></span>Asfalto</div>
    <div class="legend-row"><span class="legend-swatch" style="background:#01907a"></span>Camino de tierra</div>
    <div class="legend-row"><span class="legend-swatch" style="background:#07b14d"></span>Comunal</div>
    <div class="legend-row"><span class="legend-swatch" style="background:#00868d"></span>Vías secundarias</div>
  `);

  if (active.length === 0) {
    legendContentEl.innerHTML = `<div class="legend-item"><div class="legend-row">No hay capas activas.</div></div>`;
    return;
  }

  legendContentEl.innerHTML = active.map(a => `
    <div class="legend-item">
      <div class="legend-item__name">${a.name}</div>
      ${a.html}
    </div>
  `).join("");
}

// =======================================================
// FILTER UI (Central => Sindicacto dependiente)
// =======================================================
function populateFilterCentral() {
  const feats = catastroGJ_ALL?.features || [];
  const centrales = uniqueSorted(feats.map(f => getCatastroCentral(f.properties || {})));

  const selCentral = document.getElementById("filter-central");
  selCentral.innerHTML = `<option value="">Todos</option>` + centrales.map(v => `<option value="${v}">${v}</option>`).join("");
  selCentral.value = currentFilters.central || "";
}

function populateFilterSindicatoDependent() {
  const feats = catastroGJ_ALL?.features || [];

  const sindicatos = uniqueSorted(
    feats
      .filter(f => {
        const p = f.properties || {};
        if (!currentFilters.central) return true;
        return getCatastroCentral(p) === currentFilters.central;
      })
      .map(f => getCatastroSindicacto(f.properties || {}))
  );

  const selSind = document.getElementById("filter-sindicato");
  selSind.innerHTML = `<option value="">Todos</option>` + sindicatos.map(v => `<option value="${v}">${v}</option>`).join("");

  if (currentFilters.sindicato && !sindicatos.includes(currentFilters.sindicato)) {
    currentFilters.sindicato = "";
  }
  selSind.value = currentFilters.sindicato || "";
}

function wireFilterEvents() {
  const selCentral = document.getElementById("filter-central");
  const selSind = document.getElementById("filter-sindicato");

  selCentral.addEventListener("change", () => {
    currentFilters.central = selCentral.value;
    currentFilters.sindicato = "";
    // no tocamos filtros de dashboard
    populateFilterSindicatoDependent();
    rebuildFilteredLayers();
  });

  selSind.addEventListener("change", () => {
    currentFilters.sindicato = selSind.value;
    rebuildFilteredLayers();
  });
}

// =======================================================
// DASHBOARD INTERACTIONS
// =======================================================
function wireDashboardEvents() {
  const btnC = document.getElementById("kpi-btn-completo");
  const btnP = document.getElementById("kpi-btn-parcial");
  const btnS = document.getElementById("kpi-btn-sindatos");
  const btnClear = document.getElementById("btn-clear-dashboard-filters");

  btnC.addEventListener("click", () => {
    currentFilters.estado = (currentFilters.estado === "completo") ? "" : "completo";
    rebuildFilteredLayers();
  });
  btnP.addEventListener("click", () => {
    currentFilters.estado = (currentFilters.estado === "parcial") ? "" : "parcial";
    rebuildFilteredLayers();
  });
  btnS.addEventListener("click", () => {
    currentFilters.estado = (currentFilters.estado === "sin datos") ? "" : "sin datos";
    rebuildFilteredLayers();
  });

  btnClear.addEventListener("click", () => {
    currentFilters.estado = "";
    currentFilters.runsa = "";
    currentFilters.species = "";
    rebuildFilteredLayers();
  });
}

function wireChartTabs() {
  const btnR = document.getElementById("tab-chart-runsa");
  const btnS = document.getElementById("tab-chart-species");
  if (!btnR || !btnS) return;

  btnR.addEventListener("click", () => {
    chartMode = "runsa";
    // solo refresca dashboard/tabla (sin recargar capas)
    renderDashboardAndTable();
  });

  btnS.addEventListener("click", () => {
    chartMode = "species";
    renderDashboardAndTable();
  });
}

// =======================================================
// DRAWER TABLE
// =======================================================
function wireDrawer() {
  const drawer = document.getElementById("table-drawer");
  const toggle = document.getElementById("drawer-toggle");
  toggle.addEventListener("click", () => {
    drawer.classList.toggle("collapsed");
  });
}

// =======================================================
// SEARCH
// =======================================================
function wireSearch() {
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  const clearBtn = document.getElementById("search-clear");

  function hideResults() { results.classList.add("hidden"); results.innerHTML = ""; }
  function showResults(html) { results.innerHTML = html; results.classList.remove("hidden"); }

  clearBtn.addEventListener("click", () => {
    input.value = "";
    hideResults();
  });

  document.addEventListener("click", (e) => {
    if (!results.contains(e.target) && e.target !== input) hideResults();
  });

  input.addEventListener("input", () => {
    const q = safeVal(input.value).toLowerCase();
    if (q.length < 2) { hideResults(); return; }

    // Buscar sobre catastro con datos (Estado no vacío) - sin aplicar filtros de dashboard,
    // pero sí respetando filtros Central/Sindicato para coherencia del usuario.
    const base = (catastroGJ_ALL.features || []).filter(f => {
      const p = f.properties || {};
      if (getEstadoRaw(p) === "") return false;
      // solo central/sindicato:
      const c = currentFilters.central;
      const s = currentFilters.sindicato;
      if (c && getCatastroCentral(p) !== c) return false;
      if (s && getCatastroSindicacto(p) !== s) return false;
      return true;
    });

    const matches = [];
    for (const f of base) {
      const p = f.properties || {};
      const nombre = safeVal(p["Nombre"]);
      if (!nombre) continue;
      if (nombre.toLowerCase().includes(q)) {
        matches.push(f);
        if (matches.length >= 25) break;
      }
    }

    if (!matches.length) {
      showResults(`<div class="search__item"><small>Sin resultados</small></div>`);
      return;
    }

    const html = matches.map((f, idx) => {
      const p = f.properties || {};
      const nombre = safeVal(p["Nombre"]);
      const central = safeVal(p["CENTRAL"]);
      const sind = safeVal(p["Sindicacto"]);
      const estado = safeVal(p["Estado"]);
      return `
        <div class="search__item" data-idx="${idx}">
          <strong>${nombre}</strong>
          <small>${estado || "-"} · ${central || "-"} · ${sind || "-"}</small>
        </div>
      `;
    }).join("");

    showResults(html);

    results.querySelectorAll(".search__item").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.getAttribute("data-idx"), 10);
        const f = matches[idx];
        if (!f) return;

        // Al seleccionar: sincroniza central/sindicato con el predio para asegurar que se vea
        const p = f.properties || {};
        currentFilters.central = getCatastroCentral(p);
        currentFilters.sindicato = getCatastroSindicacto(p);

        // limpia filtros dashboard para no esconderlo por accidente
        currentFilters.estado = "";
        currentFilters.runsa = "";

        // actualiza selects y reconstruye
        const selCentral = document.getElementById("filter-central");
        selCentral.value = currentFilters.central || "";
        populateFilterSindicatoDependent();
        const selSind = document.getElementById("filter-sindicato");
        selSind.value = currentFilters.sindicato || "";

        hideResults();
        rebuildFilteredLayers();

        // después del rebuild, volamos al feature original
        setTimeout(() => {
          flyToFeature(f, true);
        }, 0);
      });
    });
  });
}

// =======================================================
// FLY TO FEATURE + open popup
// =======================================================
function flyToFeature(feature, openPopup = true) {
  const temp = L.geoJSON(feature);
  const b = temp.getBounds();
  if (b && b.isValid()) {
    map.fitBounds(b.pad(0.25), { animate: true });
  }

  if (!openPopup || !layerCatastroDatos) return;

  // Intentar encontrar la capa correspondiente para abrir popup
  const targetNombre = safeVal(feature.properties?.Nombre);
  const targetCentral = safeVal(feature.properties?.CENTRAL);
  const targetSind = safeVal(feature.properties?.Sindicacto);

  let found = null;
  layerCatastroDatos.eachLayer(l => {
    const p = l.feature?.properties || {};
    if (safeVal(p.Nombre) === targetNombre &&
      safeVal(p.CENTRAL) === targetCentral &&
      safeVal(p.Sindicacto) === targetSind) {
      found = l;
    }
  });

  if (found) found.openPopup();
}

// =======================================================
// REBUILD LAYERS (apply filters, keep active overlays)
// =======================================================
function rebuildFilteredLayers() {
  if (!catastroGJ_ALL || !sindicatosGJ_ALL || !caminosGJ_ALL || !estanquesGJ_ALL) return;

  const prevState = getOverlayState();

  // remover actuales si estaban en mapa
  [layerCatastroDatos, layerCatastroTotal, layerSindicatos, layerSindicatosLabels, layerEstanquesFiltered].forEach(l => {
    if (l && map.hasLayer(l)) map.removeLayer(l);
  });

  // sindicatos
  layerSindicatos = L.geoJSON(sindicatosGJ_ALL, {
    style: styleSindicatos,
    filter: (f) => passesFiltersSindicatos(f.properties || {})
  });

  // etiquetas (rebuild por filtros central/sindicato)
  layerSindicatosLabels = buildSindicatosLabelsLayer();

  // catastro total gris (solo central/sindicato)
  layerCatastroTotal = L.geoJSON(catastroGJ_ALL, {
    style: styleCatastroTotal,
    interactive: false,     // ✅ CLAVE: no captura clicks/hover
    bubblingMouseEvents: false,
    filter: (f) => {
      const p = f.properties || {};
      const c = currentFilters.central;
      const s = currentFilters.sindicato;
      if (c && getCatastroCentral(p) !== c) return false;
      if (s && getCatastroSindicacto(p) !== s) return false;
      return true;
    }
  });

  // catastro con datos (Estado no vacío + filtros completos)
  layerCatastroDatos = L.geoJSON(catastroGJ_ALL, {
    style: styleCatastro,
    filter: (f) => {
      const p = f.properties || {};
      if (getEstadoRaw(p) === "") return false;
      return passesFiltersCatastro(p);
    },
    onEachFeature: onEachCatastro
  });

  // estanques filtrados (mismos campos que catastro) -> aplica filtros completos
  layerEstanquesFiltered = L.geoJSON(estanquesGJ_ALL, {
    style: styleEstanques,
    filter: (f) => passesFiltersCatastro(f.properties || {})
  });

  // overlays
  overlayMaps["Sindicatos"] = layerSindicatos;
  overlayMaps["Etiquetas Sindicatos"] = layerSindicatosLabels;
  overlayMaps["Predios con Catastro"] = layerCatastroDatos;
  overlayMaps["Predios totales"] = layerCatastroTotal;
  overlayMaps["Estanques"] = layerEstanquesFiltered;
  overlayMaps["Caminos"] = layerCaminos;

  // recrear control
  layersControl.remove();
  layersControl = L.control.layers(baseMaps, overlayMaps, { collapsed: false }).addTo(map);
  setLayersControlVisible(layersControlVisible); // respeta si estaba oculto

  // overlay events (labels toggling)
  map.off("overlayadd");
  map.off("overlayremove");
  map.on("overlayadd", (e) => {
    if (e.layer === layerSindicatosLabels) labelsWanted = true;
    renderLegend();
    updateLabelsVisibility();
  });
  map.on("overlayremove", (e) => {
    if (e.layer === layerSindicatosLabels) labelsWanted = false;
    renderLegend();
  });

  // restaurar capas activas como estaban
  applyOverlayState(prevState);

  // dashboard y tabla
  renderDashboardAndTable();

  // leyenda
  renderLegend();

  // etiquetas por zoom
  updateLabelsVisibility();
}

// =======================================================
// LOAD SHP ZIP
// =======================================================
async function loadZipAsGeoJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar: ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  return await shp(arrayBuffer);
}

function normalizeGeojson(gj) {
  if (!gj) return null;
  if (gj.type === "FeatureCollection") return gj;
  const keys = Object.keys(gj);
  if (keys.length > 0 && gj[keys[0]]?.type === "FeatureCollection") return gj[keys[0]];
  return null;
}

async function loadCatastroFromSupabase() {
  if (!supabaseClient) throw new Error("Supabase no configurado");
  console.log("[SICAM] INICIANDO CARGA CATASTRO DESDE SUPABASE");

  let allData = [];
  let from = 0;
  let to = 999;
  let finished = false;

  while (!finished) {
    const { data, error } = await supabaseClient
      .from(CONFIG.supabase.table)
      .select("*")
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) {
      finished = true;
    } else {
      allData = allData.concat(data);
      from += 1000;
      to += 1000;
      if (data.length < 1000) finished = true;
    }
  }

  // Convert to GeoJSON FeatureCollection
  return {
    type: "FeatureCollection",
    features: allData.map(item => {
      // Assuming 'geometry' column exists or data is properties-only (if properties only, it needs geometry)
      // If the Supabase table has a 'geom' or 'geometry' column in GeoJSON format:
      let geometry = item.geometry || item.geom;
      if (typeof geometry === 'string') geometry = JSON.parse(geometry);

      return {
        type: "Feature",
        geometry: geometry || null, // Handle cases with no geometry
        properties: item
      };
    })
  };
}

// =======================================================
// INIT
// =======================================================
async function init() {
  setLoading(true);

  try {
    const [caminosRaw, estanquesRaw, sindicatosRaw, catastroGJ] = await Promise.all([
      loadZipAsGeoJson(CONFIG.shpPaths.caminos),
      loadZipAsGeoJson(CONFIG.shpPaths.estanques),
      loadZipAsGeoJson(CONFIG.shpPaths.sindicatos),
      loadCatastroFromSupabase().catch(err => {
        console.warn("Error cargando desde Supabase, intentando local...", err);
        return loadZipAsGeoJson(CONFIG.shpPaths.catastro).then(normalizeGeojson);
      })
    ]);

    caminosGJ_ALL = normalizeGeojson(caminosRaw);
    estanquesGJ_ALL = normalizeGeojson(estanquesRaw);
    sindicatosGJ_ALL = normalizeGeojson(sindicatosRaw);
    catastroGJ_ALL = catastroGJ;
    if (catastroGJ_ALL && catastroGJ_ALL.features) {
      catastroGJ_ALL.features.forEach((f, i) => f.properties._uid = i);
    }

    if (!caminosGJ_ALL || !estanquesGJ_ALL || !sindicatosGJ_ALL || !catastroGJ_ALL) {
      throw new Error("Una o más capas no pudieron cargarse. Revisa la conexión o los archivos.");
    }

    // caminos layer creado, pero NO se agrega por defecto
    layerCaminos = L.geoJSON(caminosGJ_ALL, { style: styleCaminos });

    // filtros base
    populateFilterCentral();
    populateFilterSindicatoDependent();
    wireFilterEvents();

    // dashboard + tabla interactions
    wireDashboardEvents();
    wireChartTabs();
    wireDrawer();

    // search
    wireSearch();

    // build layers según defaults
    rebuildFilteredLayers();

    // labels by zoom
    map.on("zoomend", updateLabelsVisibility);

    // fit inicial
    // intentamos usar catastro con datos una vez que existe
    setTimeout(() => {
      if (layerCatastroDatos) {
        const b = layerCatastroDatos.getBounds();
        if (b && b.isValid()) map.fitBounds(b.pad(0.08));
      }
    }, 0);

  } catch (err) {
    console.error(err);
    alert("Error cargando capas:\n" + err.message);
  } finally {
    setLoading(false);
  }
}

init();

// =======================================================
// PANTALLA DE BIENVENIDA (MODAL)
// =======================================================
(function () {
  // Nota: app.js se carga al final del body, pero usamos DOMContentLoaded por seguridad.
  document.addEventListener("DOMContentLoaded", () => {
    const overlay = document.getElementById("welcome-overlay");
    const closeBtn = document.getElementById("welcome-close");

    if (!overlay) return;

    // Mostrar al cargar
    overlay.classList.remove("hidden");

    // Cerrar
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        overlay.classList.add("hidden");
      });
    }
  });
})();

// =======================================================
// TOUR / TUTORIAL (PASO A PASO CON SPOTLIGHT)
// =======================================================
(function () {
  const overlay = document.getElementById("tour-overlay");
  const spotlight = document.getElementById("tour-spotlight");
  const panel = document.getElementById("tour-panel");
  const titleEl = document.getElementById("tour-title");
  const textEl = document.getElementById("tour-text");
  const nextBtn = document.getElementById("tour-next");
  const closeBtn = document.getElementById("tour-close");

  const welcomeOverlay = document.getElementById("welcome-overlay");
  const howtoBtn = document.getElementById("welcome-howto");

  // Si aún no existe el HTML del tour en index.html, salimos sin romper nada.
  if (!overlay || !spotlight || !panel || !titleEl || !textEl || !nextBtn || !closeBtn) {
    return;
  }

  let stepIndex = 0;

  // PASOS DEL TOUR (selector + contenido)
  const steps = [
    {
      selector: "#tour-kpis",
      title: "Indicadores principales (KPIs)",
      html: `
        <b>Predios con estanques</b>: indica el número total de predios o propiedades que tienen producción acuícola en el municipio.<br><br>
        <b>Completos / Parciales / Sin datos</b>: muestran el estado del catastro por predio.
        <b>Al hacer click</b> en cada uno se aplica el filtro correspondiente en el mapa y en la tabla.<br><br>
        <b>Estanques identificados</b>: suma total de estanques identificados/observados en los predios filtrados.
      `
    },
    {
      selector: "#tour-chart",
      title: "Gráfico: Tiene RUNSA?",
      html: `
        Este gráfico muestra cuántos predios <b>sí</b> o <b>no</b> cuentan con RUNSA.<br><br>
        <b>Tip:</b> si haces click en “Sí” o “No” se aplica un filtro para ver únicamente esos predios en el mapa y la tabla.
      `
    },
    {
      selector: "#tour-filters",
      title: "Filtros y buscador",
      html: `
        <b>Central</b> y <b>Sindicato</b> filtran el catastro por organización territorial.<br>
        El selector de <b>Sindicato</b> depende de la <b>Central</b> elegida.<br><br>
        El <b>Buscador</b> permite encontrar predios por nombre del propietario y hacer zoom automáticamente.
      `
    },
    {
      selector: "#tour-map-tools",
      title: "Herramientas del mapa",
      html: `
        <b>Vista inicial</b>: vuelve al encuadre principal del municipio.<br>
        <b>Capas</b>: muestra/oculta capas (catastro, estanques, sindicatos, caminos).<br>
        <b>Leyenda</b>: muestra la leyenda según las capas activas.
      `
    },
    {
      selector: "#drawer-toggle",
      title: "Tabla de predios",
      html: `
        La tabla resume la información principal por predio (estado, estanques, bombas, sindicato, etc.).<br><br>
        <b>Tip:</b> al hacer click en una fila, el mapa hace zoom al predio y abre su popup (si aplica).
      `
    }
  ];

  function showOverlay() {
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
  }
  function hideOverlay() {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }

  function getRect(el) {
    const r = el.getBoundingClientRect();
    return {
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      w: r.width,
      h: r.height
    };
  }

  function positionPanel(targetRect) {
    const pad = 14;
    const panelW = panel.offsetWidth || 420;
    const panelH = panel.offsetHeight || 220;

    // preferir a la derecha del target
    let left = targetRect.x + targetRect.w + pad;
    let top = targetRect.y;

    // si no hay espacio a la derecha, poner abajo
    const viewportRight = window.scrollX + window.innerWidth;
    if (left + panelW > viewportRight - 10) {
      left = targetRect.x;
      top = targetRect.y + targetRect.h + pad;
    }

    // ajustar para que no se salga por abajo
    const viewportBottom = window.scrollY + window.innerHeight;
    if (top + panelH > viewportBottom - 10) {
      top = Math.max(window.scrollY + 10, viewportBottom - panelH - 10);
    }

    // ajustar si se sale por la izquierda
    left = Math.max(window.scrollX + 10, Math.min(left, viewportRight - panelW - 10));

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function renderStep(i) {
    const step = steps[i];
    if (!step) return;

    const el = document.querySelector(step.selector);
    if (!el) return;

    const r = getRect(el);
    const pad = 10;

    spotlight.style.left = `${r.x - pad}px`;
    spotlight.style.top = `${r.y - pad}px`;
    spotlight.style.width = `${r.w + pad * 2}px`;
    spotlight.style.height = `${r.h + pad * 2}px`;

    titleEl.textContent = step.title;
    textEl.innerHTML = step.html;

    // posicionar panel
    positionPanel(r);

    // último paso -> botón final
    nextBtn.textContent = (i === steps.length - 1) ? "Finalizar" : "Siguiente";
  }

  function onReflow() {
    renderStep(stepIndex);
  }

  function startTour() {
    stepIndex = 0;
    // cierra la bienvenida si está abierta
    if (welcomeOverlay && !welcomeOverlay.classList.contains("hidden")) {
      welcomeOverlay.classList.add("hidden");
    }
    showOverlay();
    renderStep(stepIndex);
    // recalcular en resize/scroll
    window.addEventListener("resize", onReflow, { passive: true });
    window.addEventListener("scroll", onReflow, { passive: true });
  }

  function endTour() {
    hideOverlay();
    window.removeEventListener("resize", onReflow);
    window.removeEventListener("scroll", onReflow);
  }

  // Eventos UI
  if (howtoBtn) {
    howtoBtn.addEventListener("click", startTour);
  }
  nextBtn.addEventListener("click", () => {
    if (stepIndex >= steps.length - 1) {
      endTour();
      return;
    }
    stepIndex += 1;
    renderStep(stepIndex);
  });
  closeBtn.addEventListener("click", endTour);
})();

// =======================================================
// ADMIN PANEL (GESTIÓN DE CAMBIOS) - GLOBAL INIT
// =======================================================
(function () {
  let currentAdminStatus = "pendiente";

  function wireAdminEvents() {
    const btnAdmin = document.getElementById("btn-admin-panel");
    const overlay = document.getElementById("admin-overlay");
    const closeBtn = document.getElementById("admin-close");
    const tabs = document.querySelectorAll(".admin-tab");

    if (!btnAdmin || !overlay) return;

    btnAdmin.addEventListener("click", () => {
      overlay.classList.remove("hidden");
      loadAdminChanges();
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", () => overlay.classList.add("hidden"));
    }

    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        currentAdminStatus = tab.getAttribute("data-status");
        loadAdminChanges();
      });
    });
  }

  async function loadAdminChanges() {
    const listEl = document.getElementById("admin-list");
    const countEl = document.getElementById("admin-count-pending");
    if (!listEl) return;
    listEl.innerHTML = '<div class="loader-inline"><div class="spinner"></div></div>';
    try {
      const { data, error } = await supabaseClient
        .from("catastro_ediciones")
        .select("*")
        .eq("estado", currentAdminStatus)
        .order("fecha_creacion", { ascending: false });
      if (error) throw error;
      if (currentAdminStatus === "pendiente" && countEl) {
        countEl.textContent = data.length;
      }
      if (!data || data.length === 0) {
        listEl.innerHTML = `<div style="padding:40px; text-align:center; color:var(--muted);">No hay cambios ${currentAdminStatus}s.</div>`;
        return;
      }
      listEl.innerHTML = data.map(item => renderChangeCard(item)).join("");
      wireCardActions();
    } catch (err) {
      console.error("Error cargando cambios:", err);
      listEl.innerHTML = `<div style="padding:20px; color:#ff6b6b;">Error: ${err.message}</div>`;
    }
  }

  function renderChangeCard(item) {
    const old = item.datos_anteriores || {};
    const nw = item.datos_nuevos || {};
    const date = new Date(item.fecha_creacion).toLocaleString();
    const compareFields = [
      ["Nombre", "Nombre"], ["Estado", "Estado"], ["Celular", "Celular"],
      ["Asociacion", "Asociación"], ["Estanques", "Estanques Reg."],
      ["Est_Obser", "Estanques Ident."], ["Tiene_RUNS", "Tiene RUNSA?"],
      ["Que_especi", "Especies"], ["Cuanto_Tam", "Cant. Tambaqui"],
      ["Cuanto_Pac", "Cant. Pacu"], ["Cuanto_Sur", "Cant. Surubi"],
      ["Cuanto_Til", "Cant. Tilapia"], ["Cuanto_Pan", "Cant. Pangacio"],
      ["ID_12", "Foto ID"]
    ];
    const rows = compareFields.map(([key, label]) => {
      const v1 = safeVal(old[key]);
      const v2 = safeVal(nw[key]);
      const changed = v1 !== v2 && nw.hasOwnProperty(key);
      return `<tr><td style="width:30%; opacity:0.7;">${label}</td><td style="width:35%;">${v1 || "-"}</td><td style="width:35%;" class="${changed ? 'val-changed' : 'val-unchanged'}">${changed ? `<strong>${v2 || "-"}</strong>` : (v1 || "-")}</td></tr>`;
    }).join("");
    const actions = item.estado === "pendiente" ? `
      <div class="change-card__actions">
        <button class="btn-map-jump" data-id="${item.id_catastro}" title="Ver en mapa"><i class="fa-solid fa-location-dot"></i></button>
        <button class="btn-approve" data-id="${item.id}" title="Aprobar"><i class="fa-solid fa-check"></i> Aprobar</button>
        <button class="btn-reject" data-id="${item.id}" title="Rechazar"><i class="fa-solid fa-xmark"></i> Rechazar</button>
      </div>` : `
      <div class="change-card__actions">
        <button class="btn-map-jump" data-id="${item.id_catastro}" title="Ver en mapa"><i class="fa-solid fa-location-dot"></i></button>
        <span style="font-size:12px; font-weight:800; text-transform:uppercase; color:${item.estado === 'aprobado' ? 'var(--c5)' : '#ff6b6b'}">${item.estado}</span>
      </div>`;

    // Priorizamos la foto si nw.ID_12 existe
    const photoId = nw.ID_12 || old.ID_12;
    let photoUrl = "";
    if (photoId) {
      // Usar la URL pública de Supabase Storage en lugar de la carpeta local
      photoUrl = `${CONFIG.supabase.url}/storage/v1/object/public/${CONFIG.supabase.storageBucket}/${photoId}.jpg`;
    }

    const photoHtml = photoId ? `
      <div class="change-comp-box" style="display:flex; flex-direction:column; gap:10px;">
         <div class="change-comp-title">Evidencia / Fotografía</div>
         <div class="popup-photo" style="margin:0; width:100%; height:200px; display:flex; align-items:center; justify-content:center; background:#000; border-radius:8px; overflow:hidden;">
            <img src="${photoUrl}" 
                 onerror="this.src='${photoUrl.replace('.jpg', '.png')}'; this.onerror=null;" 
                 style="max-width:100%; max-height:100%; object-fit:contain;" />
         </div>
         ${item.notes || item.notas ? `<div style="font-size:12px; color:var(--muted); margin-top:5px;"><b>Notas:</b> ${item.notes || item.notas}</div>` : ""}
      </div>` : `
      <div class="change-comp-box" style="display:flex; flex-direction:column; gap:10px;">
         <div class="change-comp-title">Notas / Info</div>
         <div style="font-size:13px; color:var(--muted)">${item.notas || "Sin notas adicionales."}</div>
      </div>`;

    return `
      <div class="change-card">
        <div class="change-card__header">
          <div>
            <div class="change-card__id">Solicitud #${item.id} (Predio ${item.id_catastro})</div>
            <div class="change-card__date">${date}</div>
          </div>
          ${actions}
        </div>
        <div class="change-grid">
          <div class="change-comp-box">
            <div class="change-comp-title">Comparativa de Datos</div>
            <table class="change-table">
              <thead><tr><th>Campo</th><th>Anterior</th><th>Propuesta</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ${photoHtml}
        </div>
      </div>
    `;
  }

  function wireCardActions() {
    document.querySelectorAll(".btn-map-jump").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const feat = catastroGJ_ALL.features.find(f => (f.properties.id || f.properties.OBJECTID) == id);
        if (feat) {
          document.getElementById("admin-overlay").classList.add("hidden");
          flyToFeature(feat, true);
        } else {
          alert("No se encontró el predio en el mapa actual.");
        }
      });
    });
    document.querySelectorAll(".btn-approve").forEach(btn => {
      btn.addEventListener("click", () => handleAdminAction(btn.getAttribute("data-id"), "aprobado"));
    });
    document.querySelectorAll(".btn-reject").forEach(btn => {
      btn.addEventListener("click", () => handleAdminAction(btn.getAttribute("data-id"), "rechazado"));
    });
  }

  async function handleAdminAction(changeId, newStatus) {
    if (!confirm(`¿Estás seguro de que deseas ${newStatus} esta solicitud?`)) return;
    setLoading(true);
    try {
      const { data: change, error: getErr } = await supabaseClient.from("catastro_ediciones").select("*").eq("id", changeId).single();
      if (getErr) throw getErr;
      if (newStatus === "aprobado") {
        const { error: updErr } = await supabaseClient.from("catastro").update(change.datos_nuevos).match({ id: change.id_catastro });
        if (updErr) {
          const { error: updErr2 } = await supabaseClient.from("catastro").update(change.datos_nuevos).match({ OBJECTID: change.id_catastro });
          if (updErr2) throw updErr;
        }
        const localFeat = catastroGJ_ALL.features.find(f => (f.properties.id || f.properties.OBJECTID) == change.id_catastro);
        if (localFeat) Object.assign(localFeat.properties, change.datos_nuevos);
      }
      const { error: finalErr } = await supabaseClient.from("catastro_ediciones").update({
        estado: newStatus,
        fecha_revision: new Date().toISOString(),
        revisado_por: "Administrador Dashboard"
      }).eq("id", changeId);
      if (finalErr) throw finalErr;
      alert(`Solicitud ${newStatus} correctamente.`);
      loadAdminChanges();
      rebuildFilteredLayers();
    } catch (err) {
      console.error("Error en acción administrativa:", err);
      alert("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  wireAdminEvents();
})();

