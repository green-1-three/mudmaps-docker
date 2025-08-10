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

// 1) Prefer .env values if set
let API_BASE = import.meta.env.VITE_API_BASE;     // e.g., "/api" in production
let OSRM_BASE = import.meta.env.VITE_OSRM_BASE;   // leave as-is unless you proxy OSRM too

// 2) Auto-detect environment if not set
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);

if (!API_BASE) {
    API_BASE = IS_LOCAL ? 'http://localhost:3001' : '/api';
}

if (!OSRM_BASE) {
    OSRM_BASE = IS_LOCAL ? 'http://localhost:5010' : `http://${window.location.hostname}:5010`;
}

// Log for debugging
console.log("Using API_BASE:", API_BASE);
console.log("Using OSRM_BASE:", OSRM_BASE);

// Initialize map
const map = new Map({
    target: 'map',
    layers: [
        new TileLayer({
            source: new OSM(),
        }),
    ],
    view: new View({
        center: fromLonLat([0, 0]),
        zoom: 2,
    }),
});

const vectorSource = new VectorSource();
const vectorLayer = new VectorLayer({
    source: vectorSource,
});
map.addLayer(vectorLayer);

// Custom styles
const userStyle = new Style({
    image: new Icon({
        anchor: [0.5, 1],
        src: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png',
        scale: 1,
    }),
});

const markerStyle = new Style({
    image: new Icon({
        anchor: [0.5, 1],
        src: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
        scale: 1,
    }),
});

// Geolocation
if ('geolocation' in navigator) {
    console.log("Setting up geolocation watcher...");
    navigator.geolocation.watchPosition((position) => {
        console.log("Got updated position:", position);
        const coords = [position.coords.longitude, position.coords.latitude];
        const projectedCoords = fromLonLat(coords);

        const userLocation = new Feature({
            geometry: new Point(projectedCoords),
        });

        userLocation.setStyle(userStyle);
        vectorSource.addFeature(userLocation);
        map.getView().animate({ center: projectedCoords, zoom: 14 });
    }, (error) => {
        console.error('Geolocation error:', error);
    }, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    });
}

// Fetch markers from database (now via Nginx proxy in prod)
fetch(`${API_BASE}/markers`)
    .then(res => res.json())
    .then(users => {
        users.forEach(user => {
            user.coords.forEach(([lon, lat]) => {
                const coord = fromLonLat([lon, lat]);
                const marker = new Feature({
                    geometry: new Point(coord),
                });
                marker.setStyle(markerStyle);
                vectorSource.addFeature(marker);
            });
        });
    })
    .catch(err => console.error('Markers fetch error:', err));

// Fetch polylines and snap to OSRM roads
fetch(`${API_BASE}/polylines`)
    .then(res => res.json())
    .then(users => {
        users.forEach(user => {
            const coordString = user.coords.map(([lon, lat]) => `${lon},${lat}`).join(';');
            const osrmUrl = `${OSRM_BASE}/match/v1/driving/${coordString}?geometries=geojson&overview=full`;

            fetch(osrmUrl)
                .then(res => res.json())
                .then(data => {
                    if (data.matchings && data.matchings.length > 0) {
                        const snappedCoords = data.matchings[0].geometry.coordinates;
                        const snappedLine = new Feature({
                            geometry: new LineString(snappedCoords.map(c => fromLonLat(c))),
                        });

                        snappedLine.setStyle(
                            new Style({
                                stroke: new Stroke({ color: 'blue', width: 3 }),
                            })
                        );

                        vectorSource.addFeature(snappedLine);
                    } else {
                        console.warn('No match found for:', user.username);
                    }
                })
                .catch(err => {
                    console.error('Map matching error:', err);
                });
        });
    })
    .catch(err => console.error('Polylines fetch error:', err));
