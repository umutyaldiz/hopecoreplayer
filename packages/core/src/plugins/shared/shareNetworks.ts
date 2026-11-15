import type { ShareNetwork } from '../../types';

export const NETWORK_NAMES: Record<ShareNetwork, string> = {
    x: 'X',
    whatsapp: 'WhatsApp',
    facebook: 'Facebook',
    linkedin: 'LinkedIn',
    telegram: 'Telegram',
    reddit: 'Reddit',
    email: 'Email',
};

/** Ağın paylaşım adresi. */
export function networkUrl(network: ShareNetwork, url: string, title: string): string {
    const u = encodeURIComponent(url);
    const t = encodeURIComponent(title);
    switch (network) {
        case 'x':
            return `https://x.com/intent/post?url=${u}&text=${t}`;
        case 'whatsapp':
            return `https://wa.me/?text=${encodeURIComponent(title ? `${title} ${url}` : url)}`;
        case 'facebook':
            return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
        case 'linkedin':
            return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
        case 'telegram':
            return `https://t.me/share/url?url=${u}&text=${t}`;
        case 'reddit':
            return `https://www.reddit.com/submit?url=${u}&title=${t}`;
        case 'email':
            return `mailto:?subject=${t}&body=${u}`;
    }
}

/** Paylaşılacak temel adres: verilen, canonical ya da sayfa adresi; `drop` parametreleri ve hash temizlenir. */
export function shareBaseUrl(given: string | undefined, drop: string[]): string {
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
    const u = new URL(given || canonical || location.href, location.href);
    for (const p of drop) u.searchParams.delete(p);
    u.hash = '';
    return u.toString();
}

/** Bağlantıyı panoya kopyalar; Clipboard API yoksa input seçilip execCommand denenir. */
export function copyText(text: string, input?: HTMLInputElement): Promise<void> {
    return (navigator.clipboard?.writeText(text) ?? Promise.reject()).catch(() => {
        input?.select();
        document.execCommand('copy');
    });
}
