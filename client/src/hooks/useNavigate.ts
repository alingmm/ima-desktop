import { useCallback } from 'react';
import type { PageType } from '../App';

export function useNavigate() {
  const goTo = useCallback((page: PageType) => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: page }));
  }, []);

  return { goTo };
}
