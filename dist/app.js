let map = null;
let layer = null;
let mapReady = false;

const state = { boxes: [], filter: 'all', query: '', markers: new Map(), selected: null, targetMarker: null };
const list = document.querySelector('#boxList');
const loading = document.querySelector('#loading');
const empty = document.querySelector('#emptyState');
const totalCount = document.querySelector('#totalCount');
const visibleCount = document.querySelector('#visibleCount');
const popupTemplate = document.querySelector('#popupTemplate');
const locationInput = document.querySelector('#locationInput');
const nearestResult = document.querySelector('#nearestResult');
const nearestModal = document.querySelector('#nearestModal');
const nearestModalStatus = document.querySelector('#nearestModalStatus');
const nearestOptions = document.querySelector('#nearestOptions');
const mapStage = document.querySelector('.map-stage');
const mapToolbar = document.querySelector('.map-toolbar');
const legend = document.querySelector('.legend');

function escapeText(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
}

function initMap() {
  if (!window.L) {
    const mapNode = document.querySelector('#map');
    mapNode.innerHTML = '<div class="map-fallback"><strong>Mapa no disponible</strong><span>La búsqueda de cajas y el GPS siguen funcionando.</span></div>';
    mapToolbar.hidden = true;
    legend.hidden = true;
    return;
  }

  map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([-34.82, -58.21], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  layer = L.featureGroup().addTo(map);
  mapReady = true;
}

function markerIcon(box, selected = false) {
  if (!window.L) return null;
  return L.divIcon({
    className: 'marker-wrap',
    html: `<span class="marker-pin ${box.approx ? 'approx' : ''} ${selected ? 'selected' : ''}"></span>`,
    iconSize: selected ? [35, 35] : [29, 29],
    iconAnchor: selected ? [11, 32] : [9, 27],
    popupAnchor: [4, -28]
  });
}

function popupFor(box) {
  const node = popupTemplate.content.cloneNode(true);
  node.querySelector('.popup-kicker').textContent = box.approx ? 'Ubicación aproximada' : 'Ubicación verificada';
  node.querySelector('h2').textContent = box.name;
  const description = node.querySelector('.popup-description');
  description.textContent = box.description || 'Caja de acceso de la red FTTH';
  description.hidden = !box.description;
  node.querySelector('.popup-coords').textContent = `${box.lat.toFixed(6)}, ${box.lng.toFixed(6)}`;
  node.querySelector('.directions').href = `https://www.google.com/maps/dir/?api=1&destination=${box.lat},${box.lng}`;
  return node;
}

function selectBox(id, move = true) {
  const box = state.boxes.find(item => item.id === id);
  if (!box) return;

  if (mapReady && state.selected && state.markers.has(state.selected)) {
    const previous = state.boxes.find(item => item.id === state.selected);
    if (previous) state.markers.get(state.selected).setIcon(markerIcon(previous));
  }

  state.selected = id;

  if (!mapReady) return;
  const marker = state.markers.get(id);
  if (!marker) return;

  marker.setIcon(markerIcon(box, true));
  marker.bindPopup(popupFor(box), { maxWidth: 280 }).openPopup();
  if (move) map.flyTo([box.lat, box.lng], Math.max(map.getZoom(), 17), { duration: .6 });
}

function matchingBoxes() {
  const query = state.query.trim().toLocaleLowerCase('es');
  return state.boxes.filter(box => {
    const filterMatch = state.filter === 'all' || (state.filter === 'approx' ? box.approx : !box.approx);
    const textMatch = !query || `${box.name} ${box.description}`.toLocaleLowerCase('es').includes(query);
    return filterMatch && textMatch;
  });
}

function render() {
  const matches = matchingBoxes();
  list.innerHTML = matches.map(box => `
    <li><button class="box-item ${box.approx ? 'approx' : ''}" data-id="${box.id}">
      <span class="status" aria-hidden="true"></span>
      <span><strong>${escapeText(box.name)}</strong><small>${box.approx ? 'Posición aproximada' : 'Posición registrada'}</small></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
    </button></li>`).join('');

  visibleCount.textContent = matches.length;
  empty.hidden = matches.length > 0;

  if (mapReady) {
    state.markers.forEach((marker, id) => {
      const visible = matches.some(box => box.id === id);
      if (visible && !layer.hasLayer(marker)) layer.addLayer(marker);
      if (!visible && layer.hasLayer(marker)) layer.removeLayer(marker);
    });
  }
}

function parseKml(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('El archivo de ubicaciones no es válido.');

  return [...xml.getElementsByTagNameNS('*', 'Placemark')].map((placemark, index) => {
    const name = placemark.getElementsByTagNameNS('*', 'name')[0]?.textContent?.trim() || `Caja ${index + 1}`;
    const description = placemark.getElementsByTagNameNS('*', 'description')[0]?.textContent?.trim() || '';
    const raw = placemark.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent?.trim();
    const coordinates = raw?.split(',').map(Number);
    if (!coordinates || coordinates.length < 2 || coordinates.some(Number.isNaN)) return null;
    return {
      id: `box-${index + 1}`,
      name,
      description,
      lng: coordinates[0],
      lat: coordinates[1],
      approx: /aproximad/i.test(`${name} ${description}`)
    };
  }).filter(Boolean);
}

function buildMarkers() {
  if (!mapReady) return;

  state.boxes.forEach(box => {
    const marker = L.marker([box.lat, box.lng], { icon: markerIcon(box), title: box.name });
    marker.on('click', () => selectBox(box.id, false));
    state.markers.set(box.id, marker);
    marker.addTo(layer);
  });

  if (state.boxes.length) map.fitBounds(layer.getBounds().pad(.08));
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestCandidates(lat, lng, limit = 12) {
  return state.boxes
    .map(box => ({ box, directDistance: distanceMeters(lat, lng, box.lat, box.lng) }))
    .sort((a, b) => a.directDistance - b.directDistance)
    .slice(0, limit);
}

async function roadDistances(lat, lng, candidates) {
  const points = [[lng, lat], ...candidates.map(item => [item.box.lng, item.box.lat])];
  const coords = points.map(point => point.join(',')).join(';');
  const destinations = candidates.map((_, index) => index + 1).join(';');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const url = `https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&destinations=${destinations}&annotations=distance`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('No se pudo calcular la distancia por calles.');
    const data = await response.json();
    const distances = data?.distances?.[0];
    if (!Array.isArray(distances)) throw new Error('Respuesta de rutas inválida.');

    return candidates.map((item, index) => ({
      ...item,
      roadDistance: Number.isFinite(distances[index]) ? distances[index] : null
    }));
  } finally {
    clearTimeout(timer);
  }
}

function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
}

