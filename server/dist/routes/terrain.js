import { Router } from 'express';
import { computeLineOfSight, computeSlopeAspect, destinationPoint, haversineDistance, interpolatePoints, sampleGrid, } from '../utils/geo.js';
import { fetchElevations } from '../utils/elevation.js';
const router = Router();
function parseBbox(query) {
    const north = parseFloat(String(query.north));
    const south = parseFloat(String(query.south));
    const east = parseFloat(String(query.east));
    const west = parseFloat(String(query.west));
    if ([north, south, east, west].some((v) => Number.isNaN(v)))
        return null;
    return { north, south, east, west };
}
/**
 * GET /api/terrain/elevation?points=lat,lon;lat,lon;...
 * Batch elevation lookup for arbitrary points (SRTM/Copernicus DEM via Open-Meteo).
 */
router.get('/elevation', async (req, res) => {
    try {
        const raw = String(req.query.points || '');
        const points = raw
            .split(';')
            .filter(Boolean)
            .map((pair) => {
            const [lat, lon] = pair.split(',').map(Number);
            return { lat, lon };
        });
        if (!points.length) {
            return res.status(400).json({ error: 'No points provided' });
        }
        const elevations = await fetchElevations(points);
        res.json({ points: elevations });
    }
    catch (error) {
        console.error('Elevation lookup failed:', error);
        res.status(500).json({ error: 'Failed to fetch elevation data' });
    }
});
/**
 * Identify spot heights (local maxima) within a bounding box by sampling a
 * regular elevation grid and finding points that are higher than all of
 * their immediate neighbours.
 */
async function findSpotHeights(bbox, resolution = 12) {
    const gridPoints = sampleGrid(bbox, resolution);
    const res = Math.max(2, Math.min(resolution, 40));
    const elevations = await fetchElevations(gridPoints);
    const grid = [];
    for (let i = 0; i < res; i++) {
        grid.push(elevations.slice(i * res, (i + 1) * res).map((p) => p.elevation));
    }
    const spotHeights = [];
    for (let i = 0; i < res; i++) {
        for (let j = 0; j < res; j++) {
            const value = grid[i][j];
            let isMax = true;
            let minNeighbor = Infinity;
            for (let di = -1; di <= 1; di++) {
                for (let dj = -1; dj <= 1; dj++) {
                    if (di === 0 && dj === 0)
                        continue;
                    const ni = i + di;
                    const nj = j + dj;
                    if (ni < 0 || nj < 0 || ni >= res || nj >= res)
                        continue;
                    const neighborValue = grid[ni][nj];
                    if (neighborValue > value)
                        isMax = false;
                    minNeighbor = Math.min(minNeighbor, neighborValue);
                }
            }
            if (isMax && Number.isFinite(minNeighbor)) {
                const point = elevations[i * res + j];
                spotHeights.push({
                    lat: point.lat,
                    lon: point.lon,
                    elevation: value,
                    prominence: Math.max(0, value - minNeighbor),
                });
            }
        }
    }
    // Sort highest first and keep the most significant peaks (avoid noisy flat-terrain duplicates)
    return spotHeights
        .sort((a, b) => b.elevation - a.elevation)
        .filter((s) => s.prominence > 0)
        .slice(0, 25);
}
/**
 * GET /api/terrain/spot-heights?north=&south=&east=&west=&resolution=
 */
router.get('/spot-heights', async (req, res) => {
    try {
        const bbox = parseBbox(req.query);
        if (!bbox)
            return res.status(400).json({ error: 'Invalid bounding box' });
        const resolution = parseInt(String(req.query.resolution || '12'), 10);
        const spotHeights = await findSpotHeights(bbox, resolution);
        res.json({ spotHeights });
    }
    catch (error) {
        console.error('Spot height analysis failed:', error);
        res.status(500).json({ error: 'Failed to analyze spot heights' });
    }
});
/**
 * POST /api/terrain/los
 * Body: { from: {lat, lon}, to: {lat, lon}, observerHeight?, targetHeight? }
 * Samples the elevation profile between two positions and determines whether
 * line-of-sight exists, accounting for earth curvature and refraction.
 */
router.post('/los', async (req, res) => {
    try {
        const { from, to, observerHeight, targetHeight } = req.body;
        if (!from || !to) {
            return res.status(400).json({ error: 'from and to positions are required' });
        }
        const distance = haversineDistance(from, to);
        const steps = Math.min(100, Math.max(10, Math.round(distance / 50)));
        const samplePoints = interpolatePoints(from, to, steps);
        const elevationProfile = await fetchElevations(samplePoints);
        const result = computeLineOfSight(elevationProfile, observerHeight ?? 2, targetHeight ?? 2);
        res.json({
            distance,
            visible: result.visible,
            obstructedAt: result.obstructedAt,
            profile: result.profile,
        });
    }
    catch (error) {
        console.error('LOS analysis failed:', error);
        res.status(500).json({ error: 'Failed to compute line of sight' });
    }
});
/**
 * POST /api/terrain/viewshed
 * Body: { origin: {lat, lon}, radius (m), rays?, observerHeight?, targetHeight? }
 * Simplified 360-degree viewshed: casts rays outward from the origin at
 * regular bearing increments and reports the maximum visible distance and
 * any obstructed sectors along each ray.
 */
