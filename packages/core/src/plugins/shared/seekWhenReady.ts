interface SeekWhenReadyOptions {
    /** Konum yerleşince (ya da denemeler bitince) bir kez çağrılır — ör. play(). */
    done?: () => void;
    /** Toplam sarma denemesi (varsayılan 3). */
    attempts?: number;
    /**
     * Yerleştikten sonra bu süre (ms) boyunca konum `seeking` olmadan hedefin gerisine düşerse sarma bir kez daha
     * uygulanır. WebKitGTK / WPE (GStreamer): uzun süre duraklatılmış videoda oynarken yapılan sarma `seeked`'te
     * doğru görünüp ardından oynatma eski konumdan sürüyor. Kullanıcı / başka bir kod sararsa (`seeking`) bekçi kapanır.
     */
    guardMs?: number;
}

/**
 * Videoyu `seconds`'a güvenilir biçimde sarar.
 *
 * WebKit (Safari / iOS, Playwright WebKit) `readyState`'i `loadedmetadata`'dan önce yükseltiyor ve aradaki ya da
 * hemen ardından play() gelen bir seek'i 0'a sıfırlayabiliyor. Bu yüzden konum `seeked`'te doğrulanır, tutmadıysa
 * toplam `attempts` kez uygulanır; `done` her durumda (yerleşince ya da denemeler bitince) bir kez çağrılır.
 */
export function seekWhenReady(v: HTMLVideoElement, seconds: number, { done, attempts = 3, guardMs = 0 }: SeekWhenReadyOptions = {}): void {
    let finished = false;
    let ownSeek = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (guardMs > 0) guard();
        done?.();
    };
    // seeked hiç gelmezse (takılan ağ, iptal edilen seek) done yine de çalışsın — oynatma askıda kalmasın.
    const timer = done ? setTimeout(finish, 3000) : undefined;
    const seekTo = () => {
        ownSeek = true;
        v.currentTime = seconds;
    };
    const attempt = () => {
        ownSeek = false;
        if (Math.abs(v.currentTime - seconds) <= 0.5 || attempts-- <= 0) return finish();
        v.addEventListener('seeked', attempt, { once: true });
        seekTo();
    };

    const guard = () => {
        let reapplied = 0;
        const stop = () => {
            clearTimeout(guardTimer);
            v.removeEventListener('timeupdate', check);
            v.removeEventListener('playing', check);
            v.removeEventListener('seeking', onSeeking);
            v.removeEventListener('seeked', onSeeked);
        };
        const check = () => {
            if (ownSeek || v.seeking || v.currentTime >= seconds - 1) return;
            if (reapplied++ >= 2) return stop();
            seekTo();
        };
        // Başka bir sarma (kullanıcı, eklenti) bekçiyi kapatır; kendi yeniden sarmamız kapatmaz.
        const onSeeking = () => {
            if (!ownSeek) stop();
        };
        const onSeeked = () => {
            ownSeek = false;
        };
        v.addEventListener('timeupdate', check);
        v.addEventListener('playing', check);
        v.addEventListener('seeking', onSeeking);
        v.addEventListener('seeked', onSeeked);
        const guardTimer = setTimeout(stop, guardMs);
    };

    if (v.readyState >= 1) attempt();
    else v.addEventListener('loadedmetadata', attempt, { once: true });
}
