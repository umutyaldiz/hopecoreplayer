/**
 * Videoyu `seconds`'a güvenilir biçimde sarar, sonra `done`'ı çağırır (ör. play()).
 *
 * WebKit (Safari / iOS, Playwright WebKit) `readyState`'i `loadedmetadata`'dan önce yükseltiyor ve aradaki ya da
 * hemen ardından play() gelen bir seek'i 0'a sıfırlayabiliyor. Bu yüzden konum `seeked`'te doğrulanır, tutmadıysa
 * toplam `attempts` kez uygulanır; `done` her durumda (yerleşince ya da denemeler bitince) bir kez çağrılır.
 */
export function seekWhenReady(v: HTMLVideoElement, seconds: number, done?: () => void, attempts = 3): void {
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        done?.();
    };
    // seeked hiç gelmezse (takılan ağ, iptal edilen seek) done yine de çalışsın — oynatma askıda kalmasın.
    const timer = done ? setTimeout(finish, 3000) : undefined;
    const attempt = () => {
        if (Math.abs(v.currentTime - seconds) <= 0.5 || attempts-- <= 0) return finish();
        v.addEventListener('seeked', attempt, { once: true });
        v.currentTime = seconds;
    };
    if (v.readyState >= 1) attempt();
    else v.addEventListener('loadedmetadata', attempt, { once: true });
}
