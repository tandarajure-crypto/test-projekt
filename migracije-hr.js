const map = L.map('ricice-map').setView([43.51347, 17.11103], 11);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap',
  referrerPolicy: 'no-referrer'
}).addTo(map);

L.marker([43.51347, 17.11103])
  .addTo(map)
  .bindPopup('Ričice')
  .openPopup();

L.marker([43.55, 17.116667])
  .addTo(map)
  .bindPopup('Zavelim');

L.marker([43.8249858, 17.0076892])
  .addTo(map)
  .bindPopup('Livno');
