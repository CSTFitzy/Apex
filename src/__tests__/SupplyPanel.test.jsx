import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import SupplyPanel from '../components/SupplyPanel.jsx';

const status = {
  overallStatus: 'critical',
  supplyTypes: ['ammunition', 'fuel', 'rations', 'medical'],
  aggregate: [
    {
      supplyType: 'fuel',
      unitOfMeasure: 'liters',
      quantity: 300,
      capacity: 1600,
      percentRemaining: 18.8,
      status: 'low',
      hoursToDepletion: 6,
    },
  ],
  units: [
    {
      unitId: 'A-1-1',
      name: 'Alpha 1',
      callsign: 'HAMMER',
      status: 'critical',
      hoursToFirstDepletion: 1.5,
      supplies: [
        {
          supplyType: 'fuel',
          unitOfMeasure: 'liters',
          quantity: 60,
          capacity: 800,
          percentRemaining: 7.5,
          status: 'critical',
          hoursToDepletion: 1.5,
        },
      ],
    },
  ],
  alerts: [
    {
      unitId: 'A-1-1',
      unitName: 'Alpha 1',
      supplyType: 'fuel',
      severity: 'critical',
      status: 'critical',
      percentRemaining: 7.5,
      hoursToDepletion: 1.5,
      message: 'Alpha 1 fuel at 7.5% - depletion in 1.5h',
    },
  ],
};

const forecast = {
  recommendations: [
    {
      unitId: 'A-1-1',
      unitName: 'Alpha 1',
      priority: 'immediate',
      hoursToFirstDepletion: 1.5,
      items: [{ supplyType: 'fuel', quantity: 740, unitOfMeasure: 'liters' }],
    },
  ],
};

const consumption = [
  {
    id: 1,
    supply_type: 'fuel',
    quantity: 40,
    occurred_at: new Date().toISOString(),
    unit_id: 'A-1-1',
    name: 'Alpha 1',
  },
];

describe('SupplyPanel', () => {
  it('renders aggregate levels, alerts, forecasts and the transfer form', () => {
    const markup = renderToStaticMarkup(
      <SupplyPanel status={status} forecast={forecast} consumption={consumption} />
    );

    expect(markup).toContain('Aggregate levels');
    expect(markup).toContain('supply-badge-critical');
    expect(markup).toContain('Alpha 1 fuel at 7.5%');
    expect(markup).toContain('Recommended resupply');
    expect(markup).toContain('740 liters fuel');
    expect(markup).toContain('Transfer supplies');
    // The depletion timeline renders each unit's earliest depletion estimate.
    expect(markup).toContain('supply-timeline-eta">1.5 h');
  });

  it('renders a loading state before data arrives', () => {
    const markup = renderToStaticMarkup(<SupplyPanel loading />);
    expect(markup).toContain('Loading supply status...');
  });

  it('surfaces load errors', () => {
    const markup = renderToStaticMarkup(<SupplyPanel error="Failed to load supply status" />);
    expect(markup).toContain('Failed to load supply status');
  });
});
