'use client';

import React from 'react';
import { Bar, Radar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
} from 'chart.js';
import { BarWithErrorBarsController, BarWithErrorBar } from 'chartjs-chart-error-bars';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  BarWithErrorBarsController,
  BarWithErrorBar,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
);

interface SingleAbilityChartProps {
  criteria: string;
  score: number;
  confidenceInterval: { lower: number; upper: number };
}

export function SingleAbilityChart({ criteria, score, confidenceInterval }: SingleAbilityChartProps) {
  const chartData = {
    labels: [criteria],
    datasets: [
      {
        type: 'barWithErrorBars',
        label: '能力スコア',
        data: [{ y: score, yMin: confidenceInterval.lower, yMax: confidenceInterval.upper }],
        backgroundColor: 'rgba(54,162,235,0.55)',
        borderColor: 'rgba(54,162,235,1)',
        borderWidth: 1,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, title: { display: false } },
    scales: { x: { display: false }, y: { suggestedMin: 0 } },
  };
  return (
    <div style={{ width: '200px', height: '120px' }}>
      <Bar data={chartData} options={chartOptions} />
    </div>
  );
}

// ===== レーダーチャート（全基準まとめ表示） =====
interface RadarAbilityChartProps {
  scores: {
    criteria: string;
    score: number;
    confidenceInterval: { lower: number; upper: number };
    predictedMaxScore?: number;
  }[];
  maxScale?: number;
}

export function RadarAbilityChart({ scores, maxScale = 4 }: RadarAbilityChartProps) {
  const fullLabels = scores.map((s) => s.criteria);

  function wrapLabel(text: string, maxChars: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      if ((current + ' ' + w).trim().length <= maxChars) {
        current = (current ? current + ' ' : '') + w;
      } else {
        if (current) lines.push(current);
        if (w.length > maxChars) {
          // 長い連続語は強制分割
          for (let i = 0; i < w.length; i += maxChars) {
            lines.push(w.slice(i, i + maxChars));
          }
          current = '';
        } else {
          current = w;
        }
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  const radarData: any = {
    labels: fullLabels,
    datasets: [
      {
        label: '能力スコア',
        data: scores.map((s) => s.score),
        backgroundColor: 'rgba(34,197,94,0.25)',
        borderColor: 'rgba(34,197,94,1)',
        pointBackgroundColor: 'rgba(34,197,94,1)',
        borderWidth: 2,
      },
    ],
  };
  const radarOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: {
        enabled: true,
        callbacks: {
          title: (items: any[]) => {
            if (!items.length) return '';
            const idx = items[0].dataIndex;
            return fullLabels[idx];
          },
          label: (ctx: any) => `スコア: ${ctx.formattedValue}`,
        },
      },
    },
    scales: {
      r: {
        suggestedMin: 0,
        suggestedMax: maxScale,
        ticks: { stepSize: 1, backdropColor: 'transparent', showLabelBackdrop: false },
        grid: { color: 'rgba(0,0,0,0.1)' },
        angleLines: { color: 'rgba(0,0,0,0.15)' },
        pointLabels: {
          font: { size: 11, lineHeight: 1.05, weight: '600' },
          color: '#111',
          callback: (value: any, index: number) => wrapLabel(fullLabels[index] || '', 8),
        },
      },
    },
  };
  return (
    <div className="mx-auto" style={{ width: '100%', maxWidth: 760 }}>
      <div style={{ width: '100%', maxWidth: 700, height: 420 }} className="mx-auto">
        <Radar data={radarData} options={radarOptions} />
      </div>
    </div>
  );
}
