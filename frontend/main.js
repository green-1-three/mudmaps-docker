import './style.css';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { fromLonLat } from 'ol/proj';
import { Feature } from 'ol';
import { Point, LineString } from 'ol/geom';
import { Vector as VectorLayer } from 'ol/layer';
import { Vector as VectorSource } from 'ol/source';
import { Style, Icon, Stroke } from 'ol/style';

// Prefer build-time values; fall back to same-origin proxy paths
let API_BASE = import.meta.env.VITE_API_BASE;
let OSRM_BASE = import.meta.env.VITE_OSRM_BASE;

// 2) Better defaults
if (!API_BASE) {
    API_BASE = (window.location.hostname === 'localhost')
        ? 'http://localhost:3001'
        : '/api';              // <— KEY CHANGE (use the proxy path)
}

if (!OSRM_BASE) {
    OSRM_BASE = (window.location.hostname === 'localhost')
        ? 'http://localhost:5010'
        : `http://${window.location.hostname}:5010`; // or proxy it later too
}

console.log('Using API_BASE:', API_BASE);
console.log('Using OSRM_BASE:', OSRM_BASE);

// Map
const map = new Map({
    target: 'map',
    layers: [new TileLayer({ source: new OSM() })],
    view: new View({ center: fromLonLat([0, 0]), zoom: 2 })
});

const vectorSource = new VectorSource();
const vectorLayer = new VectorLayer({ source: vectorSource });
map.addLayer(vectorLayer);

// Styles
const userStyle = new Style({
    image: new Icon({ anchor: [0.5, 1], src: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png', scale: 1 })
});
const markerStyle = new Style({
    image: new Icon({ anchor: [0.5, 1], src: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png', scale: 1 })
});

function addMarker(vectorSource, lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const f = new Feature({ geometry: new Point(fromLonLat([lon, lat])) });
    f.setStyle(markerStyle);
    vectorSource.addFeature(f);
}

// Accepts many shapes and normalizes to [[lon,lat], ...]
function normalizeMarkersPayload(payload) {
    const out = [];
    const list =
        Array.isArray(payload) ? payload :
            Array.isArray(payload.users) ? payload.users :
                Array.isArray(payload.markers) ? payload.markers :
                    [];

    const isPair = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);

    list.forEach(item => {
        if (isPair(item)) { out.push(item); return; }               // [[lon,lat],...]
        if (item && typeof item === 'object') {
            const c = item.coords;

            if (isPair(c)) { out.push(c); return; }                   // { coords:[lon,lat] }
            if (Array.isArray(c) && c.length && isPair(c[0])) {       // { coords:[[lon,lat],...] }
                c.forEach(p => isPair(p) && out.push(p)); return;
            }
            if (Array.isArray(c) && c.length >= 2 && c.every(Number.isFinite)) {
                for (let i = 0; i + 1 < c.length; i += 2) {             // { coords:[lon,lat,lon,lat,...] }
                    const lon = c[i], lat = c[i+1];
                    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat]);
                }
                return;
            }
            if (Number.isFinite(item.lon) && Number.isFinite(item.lat)) { // { lon, lat }
                out.push([item.lon, item.lat]); return;
            }
        }
        console.warn('Unrecognized marker item shape:', item);
    });

    return out;
}

// Geolocation
if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition((pos) => {
        const coords = [pos.coords.longitude, pos.coords.latitude];
        const projected = fromLonLat(coords);
        const user = new Feature({ geometry: new Point(projected) });
        user.setStyle(userStyle);
        vectorSource.addFeature(user);
        map.getView().animate({ center: projected, zoom: 14 });
    }, (err) => console.error('Geolocation error:', err), {
        enableHighAccuracy: true, timeout: 10000, maximumAge: 0
    });
}

// Fetch markers
fetch(`${API_BASE}/markers`)
    .then(async (res) => {
        const ct = res.headers.get('content-type') || '';
        const body = await res.text();
        if (!ct.includes('application/json')) {
            throw new Error(`Markers endpoint did not return JSON. First bytes: ${body.slice(0, 120)}`);
        }
        const data = JSON.parse(body);
        const pairs = normalizeMarkersPayload(data);
        pairs.forEach(([lon, lat]) => addMarker(vectorSource, lon, lat));
        console.log(`Plotted ${pairs.length} markers`);
    })
    .catch(err => console.error('Markers fetch error:', err));

// Fetch polylines and OSRM match (optional /osrm)
fetch(`${API_BASE}/polylines`)
    .then(res => res.json())
    .then(users => {
        users.forEach(user => {
            const coordString = user.coords.map(([lon, lat]) => `${lon},${lat}`).join(';');
            const osrmUrl = `${OSRM_BASE}/match/v1/driving/${coordString}?geometries=geojson&overview=full`;

            fetch(osrmUrl)
                .then(r => r.json())
                .then(data => {
                    if (data.matchings && data.matchings.length > 0) {
                        const snapped = data.matchings[0].geometry.coordinates.map(c => fromLonLat(c));
                        const line = new Feature({ geometry: new LineString(snapped) });
                        line.setStyle(new Style({ stroke: new Stroke({ color: 'blue', width: 3 }) }));
                        vectorSource.addFeature(line);
                    } else {
                        console.warn('No match found for:', user.username);
                    }
                })
                .catch(err => console.error('Map matching error:', err));
        });
    })
    .catch(err => console.error('Polylines fetch error:', err));