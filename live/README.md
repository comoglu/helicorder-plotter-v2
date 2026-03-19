# KOERI Live Seismic Monitoring System

Production-ready real-time seismic monitoring for KOERI (Kandilli Observatory) network stations.

## Quick Start

```bash
cd /home/ubuntu/Projects/Cayeli
python3 -m http.server 8000
```

Then open: **http://localhost:8000/live/**

## Features

### 1. URL-Based Station Selection
Monitor specific stations by adding them to the URL:

**Single Station:**
```
http://localhost:8000/live/?KO.ISK
```

**Multiple Stations:**
```
http://localhost:8000/live/?KO.ISK,KO.CHAY,KO.ARMT
```

### 2. Real-time Auto-Update
- Automatically updates every 30 seconds
- Live streaming of seismic data
- No manual refresh needed

### 3. Multiple Time Windows
For each station, choose:
- **10m** - 10 minutes of data
- **30m** - 30 minutes of data
- **1h** - 1 hour of data

### 4. Clean Professional Display
- Dark theme optimized for monitoring
- Seismograph displays using seisplotjs
- Station metadata (location, elevation, sample rate)
- Multiple stations in responsive grid

## Usage

### Monitor Single Station

```
http://localhost:8000/live/?KO.ISK
```

Shows ISK station (Istanbul) vertical component in real-time.

### Monitor Multiple Stations

```
http://localhost:8000/live/?KO.ISK,KO.CHAY,KO.ARMT
```

Shows 3 stations side-by-side with independent time windows.

### Quick Links

**Popular Stations:**
- [ISK (Istanbul)](http://localhost:8000/live/?KO.ISK)
- [CHAY (Cayeli, Rize)](http://localhost:8000/live/?KO.CHAY)
- [ARMT (Armutlu, Yalova)](http://localhost:8000/live/?KO.ARMT)

**Station Pairs:**
- [ISK + CHAY](http://localhost:8000/live/?KO.ISK,KO.CHAY)
- [ISK + ARMT](http://localhost:8000/live/?KO.ISK,KO.ARMT)

**Regional Network:**
- [Marmara Region (3 stations)](http://localhost:8000/live/?KO.ISK,KO.ARMT,KO.AVCI)

## URL Format

```
?<NETWORK>.<STATION>[,<NETWORK>.<STATION>,...]
```

**Examples:**
- `?KO.ISK` - Single station
- `?KO.ISK,KO.CHAY` - Two stations
- `?KO.ISK,KO.CHAY,KO.ARMT,KO.AVCI` - Four stations

## Files

### Production Files
- **index.html** - Main live monitoring interface
- **app.js** - Live monitoring application logic
- **dashboard.html** - Full station browser (browse all 200+ stations)
- **dashboard.js** - Dashboard application logic

### Directory Structure
```
live/
├── index.html          # Main entry point (URL-based monitoring)
├── app.js             # Live monitoring logic
├── dashboard.html     # Station browser
├── dashboard.js       # Dashboard logic
└── README.md          # This file
```

## Dashboard Mode

For browsing all available stations:

```
http://localhost:8000/live/dashboard.html
```

Features:
- Browse 200+ KO network stations
- Search by station code or location
- Interactive map view
- Click to select and monitor
- Multiple view modes (Waveforms, Helicorder, etc.)

## Configuration

Edit [app.js](app.js) to customize:

```javascript
const CONFIG = {
    host: 'eida.koeri.boun.edu.tr',
    protocol: 'https:',
    updateInterval: 30000,  // Update every 30 seconds
    defaultDuration: 600,   // Default 10 minutes of data
};
```

## How It Works

1. **URL Parsing:** Extracts station codes from URL parameters
2. **Metadata Fetch:** Loads station information from FDSN station service
3. **Data Streaming:** Fetches miniSEED data every 30 seconds
4. **Display:** Uses seisplotjs Seismograph component for professional display
5. **Auto-Update:** Continuously refreshes data without page reload

## Use Cases

### Earthquake Monitoring
Monitor key stations during seismic events:
```
?KO.ISK,KO.CHAY,KO.ARMT
```

### Regional Analysis
Track multiple stations in a specific region:
```
?KO.ISK,KO.ARMT,KO.AVCI,KO.BGKT
```

### Station Comparison
Compare nearby stations for local events:
```
?KO.ISK,KO.AVCI
```

### Network Operations
Monitor critical network stations:
```
?KO.ISK,KO.CHAY,KO.BALB,KO.AKS
```

## Advantages

✅ **URL-Based** - Share links to specific station configurations
✅ **No Configuration** - Just add stations to URL
✅ **Auto-Update** - Live streaming every 30 seconds
✅ **Multiple Stations** - Monitor many stations simultaneously
✅ **Flexible Time Windows** - 10m, 30m, or 1h per station
✅ **Professional Display** - seisplotjs components
✅ **Production Ready** - Clean, focused, reliable

## Browser Requirements

- Modern browser (Chrome, Firefox, Safari, Edge)
- JavaScript enabled
- Internet connection to KOERI FDSN services

## Deployment

### Local Development
```bash
python3 -m http.server 8000
```

### Production Server (nginx)
```nginx
server {
    listen 80;
    server_name seismic.example.com;

    root /path/to/Cayeli/live;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

### Production Server (Apache)
```apache
<VirtualHost *:80>
    ServerName seismic.example.com
    DocumentRoot /path/to/Cayeli/live

    <Directory /path/to/Cayeli/live>
        Options Indexes FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>
</VirtualHost>
```

## Troubleshooting

### No stations showing
- Check URL format: `?KO.STATION`
- Verify station code is correct
- Check browser console for errors

### No data loading
- Verify FDSN service is accessible
- Check if station has recent data
- Look at browser Network tab for failed requests

### Auto-update not working
- Check browser console for errors
- Verify updateInterval is set correctly
- Ensure page is not in background (some browsers throttle timers)

## Credits

Built with [seisplotjs](https://github.com/crotwell/seisplotjs) by Philip Crotwell.
Data from KOERI (Kandilli Observatory & Earthquake Research Institute).

## Support

For issues:
- Check browser console for errors
- Verify station codes are valid
- Test with known working stations (ISK, CHAY)
- Review network requests in developer tools
