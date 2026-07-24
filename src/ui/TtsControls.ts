/* ────────────── TTS 浮动控制条（从 ReaderView 拆出） ────────────── */
import { App, Notice } from "obsidian";
import type { Article } from "../types";
import { TtsService, type TtsSegment, type TtsState } from "../services/TtsService";

/** 语速档位 */
const TTS_RATES = [0.75, 1.0, 1.25, 1.5];

export interface TtsControlsDeps {
  app: App;
  /** 获取视图的 contentEl */
  getContentEl: () => HTMLElement;
  /** 获取正文 bodyEl（可能随文章切换而变化） */
  getBodyEl: () => HTMLElement | null;
  /** 获取当前文章（可能为 null） */
  getArticle: () => Article | null;
  /** 从 Obsidian local storage 读取字符串 */
  loadLocal: (key: string) => string | null;
  /** 写入 Obsidian local storage */
  saveLocal: (key: string, value: string) => void;
}

export class TtsControls {
  private deps: TtsControlsDeps;

  // ── 朗读（TTS）状态 ──
  private ttsService: TtsService | null = null;
  private ttsActiveEl: HTMLElement | null = null; // 当前高亮的朗读段落
  private ttsRate = 1.0; // 语速（记忆）
  private ttsVoice: SpeechSynthesisVoice | null = null; // 选中语音（记忆）
  private ttsPlayBtn: HTMLButtonElement | null = null;
  private ttsStopBtn: HTMLButtonElement | null = null;
  private ttsRateSel: HTMLSelectElement | null = null;
  private ttsVoiceSel: HTMLSelectElement | null = null;
  private ttsBarEl: HTMLElement | null = null;

  /** 仅弹一次「去装增强语音」提示，避免重复打扰 */
  private static enhancedVoiceNoticeShown = false;

  constructor(deps: TtsControlsDeps) {
    this.deps = deps;
  }

  /** 传入工具栏中的朗读触发按钮引用 */
  setPlayBtn(btn: HTMLButtonElement): void {
    this.ttsPlayBtn = btn;
  }

  /** 切换底部 TTS 浮动条的显隐 */
  toggleBar(): void {
    const contentEl = this.deps.getContentEl();
    const bar = contentEl.querySelector<HTMLElement>(".bwr-tts-bar");
    if (bar) {
      bar.remove();
      this.ttsBarEl = null;
      return;
    }
    this.renderTtsBar();
    // 展开后自动开始朗读
    void this.toggleTtsPlay();
  }

  /** 停止朗读并复位 UI（文章切换 / 视图关闭时调用） */
  stop(): void {
    this.getTts()?.stop();
    this.resetTtsUi();
  }

  /** 销毁：停止朗读、清除引用 */
  destroy(): void {
    this.stop();
    this.ttsService = null;
    this.ttsPlayBtn = null;
    this.ttsBarEl = null;
  }

  /* ── 内部方法 ── */

