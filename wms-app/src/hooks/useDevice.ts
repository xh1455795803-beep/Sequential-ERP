import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT = 768;

export function useDevice() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.innerWidth < MOBILE_BREAKPOINT ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent)
    );
  });

  useEffect(() => {
    const onResize = () => {
      const mobile =
        window.innerWidth < MOBILE_BREAKPOINT ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
      setIsMobile(mobile);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return { isMobile };
}
