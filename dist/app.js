const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([-34.82, -58.21], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

const state = { boxes: [], filter: 'all', query: '', markers: new Map(), selected: null };
const list = document.querySelector('#boxList');
const loading = document.querySelector('#loading');
const empty = document.querySelector('#emptyState');
const totalCount = document.querySelector('#totalCount');
const visibleCount = document.querySelector('#visibleCount');
const popupTemplate = document.querySelector('#popupTemplate');
const layer = L.featureGroup().addTo(map);

function escapeText(value = '') {
  return value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
}

function markerIcon(box, selected = false) {
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
  const directions = node.querySelector('.directions');
  directions.href = `https://www.google.com/maps/dir/?api=1&destination=${box.lat},${box.lng}`;
  return node;
}

function selectBox(id, move = true) {
  if (state.selected && state.markers.has(state.selected)) {
    const previous = state.boxes.find(box => box.id === state.selected);
    state.markers.get(state.selected).setIcon(markerIcon(previous));
  }
  const box = state.boxes.find(item => item.id === id);
  const marker = state.markers.get(id);
  if (!box || !marker) return;
  state.selected = id;
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
  state.markers.forEach((marker, id) => {
    const visible = matches.some(box => box.id === id);
    if (visible && !layer.hasLayer(marker)) layer.addLayer(marker);
    if (!visible && layer.hasLayer(marker)) layer.removeLayer(marker);
  });
}

function parseKml(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('El archivo de ubicaciones no es válido.');
  return [...xml.getElementsByTagNameNS('*', 'Placemark')].map((placemark, index) => {
    const name = placemark.getElementsByTagNameNS('*', 'name')[0]?.textContent?.trim() || `Caja ${index + 1}`;
    const description = placemark.getElementsByTagNameNS('*', 'description')[0]?.textContent?.trim() || '';
    const coordinates = placemark.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent?.trim().split(',').map(Number);
    if (!coordinates || coordinates.length < 2 || coordinates.some(Number.isNaN)) return null;
    return { id: `box-${index + 1}`, name, description, lng: coordinates[0], lat: coordinates[1], approx: /aproximad/i.test(`${name} ${description}`) };
  }).filter(Boolean);
}

async function loadBoxes() {
  try {
    const response = await fetch('data/cajas.kml');
    if (!response.ok) throw new Error('No se pudo abrir el archivo de ubicaciones.');
    state.boxes = parseKml(await response.text());
    state.boxes.forEach(box => {
      const marker = L.marker([box.lat, box.lng], { icon: markerIcon(box), title: box.name });
      marker.on('click', () => selectBox(box.id, false));
      state.markers.set(box.id, marker);
      marker.addTo(layer);
    });
    totalCount.textContent = state.boxes.length;
    render();
    if (state.boxes.length) map.fitBounds(layer.getBounds().pad(.08));
  } catch (error) {
    empty.hidden = false;
    empty.textContent = error.message;
  } finally {
    loading.hidden = true;
  }
}

document.querySelector('#search').addEventListener('input', event => { state.query = event.target.value; render(); });
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
  const matches = matchingBoxes();
  if (!matches.length) return;
  map.fitBounds(L.latLngBounds(matches.map(box => [box.lat, box.lng])).pad(.08));
});
document.querySelector('#locate').addEventListener('click', () => map.locate({ setView: true, maxZoom: 17 }));
map.on('locationfound', event => L.circleMarker(event.latlng, { radius: 8, weight: 3, color: '#fff', fillColor: '#1475ff', fillOpacity: 1 }).addTo(map).bindPopup('Tu ubicación').openPopup());
map.on('locationerror', () => alert('No fue posible obtener tu ubicación. Revisá los permisos del navegador.'));

loadBoxes();
