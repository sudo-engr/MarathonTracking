const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');
const sync = source.split('\n').find(line => line.startsWith('function syncCourseMarkers()'));
const parse = source.split('\n').find(line => line.startsWith('function parseTime('));
let now = Date.parse('2026-10-24T17:00:00+09:00');
const posted = {};
const records = {
    'race:3909': { status: 'ok', course: 'FULL', total: '04:00:00', segments: [{elapsed: '04:00:00'}] },
    'race:3358': { status: 'ok', course: ' 10K ', total: '01:00:00', segments: [{elapsed: '00:30:00'}] },
};
const context = vm.createContext({
    Date: { now: () => now, parse: Date.parse },
    selected: () => ({id: 'race', date: '2026-10-25'}),
    state: { bibs: ['3909', '3358'], names: {} }, cache: () => records,
    $: id => ({contentWindow: {postMessage: message => { posted[id] = message.runners; }}}),
});
vm.runInContext(parse + '\n' + sync + '\nsyncCourseMarkers()', context);
assert.equal(posted.courseMapFrame[0].date, '2026-10-25');
assert.equal(posted.courseMapFrame[0].total, '04:00:00');
assert.equal(posted.courseMapFrame10k[0].course, ' 10K ');
now = Date.parse('2026-10-25T12:00:00+09:00');
vm.runInContext('syncCourseMarkers()', context);
assert.equal(posted.courseMapFrame[0].segments[0].elapsed, '04:00:00');
assert.equal(posted.courseMapFrame10k[0].segments[0].elapsed, '00:30:00');
assert.equal(posted.courseMapFrame[0].progress, undefined);
assert.equal((source.match(/function syncCourseMarkers\(/g) || []).length, 1);
assert.ok(!source.includes('syncCourseMarkersOnly'));
console.log('PASS: checkpoint data and race date reach predictor; Full/10K routing preserved');
