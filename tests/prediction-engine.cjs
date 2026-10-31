const assert = require('node:assert/strict');
const { buildRoute, predict } = require('../runner-prediction.js');

const km = (lat1, lon1, lat2, lon2) => Math.abs((lon2 - lon1) * 111000);
const flat = buildRoute([{ lat: 0, lon: 0, ele: 0 }, { lat: 0, lon: 0.015, ele: 0 }, { lat: 0, lon: 0.03, ele: 0 }], km);
assert.equal(Math.round(flat.totalMeters), 3330);
assert.ok(flat.segments.every(s => s.grade === 0));
const uphill = buildRoute([{ lat: 0, lon: 0, ele: 0 }, { lat: 0, lon: 0.005, ele: 100 }, { lat: 0, lon: 0.01, ele: 100 }], km);
assert.ok(uphill.segments[0].grade > 0);

const runner = { date: '2026-10-31', total: '00:20:00', segments: [
  { point: '출발', elapsed: '00:00:00', timeOfDay: '08:00:00' },
  { point: '1K', elapsed: '00:06:00', timeOfDay: '08:06:00' },
  { point: '2K', elapsed: '00:12:00', timeOfDay: '08:12:00' },
] };
const at0815 = Date.parse('2026-10-31T08:15:00+09:00');
const neutral = predict(runner, flat, () => ({ temperature: 10, precipitation: 0, windSpeed: 0, windDirection: 0 }), at0815);
assert.equal(neutral.state, 'running');
assert.ok(neutral.progress > 0.5 && neutral.progress < 0.8);
assert.equal(neutral.averagePace, 360);
assert.equal(neutral.segmentPace, 360);
assert.equal(neutral.weatherApplied, true);

const anchorTime = Date.parse('2026-10-31T08:12:00+09:00');
const wind = weather => predict(runner, flat, ts => ts > anchorTime ? weather : { temperature: 10, windSpeed: 0, windDirection: 0 }, at0815).progress;
const headwind = wind({ temperature: 10, windSpeed: 10, windDirection: 90 });
const tailwind = wind({ temperature: 10, windSpeed: 10, windDirection: 270 });
assert.ok(headwind < tailwind);
assert.equal(predict(runner, flat, () => null, at0815).weatherApplied, false);

const before = predict(runner, flat, null, Date.parse('2026-10-31T07:59:00+09:00'));
assert.equal(before.progress, 0);
const past = predict(runner, flat, null, Date.parse('2026-11-01T07:00:00+09:00'));
assert.equal(past.progress, 2 / 3.33);
assert.equal(past.estimated, false);
const finish = { ...runner, segments: [...runner.segments, { point: 'FINISH', elapsed: '00:20:00', timeOfDay: '08:20:00' }] };
assert.equal(predict(finish, flat, null, Date.parse('2026-10-31T08:21:00+09:00')).progress, 1);

const capped = predict({ ...runner, segments: [...runner.segments, { point: '2.5K', elapsed: '00:15:00', timeOfDay: '08:15:00' }] }, flat, null, Date.parse('2026-10-31T08:14:30+09:00'));
assert.ok(capped.progress < 2.5 / 2.22);
const repeated = predict({ ...runner, segments: [...runner.segments, { point: '2K', elapsed: '00:12:00', timeOfDay: '08:12:00' }] }, flat, null, at0815);
assert.equal(repeated.state, 'running');
console.log('PASS: route smoothing, checkpoint anchoring, pace, weather, elevation, finish/prerace/past/cap behavior');

const { weatherFactor } = require('../runner-prediction.js');
assert.equal(weatherFactor({temperature: 7},0),1);
assert.equal(weatherFactor({temperature: null},0),1);
assert.equal(buildRoute([{lat:0,lon:0,ele:null},{lat:0,lon:.01,ele:null}],km).elevationApplied,false);
assert.equal(predict(runner,flat,null,Date.parse('2026-10-30T09:00:00+09:00')).progress,0);
assert.equal(predict(runner,flat,null,Date.parse('2026-10-31T09:00:00+09:00')).state,'stale');
assert.equal(predict(finish,flat,null,Date.parse('2026-11-01T09:00:00+09:00')).state,'finished');
const noClocks = {...runner,segments:runner.segments.map(({timeOfDay,...row})=>row)};
assert.equal(predict(noClocks,flat,null,at0815).progress,2/3.33);
assert.equal(predict(noClocks,flat,null,at0815).estimated,false);
const tenKRoute = buildRoute([{lat:0,lon:0,ele:0},{lat:0,lon:9.96/111,ele:0}],km);
const tenKRunner = {...runner,course:'10K',segments:[{point:'출발',elapsed:'00:00:00',timeOfDay:'08:00:00'},{point:'5K',elapsed:'00:30:00',timeOfDay:'08:30:00'}]};
const shortGpx = predict(tenKRunner,tenKRoute,null,Date.parse('2026-10-31T08:36:00+09:00'));
assert.equal(shortGpx.averagePace,360);
assert.ok(Math.abs(shortGpx.progress - .6)<.0001);
const hillAhead = buildRoute([{lat:0,lon:0,ele:0},{lat:0,lon:2/111,ele:0},{lat:0,lon:3.33/111,ele:130}],km);
assert.ok(predict(runner,hillAhead,null,at0815).progress < predict(runner,flat,null,at0815).progress);
const constantHeat = predict(runner,flat,()=>({temperature:25,windSpeed:0}),at0815);
assert.ok(Math.abs(constantHeat.progress - predict(runner,flat,null,at0815).progress)<.0001);
assert.ok(wind({temperature:30,windSpeed:0,windDirection:0}) < wind({temperature:10,windSpeed:0,windDirection:0}));
console.log('PASS: missing elevation/clock, no weather double-counting, heat, uphill, official distance, and stale record guards');
