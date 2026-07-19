/* ────────────── 竹杖芒鞋 · 朗读服务（Web Speech API 封装） ────────────── */

/**
 * 朗读状态机：
 * - idle：未朗读 / 已停止 / 已读完
 * - playing：正在朗读
 * - paused：已暂停
 */
export type TtsState = "idle" | "playing" | "paused";

/** 一段可朗读文本 + 其在正文中对应的 DOM 元素（用于高亮/滚动） */
export interface TtsSegment {
  text: string;
  el: HTMLElement;
}

/** 事件回调 */
export interface TtsCallbacks {
  /** 某一段开始朗读（index 为段序号，seg 为对应 DOM 段） */
  onSegmentStart?: (index: number, seg: TtsSegment) => void;
  /** 状态切换 */
  onStateChange?: (state: TtsState) => void;
  /** 全部自然朗读完成（手动 stop 不触发） */
  onEnd?: () => void;
}

/** 依赖注入，便于在测试中以 mock 替代浏览器 API */
export interface TtsDeps {
  /** SpeechSynthesis 实例；默认取 window.speechSynthesis */
  synth?: SpeechSynthesis | null;
  /** SpeechSynthesisUtterance 构造器；默认取全局类 */
  UtteranceCtor?: new (text?: string) => SpeechSynthesisUtterance;
}

const ZH_LANG_REGEX = /zh|cmn|cn/i;

/** 增强/神经语音（音色更自然）：macOS "Tingting (Enhanced)"、Windows "Xiaoxiao Online (Natural)"、Google "(Premium)" 等均命中 */
const ENHANCED_RE = /enhanced|neural|natural|premium/i;

export class TtsService {
  private synth: SpeechSynthesis | null;
  private UtteranceCtor: new (text?: string) => SpeechSynthesisUtterance;
  private callbacks: TtsCallbacks;

  private segments: TtsSegment[] = [];
  private index = 0;
  private state: TtsState = "idle";
  private rate = 1.0;
  private voice: SpeechSynthesisVoice | null = null;

  constructor(callbacks: TtsCallbacks = {}, deps: TtsDeps = {}) {
    this.callbacks = callbacks;
    this.synth =
      deps.synth !== undefined
        ? deps.synth
        : typeof window !== "undefined"
          ? window.speechSynthesis
          : null;
    this.UtteranceCtor =
      deps.UtteranceCtor ??
      (typeof SpeechSynthesisUtterance !== "undefined" ? SpeechSynthesisUtterance : (null as unknown as new (text?: string) => SpeechSynthesisUtterance));
  }

  /** 当前运行环境是否支持朗读 */
  isSupported(): boolean {
    return !!this.synth;
  }

  /** 当前状态 */
  getState(): TtsState {
    return this.state;
  }

  /** 当前所处段序号（用于续读记忆） */
  getCurrentIndex(): number {
    return this.index;
  }

  /** 全部可用语音 */
  getVoices(): SpeechSynthesisVoice[] {
    if (!this.synth) return [];
    return this.synth.getVoices();
  }

  /** 判断是否为增强/神经语音（更自然） */
  isEnhancedVoice(v: SpeechSynthesisVoice): boolean {
    return ENHANCED_RE.test(v.name);
  }

  /** 仅中文（含 zh/cmn/cn）语音，增强/神经音排到最前（稳定排序，其余相对顺序不变） */
  getChineseVoices(): SpeechSynthesisVoice[] {
    return this.getVoices()
      .filter((v) => ZH_LANG_REGEX.test(v.lang))
      .sort((a, b) => Number(this.isEnhancedVoice(b)) - Number(this.isEnhancedVoice(a)));
  }

  /** 系统是否装了任意增强中文语音（用于决定是否提示用户安装） */
  hasEnhancedChineseVoice(): boolean {
    return this.getChineseVoices().some((v) => this.isEnhancedVoice(v));
  }

  /** 注册语音列表异步加载完成回调（部分浏览器初始 getVoices 为空，需监听此事件） */
  setVoicesChangedHandler(cb: () => void): void {
    if (this.synth) {
      this.synth.onvoiceschanged = cb;
    }
  }

  /** 设置语速（0.5~2 之间由调用方约束） */
  setRate(rate: number): void {
    this.rate = rate;
  }

  /** 设置朗读语音；传 null 由引擎按 lang 自行选择 */
  setVoice(voice: SpeechSynthesisVoice | null): void {
    this.voice = voice;
  }

  /**
   * 灌入分段队列并开始朗读。
   * @param segments 已按正文顺序切好的段落
   * @param startIndex 从指定段开始（续读记忆），默认 0
   */
  speakSegments(segments: TtsSegment[], startIndex = 0): void {
    if (!this.synth || segments.length === 0) return;
    this.segments = segments;
    this.index = Math.max(0, Math.min(startIndex, segments.length - 1));
    this.speakCurrent();
  }

  private speakCurrent(): void {
    if (!this.synth) return;
    if (this.index >= this.segments.length) {
      this.finish();
      return;
    }
    const seg = this.segments[this.index];
    const u = new this.UtteranceCtor(seg.text);
    u.rate = this.rate;
    if (this.voice) u.voice = this.voice;

    u.onstart = () => {
      this.state = "playing";
      this.callbacks.onStateChange?.(this.state);
      this.callbacks.onSegmentStart?.(this.index, seg);
    };
    u.onend = () => {
      // 仅在仍处于 playing 时续播，避免 cancel 后浏览器回调 onend 造成串播
      if (this.state !== "playing") return;
      this.index += 1;
      this.speakCurrent();
    };
    u.onerror = () => {
      // 朗读异常（如被策略阻止）时安全收尾，避免卡死
      this.state = "idle";
      this.callbacks.onStateChange?.(this.state);
      this.callbacks.onEnd?.();
    };

    this.synth.speak(u);
  }

  private finish(): void {
    this.state = "idle";
    this.callbacks.onStateChange?.(this.state);
    this.callbacks.onEnd?.();
  }

  /** 暂停 */
  pause(): void {
    if (this.synth && this.state === "playing") {
      this.synth.pause();
      this.state = "paused";
      this.callbacks.onStateChange?.(this.state);
    }
  }

  /** 继续 */
  resume(): void {
    if (this.synth && this.state === "paused") {
      this.synth.resume();
      this.state = "playing";
      this.callbacks.onStateChange?.(this.state);
    }
  }

  /** 停止并清空队列；先置 idle 再 cancel，避免 cancel 的 onend 续播 */
  stop(): void {
    this.state = "idle";
    this.index = 0;
    if (this.synth) this.synth.cancel();
    this.callbacks.onStateChange?.(this.state);
  }
}
