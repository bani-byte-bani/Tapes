export default function StarRating({ value = 0, onChange, readOnly = false }) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <div className="stars">
      {stars.map((n) => (
        <button
          key={n}
          type="button"
          className={`star-btn ${n <= value ? 'filled' : ''}`}
          disabled={readOnly}
          onClick={() => onChange && onChange(n === value ? 0 : n)}
          aria-label={`${n}つ星`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
