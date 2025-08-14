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
    .then(res => res.json())
    .then(users => {
        users.forEach(user => {
            user.coords.forEach(([lon, lat]) => {
                const pt = fromLonLat([lon, lat]);
                const feature = new Feature({ geometry: new Point(pt) });
                feature.setStyle(markerStyle);
                vectorSource.addFeature(feature);
            });
        });
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