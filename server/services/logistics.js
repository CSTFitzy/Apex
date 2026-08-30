const EARTH_RADIUS_KM = 6371;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function calculateDistanceKm(origin, destination) {
  const latitudeDelta = toRadians(destination.latitude - origin.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(origin.latitude)) *
      Math.cos(toRadians(destination.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function optimizeRoute(origin, destination, waypoints = [], speedKmh = 40) {
  if (!Number.isFinite(speedKmh) || speedKmh <= 0) {
    throw new Error('speedKmh must be a positive number');
  }

  const unvisited = [...waypoints];
  const orderedWaypoints = [];
  let current = origin;
  let distanceKm = 0;

  while (unvisited.length > 0) {
    let closestIndex = 0;
    let closestDistance = calculateDistanceKm(current, unvisited[0]);
    for (let index = 1; index < unvisited.length; index += 1) {
      const distance = calculateDistanceKm(current, unvisited[index]);
      if (distance < closestDistance) {
        closestIndex = index;
        closestDistance = distance;
      }
    }
    const [next] = unvisited.splice(closestIndex, 1);
    distanceKm += closestDistance;
    orderedWaypoints.push(next);
    current = next;
  }

  distanceKm += calculateDistanceKm(current, destination);
  return {
    waypoints: orderedWaypoints,
    distanceKm: Number(distanceKm.toFixed(3)),
    estimatedDurationMinutes: Math.ceil((distanceKm / speedKmh) * 60),
  };
}

export function forecastConsumption(inventory, consumption, forecastDays = 7) {
  const totalConsumed = consumption.reduce((total, entry) => total + Number(entry.quantity), 0);
  const periodStart = consumption[0]?.consumed_at ? new Date(consumption[0].consumed_at) : null;
  const elapsedDays = periodStart
    ? Math.max((Date.now() - periodStart.getTime()) / 86400000, 1)
    : 0;
  const dailyConsumption = elapsedDays ? totalConsumed / elapsedDays : 0;
  const quantity = Number(inventory.quantity);
  const projectedQuantity = Math.max(0, quantity - dailyConsumption * forecastDays);

  return {
    inventoryId: inventory.id,
    resourceType: inventory.resource_type,
    dailyConsumption: Number(dailyConsumption.toFixed(3)),
    projectedQuantity: Number(projectedQuantity.toFixed(3)),
    daysUntilDepletion: dailyConsumption ? Number((quantity / dailyConsumption).toFixed(1)) : null,
    reorderRecommended: projectedQuantity <= Number(inventory.reorder_point),
  };
}
