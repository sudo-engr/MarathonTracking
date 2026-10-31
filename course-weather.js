/* Open-Meteo hourly model data for the course start, not an on-course observation. */
(function(root) {
    const entries = new Map();
    async function load(date, point, now = Date.now()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
        const key = `${date}:${point.lat.toFixed(2)}:${point.lon.toFixed(2)}`;
        const cached = entries.get(key);
        if (cached && now - cached.at < (cached.data ? 1800000 : 300000)) return cached.promise;
        const entry = {at: now, data: null};
        const age = (now - Date.parse(date + 'T00:00:00+09:00')) / 86400000;
        if (age < -16) return null;
        const host = age > 5 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
        const params = new URLSearchParams({latitude: point.lat.toFixed(2), longitude: point.lon.toFixed(2), start_date: date, end_date: date, timezone: 'Asia/Seoul', timeformat: 'unixtime', wind_speed_unit: 'ms', hourly: 'temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m'});
        entry.promise = (async () => {
            try {
                const response = await fetch(host + '?' + params, {signal: AbortSignal.timeout(10000)});
                if (!response.ok) throw new Error('Weather unavailable');
                const {hourly} = await response.json();
                const names = ['temperature_2m', 'precipitation', 'weather_code', 'wind_speed_10m', 'wind_direction_10m'];
                if (!Array.isArray(hourly?.time) || !names.every(name => Array.isArray(hourly[name]))) return null;
                const rows = hourly.time.map((time, i) => ({time: time * 1000, temperature: hourly.temperature_2m[i], precipitation: hourly.precipitation[i], weatherCode: hourly.weather_code[i], windSpeed: hourly.wind_speed_10m[i], windDirection: hourly.wind_direction_10m[i]})).filter(row => Object.values(row).every(Number.isFinite));
                if (!rows.length) return null;
                entry.data = timestamp => rows.find(row => timestamp >= row.time && timestamp < row.time + 3600000) || null;
                return entry.data;
            } catch { return null; }
        })();
        entries.set(key, entry);
        return entry.promise;
    }
    const api = {load};
    if (typeof module !== 'undefined') module.exports = api;
    else root.CourseWeather = api;
})(typeof window !== 'undefined' ? window : globalThis);