router.post('/viewshed', async (req, res) => {
    try {
        const { origin, radius = 5000, rays = 24, observerHeight = 2, targetHeight = 2, } = req.body;
        if (!origin)
            return res.status(400).json({ error: 'origin is required' });
        const numRays = Math.min(72, Math.max(8, rays));
        const sectors = [];
        for (let r = 0; r < numRays; r++) {
            const bearingDeg = (360 / numRays) * r;
            const endPoint = destinationPoint(origin, bearingDeg, radius);
            const steps = 15;
            const samplePoints = interpolatePoints(origin, endPoint, steps);
            const elevationProfile = await fetchElevations(samplePoints);
            const los = computeLineOfSight(elevationProfile, observerHeight, targetHeight);
            let visibleDistance = radius;
            if (!los.visible && los.obstructedAt) {
                visibleDistance = haversineDistance(origin, los.obstructedAt);
            }
            sectors.push({
                bearing: bearingDeg,
                endPoint,
                visible: los.visible,
                visibleDistanceM: visibleDistance,
            });
        }
        const visibleAreaPct = (sectors.filter((s) => s.visible).length / sectors.length) * 100;
        res.json({ origin, radius, sectors, visibleAreaPct });
    }
    catch (error) {
        console.error('Viewshed analysis failed:', error);
        res.status(500).json({ error: 'Failed to compute viewshed' });
    }
});
/**
 * POST /api/terrain/slope
 * Body: { point: {lat, lon}, cellSize? } - samples a 3x3 elevation window
 * around the point to compute slope (degrees) and aspect.
 */
router.post('/slope', async (req, res) => {
    try {
        const { point, cellSize = 30 } = req.body;
        if (!point)
            return res.status(400).json({ error: 'point is required' });
        const offsets = [-1, 0, 1];
        const samplePoints = [];
        for (const dLatCell of offsets) {
            for (const dLonCell of offsets) {
                const p = destinationPoint(destinationPoint(point, 0, dLatCell * cellSize), 90, dLonCell * cellSize);
                samplePoints.push(p);
            }
        }
        const elevations = await fetchElevations(samplePoints);
        const values = elevations.map((e) => e.elevation);
        const grid = [
            [values[0], values[1], values[2]],
            [values[3], values[4], values[5]],
            [values[6], values[7], values[8]],
        ];
        const { slopeDeg, aspectDeg } = computeSlopeAspect(grid, cellSize);
        let coverConcealment;
        if (slopeDeg > 25)
            coverConcealment = 'Steep slope: good cover, limited mobility';
        else if (slopeDeg > 10)
            coverConcealment = 'Moderate slope: partial cover available';
        else
            coverConcealment = 'Gentle/flat terrain: minimal natural cover';
        res.json({ point, elevation: values[4], slopeDeg, aspectDeg, coverConcealment });
    }
    catch (error) {
        console.error('Slope analysis failed:', error);
        res.status(500).json({ error: 'Failed to compute slope analysis' });
    }
});
/**
 * POST /api/terrain/report
 * Body: { bbox: {north, south, east, west}, resolution? }
 * Comprehensive automated terrain report: identifies all spot heights in the
 * operational area and computes inter-visibility between each of them, plus
 * slope/cover-concealment assessment at each spot height.
 */
router.post('/report', async (req, res) => {
    try {
        const { bbox, resolution = 10 } = req.body;
        if (!bbox)
            return res.status(400).json({ error: 'bbox is required' });
        const spotHeights = await findSpotHeights(bbox, resolution);
        const intervisibility = [];
        const maxPairs = 40; // cap work for large peak counts
        let pairCount = 0;
        for (let i = 0; i < spotHeights.length && pairCount < maxPairs; i++) {
            for (let j = i + 1; j < spotHeights.length && pairCount < maxPairs; j++) {
                const from = spotHeights[i];
                const to = spotHeights[j];
                const distance = haversineDistance(from, to);
                const samplePoints = interpolatePoints(from, to, Math.min(40, Math.max(6, Math.round(distance / 100))));
                const profile = await fetchElevations(samplePoints);
                const los = computeLineOfSight(profile, 2, 2);
                intervisibility.push({
                    from: { lat: from.lat, lon: from.lon },
                    to: { lat: to.lat, lon: to.lon },
                    visible: los.visible,
                    distanceM: distance,
                });
                pairCount++;
            }
        }
        const observationSummary = spotHeights.map((peak) => {
            const linkedPeaks = intervisibility.filter((link) => (link.from.lat === peak.lat && link.from.lon === peak.lon) ||
                (link.to.lat === peak.lat && link.to.lon === peak.lon));
            const visibleCount = linkedPeaks.filter((l) => l.visible).length;
            return {
                ...peak,
                observableSpotHeights: visibleCount,
                totalComparedSpotHeights: linkedPeaks.length,
            };
        });
        res.json({
            bbox,
            generatedAt: new Date().toISOString(),
            spotHeights: observationSummary,
            intervisibility,
            summary: `Identified ${spotHeights.length} key terrain features (spot heights) in the operational area. ` +
                `${observationSummary.filter((s) => s.observableSpotHeights > 0).length} of these have direct observation of at least one other spot height.`,
        });
    }
    catch (error) {
        console.error('Terrain report generation failed:', error);
        res.status(500).json({ error: 'Failed to generate terrain report' });
    }
});
export default router;
