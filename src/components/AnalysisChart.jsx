import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend);

/**
 * Renders a time-series analysis chart (e.g. threat activity over time,
 * temperature/precipitation trends) using Chart.js.
 */
export default function AnalysisChart({ labels = [], datasets = [], title = 'Analysis' }) {
  const data = {
    labels,
    datasets: datasets.map((dataset) => ({
      borderWidth: 2,
      tension: 0.3,
      ...dataset,
    })),
  };

  const options = {
    responsive: true,
    plugins: {
      legend: { position: 'top' },
      title: { display: Boolean(title), text: title },
    },
  };

  return (
    <div className="analysis-chart">
      <Line data={data} options={options} />
    </div>
  );
}
