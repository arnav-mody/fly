// map.jsx — route map components for the Mody-Gandhi Travel Tracker.
//
// Two flavors live here:
//   • <RouteMap> — the big hero map. Graticule + faint continent outlines +
//     great-circle arc + animated plane sprite. Used for airborne flights and
//     in the flight detail modal.
//   • <RouteRibbon> — a slim horizontal version for cards. Origin → arc →
//     destination with airport codes inline. No projection, just an SVG arc.

// ── projection helpers ──────────────────────────────────────────────────────
// Equirectangular projection — simple, good enough for a stylized chart.
// We center on the route's midpoint longitude so the arc reads cleanly
// regardless of whether it crosses the date line.
function projectFactory({ width, height, centerLon, lonSpan, latSpan, midLat }) {
  return (lat, lon) => {
    // Normalize longitude to [-180+centerLon, 180+centerLon] relative window
    let dl = lon - centerLon;
    while (dl > 180) dl -= 360;
    while (dl < -180) dl += 360;
    const x = width / 2 + (dl / lonSpan) * width;
    const y = height / 2 - ((lat - midLat) / latSpan) * height;
    return [x, y];
  };
}

// Great-circle interpolation between two lat/lon points.
// f ∈ [0,1] — 0 returns A, 1 returns B.
function greatCircle(lat1, lon1, lat2, lon2, f) {
  const toRad = Math.PI / 180, toDeg = 180 / Math.PI;
  const φ1 = lat1 * toRad, λ1 = lon1 * toRad;
  const φ2 = lat2 * toRad, λ2 = lon2 * toRad;
  const Δφ = φ2 - φ1, Δλ = λ2 - λ1;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const d = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (d === 0) return [lat1, lon1];
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
  const λ = Math.atan2(y, x);
  return [φ * toDeg, λ * toDeg];
}

// Build SVG path data for a great-circle route, sampled into N segments.
function arcPath(from, to, project, N = 80) {
  let d = "";
  for (let i = 0; i <= N; i++) {
    const [lat, lon] = greatCircle(from.lat, from.lon, to.lat, to.lon, i / N);
    const [x, y] = project(lat, lon);
    d += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1) + " ";
  }
  return d;
}

// Position + heading at fraction f along the route. Heading is in degrees
// clockwise from north — we convert to SVG rotation (east = 0deg, clockwise).
function pointAt(from, to, project, f) {
  const [lat, lon]  = greatCircle(from.lat, from.lon, to.lat, to.lon, f);
  const [lat2,lon2] = greatCircle(from.lat, from.lon, to.lat, to.lon, Math.min(1, f + 0.01));
  const [x, y]   = project(lat, lon);
  const [x2,y2]  = project(lat2, lon2);
  const heading = Math.atan2(y2 - y, x2 - x) * 180 / Math.PI;
  return { x, y, heading };
}

// ── continent outlines (hand-simplified, decorative only) ───────────────────
// Rough blocky outlines of the major landmasses so the chart feels grounded.
// These are NOT geographically accurate — just enough silhouette to read as
// "the world" behind the route arc.
const CONTINENTS = [
  // North America
  "M 60 70 L 90 55 L 130 50 L 175 60 L 215 75 L 240 95 L 250 120 L 235 145 L 215 170 L 190 185 L 165 195 L 145 200 L 125 195 L 105 180 L 85 155 L 70 125 L 55 95 Z",
  // South America
  "M 200 220 L 225 215 L 245 230 L 255 260 L 250 295 L 235 325 L 215 345 L 195 350 L 180 335 L 175 305 L 180 270 L 190 240 Z",
  // Europe
  "M 365 75 L 395 65 L 430 70 L 460 80 L 470 105 L 455 125 L 425 135 L 395 130 L 370 115 L 360 95 Z",
  // Africa
  "M 380 140 L 425 135 L 460 145 L 480 175 L 485 215 L 470 250 L 450 285 L 425 305 L 400 295 L 385 265 L 375 225 L 372 185 Z",
  // Asia (rough)
  "M 470 70 L 525 55 L 590 50 L 660 55 L 720 75 L 760 105 L 770 140 L 745 170 L 715 185 L 670 190 L 625 180 L 580 170 L 535 155 L 495 135 L 475 105 Z",
  // India (peninsula nudge)
  "M 605 155 L 635 160 L 645 195 L 625 215 L 610 200 L 600 180 Z",
  // Australia
  "M 700 250 L 740 245 L 780 255 L 790 280 L 775 305 L 740 315 L 710 305 L 695 280 Z",
  // SE Asia islands
  "M 670 230 L 700 225 L 720 240 L 700 250 L 680 248 Z",
];