  /** 渲染底部 TTS 浮动条 */
  private renderTtsBar(): void {
    const contentEl = this.deps.getContentEl();
    // 移除已有的浮动条
    contentEl.querySelector(".bwr-tts-bar")?.remove();

    const bar = contentEl.createDiv({ cls: "bwr-tts-bar" });
    this.ttsBarEl = bar;

    const playBtn = bar.createEl("button", {
      cls: "bwr-btn bwr-btn-tts-play",
      text: "朗读",
      attr: { title: "朗读全文（可暂停/继续）", "aria-label": "朗读全文" },
    });
    const stopBtn = bar.createEl("button", {
      cls: "bwr-btn bwr-btn-tts-stop",
      text: "停止",
      attr: { title: "停止朗读", "aria-label": "停止朗读" },
    });
    stopBtn.disabled = true;

    const rateSel = bar.createEl("select", {
      cls: "bwr-tts-select",
      attr: { title: "语速", "aria-label": "语速" },
    });
    for (const r of TTS_RATES) {
      rateSel.createEl("option", { text: `${r}x`, value: String(r) });
    }

    const voiceSel = bar.createEl("select", {
      cls: "bwr-tts-select",
      attr: { title: "朗读语音", "aria-label": "朗读语音" },
    });

    // 关闭按钮
    const closeBtn = bar.createEl("button", {
      cls: "bwr-btn bwr-tts-close",
      text: "✕",
      attr: { title: "关闭朗读面板", "aria-label": "关闭朗读面板" },
    });
    closeBtn.addEventListener("click", () => {
      this.stop();
      bar.remove();
      this.ttsBarEl = null;
    });

    this.ttsStopBtn = stopBtn;
    this.ttsRateSel = rateSel;
    this.ttsVoiceSel = voiceSel;

    // 语速记忆
    const savedRate = this.deps.loadLocal("bw-tts-rate");
    if (savedRate) {
      this.ttsRate = parseFloat(savedRate);
      rateSel.value = savedRate;
    }

    playBtn.addEventListener("click", () => this.toggleTtsPlay());
    stopBtn.addEventListener("click", () => this.stop());
    rateSel.addEventListener("change", () => {
      this.ttsRate = parseFloat(rateSel.value);
      this.deps.saveLocal("bw-tts-rate", String(this.ttsRate));
      this.getTts()?.setRate(this.ttsRate);
    });
    voiceSel.addEventListener("change", () => {
      const name = voiceSel.value;
      const v = name
        ? (this.getTts()?.getVoices().find((vv) => vv.name === name) ?? null)
        : null;
      this.ttsVoice = v;
      if (name) this.deps.saveLocal("bw-tts-voice", name);
      this.getTts()?.setVoice(v);
      if (this.getTts()?.getState() !== "idle") {
        this.stop();
      }
    });

    // 填充语音下拉；不支持时禁用整组
    const tts = this.getTts();
    if (!tts || !tts.isSupported()) {
      for (const el of [playBtn, stopBtn, rateSel, voiceSel]) {
        el.disabled = true;
      }
      playBtn.setAttr("title", "当前平台暂不支持朗读（需桌面端 Obsidian）");
      return;
    }
    this.populateVoices();
  }

  /** 懒初始化朗读服务（绑定回调） */
  private getTts(): TtsService | null {
    if (this.ttsService) return this.ttsService;
    const svc = new TtsService({
      onSegmentStart: (i, seg) => this.onTtsSegmentStart(i, seg),
      onStateChange: (s) => this.onTtsStateChange(s),
      onEnd: () => this.onTtsEnd(),
    });
    this.ttsService = svc;
    return svc;
  }

  /** 从已渲染正文提取可朗读段落（保留 DOM 引用用于高亮+滚动） */
  private extractReadableSegments(): TtsSegment[] {
    const bodyEl = this.deps.getBodyEl();
    if (!bodyEl) return [];
    const nodes = Array.from(
      bodyEl.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li, blockquote"),
    );
    const segs: TtsSegment[] = [];
    for (const el of nodes) {
      const text = el.textContent?.trim();
      if (text) segs.push({ text, el });
    }
    return segs;
  }

  /** 播放/暂停/继续 三态切换 */
  private toggleTtsPlay(): void {
    const tts = this.getTts();
    if (!tts || !tts.isSupported()) return;

    const state = tts.getState();
    if (state === "playing") {
      tts.pause();
      return;
    }
    if (state === "paused") {
      tts.resume();
      return;
    }

    // idle → 从头或续读开始
    // 仅在用户真正点击朗读、且系统只有机械音时，才提示一次去装增强语音
    if (!tts.hasEnhancedChineseVoice()) {
      TtsControls.promptEnhancedVoiceOnce();
    }

    const segs = this.extractReadableSegments();
    if (segs.length === 0) return;
    let start = 0;
    const article = this.deps.getArticle();
    if (article) {
      const saved = this.deps.loadLocal(`bw-tts-pos-${article.slug}`);
      if (saved) start = Math.max(0, parseInt(saved, 10) || 0);
    }
    tts.setRate(this.ttsRate);
    tts.setVoice(this.ttsVoice);
    tts.speakSegments(segs, start);
  }

  private onTtsSegmentStart(index: number, seg: TtsSegment): void {
    if (this.ttsActiveEl && this.ttsActiveEl !== seg.el) {
      this.ttsActiveEl.removeClass("bwr-tts-active");
    }
    this.ttsActiveEl = seg.el;
    seg.el.addClass("bwr-tts-active");
    seg.el.scrollIntoView({ behavior: "smooth", block: "center" });
    const article = this.deps.getArticle();
    if (article) {
      this.deps.saveLocal(`bw-tts-pos-${article.slug}`, String(index));
    }
  }

