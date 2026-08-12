import { useEffect, useState } from 'react';

/**
 * 共有済みSessionの自動反映(後勝ち)の状態表示。
 * 成功したときは数秒で自動的に消える。失敗したときは残して気づけるようにする。
 */
export default function SyncStatus({ state }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (state === 'idle') {
      setVisible(false);
      return;
    }
    setVisible(true);
    if (state !== 'done') return;
    const timer = window.setTimeout(() => setVisible(false), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (!visible) return null;

  const text = {
    syncing: '共有リンクに反映しています...',
    done: '共有リンクに反映しました',
    error: '共有リンクへの反映に失敗しました(この端末の変更は保存済みです)',
  }[state];

  return <p className={`sync-status is-${state}`}>{text}</p>;
}
