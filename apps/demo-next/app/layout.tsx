import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'HopeCorePlayer — Next.js demo',
    description: 'Faz 8: @hopeplayer/react gerçek kullanım örneği (App Router, SSR-safe).',
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="tr">
            <body
                style={{
                    margin: 0,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    background: '#0a0a0a',
                    color: '#fff',
                }}
            >
                {children}
            </body>
        </html>
    );
}
