import { useEffect, useState } from 'react';
import { getNickname, setNickname } from '../repository/localRepository.js';

/**
 * コメントに表示する「あなたの表示名」の入力欄。
 * ログイン不要のため、この端末(ブラウザ)ごとにIndexedDBへ保存する。
 * 共有リンクを開いた相手の端末でも、その相手自身の表示名として独立して保存される。
 */
export default function NicknameField({ onChange }) {
  const [value, setValue] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const n = await getNickname();
      setValue(n);
      setReady(true);
      if (onChange) onChange(n);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleBlur() {
    const trimmed = value.trim();
    await setNickname(trimmed);
    if (onChange) onChange(trimmed);
  }

  if (!ready) return null;

  return (
    <div className="nickname-field">
      <span className="nickname-label">表示名</span>
      <input
        className="field"
        placeholder="コメントに表示する名前(例: たろう)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
      />
    </div>
  );
}
