const assert = require('node:assert/strict');
const weather = require('../course-weather.js');
let calls = 0;
const now = Date.parse('2026-11-01T08:30:00+09:00');
global.fetch = async url => {
    calls++;
    assert.ok(url.startsWith('https://api.open-meteo.com/v1/forecast?'));
    assert.ok(url.includes('wind_speed_unit=ms'));
    return {ok:true,json:async()=>({hourly:{time:[now / 1000 - 1800],temperature_2m:[20],precipitation:[1],weather_code:[61],wind_speed_10m:[3],wind_direction_10m:[180]}})};
};
(async () => {
    const point = {lat:37.5,lon:127};
    const at = await weather.load('2026-11-01',point,now);
    assert.equal(at(now).windSpeed,3);
    assert.equal(at(now).windDirection,180);
    assert.equal(at(now + 3600000),null);
    assert.equal(await weather.load('2026-11-01',point,now),at);
    assert.equal(calls,1);
    assert.equal(await weather.load('invalid',point,now),null);
    global.fetch = async () => {calls++;throw new Error('offline')};
    assert.equal(await weather.load('2026-11-02',point,now),null);
    assert.equal(await weather.load('2026-11-02',point,now),null);
    assert.equal(calls,2);
    global.fetch = async () => ({ok:true,json:async()=>({hourly:{time:[1],temperature_2m:[null],precipitation:[0],weather_code:[0],wind_speed_10m:[0],wind_direction_10m:[0]}})});
    assert.equal(await weather.load('2026-11-03',point,now),null);
    console.log('PASS: hourly weather, wind units, cache, missing data, and offline fallback');
})().catch(error => {console.error(error);process.exitCode=1});
