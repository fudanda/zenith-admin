import type { CSSProperties } from 'react';
import { clamp } from '@arcbase/shared/core';
import './bars.css';

export type MetricMeterTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

/** 有上下界的资源、配额或健康度度量；使用 ARIA meter 语义，不表示任务进度。 */
export interface MetricMeterProps {
  value: number;
  label: string;
  min?: number;
  max?: number;
  valueText?: string;
  tone?: MetricMeterTone;
  stroke?: string;
  track?: string;
  height?: number;
  radius?: CSSProperties['borderRadius'];
  className?: string;
  style?: CSSProperties;
}

export function MetricMeter({
  value,
  label,
  min = 0,
  max = 100,
  valueText,
  tone = 'primary',
  stroke,
  track,
  height = 8,
  radius,
  className,
  style,
}: Readonly<MetricMeterProps>) {
  const upper = max > min ? max : min + 1;
  const boundedValue = clamp(value, min, upper);
  const scale = (boundedValue - min) / (upper - min);
  const classes = ['zx-meter', `zx-meter--${tone}`, className].filter(Boolean).join(' ');
  const meterStyle = {
    '--zx-bar-height': `${height}px`,
    '--zx-bar-scale': scale,
    ...(stroke ? { '--zx-bar-stroke': stroke } : {}),
    ...(track ? { '--zx-bar-track': track } : {}),
    ...(radius !== undefined ? { '--zx-bar-radius': typeof radius === 'number' ? `${radius}px` : radius } : {}),
    ...style,
  } as CSSProperties;

  return (
    <div
      className={classes}
      style={meterStyle}
      role="meter"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={upper}
      aria-valuenow={boundedValue}
      aria-valuetext={valueText}
    >
      <span className="zx-meter__fill" />
    </div>
  );
}

export default MetricMeter;
