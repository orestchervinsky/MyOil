import type { JSX } from 'react'
import type { BuildingKey } from './App'

// Simple stylized isometric-friendly SVG illustrations for each building type.
// Not photoreal — hand-drawn shapes with a couple of shading tones so they
// read as "a thing" at small size rather than a single-color glyph.

export function OilFieldArt(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" width="52" height="52">
      <ellipse cx="32" cy="56" rx="22" ry="5" fill="#000" opacity="0.25" />
      <rect x="29" y="30" width="6" height="24" fill="#2b2620" />
      <polygon points="18,54 46,54 38,20 26,20" fill="none" stroke="#3a342b" strokeWidth="2" />
      <line x1="20" y1="54" x2="32" y2="18" stroke="#3a342b" strokeWidth="2" />
      <line x1="44" y1="54" x2="32" y2="18" stroke="#3a342b" strokeWidth="2" />
      <rect x="10" y="16" width="26" height="5" rx="2" fill="#8a2f2f" transform="rotate(-8 23 18)" />
      <circle cx="11" cy="17" r="4" fill="#8a2f2f" />
      <rect x="9" y="16" width="6" height="16" fill="#443c30" />
      <circle cx="12" cy="34" r="3" fill="#171310" />
    </svg>
  )
}

export function RefineryArt(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" width="52" height="52">
      <ellipse cx="32" cy="56" rx="24" ry="5" fill="#000" opacity="0.25" />
      <rect x="10" y="28" width="14" height="26" rx="2" fill="#8b8f96" />
      <ellipse cx="17" cy="28" rx="7" ry="3" fill="#a7abb2" />
      <rect x="27" y="20" width="14" height="34" rx="2" fill="#9a9ea5" />
      <ellipse cx="34" cy="20" rx="7" ry="3" fill="#b6bac1" />
      <rect x="13" y="34" width="2" height="6" fill="#6a6d73" />
      <rect x="30" y="26" width="2" height="6" fill="#6a6d73" />
      <rect x="45" y="10" width="4" height="44" fill="#6f737a" />
      <polygon points="43,10 51,10 47,4" fill="#e0a840" />
      <rect x="18" y="46" width="10" height="3" fill="#8a2f2f" />
      <rect x="45" y="2" width="4" height="4" fill="#ff8c3a" opacity="0.9" />
    </svg>
  )
}

export function TransportArt(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" width="52" height="52">
      <ellipse cx="32" cy="54" rx="24" ry="5" fill="#000" opacity="0.25" />
      <rect x="8" y="30" width="14" height="14" rx="2" fill="#e6dcc8" />
      <rect x="10" y="20" width="10" height="12" rx="2" fill="#d8cdb5" />
      <rect x="12" y="22" width="6" height="5" fill="#7fa8c9" />
      <rect x="20" y="26" width="30" height="18" rx="6" fill="#c9ccd1" />
      <rect x="20" y="32" width="30" height="4" fill="#e0a840" />
      <circle cx="18" cy="46" r="5" fill="#1d1a16" />
      <circle cx="18" cy="46" r="2" fill="#565048" />
      <circle cx="42" cy="46" r="5" fill="#1d1a16" />
      <circle cx="42" cy="46" r="2" fill="#565048" />
    </svg>
  )
}

export function WarehouseArt(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" width="52" height="52">
      <ellipse cx="32" cy="56" rx="24" ry="5" fill="#000" opacity="0.25" />
      <polygon points="12,28 32,14 52,28 52,52 12,52" fill="#7a5a3a" />
      <polygon points="12,28 32,14 52,28 46,28 32,18 18,28" fill="#5c4128" />
      <rect x="27" y="36" width="10" height="16" fill="#3a2b1a" />
      <circle cx="18" cy="46" r="5" fill="#4a3a26" stroke="#2a1f12" strokeWidth="1" />
      <circle cx="26" cy="48" r="5" fill="#54432c" stroke="#2a1f12" strokeWidth="1" />
      <circle cx="44" cy="46" r="5" fill="#4a3a26" stroke="#2a1f12" strokeWidth="1" />
    </svg>
  )
}

export function BankArt(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" width="52" height="52">
      <ellipse cx="32" cy="56" rx="24" ry="5" fill="#000" opacity="0.25" />
      <polygon points="14,26 32,12 50,26" fill="#e8dcb8" />
      <rect x="12" y="26" width="40" height="4" fill="#cbb984" />
      <rect x="15" y="30" width="5" height="20" fill="#f2e8c9" />
      <rect x="24" y="30" width="5" height="20" fill="#f2e8c9" />
      <rect x="35" y="30" width="5" height="20" fill="#f2e8c9" />
      <rect x="44" y="30" width="5" height="20" fill="#f2e8c9" />
      <rect x="12" y="50" width="40" height="4" fill="#cbb984" />
      <rect x="22" y="50" width="20" height="4" fill="#8a6f2f" />
      <circle cx="32" cy="19" r="3.5" fill="#e0a840" />
    </svg>
  )
}

export function PartsFactoryArt(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" width="52" height="52">
      <ellipse cx="32" cy="56" rx="24" ry="5" fill="#000" opacity="0.25" />
      <rect x="12" y="30" width="40" height="24" fill="#6b6259" />
      <polygon points="12,30 20,22 28,30" fill="#4f483f" />
      <polygon points="28,30 36,22 44,30" fill="#4f483f" />
      <polygon points="44,30 52,22 52,30" fill="#4f483f" />
      <rect x="42" y="8" width="6" height="24" fill="#807668" />
      <rect x="18" y="38" width="8" height="8" fill="#2c2822" />
      <rect x="32" y="38" width="8" height="8" fill="#2c2822" />
      <circle cx="32" cy="46" r="0" />
      <g transform="translate(24 44)" fill="#e0a840">
        <circle r="7" fill="none" stroke="#e0a840" strokeWidth="3" />
        <circle r="2.5" fill="#e0a840" />
      </g>
    </svg>
  )
}

export function buildingArt(key: BuildingKey): JSX.Element {
  switch (key) {
    case 'field':
      return <OilFieldArt />
    case 'refinery':
      return <RefineryArt />
    case 'transport':
      return <TransportArt />
    case 'warehouse':
      return <WarehouseArt />
    case 'bank':
      return <BankArt />
    case 'partsFactory':
      return <PartsFactoryArt />
  }
}
