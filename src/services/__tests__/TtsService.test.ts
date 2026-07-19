import { describe, it, expect, vi } from "vitest";
import { TtsService } from "../TtsService";
import type { TtsSegment } from "../TtsService";

/** 最小 SpeechSynthesisUtterance 模拟，属性与回调对齐浏览器 API */
class MockUtterance {
  text: string;
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  lang = "";
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

/** 最小 SpeechSynthesis 模拟（结构兼容浏览器 API，无需 any） */
class MockSynth implements Partial<SpeechSynthesis> {
  _spoken: MockUtterance[] = [];
  _last: MockUtterance | null = null;
  speaking = false;
  paused = false;
  pending = false;
  onvoiceschanged: ((this: SpeechSynthesis, ev: Event) => unknown) | null = null;

  getVoices(): SpeechSynthesisVoice[] {
    return [
      { name: "Tingting", lang: "zh-CN" } as SpeechSynthesisVoice,
      { name: "Huihui", lang: "zh-CN" } as SpeechSynthesisVoice,
      { name: "Samantha", lang: "en-US" } as SpeechSynthesisVoice,
    ];
  }
  speak(u: SpeechSynthesisUtterance): void {
    const mu = u as unknown as MockUtterance;
    this._spoken.push(mu);
    this._last = mu;
    this.speaking = true;
    mu.onstart?.();
  }
  cancel(): void {
    this.speaking = false;
    this.paused = false;
    this._last = null;
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return false;
  }
}

function makeMockSynth(): MockSynth {
  return new MockSynth();
}

function segments(...texts: string[]): TtsSegment[] {
  return texts.map((t) => ({ text: t, el: {} as HTMLElement }));
}

describe("TtsService 不支持环境", () => {
  it("synth 为 null 时 isSupported=false，speakSegments 无副作用", () => {
    const svc = new TtsService({}, { synth: null });
    expect(svc.isSupported()).toBe(false);
    svc.speakSegments(segments("你好", "世界"));
    expect(svc.getState()).toBe("idle");
    expect(svc.getChineseVoices()).toEqual([]);
  });
});

describe("TtsService 分段队列推进", () => {
  it("逐段推进：onstart→onSegmentStart，模拟 onend→下一段，全部读完触发 onEnd", () => {
    const synth = makeMockSynth();
    const starts: number[] = [];
    const onEnd = vi.fn();
    const svc = new TtsService(
      { onSegmentStart: (i) => starts.push(i), onEnd },
      { synth, UtteranceCtor: MockUtterance as unknown as new (t?: string) => SpeechSynthesisUtterance },
    );

    expect(svc.isSupported()).toBe(true);
    svc.speakSegments(segments("甲", "乙", "丙"));

    // 第 1 段被念
    expect(synth._spoken).toHaveLength(1);
    expect(synth._last?.text).toBe("甲");
    expect(starts).toEqual([0]);
    expect(svc.getState()).toBe("playing");

    // 模拟第 1 段结束 → 第 2 段
    synth._last!.onend!();
    expect(synth._spoken).toHaveLength(2);
    expect(synth._last?.text).toBe("乙");
    expect(starts).toEqual([0, 1]);

    // 第 2 段结束 → 第 3 段
    synth._last!.onend!();
    expect(synth._spoken).toHaveLength(3);
    expect(synth._last?.text).toBe("丙");
    expect(starts).toEqual([0, 1, 2]);

    // 第 3 段结束 → 全部读完
    synth._last!.onend!();
    expect(synth._spoken).toHaveLength(3); // 不再新增
    expect(svc.getState()).toBe("idle");
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("支持从指定段落开始（续读）", () => {
    const synth = makeMockSynth();
    const starts: number[] = [];
    const svc = new TtsService(
      { onSegmentStart: (i) => starts.push(i) },
      { synth, UtteranceCtor: MockUtterance as unknown as new (t?: string) => SpeechSynthesisUtterance },
    );
    svc.speakSegments(segments("甲", "乙", "丙"), 1);
    expect(synth._last?.text).toBe("乙");
    expect(starts).toEqual([1]);
  });
});

describe("TtsService 状态控制", () => {
  it("pause / resume 切换状态，stop 清空并回到 idle", () => {
    const synth = makeMockSynth();
    const states: string[] = [];
    const svc = new TtsService(
      { onStateChange: (s) => states.push(s) },
      { synth, UtteranceCtor: MockUtterance as unknown as new (t?: string) => SpeechSynthesisUtterance },
    );
    svc.speakSegments(segments("甲", "乙"));
    expect(svc.getState()).toBe("playing");

    svc.pause();
    expect(svc.getState()).toBe("paused");
    expect(synth.paused).toBe(true);

    svc.resume();
    expect(svc.getState()).toBe("playing");
    expect(synth.paused).toBe(false);

    svc.stop();
    expect(svc.getState()).toBe("idle");
    expect(synth.speaking).toBe(false);
    expect(states).toContain("paused");
    expect(states).toContain("playing");
    expect(states[states.length - 1]).toBe("idle");
  });

  it("stop 取消当前朗读后，原 utterance 的 onend 不会触发续播", () => {
    const synth = makeMockSynth();
    const starts: number[] = [];
    const svc = new TtsService(
      { onSegmentStart: (i) => starts.push(i) },
      { synth, UtteranceCtor: MockUtterance as unknown as new (t?: string) => SpeechSynthesisUtterance },
    );
    svc.speakSegments(segments("甲", "乙"));
    svc.stop();
    // 模拟浏览器 cancel 后可能回调的 onend
    synth._last?.onend?.();
    expect(starts).toEqual([0]); // 未续播第 2 段
    expect(svc.getState()).toBe("idle");
  });
});

describe("TtsService 语音与参数", () => {
  it("getChineseVoices 仅返回含中文化的语音", () => {
    const synth = makeMockSynth();
    const svc = new TtsService({}, { synth });
    const zh = svc.getChineseVoices();
    expect(zh).toHaveLength(2);
    expect(zh.every((v) => /zh|cmn|cn/i.test(v.lang))).toBe(true);
  });

  it("setRate / setVoice 写入下一次 utterance", () => {
    const synth = makeMockSynth();
    const voice = { name: "Tingting", lang: "zh-CN" } as SpeechSynthesisVoice;
    const svc = new TtsService({}, { synth, UtteranceCtor: MockUtterance as unknown as new (t?: string) => SpeechSynthesisUtterance });
    svc.setRate(1.5);
    svc.setVoice(voice);
    svc.speakSegments(segments("甲"));
    expect(synth._last?.rate).toBe(1.5);
    expect(synth._last?.voice).toBe(voice);
  });

  it("setVoicesChangedHandler 注册回调", () => {
    const synth = makeMockSynth();
    const svc = new TtsService({}, { synth });
    const cb = vi.fn();
    svc.setVoicesChangedHandler(cb);
    expect(synth.onvoiceschanged).toBe(cb);
  });

  it("isEnhancedVoice 识别增强/神经语音（Enhanced/Neural/Premium）", () => {
    const svc = new TtsService({}, { synth: makeMockSynth() });
    expect(svc.isEnhancedVoice({ name: "Tingting (Enhanced)", lang: "zh-CN" } as SpeechSynthesisVoice)).toBe(true);
    expect(svc.isEnhancedVoice({ name: "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)", lang: "zh-CN" } as SpeechSynthesisVoice)).toBe(true);
    expect(svc.isEnhancedVoice({ name: "Google 普通话 (Premium)", lang: "zh-CN" } as SpeechSynthesisVoice)).toBe(true);
    expect(svc.isEnhancedVoice({ name: "Tingting", lang: "zh-CN" } as SpeechSynthesisVoice)).toBe(false);
    expect(svc.isEnhancedVoice({ name: "Samantha", lang: "en-US" } as SpeechSynthesisVoice)).toBe(false);
  });

  it("getChineseVoices 将增强中文语音排到最前（稳定排序，其他顺序不变）", () => {
    const synth = makeMockSynth();
    synth.getVoices = () => [
      { name: "Tingting", lang: "zh-CN" } as SpeechSynthesisVoice,
      { name: "Huihui", lang: "zh-CN" } as SpeechSynthesisVoice,
      { name: "Tingting (Enhanced)", lang: "zh-CN" } as SpeechSynthesisVoice,
      { name: "Samantha", lang: "en-US" } as SpeechSynthesisVoice,
    ];
    const svc = new TtsService({}, { synth });
    const zh = svc.getChineseVoices();
    expect(zh).toHaveLength(3);
    expect(zh[0].name).toBe("Tingting (Enhanced)"); // 增强音置顶
    expect(zh.map((v) => v.name)).toEqual(["Tingting (Enhanced)", "Tingting", "Huihui"]);
  });

  it("hasEnhancedChineseVoice：存在增强中文语音返回 true，否则 false", () => {
    const withEnhanced = makeMockSynth();
    withEnhanced.getVoices = () => [
      { name: "Tingting", lang: "zh-CN" } as SpeechSynthesisVoice,
      { name: "Tingting (Enhanced)", lang: "zh-CN" } as SpeechSynthesisVoice,
    ] as SpeechSynthesisVoice[];
    expect(new TtsService({}, { synth: withEnhanced }).hasEnhancedChineseVoice()).toBe(true);

    const without = makeMockSynth();
    without.getVoices = () => [
      { name: "Tingting", lang: "zh-CN" } as SpeechSynthesisVoice,
      { name: "Huihui", lang: "zh-CN" } as SpeechSynthesisVoice,
    ] as SpeechSynthesisVoice[];
    expect(new TtsService({}, { synth: without }).hasEnhancedChineseVoice()).toBe(false);

    expect(new TtsService({}, { synth: null }).hasEnhancedChineseVoice()).toBe(false);
  });
});
