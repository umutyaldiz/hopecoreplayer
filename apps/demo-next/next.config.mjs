import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
    // @hopeplayer/core, kendi CSS'ini (?inline Tailwind) JS içine gömüyor —
    // bu demo'nun Next.js tarafında ekstra bir global CSS/webpack loader
    // ayarı gerekmiyor, sadece normal bir npm bağımlılığı gibi çalışıyor.
    //
    // Monorepo kökünde (videoJS/) ayrı bir package-lock.json daha var —
    // Next'in workspace-root tahminini bu projeye sabitliyoruz ki o üst
    // dizini yanlışlıkla "root" seçmesin.
    outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
};

export default nextConfig;
