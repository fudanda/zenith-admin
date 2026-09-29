import { useId, type ReactNode } from 'react';
import './styles.css';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="zenith-page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div><div>{actions}</div></div>;
}

export function ZenithMark() {
  const id = useId().replaceAll(':','');
  const faces = [
    { key:'top', d:'M14 7 L56 7 L33.9 19 L14 19Z', from:'color-mix(in srgb, var(--semi-color-primary) 52%, #fff)', to:'color-mix(in srgb, var(--semi-color-primary) 70%, #fff)' },
    { key:'band', d:'M56 7 L33.9 19 L6.84 57 L32.62 43Z', from:'color-mix(in srgb, var(--semi-color-primary) 92%, #000)', to:'color-mix(in srgb, var(--semi-color-primary) 88%, #fff)' },
    { key:'base', d:'M32.62 43 L58 43 L58 57 L6.84 57Z', from:'color-mix(in srgb, var(--semi-color-primary) 80%, #000)', to:'color-mix(in srgb, var(--semi-color-primary) 66%, #000)' },
  ];
  return <svg className="zenith-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true"><defs>{faces.map(face=><linearGradient key={face.key} id={`${id}-${face.key}`} x1="0" y1="0" x2={face.key==='band'?'0':'1'} y2={face.key==='band'?'1':'0'}><stop offset="0" stopColor={face.from}/><stop offset="1" stopColor={face.to}/></linearGradient>)}</defs>{faces.map(face=><path key={face.key} d={face.d} fill={`url(#${id}-${face.key})`} stroke={`url(#${id}-${face.key})`} strokeWidth="2.5" strokeLinejoin="round"/>)}</svg>;
}
