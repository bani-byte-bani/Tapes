import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * 「新規録音を追加」への入口。ただの+ボタンではなく、
 * テープをデッキに挿入する感覚のワンショットアニメーションにしてある。
 * タップ後、挿入アニメーションが終わってから /session/new へ遷移する。
 */
export default function TapeDeckButton() {
  const navigate = useNavigate();
  const [inserting, setInserting] = useState(false);

  function handleInsert() {
    if (inserting) return;
    setInserting(true);
    window.setTimeout(() => {
      navigate('/session/new');
    }, 620);
  }

  return (
    <button
      type="button"
      className={`tape-deck-btn ${inserting ? 'is-inserting' : ''}`}
      onClick={handleInsert}
      aria-label="新規録音を追加"
    >
      <svg className="tape-deck-svg" viewBox="0 0 160 116" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <ellipse cx="80" cy="98" rx="58" ry="8" fill="var(--color-ink)" opacity="0.14" />

        {/* デッキ本体 */}
        <rect x="8" y="52" width="144" height="46" rx="7" fill="var(--color-ink)" />
        <rect x="18" y="60" width="124" height="30" rx="4" fill="#171310" />
        <rect className="deck-slot" x="28" y="65" width="104" height="9" rx="4.5" fill="#040302" />
        <text x="80" y="86" textAnchor="middle" fontSize="6.5" fill="var(--color-accent-soft)" fontFamily="'Courier New', monospace" letterSpacing="2">
          INSERT
        </text>
        <circle cx="24" cy="75" r="2.6" fill="var(--color-accent)" className="deck-led" />

        {/* カセットテープ(挿入アニメーションの対象) */}
        <g className="tape-cassette">
          <rect x="30" y="4" width="100" height="58" rx="7" fill="var(--color-accent)" stroke="var(--color-ink)" strokeWidth="2.5" />
          <rect x="41" y="15" width="78" height="26" rx="3" fill="var(--color-surface)" opacity="0.92" />
          <circle cx="58" cy="28" r="9" fill="var(--color-ink)" />
          <circle cx="102" cy="28" r="9" fill="var(--color-ink)" />
          <circle cx="58" cy="28" r="3.2" fill="var(--color-accent-soft)" />
          <circle cx="102" cy="28" r="3.2" fill="var(--color-accent-soft)" />
          <rect x="46" y="47" width="68" height="7" rx="2.5" fill="var(--color-ink)" opacity="0.55" />
          <text x="80" y="24" textAnchor="middle" fontSize="6" fill="var(--color-ink-soft)" fontFamily="'Courier New', monospace" letterSpacing="1">
            NEW TAPE
          </text>
        </g>
      </svg>
      <span className="tape-deck-caption">タップして録音を追加</span>
    </button>
  );
}
