const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('gpx-viewer.html', 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const markers = [];
const basemaps = [];
const resizeObservers = [];
const attribution = { classes: new Set(['maplibregl-compact-show']), open: true,
    classList: { add(name){attribution.classes.add(name)}, remove(name){attribution.classes.delete(name)} },
    removeAttribute(name){if(name==='open')this.open=false} };
const element = () => ({ querySelector: () => attribution, style: { setProperty() {} }, children: [], isConnected: false,
    append(...children) { this.children.push(...children); }, getContext() { return {}; } });
class Marker {
    constructor({element}) { this.element = element; }
    setLngLat(point) { this.point = point; return this; }
    addTo(map) { this.map=map; this.element.isConnected=true; if (!markers.includes(this)) markers.push(this); return this; }
    remove() { this.element.isConnected=false; return this; }
    getElement() { return this.element; }
    get label() { return this.element.children[1]?.textContent || ''; }
}
class Map {
    constructor(options) { basemaps.push(options); this.sources={}; this.layers=[]; this.controls=[]; this.touchZoomRotate={disableRotation(){}}; }
    addControl(control, position) { this.controls.push({control,position}); }
    once(event, callback) { this.loadCallback=callback; }
    addSource(id, source) { this.sources[id]=source; }
    addLayer(layer) { this.layers.push(layer); }
    resize() {}
    fitBounds(bounds) { this.bounds=bounds; this.fitCount=(this.fitCount||0)+1; }
}
class LngLatBounds { constructor(a,b) { this.points=[a,b]; } extend(p) { this.points.push(p); return this; } }
const runnerStatus = element();
const context = vm.createContext({
    URLSearchParams, window: { location: { search: '' }, addEventListener() {} },
    document: { getElementById: id => id === 'runner-status' ? runnerStatus : element(), createElement: element, addEventListener() {} },
    Chart: function (ctx, config) { this.options=config.options; this.resize = () => {}; },
    maplibregl: { Map, Marker, LngLatBounds, NavigationControl: class {}, FullscreenControl: class { constructor(options){this.options=options;this.events={};} on(event,callback){this.events[event]=callback;return this;} } },
    ResizeObserver: class { constructor(callback) { this.callback=callback; resizeObservers.push(this); } observe() {} },
    setTimeout() {}, setInterval() {},
    RunnerPrediction: require("../runner-prediction.js"),
    CourseWeather: {load: async () => null},
});
vm.runInContext(fs.readFileSync('runruun-elevation.js', 'utf8'), context);
context.RunruunElevationEngine = context.window.RunruunElevationEngine;
vm.runInContext(script.replace('    initGpxViewer();', ''), context);
vm.runInContext(`
    renderAnalysis({stats: {chartData: []}, points: [{lat: 1, lon: 2}, {lat: 2, lon: 3}]}, [{lat: 10, lon: 20}, {lat: 10.001, lon: 20.001}]);
`, context);
assert.deepEqual(markers.map(m => [m.label, ...m.point]), [['출발', 20, 10], ['도착', 20.001, 10.001]]);
assert.equal(vm.runInContext('JSON.stringify(routePath)', context), '[[2,1],[3,2]]');
assert.ok(script.includes('renderAnalysis(result, rawParsed);'));
assert.equal(basemaps[0].style, 'https://tiles.openfreemap.org/styles/bright');
console.log('PASS: GPX order defines start/finish; runner pins use distance-resampled points; viewer syntax valid');

// A sparse segment crossing several milestones must place all at interpolated distances.
markers.length = 0;
vm.runInContext(`mapInstance = null; gpxChartInstance = null;
    renderAnalysis({stats: {}, points: []}, [{lat: 0, lon: 0}, {lat: 0, lon: 0}, {lat: 0, lon: 0.225}]);`, context);
assert.deepEqual(markers.filter(m => m.label.endsWith(' km')).map(m => m.label), ['5 km', '10 km', '15 km', '20 km', '25 km']);
for (const marker of markers.filter(m => m.label.endsWith(' km'))) {
    const distance = context.RunruunElevationEngine.haversineDistanceMeters(0, 0, marker.point[1], marker.point[0]);
    assert.ok(Math.abs(distance - parseInt(marker.label) * 1000) < 0.01);
}
for (const course of ['full', '10k']) {
    // Match browser DOM parsing: track points only, excluding GPX waypoint metadata.
    context.gpxText = fs.readFileSync(`GPX/2026_춘천_${course}.gpx`, 'utf8').match(/<trkseg>[\s\S]*?<\/trkseg>/g).join('');
    markers.length = 0;
    vm.runInContext(`mapInstance = null; gpxChartInstance = null;
        const points_${course} = RunruunElevationEngine.parseGpx(gpxText);
        renderAnalysis({stats: {}, points: points_${course}}, points_${course});`, context);
    const labels = markers.filter(m => m.label.endsWith(' km')).map(m => m.label);
    assert.deepEqual(labels, course === 'full' ? ['5 km', '10 km', '15 km', '20 km', '25 km', '30 km', '35 km', '40 km'] : ['5 km']);
    console.log(`PASS: Chuncheon ${course}: ${labels.join(', ')}`);
}

vm.runInContext('mapInstance.loadCallback()', context);
assert.equal(vm.runInContext('mapInstance.sources.course.data.geometry.type',context),'LineString');
assert.equal(vm.runInContext('mapInstance.layers[0].paint["line-width"]',context),4);
// Early runner messages survive GPX loading; subsequent updates replace old markers.
vm.runInContext(`mapInstance=null; gpxChartInstance=null; routePath=[]; showRunners([{bib:'1',name:'<img onerror=alert(1)>',progress:0.5}]);
    renderAnalysis({stats:{},points:[{lon:20,lat:10},{lon:21,lat:11},{lon:22,lat:12}]},[{lon:20,lat:10},{lon:20.001,lat:10.001}]);`,context);
assert.equal(vm.runInContext('runnerMarkers.length',context),1);
assert.equal(vm.runInContext('JSON.stringify(runnerMarkers[0].point)',context),'[21,11]');
assert.equal(vm.runInContext('runnerMarkers[0].label',context),'<img onerror=alert(1)> #1');
const oldRunner=vm.runInContext('runnerMarkers[0]',context);
vm.runInContext("showRunners([{bib:'1',name:'러너',progress:1}])",context);
assert.equal(oldRunner.element.isConnected,false);
assert.equal(vm.runInContext('JSON.stringify(runnerMarkers[0].point)',context),'[22,12]');
vm.runInContext('displayChartData=[{lon:21,lat:11}]; gpxChartInstance.options.onHover(null,[{index:0}])',context);
assert.equal(vm.runInContext('JSON.stringify(hoverMarkerInstance.point)',context),'[21,11]');
assert.equal(vm.runInContext('hoverMarkerInstance.getElement().isConnected',context),true);
vm.runInContext('gpxChartInstance.options.onHover(null,[])',context);
assert.equal(vm.runInContext('hoverMarkerInstance.getElement().isConnected',context),false);
assert.ok(!/leaflet|\bL\./i.test(html));
console.log('PASS: native MapLibre course layer, early runner messages, marker replacement, safe text labels, chart hover; no Leaflet');

assert.equal(vm.runInContext('mapInstance.controls[1].position',context),'top-right');
assert.equal(basemaps[0].locale['FullscreenControl.Enter'],'지도 전체화면');
const appHtml=fs.readFileSync('index.html','utf8');
for(const id of ['courseMapFrame','courseMapFrame10k']) {
    const frame=appHtml.match(new RegExp('<iframe[^>]*id="'+id+'"[^>]*>'))[0];
    assert.ok(frame.includes('allow="fullscreen"')&&frame.includes('allowfullscreen'));
}
console.log('PASS: fullscreen control and permissions on both Full/10K iframes');

const resizeSource=fs.readFileSync('app.js','utf8').split('\n').find(line=>line.startsWith('function resizeCourseMap('));
const resizingFrame={classList:{contains:()=>false},contentDocument:{fullscreenElement:{},body:{scrollHeight:2000},documentElement:{scrollHeight:2000}},style:{height:'568px'}};
const resizeContext=vm.createContext({$:()=>resizingFrame});
vm.runInContext(resizeSource+';resizeCourseMap()',resizeContext);
assert.equal(resizingFrame.style.height,'568px');
resizingFrame.contentDocument.fullscreenElement=null;
vm.runInContext('resizeCourseMap()',resizeContext);
assert.equal(resizingFrame.style.height,'2000px');
console.log('PASS: iframe resizing pauses during fullscreen and resumes afterward');

vm.runInContext('mapInstance.loadCallback()',context);
const beforeResize=vm.runInContext('mapInstance.fitCount',context);
resizeObservers.at(-1).callback();
assert.equal(vm.runInContext('mapInstance.fitCount',context),beforeResize+1);
assert.ok(vm.runInContext('mapInstance.bounds.points.length>2',context));
console.log('PASS: map size changes refit the complete course, including fullscreen entry/exit');

assert.equal(vm.runInContext('mapInstance.controls[1].control.options.pseudo',context),true);

assert.equal(attribution.open,false);
assert.ok(attribution.classes.has('maplibregl-compact'));
assert.ok(!attribution.classes.has('maplibregl-compact-show'));
console.log('PASS: attribution starts collapsed without removing source credits');

// Every event/course combination must resolve to an existing local GPX.
const courseFrames = Object.fromEntries(['courseMapFrame', 'courseMapFrame10k', 'courseMap10k'].map(id => [id, {getAttribute(){return this.src;}}]));
let courseEvent;
let courseRecords;
const courseContext = vm.createContext({
    selected: () => ({id: courseEvent}), state: {bibs: ['full', '10k']},
    cache: () => courseRecords, $: id => courseFrames[id], encodeURIComponent,
});
vm.runInContext(fs.readFileSync('app.js', 'utf8').split('\n').find(line => line.startsWith('function renderCourseMaps()')), courseContext);
for (const event of ['myresult-176', 'myresult-177']) {
    courseEvent = event;
    courseRecords = {[`${event}:full`]: {course: 'FULL'}, [`${event}:10k`]: {course: '10K'}};
    for (const bibs of [['full'], ['10k'], ['full', '10k']]) {
        courseContext.state.bibs = bibs;
        vm.runInContext('renderCourseMaps()', courseContext);
        assert.equal(courseFrames.courseMap10k.hidden, bibs.length !== 2);
        for (const id of bibs.length === 2 ? ['courseMapFrame', 'courseMapFrame10k'] : ['courseMapFrame']) {
            const path = new URLSearchParams(courseFrames[id].src.split('?')[1]).get('url');
            assert.ok(fs.existsSync(path), path);
            assert.ok(path.endsWith(id === 'courseMapFrame10k' || bibs[0] === '10k' ? '_10k.gpx' : '_full.gpx'));
        }
    }
}
console.log('PASS: both events resolve Full, 10K, and mixed maps to existing updated GPX files');

context.Date = {now: () => Date.parse('2026-10-31T08:36:00+09:00')};
vm.runInContext(`
    showRunners([{bib:'new',name:'테스트',date:'2026-10-31',course:'FULL',segments:[
        {point:'출발',elapsed:'00:00:00',timeOfDay:'08:00:00'},
        {point:'5K',elapsed:'00:30:00',timeOfDay:'08:30:00'}]}]);
`, context);
assert.ok(runnerStatus.textContent.includes('평균 6:00/km'));
assert.ok(runnerStatus.textContent.includes('최근 구간 6:00/km'));
assert.ok(runnerStatus.textContent.includes('추정 위치'));
vm.runInContext("showRunners([{bib:'missing',date:'2026-10-31',segments:[]}])",context);
assert.equal(vm.runInContext('runnerMarkers.length',context),0);
assert.ok(runnerStatus.textContent.includes('통과 기록 부족'));
console.log('PASS: real prediction drives runner pace/status; unknown checkpoint does not invent a pin');