// ── RouteMap ────────────────────────────────────────────────────────────────
// The hero map. Renders a graticule, decorative continents, the route arc,
// origin/destination pins, and a plane sprite that animates along the path
// based on `progress` (0..1).
function RouteMap({ from, to, progress = 0, status = "scheduled", compact = false, height }) {
  const W = 840, H = compact ? 260 : 380;
  const actualH = height ?? H;

  // Choose projection window from the two endpoints.
  // Use a midpoint that handles crossing-the-pole routes by going the short way.
  let lonDiff = to.lon - from.lon;
  if (lonDiff > 180) lonDiff -= 360;
  if (lonDiff < -180) lonDiff += 360;
  const midLon = from.lon + lonDiff / 2;
  const midLat = (from.lat + to.lat) / 2;

  // Always frame the whole world for context, but center on the route.
  const project = projectFactory({
    width: W, height: actualH,
    centerLon: midLon,
    lonSpan: 360,
    latSpan: 180,
    midLat: 0,
  });

  const arc = arcPath(from, to, project, 100);
  const [fx, fy] = project(from.lat, from.lon);
  const [tx, ty] = project(to.lat,   to.lon);

  // Animated plane: lerp progress over a couple seconds when it changes,
  // and add a subtle "alive" wobble for airborne flights.
  const [animProgress, setAnimProgress] = React.useState(0);
  React.useEffect(() => {
    let raf;
    const start = performance.now();
    const from0 = animProgress;
    const to0   = progress;
    const dur   = 1400;
    const tick = (t) => {
      const f = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - f, 3);
      setAnimProgress(from0 + (to0 - from0) * eased);
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const plane = status === "airborne" || (animProgress > 0 && animProgress < 1)
    ? pointAt(from, to, project, animProgress)
    : null;

  // Graticule (lat/lon grid lines) — pure decoration.
  const graticule = [];
  for (let lat = -60; lat <= 60; lat += 15) {
    const [, y1] = project(lat, midLon - 180);
    graticule.push(<line key={`la${lat}`} x1="0" y1={y1} x2={W} y2={y1} stroke="var(--paper-line)" strokeWidth="0.5" />);
  }
  for (let lon = -180; lon <= 180; lon += 30) {
    const [x1] = project(0, midLon + lon);
    graticule.push(<line key={`lo${lon}`} x1={x1} y1="0" x2={x1} y2={actualH} stroke="var(--paper-line)" strokeWidth="0.5" />);
  }

  return (
    <svg viewBox={`0 0 ${W} ${actualH}`} className="route-map" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="rmGrain" width="3" height="3" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="0.4" fill="var(--ink)" opacity="0.06" />
        </pattern>
        <linearGradient id="rmArcGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"  stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="50%" stopColor="var(--accent)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <rect width={W} height={actualH} fill="var(--paper-soft)" />
      <rect width={W} height={actualH} fill="url(#rmGrain)" />
      <g opacity="0.85">{graticule}</g>
      <g className="route-map__continents">
        {CONTINENTS.map((d, i) => (
          <path key={i} d={d} fill="var(--ink)" opacity="0.07" />
        ))}
      </g>
      {/* Route arc — dashed shadow + solid foreground */}
      <path d={arc} fill="none" stroke="var(--ink)" strokeOpacity="0.15" strokeWidth="2.5" strokeLinecap="round" />
      <path d={arc} fill="none" stroke="url(#rmArcGrad)" strokeWidth="2" strokeLinecap="round"
            strokeDasharray={status === "scheduled" || status === "boarding" ? "4 5" : "0"} />
      {/* Origin pin */}
      <g transform={`translate(${fx},${fy})`}>
        <circle r="9" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.5" />
        <circle r="3.5" fill="var(--ink)" />
      </g>
      {/* Destination pin */}
      <g transform={`translate(${tx},${ty})`}>
        <circle r="9" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.5" />
        <circle r="3.5" fill="var(--accent)" />
      </g>
      {/* Plane sprite */}
      {plane && (
        <g transform={`translate(${plane.x},${plane.y}) rotate(${plane.heading})`} className="route-map__plane">
          {/* Soft glow */}
          <circle r="14" fill="var(--sky)" opacity="0.18" />
          <circle r="8"  fill="var(--sky)" opacity="0.35" />
          {/* Plane icon — simple paper-airplane silhouette */}
          <path d="M -10 -3 L 10 0 L -10 3 L -6 0 Z" fill="var(--ink)" />
          <path d="M -6 0 L 10 0" stroke="var(--paper)" strokeWidth="0.5" />
        </g>
      )}
      {/* Airport code labels */}
      <text x={fx} y={fy - 14} textAnchor="middle" className="route-map__code">
        {from.code}
      </text>
      <text x={tx} y={ty - 14} textAnchor="middle" className="route-map__code">
        {to.code}
      </text>
    </svg>
  );
}

// ── RouteRibbon ─────────────────────────────────────────────────────────────
// Slim card-sized route diagram. Just an arc between two labeled dots.
function RouteRibbon({ from, to, progress = 0, status = "scheduled" }) {
  const W = 280, H = 60;
  const pad = 28;
  const fx = pad, fy = H / 2;
  const tx = W - pad, ty = H / 2;
  // Arc apex — peaks above the line for visual interest
  const apexY = 14;
  const apex  = `M ${fx} ${fy} Q ${W/2} ${apexY} ${tx} ${ty}`;

  // Plane position along the quadratic curve
  const t = Math.max(0, Math.min(1, progress));
  const planeOK = status === "airborne" && t > 0 && t < 1;
  // Quadratic bezier: B(t) = (1-t)^2 P0 + 2(1-t)t P1 + t^2 P2
  const px = (1-t)*(1-t)*fx + 2*(1-t)*t*(W/2) + t*t*tx;
  const py = (1-t)*(1-t)*fy + 2*(1-t)*t*apexY + t*t*ty;
  // Heading along curve derivative
  const dx = 2*(1-t)*((W/2)-fx) + 2*t*(tx-(W/2));
  const dy = 2*(1-t)*(apexY-fy) + 2*t*(ty-apexY);
  const heading = Math.atan2(dy, dx) * 180 / Math.PI;

  const dashed = status === "scheduled" || status === "boarding";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="route-ribbon" preserveAspectRatio="none">
      <path d={apex} fill="none" stroke="var(--ink)" strokeOpacity="0.18"
            strokeWidth="1.5" strokeDasharray={dashed ? "3 3" : "0"} />
      {status === "airborne" && (
        <path d={apex} fill="none" stroke="var(--accent)" strokeWidth="1.5"
              strokeDasharray={`${100 * t} 1000`} />
      )}
      {status === "landed" && (
        <path d={apex} fill="none" stroke="var(--sage)" strokeWidth="1.5" />
      )}
      {/* Origin & destination dots */}
      <circle cx={fx} cy={fy} r="4" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.2" />
      <circle cx={tx} cy={ty} r="4" fill={status === "landed" ? "var(--sage)" : "var(--accent)"} stroke="var(--ink)" strokeWidth="1.2" />
      {planeOK && (
        <g transform={`translate(${px},${py}) rotate(${heading})`}>
          <path d="M -6 -2 L 6 0 L -6 2 L -3 0 Z" fill="var(--ink)" />
        </g>
      )}
    </svg>
  );
}

// ── MultiRouteRibbon ────────────────────────────────────────────────────────
// Card-sized route diagram for a connecting-flight journey: origin, one dot
// per layover city, destination — all on one line. Each waypoint sits at the
// time-fraction of its layover's midpoint (not just evenly spaced), so a
// short layover reads as a quick touch and a long one visibly takes up more
// of the line, same idea as the plane's position on a live RouteRibbon.
function MultiRouteRibbon({ legs, status, now, height, showLabels = false }) {
  const W = 280, H = height ?? 60;
  const pad = 28;
  const first = legs[0], last = legs[legs.length - 1];
  const totalStart = first.depart.getTime(), totalEnd = last.arrive.getTime();
  const totalSpan = Math.max(1, totalEnd - totalStart);

  const points = [{ code: first.from, t: 0 }];
  for (let i = 0; i < legs.length - 1; i++) {
    const mid = (legs[i].arrive.getTime() + legs[i + 1].depart.getTime()) / 2;
    points.push({ code: legs[i].to, t: Math.max(0, Math.min(1, (mid - totalStart) / totalSpan)), waypoint: true });
  }
  points.push({ code: last.to, t: 1 });

  const x = (t) => pad + t * (W - pad * 2);
  const y = H / 2;
  const elapsed = now ? Math.max(0, Math.min(1, (now.getTime() - totalStart) / totalSpan)) : 0;
  const traveling = status === "airborne" || status === "layover";
  const dashed = status === "scheduled" || status === "boarding";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="route-ribbon route-ribbon--multi" preserveAspectRatio="none">
      <line x1={x(0)} y1={y} x2={x(1)} y2={y} stroke="var(--ink)" strokeOpacity="0.18"
            strokeWidth="1.5" strokeDasharray={dashed ? "3 3" : "0"} />
      {traveling && <line x1={x(0)} y1={y} x2={x(elapsed)} y2={y} stroke="var(--accent)" strokeWidth="1.5" />}
      {status === "landed" && <line x1={x(0)} y1={y} x2={x(1)} y2={y} stroke="var(--sage)" strokeWidth="1.5" />}
      {points.map((p, i) => {
        const isLast = i === points.length - 1;
        const fill = p.waypoint ? "var(--paper)" : (isLast ? (status === "landed" ? "var(--sage)" : "var(--accent)") : "var(--paper)");
        return (
          <g key={i}>
            <circle cx={x(p.t)} cy={y} r={p.waypoint ? 3 : 4}
                    fill={fill} stroke="var(--ink)" strokeWidth={p.waypoint ? 1 : 1.2} />
            {showLabels && (
              <text x={x(p.t)} y={y - 14} textAnchor="middle" className="route-map__code">{p.code}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

Object.assign(window, { RouteMap, RouteRibbon, MultiRouteRibbon });
