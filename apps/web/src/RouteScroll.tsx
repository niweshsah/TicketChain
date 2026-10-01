import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/** New pages start at the top; Back/Forward keep browser scroll restoration. */
export function RouteScroll() {
  const { pathname } = useLocation();
  const navigation = useNavigationType();
  const previous = useRef(pathname);
  useLayoutEffect(() => {
    if (previous.current !== pathname && navigation !== 'POP')
      window.scrollTo({ top: 0, behavior: 'instant' });
    previous.current = pathname;
  }, [pathname, navigation]);
  return null;
}
