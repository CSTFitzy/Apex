/**
 * Prometheus metrics for Grafana integration.
 *
 * Exposes live simulation/tactical KPIs as Prometheus gauges so an external
 * Prometheus server can scrape `GET /metrics` and Grafana can build
 * dashboards on top of it (see `grafana/` provisioning + docker-compose.yml).
 */
import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'sharknet_' });

const gauges = {
  unitsTotal: new client.Gauge({ name: 'sharknet_units_total', help: 'Total simulated units', registers: [register] }),
  friendlyActive: new client.Gauge({
    name: 'sharknet_friendly_units_active',
    help: 'Active friendly units',
    registers: [register],
  }),
  hostileActive: new client.Gauge({
    name: 'sharknet_hostile_units_active',
    help: 'Active hostile units',
    registers: [register],
  }),
  friendlyLosses: new client.Gauge({
    name: 'sharknet_friendly_losses_total',
    help: 'Friendly units lost',
    registers: [register],
  }),
  hostileLosses: new client.Gauge({
    name: 'sharknet_hostile_losses_total',
    help: 'Hostile units lost',
    registers: [register],
  }),
  killRatio: new client.Gauge({ name: 'sharknet_kill_ratio', help: 'Hostile:friendly loss ratio', registers: [register] }),
  engagementsTotal: new client.Gauge({
    name: 'sharknet_engagements_total',
    help: 'Total recorded engagements',
    registers: [register],
  }),
  operationalReadiness: new client.Gauge({
    name: 'sharknet_operational_readiness_percent',
    help: 'Percentage of friendly units still active',
    registers: [register],
  }),
};

/** Update Prometheus gauges from the latest computed KPI snapshot. */
export function updateMetricsFromKpis(kpis) {
  gauges.unitsTotal.set(kpis.unitsTotal);
  gauges.friendlyActive.set(kpis.friendlyActive);
  gauges.hostileActive.set(kpis.hostileActive);
  gauges.friendlyLosses.set(kpis.friendlyLosses);
  gauges.hostileLosses.set(kpis.hostileLosses);
  gauges.killRatio.set(kpis.killRatio);
  gauges.engagementsTotal.set(kpis.engagementsTotal);
  gauges.operationalReadiness.set(kpis.operationalReadiness);
}

export { register };
