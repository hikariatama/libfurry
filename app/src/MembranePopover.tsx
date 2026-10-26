import { animate, motion, useIsPresent, useMotionValue, useMotionValueEvent, useReducedMotion } from 'framer-motion';
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';

type Props = {
  children: ReactNode;
  className: string;
  label: string;
  labelledBy?: string;
  panelRef?: Ref<HTMLDivElement>;
};

export function MembranePopover({ children, className, label, labelledBy, panelRef }: Props) {
  const filterId = `membrane-${useId().replace(/:/g, '')}`;
  const isPresent = useIsPresent();
  const reducedMotion = useReducedMotion();
  const displacement = useMotionValue(40);
  const map = useRef<SVGFEDisplacementMapElement>(null);
  const [deforming, setDeforming] = useState(!reducedMotion);

  useMotionValueEvent(displacement, 'change', value => map.current?.setAttribute('scale', String(value)));

  useEffect(() => {
    if (reducedMotion) return;
    if (isPresent) {
      setDeforming(true);
      displacement.set(40);
      const animation = animate(displacement, [40, 18, 24, 7, 0], {
        duration: .38, times: [0, .36, .58, .81, 1], ease: 'easeOut',
      });
      void animation.then(() => { if (isPresent) setDeforming(false); });
      return () => animation.stop();
    }
    setDeforming(true);
    displacement.set(0);
    const animation = animate(displacement, [0, 10, 22], { duration: .24, times: [0, .35, 1], ease: 'easeIn' });
    return () => animation.stop();
  }, [displacement, isPresent, reducedMotion]);

  return <motion.div ref={panelRef} className={`membrane-popover ${className}`} role="dialog" aria-modal="false"
    aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy}
    initial={reducedMotion ? { opacity: 0, scale: .98 } : { opacity: 0, scale: .86 }}
    animate={{ opacity: 1, scale: 1 }} exit={reducedMotion ? { opacity: 0, scale: .98 } : { opacity: 0, scale: .88 }}
    transition={reducedMotion ? { duration: .12 } : isPresent
      ? { type: 'spring', duration: .34, bounce: .22 }
      : { duration: .24, ease: 'easeIn' }}>
    <svg className="membrane-filter-defs" aria-hidden="true"><filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
      <feTurbulence type="fractalNoise" baseFrequency="0.004 0.007" numOctaves="1" seed="2" result="noise" />
      <feDisplacementMap ref={map} in="SourceGraphic" in2="noise" scale="40" xChannelSelector="R" yChannelSelector="G" />
    </filter></svg>
    <div className="membrane-skin glass" style={deforming ? { filter: `url(#${filterId})` } : undefined} />
    <div className="membrane-content">{children}</div>
  </motion.div>;
}
