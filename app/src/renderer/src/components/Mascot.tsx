import { faceRects, type Rect } from '../../../shared/mascot'
import bodyUrl from '../assets/garth-body.png'

const neutral = faceRects('neutral')
const smile = faceRects('smile').slice(2)
const rect = (r: Rect, i: number) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />

/** Garth stays still; only his face blinks and occasionally smiles. */
export function Mascot({ size = 96, alive = false, working = false }: { size?: number; alive?: boolean; working?: boolean }) {
  return (
    <svg data-testid="mascot" data-expression={working ? 'working' : 'neutral'} width={size} height={size} viewBox="0 0 60 60" shapeRendering="crispEdges" role="img" aria-label="Garth"
      className={`garth-mascot overflow-visible shrink-0 ${alive ? 'garth-alive' : ''} ${working ? 'garth-working' : ''}`}>
      <ellipse cx="30" cy="62" rx="16" ry="2" fill="currentColor" opacity="0.08" />
      <svg width="60" height="60" viewBox="158 155.5 937 937">
        <image href={bodyUrl} width="1254" height="1254" />
      </svg>
      <g className="garth-face">
        <g data-testid="mascot-eyes" className="garth-eyes">{neutral.slice(0, 2).map(rect)}</g>
        <g className="garth-neutral">{neutral.slice(2).map(rect)}</g>
        <g className="garth-smile">{smile.map(rect)}</g>
      </g>
    </svg>
  )
}
