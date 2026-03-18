document.addEventListener("DOMContentLoaded", function () {
    var el = document.getElementById("map");
    if (!el) return;

    var map = L.map("map", {
        worldCopyJump: true,
    }).setView([-25, 135], 4);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        noWrap: false,
    }).addTo(map);

    fetch("station_data.json")
        .then(function (resp) {
            return resp.json();
        })
        .then(function (stations) {
            if (stations.length === 0) return;

            // Normalize longitudes so stations near the date line
            // (e.g. Niue at -170°) appear near Australia (130°E)
            // rather than on the opposite side of the map.
            // Shift negative longitudes east of 0° to 180-360° range.
            function normLng(lng) {
                return lng < 0 ? lng + 360 : lng;
            }

            var lats = [];
            var lngs = [];

            stations.forEach(function (s) {
                var lng = normLng(s.longitude);
                lats.push(s.latitude);
                lngs.push(lng);

                var popup =
                    "<strong>" + s.id + "</strong><br>" +
                    "Network: " + s.network + "<br>" +
                    "Station: " + s.station + "<br>" +
                    '<a href="' + s.id + '.html" target="_blank">View Helicorder</a>';
                L.marker([s.latitude, lng]).addTo(map).bindPopup(popup);
            });

            // Fit bounds using normalized longitudes
            var minLat = Math.min.apply(null, lats);
            var maxLat = Math.max.apply(null, lats);
            var minLng = Math.min.apply(null, lngs);
            var maxLng = Math.max.apply(null, lngs);

            map.fitBounds([
                [minLat - 2, minLng - 2],
                [maxLat + 2, maxLng + 2],
            ]);
        })
        .catch(function (err) {
            console.error("Failed to load station data:", err);
        });
});
