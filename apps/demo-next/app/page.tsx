import { PlayerDemo } from './PlayerDemo';

// Bu dosya bilerek bir Server Component (üstünde 'use client' YOK) — asıl
// test ettiğimiz şey tam olarak bu: <PlayerDemo> client component'i
// (içinde @hopeplayer/react kullanıyor) App Router'ın normal sunucu
// render zincirinden geçerken hiçbir şey çökmüyor, çünkü @hopeplayer/core
// yalnızca client-side bir useEffect içinde dinamik import() ediliyor
// (bkz. packages/react/src/HopePlayer.tsx).
export default function Page() {
    return (
        <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 16px' }}>
            <h1 style={{ fontSize: 28, marginBottom: 4 }}>HopeCorePlayer × Next.js</h1>
            <p style={{ color: '#a3a3a3', marginTop: 0 }}>
                <code>@hopeplayer/react</code> ile App Router üzerinde gerçek kullanım örneği (Faz 8).
            </p>
            <PlayerDemo />
        </main>
    );
}
