export default function HomePage() {
  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '1rem',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1
        style={{
          fontSize: 'clamp(1.5rem, 4vw, 2.5rem)',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: 'var(--color-text)',
        }}
      >
        AI Workforce OS — Foundation Ready
      </h1>
      <p
        style={{
          fontSize: '0.95rem',
          color: '#888',
          fontFamily: 'var(--font-mono)',
        }}
      >
        v0.0.1 · MVP Core Setup Complete
      </p>
    </main>
  )
}
