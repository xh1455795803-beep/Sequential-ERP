// 全局通知叮咚提示音（主人 UI 规范 Batch2）
// - 触发点：站内新通知到达（topbar 轮询/Realtime 检测到 fresh 通知）
// - autoplay 政策：首次用户交互（pointerdown/keydown）后解锁，未解锁前静默跳过
// - 开关：localStorage "notify-sound"（off=关，默认开）
// - 去重：60s 内只播一次；音量 0.35（柔和短促 0.8s 双音 mp3）
const SOUND_SRC = "/audio/notify-dingdong.mp3";
export const NOTIFY_SOUND_KEY = "notify-sound";

let unlocked = false;
let lastPlayedAt = 0;
let audioEl: HTMLAudioElement | null = null;

export function isNotifySoundOn(): boolean {
  try {
    return localStorage.getItem(NOTIFY_SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setNotifySoundOn(on: boolean): void {
  try {
    if (on) localStorage.removeItem(NOTIFY_SOUND_KEY);
    else localStorage.setItem(NOTIFY_SOUND_KEY, "off");
  } catch {
    /* localStorage 不可用时静默 */
  }
}

export function initNotifySoundUnlock(): void {
  if (typeof document === "undefined") return;
  const unlock = () => {
    unlocked = true;
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("keydown", unlock, true);
  };
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);
}

export function playNotifyDingdong(opts?: { force?: boolean }): void {
  if (!isNotifySoundOn()) return;
  const force = opts?.force === true;
  if (!force) {
    if (!unlocked) return; // autoplay 未解锁：静默跳过
    const now = Date.now();
    if (now - lastPlayedAt < 60000) return; // 60s 去重
    lastPlayedAt = now;
  }
  try {
    if (!audioEl) {
      audioEl = new Audio(SOUND_SRC);
      audioEl.volume = 0.35;
      audioEl.preload = "auto";
    }
    audioEl.currentTime = 0;
    const p = audioEl.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    /* 音频不可用静默跳过 */
  }
}
