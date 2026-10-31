(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RunnerPrediction = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;
  const KPH = 1000;

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function number(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function haversine(a, b) {
    const lat1 = Number(a.lat), lon1 = Number(a.lon), lat2 = Number(b.lat), lon2 = Number(b.lon);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
    const r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
  }

  function elevation(point) {
    const value = number(point?.ele ?? point?.elevation ?? point?.altitude);
    return value;
  }

  function bearing(a, b) {
    const lat1 = Number(a.lat) * Math.PI / 180, lat2 = Number(b.lat) * Math.PI / 180;
    const dLon = (Number(b.lon) - Number(a.lon)) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function buildRoute(input, distanceFn) {
    const points = (Array.isArray(input) ? input : []).filter(point =>
      point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon))
    );
    const distance = typeof distanceFn === 'function' ? (a, b) => {
      try { return Math.max(0, Number(distanceFn(a.lat, a.lon, b.lat, b.lon)) || 0); } catch { return haversine(a, b); }
    } : haversine;
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) cumulative[i] = cumulative[i - 1] + distance(points[i - 1], points[i]);
    const totalMeters = cumulative[cumulative.length - 1] || 0;
    const hasElevation = points.some(point => elevation(point) !== null);

    function atDistance(target) {
      if (!points.length) return null;
      const d = clamp(target, 0, totalMeters);
      let low = 0, high = cumulative.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (cumulative[mid] < d) low = mid; else high = mid - 1;
      }
      const i = Math.min(points.length - 2, Math.max(0, low));
      const span = cumulative[i + 1] - cumulative[i];
      const fraction = span > 0 ? (d - cumulative[i]) / span : 0;
      const a = elevation(points[i]), b = elevation(points[i + 1]);
      return a === null || b === null ? null : a + (b - a) * fraction;
    }

    const segments = [];
    for (let i = 1; i < points.length; i++) {
      const start = cumulative[i - 1], end = cumulative[i], meters = end - start;
      if (meters <= 0) continue;
      const windowStart = Math.max(0, start - 50), windowEnd = Math.min(totalMeters, end + 50);
      const e0 = atDistance(windowStart), e1 = atDistance(windowEnd);
      const grade = hasElevation && e0 !== null && e1 !== null
        ? clamp((e1 - e0) / Math.max(1, windowEnd - windowStart), -0.25, 0.25) : 0;
      segments.push({ start, end, meters, grade, bearing: bearing(points[i - 1], points[i]), startPoint: points[i - 1], endPoint: points[i] });
    }
    return { points, segments, totalMeters, elevationApplied: hasElevation };
  }

  function parseDuration(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const text = String(value ?? '').trim();
    if (!text || text === '-') return null;
    const parts = text.split(':').map(Number);
    if (!parts.length || parts.some(part => !Number.isFinite(part) || part < 0) || parts.length > 3) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  function dateOnly(value) {
    const match = String(value ?? '').match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    return match ? `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}` : null;
  }

  function timeOfDay(value) {
    const match = String(value ?? '').match(/(?:T|\s)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return null;
    const h = Number(match[1]), m = Number(match[2]), s = Number(match[3] || 0);
    return h < 24 && m < 60 && s < 60 ? h * 3600 + m * 60 + s : null;
  }

  function checkpointDistance(label, totalMeters, courseMeters = totalMeters) {
    const text = String(label ?? '').trim().toLowerCase();
    if (!text) return null;
    if (/^(출발|시작|start|begin)/i.test(text)) return 0;
    if (/^(도착|골인|finish|finishing|end)/i.test(text)) return totalMeters > 0 ? totalMeters : null;
    if (/^(하프|half|half[- ]?marathon)/i.test(text)) return totalMeters > 0 ? (21097.5 / Math.max(1, courseMeters)) * totalMeters : null;
    const match = text.match(/(?:^|\D)(\d+(?:\.\d+)?)\s*(?:k|km|키로)(?:\D|$)/i);
    return match ? (Number(match[1]) * KPH / Math.max(1, courseMeters)) * totalMeters : null;
  }

  function localDayStart(date) {
    const day = dateOnly(date);
    if (!day) return null;
    const stamp = Date.parse(`${day}T00:00:00+09:00`);
    return Number.isFinite(stamp) ? stamp : null;
  }

  function officialCourseMeters(course, fallback) {
    const text = String(course ?? '').toLowerCase().replace(/\s/g, '');
    if (/10k|10km/.test(text)) return 10000;
    if (/half|하프/.test(text)) return 21097.5;
    if (/full|marathon|42k|42km|마라톤/.test(text)) return 42195;
    return fallback;
  }

  function isFinishLabel(label) { return /^(도착|골인|finish|finishing|end)/i.test(String(label ?? '').trim()); }

  function checkpointList(runner, route) {
    const total = route.totalMeters;
    const courseMeters = officialCourseMeters(runner?.course, total);
    const rows = [];
    for (const raw of Array.isArray(runner?.segments) ? runner.segments : []) {
      const distance = checkpointDistance(raw?.point, total, courseMeters), elapsed = parseDuration(raw?.elapsed);
      if (distance === null || elapsed === null || !Number.isFinite(distance) || distance > total + 1 || elapsed < 0) continue;
      const d = clamp(distance, 0, total), tod = timeOfDay(raw?.timeOfDay);
      rows.push({ raw, distance: d, elapsed, tod });
    }
    rows.sort((a, b) => a.elapsed - b.elapsed || a.distance - b.distance);
    const valid = [];
    for (const row of rows) {
      const previous = valid[valid.length - 1];
      if (previous && (row.elapsed <= previous.elapsed || row.distance < previous.distance)) continue;
      valid.push(row);
    }
    return valid;
  }

  function terrainFactor(grade) {
    const i = clamp(Number(grade) || 0, -0.25, 0.25);
    const cost = 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
    return clamp(cost / 3.6, 0.72, 2.7);
  }

  // shortcut: bounded weather penalties are a conservative heuristic, not a physiological model; replace with calibrated race data when available.
  function weatherFactor(weather, segmentBearing) {
    if (!weather || typeof weather !== 'object') return 1;
    let factor = 1;
    const temp = number(weather.temperature);
    if (temp !== null) factor += temp > 10 ? Math.min(0.24, (temp - 10) * 0.012) : clamp((5 - temp) * 0.006, 0, 0.06);
    const rain = number(weather.precipitation);
    if (rain !== null) factor += clamp(rain / 20, 0, 0.08);
    if (number(weather.weatherCode) !== null && Number(weather.weatherCode) >= 51) factor += 0.03;
    const wind = number(weather.windSpeed ?? weather.windSpeedMps);
    const direction = number(weather.windDirection);
    if (wind !== null && direction !== null && Number.isFinite(segmentBearing)) {
      const relative = (direction - segmentBearing) * Math.PI / 180;
      const headwind = wind * Math.cos(relative);
      factor += headwind >= 0 ? Math.min(0.18, headwind * 0.012) : Math.max(-0.05, headwind * 0.006);
    }
    return clamp(factor, 0.85, 1.5);
  }

  function hasWeather(weather) {
    return !!(weather && typeof weather === 'object' && [weather.temperature, weather.precipitation, weather.weatherCode, weather.windSpeed, weather.windSpeedMps, weather.windDirection].some(value => number(value) !== null));
  }

  function routeFactor(route, from, to, weatherAt, timeStart, timeEnd) {
    const length = Math.max(0, to - from);
    if (!length || !route.segments.length) return { factor: 1, weatherApplied: false, elevationApplied: !!route.elevationApplied };
    let weighted = 0, covered = 0, weatherApplied = false;
    for (const segment of route.segments) {
      const overlap = Math.max(0, Math.min(to, segment.end) - Math.max(from, segment.start));
      if (!overlap) continue;
      const midpoint = (Math.max(from, segment.start) + Math.min(to, segment.end)) / 2;
      const ratio = length ? (midpoint - from) / length : 0;
      const timestamp = timeStart + (timeEnd - timeStart) * ratio;
      let weather = null;
      try { weather = typeof weatherAt === 'function' ? weatherAt(timestamp) : null; } catch { weather = null; }
      if (hasWeather(weather)) weatherApplied = true;
      weighted += overlap * terrainFactor(segment.grade) * weatherFactor(weather, segment.bearing);
      covered += overlap;
    }
    return { factor: covered ? weighted / covered : 1, weatherApplied, elevationApplied: !!route.elevationApplied };
  }

  function predict(runner, routeInput, weatherAt, nowInput) {
    const route = routeInput && Array.isArray(routeInput.segments) ? routeInput : buildRoute(routeInput);
    const now = Number(nowInput ?? Date.now());
    const total = Number(route.totalMeters) || 0;
    const empty = { progress: 0, averagePace: null, segmentPace: null, state: 'unknown', weatherApplied: false, elevationApplied: !!route.elevationApplied, estimated: false };
    if (!runner || !total || !Number.isFinite(now)) return empty;
    const dayStart = localDayStart(runner.date);
    if (dayStart === null) return empty;
    const dayEnd = dayStart + DAY;
    const checkpoints = checkpointList(runner, route);
    if (!checkpoints.length) return empty;
    const withTimestamp = checkpoints.map(row => ({ ...row, timestamp: row.tod === null ? null : dayStart + row.tod * 1000 }));
    const observed = withTimestamp.filter(row => row.timestamp !== null && row.timestamp <= now);
    const latest = observed[observed.length - 1] || null;
    const firstTimestamp = withTimestamp.find(row => row.timestamp !== null)?.timestamp;
    const isSameDay = now >= dayStart && now < dayEnd;
    const finish = withTimestamp.find(row => isFinishLabel(row.raw.point) || row.distance >= total);
    const finishIsExplicit = !!(finish && finish.timestamp !== null && now >= finish.timestamp);
    const maxObserved = checkpoints[checkpoints.length - 1];
    const courseMeters = officialCourseMeters(runner.course, total);
    const officialDistance = distance => distance * courseMeters / Math.max(1, total);
    const paceReference = now < dayStart ? null : isSameDay && firstTimestamp !== undefined ? latest : maxObserved;
    const averagePace = paceReference && paceReference.distance > 0 ? paceReference.elapsed / (officialDistance(paceReference.distance) / KPH) : null;
    let previous = null;
    if (latest) {
      const index = withTimestamp.indexOf(latest);
      for (let i = index - 1; i >= 0; i--) {
        if (withTimestamp[i].distance < latest.distance && withTimestamp[i].elapsed < latest.elapsed) { previous = withTimestamp[i]; break; }
      }
    }
    const segmentPace = previous && latest && latest.distance > previous.distance
      ? (latest.elapsed - previous.elapsed) / (officialDistance(latest.distance - previous.distance) / KPH) : averagePace;
    const base = { averagePace, segmentPace, weatherApplied: false, elevationApplied: !!route.elevationApplied };
    if (finishIsExplicit || (finish && finish.timestamp === null && now >= dayStart)) return { ...base, progress: 1, state: 'finished', estimated: false };
    if (now >= dayStart && firstTimestamp === undefined) return { ...base, progress: maxObserved.distance / total, state: isSameDay ? 'checkpoint' : 'stale', estimated: false };
    if (now < dayStart || !isSameDay || !latest || (firstTimestamp !== null && now < firstTimestamp)) {
      const frozen = now >= dayEnd && maxObserved.distance > 0 ? maxObserved.distance / total : 0;
      return { ...base, progress: clamp(frozen, 0, 1), state: !isSameDay && frozen ? 'stale' : 'prerace', estimated: false };
    }
    if (latest.distance >= total) return { ...base, progress: 1, state: 'finished', estimated: false };
    if (now <= latest.timestamp) return { ...base, progress: latest.distance / total, state: 'checkpoint', estimated: false };

    // Live feeds can lag; do not project an old checkpoint indefinitely.
    if (now - latest.timestamp > 30 * 60 * 1000) {
      return { ...base, progress: clamp(latest.distance / total, 0, 1), state: 'stale', estimated: false };
    }

    const next = withTimestamp.find(row => row.timestamp !== null && row.timestamp > latest.timestamp && row.distance > latest.distance);
    const observedCondition = previous && latest
      ? routeFactor(route, previous.distance, latest.distance, weatherAt, previous.timestamp, latest.timestamp)
      : routeFactor(route, latest.distance, Math.min(total, latest.distance + 100), weatherAt, latest.timestamp, latest.timestamp + 1);
    const recent = segmentPace || averagePace;
    if (!recent || !Number.isFinite(recent)) return { ...base, progress: latest.distance / total, state: 'checkpoint', estimated: false };
    const blended = segmentPace && averagePace ? segmentPace * 0.7 + averagePace * 0.3 : recent;
    const neutralPace = blended / Math.max(0.1, observedCondition.factor);
    let distance = latest.distance, elapsed = 0, weatherApplied = observedCondition.weatherApplied;
    const limit = next ? Math.max(latest.distance, next.distance - 1) : Math.max(latest.distance, total - 1);
    const available = Math.max(0, (now - latest.timestamp) / 1000);
    for (const segment of route.segments) {
      if (segment.end <= distance || segment.start >= limit) continue;
      const start = Math.max(distance, segment.start), end = Math.min(limit, segment.end), meters = end - start;
      if (!meters) continue;
      let weather = null;
      try { weather = typeof weatherAt === 'function' ? weatherAt(latest.timestamp + (elapsed + Math.min(available - elapsed, neutralPace * terrainFactor(segment.grade) * officialDistance(meters) / KPH) / 2) * 1000) : null; } catch { weather = null; }
      if (hasWeather(weather)) weatherApplied = true;
      const factor = terrainFactor(segment.grade) * weatherFactor(weather, segment.bearing);
      const seconds = neutralPace * factor * (officialDistance(meters) / KPH);
      if (elapsed + seconds > available) { distance = start + (available - elapsed) / (neutralPace * factor) * KPH * total / courseMeters; break; }
      elapsed += seconds; distance = end;
    }
    const reached = distance >= limit;
    return { ...base, progress: clamp(distance / total, 0, 1), state: reached ? 'stale' : 'running', weatherApplied, estimated: true };
  }

  return { buildRoute, predict, parseDuration, checkpointDistance, terrainFactor, weatherFactor };
});
