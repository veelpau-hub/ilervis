/* ─ Ilervis Module 02 — Mapbox fotogrametria ──────────────────────────── */

(function () {
  if (!window.MAPBOX_TOKEN || !window.mapboxgl) return;

  mapboxgl.accessToken = window.MAPBOX_TOKEN;

  const SEGRIA_CENTER = [0.62, 41.55];
  const SEGRIA_ZOOM   = 11;

  const map = new mapboxgl.Map({
    container:  'map-fotogrametria',
    style:      'mapbox://styles/mapbox/satellite-streets-v12',
    center:     SEGRIA_CENTER,
    zoom:       SEGRIA_ZOOM,
    attributionControl: false,
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left');

  // ── State ────────────────────────────────────────────────────────────────

  const state = { ortofoto: false, vari: false, meta: null };

  // ── Load metadata ─────────────────────────────────────────────────────────

  async function loadMetadata() {
    try {
      const r = await fetch('/api/fotogrametria/metadata');
      const d = await r.json();
      if (!d.available) {
        document.getElementById('map-no-data').style.display = 'flex';
        return;
      }
      state.meta = d;
      fillMetaCards(d);
      map.fitBounds(
        [[d.bounds[0], d.bounds[1]], [d.bounds[2], d.bounds[3]]],
        { padding: 40, duration: 1000 },
      );
    } catch (e) {
      console.warn('[mapa] metadata fetch failed', e);
    }
  }

  function fillMetaCards(d) {
    setText('meta-gsd',      d.gsd_cm?.toFixed(1) ?? '—');
    setText('meta-area',     d.area_ha?.toFixed(1) ?? '—');
    setText('meta-date',     d.date ?? '—');
    setText('meta-location', d.location ?? 'Segrià');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── Layer helpers ─────────────────────────────────────────────────────────

  function boundsCoords(b) {
    return [
      [b[0], b[3]],  // NW
      [b[2], b[3]],  // NE
      [b[2], b[1]],  // SE
      [b[0], b[1]],  // SW
    ];
  }

  function addImageLayer(id, url, coords, opacity = 0.85) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'image', url, coordinates: coords });
    map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity } });
  }

  function removeLayer(id) {
    if (map.getLayer(id))  map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }

  function setLayerVisible(id, visible) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }

  // ── Toggle handlers ───────────────────────────────────────────────────────

  function toggleOrtofoto() {
    state.ortofoto = !state.ortofoto;
    document.getElementById('btn-ortofoto').classList.toggle('active', state.ortofoto);

    if (!state.meta) return;
    const coords = boundsCoords(state.meta.bounds);

    if (state.ortofoto) {
      addImageLayer('ortofoto-layer', '/static/ortofoto_segria.png', coords);
    } else {
      removeLayer('ortofoto-layer');
    }
  }

  function toggleVARI() {
    state.vari = !state.vari;
    document.getElementById('btn-vari').classList.toggle('active', state.vari);

    if (!state.meta?.vari_available) {
      state.vari = false;
      document.getElementById('btn-vari').classList.remove('active');
      showToast('VARI no disponible — executa process_ortho.py --vari');
      return;
    }

    const coords = boundsCoords(state.meta.bounds);
    if (state.vari) {
      addImageLayer('vari-layer', '/static/vari_segria.png', coords, 0.75);
    } else {
      removeLayer('vari-layer');
    }
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'map-toast';
    t.textContent = msg;
    document.querySelector('.map-wrap').appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  map.on('load', () => {
    loadMetadata();
  });

  document.getElementById('btn-ortofoto')?.addEventListener('click', toggleOrtofoto);
  document.getElementById('btn-vari')?.addEventListener('click', toggleVARI);
})();