  private onTtsStateChange(state: TtsState): void {
    // 更新工具栏触发按钮文本
    if (this.ttsPlayBtn) {
      if (state === "playing") this.ttsPlayBtn.setText("暂停");
      else if (state === "paused") this.ttsPlayBtn.setText("继续");
      else this.ttsPlayBtn.setText("朗读");
    }
    // 更新浮动条内的播放/停止按钮
    if (this.ttsBarEl) {
      const barPlay = this.ttsBarEl.querySelector<HTMLButtonElement>(".bwr-btn-tts-play");
      const barStop = this.ttsBarEl.querySelector<HTMLButtonElement>(".bwr-btn-tts-stop");
      if (barPlay) {
        if (state === "playing") barPlay.setText("暂停");
        else if (state === "paused") barPlay.setText("继续");
        else barPlay.setText("朗读");
      }
      if (barStop) barStop.disabled = state === "idle";
    }
  }

  private onTtsEnd(): void {
    // 自然读完：清除续读进度，回到开头
    const article = this.deps.getArticle();
    if (article) {
      this.deps.saveLocal(`bw-tts-pos-${article.slug}`, "0");
    }
    this.resetTtsUi();
  }

  /** 清除当前高亮段落 */
  private clearTtsHighlight(): void {
    if (this.ttsActiveEl) {
      this.ttsActiveEl.removeClass("bwr-tts-active");
      this.ttsActiveEl = null;
    }
  }

  /** 复位朗读 UI：清除高亮 + 按钮回到初始态 */
  private resetTtsUi(): void {
    this.clearTtsHighlight();
    if (this.ttsPlayBtn) this.ttsPlayBtn.setText("朗读");
    // 浮动条内的按钮也复位
    if (this.ttsBarEl) {
      const barPlay = this.ttsBarEl.querySelector<HTMLButtonElement>(".bwr-btn-tts-play");
      const barStop = this.ttsBarEl.querySelector<HTMLButtonElement>(".bwr-btn-tts-stop");
      if (barPlay) barPlay.setText("朗读");
      if (barStop) barStop.disabled = true;
    }
  }

  /** 填充中文语音下拉；列表异步加载时监听 voiceschanged 再填充 */
  private populateVoices(): void {
    const tts = this.getTts();
    if (!tts || !this.ttsVoiceSel) return;
    const zh = tts.getChineseVoices();
    if (zh.length === 0) {
      tts.setVoicesChangedHandler(() => this.populateVoices());
      return;
    }
    this.ttsVoiceSel.empty();
    for (const v of zh) {
      this.ttsVoiceSel.createEl("option", { text: v.name, value: v.name });
    }
    const savedName = this.deps.loadLocal("bw-tts-voice");
    const match =
      (savedName ? zh.find((v) => v.name === savedName) : undefined) ?? zh[0];
    if (match) {
      this.ttsVoice = match;
      this.ttsVoiceSel.value = match.name;
    }
    // 仅机械音时：下拉常驻引导 + 一次性安装提示，引导用户装增强中文语音
    if (!tts.hasEnhancedChineseVoice()) {
      this.ttsVoiceSel.setAttr(
        "title",
        "当前系统只有机械音。想更自然？去系统装增强/神经中文语音（如 macOS「婷婷(增强)」、Windows「Microsoft Xiaoxiao Neural」），下次自动优先。",
      );
    }
  }

  /** 仅弹一次「去装增强语音」提示（用户点击朗读时触发），避免重复打扰 */
  static promptEnhancedVoiceOnce(): void {
    if (TtsControls.enhancedVoiceNoticeShown) return;
    TtsControls.enhancedVoiceNoticeShown = true;
    const guide =
      typeof process !== "undefined" && process.platform === "darwin"
        ? "系统设置 → 辅助功能 → 朗读内容 → 系统嗓音 → 管理嗓音，下载「婷婷(增强)」或「Yue」"
        : typeof process !== "undefined" && process.platform === "win32"
          ? "设置 → 时间和语言 → 语音 → 管理语音，下载「Microsoft Xiaoxiao Neural」等神经语音"
          : "当前系统未提供增强中文语音，朗读偏机械属正常；可尝试安装系统增强/神经中文语音";
    new Notice("朗读偏机械？去系统装增强/神经中文语音可更自然。\n" + guide, 9000);
  }
}
