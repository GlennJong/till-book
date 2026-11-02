import { useEffect, useReducer, useState } from 'react';
import { EMPTY_REGISTER, registerReducer, type RegisterState } from './cart';
import { getSetting, setSetting } from './db';

export const REGISTER_KEY = 'registerCarts';

// 收銀台的購物車（含掛起的單）存在本機：切換分頁、重新整理、更新版本都不會弄丟
export function useRegister() {
  const [state, dispatch] = useReducer(registerReducer, EMPTY_REGISTER);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSetting<RegisterState>(REGISTER_KEY)
      .then(saved => {
        if (!cancelled && saved) dispatch({ type: 'hydrate', state: saved });
      })
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loaded) setSetting(REGISTER_KEY, state);
  }, [loaded, state]);

  return [state, dispatch] as const;
}