function showTarget(lat, lng, label) {
  if (!mapReady) return;
  if (state.targetMarker) map.removeLayer(state.targetMarker);
  state.targetMarker = L.circleMarker([lat, lng], {
    radius: 8, weight: 3, color: '#fff', fillColor: '#1475ff', fillOpacity: 1
  }).addTo(map).bindPopup(label || 'Ubicación del cliente');
}

function openNearestModal() {
  if (!nearestModal) return;
  nearestModal.hidden = false;
  nearestModal.style.display = 'grid';
}

function closeNearestModal() {
  if (!nearestModal) return;
  nearestModal.hidden = true;
  nearestModal.style.display = 'none';
}

function renderNearestOptions(lat, lng, items, usingRoadDistance) {
  const top = items.slice(0, 3);
  if (!top.length) {
    nearestModalStatus.textContent = 'No encontré CTO cercanas.';
    nearestOptions.innerHTML = '';
    return;
  }

  nearestModalStatus.textContent = usingRoadDistance
    ? 'Distancia estimada por calles'
    : 'No pude consultar rutas. Muestro distancia aproximada en línea recta.';

  nearestOptions.innerHTML = top.map((item, index) => {
    const meters = usingRoadDistance ? item.roadDistance : item.directDistance;
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${lat},${lng}&destination=${item.box.lat},${item.box.lng}&travelmode=driving`;
    return `
      <article class="nearest-option">
        <div class="nearest-rank">${index + 1}</div>
        <button class="nearest-select" type="button" data-nearest-id="${item.box.id}">
          <strong>${escapeText(item.box.name)}</strong>
          <span>${formatDistance(meters)} ${usingRoadDistance ? 'por calles' : 'aprox.'}</span>
        </button>
        <a class="nearest-route" href="${mapsUrl}" target="_blank" rel="noreferrer">Ir</a>
      </article>`;
  }).join('');

  const first = top[0];
  nearestResult.innerHTML = `Más cercana: <strong>${escapeText(first.box.name)}</strong> · ${formatDistance(usingRoadDistance ? first.roadDistance : first.directDistance)}`;
}

async function locateNearest(lat, lng, label = 'Ubicación del cliente') {
  if (!state.boxes.length) {
    nearestResult.textContent = 'Las cajas todavía no están disponibles.';
    return;
  }

  showTarget(lat, lng, label);
  openNearestModal();
  nearestModalStatus.textContent = 'Calculando distancias por calles…';
  nearestOptions.innerHTML = '';

  const candidates = nearestCandidates(lat, lng, 12);

  try {
    const routed = await roadDistances(lat, lng, candidates);
    const valid = routed
      .filter(item => Number.isFinite(item.roadDistance))
      .sort((a, b) => a.roadDistance - b.roadDistance);

    if (!valid.length) throw new Error('Sin rutas');

    renderNearestOptions(lat, lng, valid, true);

    const first = valid[0];
    selectBox(first.box.id, false);
    if (mapReady) {
      map.fitBounds(L.latLngBounds([[lat, lng], [first.box.lat, first.box.lng]]).pad(.35), { maxZoom: 17 });
    }
  } catch (_) {
    renderNearestOptions(lat, lng, candidates, false);

    const first = candidates[0];
    if (first) {
      selectBox(first.box.id, false);
      if (mapReady) {
        map.fitBounds(L.latLngBounds([[lat, lng], [first.box.lat, first.box.lng]]).pad(.35), { maxZoom: 17 });
      }
    }
  }
}

function parseCoordinates(value) {
  if (!value) return null;
  let text = value.trim();
  try { text = decodeURIComponent(text); } catch (_) {}

  const patterns = [
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /!3d(-?\d{1,2}(?:\.\d+)?).*?!4d(-?\d{1,3}(?:\.\d+)?)/,
    /(?:query|q|ll)=(-?\d{1,2}(?:\.\d+)?)[, ]+(-?\d{1,3}(?:\.\d+)?)/i,
    /(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }

  return null;
}

function textWithoutUrls(value) {
  return value.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
}

async function geocodeAddress(value) {
  const query = textWithoutUrls(value);
  if (query.length < 4) return null;

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ar&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { 'Accept-Language': 'es' } });
  if (!response.ok) return null;

  const data = await response.json();
  if (!data.length) return null;

  return { lat: Number(data[0].lat), lng: Number(data[0].lon), label: data[0].display_name };
}

async function handleLocation(value) {
  const clean = value.trim();
  if (!clean) {
    nearestResult.textContent = 'Pegá una ubicación o usá tu GPS.';
    return;
  }

  nearestResult.textContent = 'Buscando ubicación…';

  const coords = parseCoordinates(clean);
  if (coords) {
    locateNearest(coords.lat, coords.lng);
    return;
  }

  try {
    const geocoded = await geocodeAddress(clean);
    if (geocoded) {
      locateNearest(geocoded.lat, geocoded.lng, geocoded.label);
      return;
    }
  } catch (_) {}

  nearestResult.textContent = 'No pude obtener la ubicación. Si es un enlace corto de Maps, pegá también la dirección o usá el GPS.';
}

function requestGps(findNearest) {
  if (!navigator.geolocation) {
    nearestResult.textContent = 'Este dispositivo no permite obtener la ubicación.';
    return;
  }

  nearestResult.textContent = 'Buscando tu ubicación…';

  navigator.geolocation.getCurrentPosition(
    position => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      showTarget(lat, lng, 'Tu ubicación');

      if (findNearest) {
        locateNearest(lat, lng, 'Tu ubicación');
      } else {
        nearestResult.textContent = 'Ubicación obtenida.';
        if (mapReady) map.flyTo([lat, lng], 17, { duration: .6 });
      }
    },
    () => {
      nearestResult.textContent = 'No pude obtener tu ubicación. Revisá el permiso de ubicación de la app.';
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
  );
}

async function loadBoxes() {
  try {
    let kmlText = window.EMBEDDED_KML || null;

    if (!kmlText) {
      const response = await fetch('data/cajas.kml', { cache: 'no-store' });
      if (!response.ok) throw new Error('No se pudo abrir el archivo de cajas.');
      kmlText = await response.text();
    }

    state.boxes = parseKml(kmlText);
    totalCount.textContent = state.boxes.length;

    buildMarkers();
    render();

    const params = new URLSearchParams(location.search);
    const shared = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join(' ');
    if (shared) {
      locationInput.value = shared;
      handleLocation(shared);
    }
  } catch (error) {
    empty.hidden = false;
    empty.textContent = error.message || 'No se pudieron cargar las cajas.';
    nearestResult.textContent = 'Error cargando las cajas. Cerrá y volvé a abrir la app.';
  } finally {
    if (loading) {
      loading.hidden = true;
      loading.style.display = 'none';
    }
  }
}

document.querySelector('#search').addEventListener('input', event => {
  state.query = event.target.value;
  render();
});

document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  document.querySelector('.filter.active')?.classList.remove('active');
  button.classList.add('active');
  state.filter = button.dataset.filter;
  render();
}));

list.addEventListener('click', event => {
  const button = event.target.closest('[data-id]');
  if (button) selectBox(button.dataset.id);
});

document.querySelector('#fitAll').addEventListener('click', () => {
  if (!mapReady) return;
  const matches = matchingBoxes();
  if (matches.length) map.fitBounds(L.latLngBounds(matches.map(box => [box.lat, box.lng])).pad(.08));
});

document.querySelector('#findNearest').addEventListener('click', () => handleLocation(locationInput.value));
locationInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') handleLocation(locationInput.value);
});

document.querySelector('#nearestFromGps').addEventListener('click', () => requestGps(true));
document.querySelector('#locate').addEventListener('click', () => requestGps(false));

document.querySelectorAll('[data-close-nearest]').forEach(el => {
  el.addEventListener('click', closeNearestModal);
});

nearestOptions?.addEventListener('click', event => {
  const button = event.target.closest('[data-nearest-id]');
  if (!button) return;
  selectBox(button.dataset.nearestId);
});

initMap();
loadBoxes();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
