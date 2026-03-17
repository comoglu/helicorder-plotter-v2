document.addEventListener("DOMContentLoaded", function () {
    var el = document.getElementById("map");
    if (!el) return;

    var map = L.map("map").setView([0, 0], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    fetch("station_data.json")
        .then(function (resp) {
            return resp.json();
        })
        .then(function (stations) {
            stations.forEach(function (s) {
                var popup =
                    "<strong>" + s.id + "</strong><br>" +
                    "Network: " + s.network + "<br>" +
                    "Station: " + s.station + "<br>" +
                    '<a href="' + s.id + '.html" target="_blank">View Helicorder</a>';
                L.marker([s.latitude, s.longitude]).addTo(map).bindPopup(popup);
            });

            if (stations.length > 0) {
                map.fitBounds(
                    L.latLngBounds(
                        stations.map(function (s) {
                            return [s.latitude, s.longitude];
                        })
                    )
                );
            }
        })
        .catch(function (err) {
            console.error("Failed to load station data:", err);
        });
});
