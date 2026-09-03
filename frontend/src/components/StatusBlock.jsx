import { panelStyle } from '../styles.js';

export default function StatusBlock({ title, data, error }) {
  return (
    <div style={panelStyle}>
      <h3>{title}</h3>
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
      {data ? <pre>{JSON.stringify(data, null, 2)}</pre> : <p>Not checked yet.</p>}
    </div>
  );
}
