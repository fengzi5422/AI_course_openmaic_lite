import { Stage } from "@/lib/dsl";
import { ActionEffects, RunToken, executeAction } from "@/lib/action/engine";

export type PlaybackStatus = "idle" | "playing" | "paused" | "scene-done" | "finished";

export interface PlaybackState {
  status: PlaybackStatus;
  sceneIndex: number;
  /** 已执行到的动作序号（用于进度显示） */
  actionIndex: number;
}

/**
 * 播放引擎：顺序消费 Scene.actions[]。
 * 状态机 idle/playing/paused → scene-done（本场景动作执行完）→ finished（全部场景结束）。
 * 与 UI 解耦：通过 ActionEffects 施加效果，通过 onState 通知状态。
 */
export class PlaybackEngine {
  private token: RunToken | null = null;
  private state: PlaybackState = { status: "idle", sceneIndex: 0, actionIndex: 0 };

  constructor(
    private readonly stage: Stage,
    private readonly effects: ActionEffects,
    private readonly onState: (s: PlaybackState) => void
  ) {}

  private setState(patch: Partial<PlaybackState>) {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }

  getState(): PlaybackState {
    return { ...this.state };
  }

  get currentScene() {
    return this.stage.scenes[this.state.sceneIndex] ?? null;
  }

  /** 播放指定场景（从头执行其动作列表） */
  playScene(index: number) {
    if (index < 0 || index >= this.stage.scenes.length) return;
    this.token = { cancelled: true, skip: false }; // 取消可能存在的上一轮
    this.effects.clearWhiteboard();
    this.effects.setSpotlight(null);
    this.effects.cancelSpeech();
    this.setState({ sceneIndex: index, actionIndex: 0, status: "playing" });
    const token: RunToken = { cancelled: false, skip: false };
    this.token = token;
    void this.runScene(index, token);
  }

  private async runScene(index: number, token: RunToken) {
    const scene = this.stage.scenes[index];
    for (let i = 0; i < scene.actions.length; i++) {
      if (token.cancelled) return;
      this.setState({ actionIndex: i, status: "playing" });
      try {
        await executeAction(scene.actions[i], this.effects, token);
      } catch {
        // 单个动作失败不阻断课堂
      }
      if (token.cancelled) return;
    }
    const isLast = index >= this.stage.scenes.length - 1;
    this.setState({ status: isLast ? "finished" : "scene-done", actionIndex: scene.actions.length });
  }

  play() {
    if (this.state.status === "scene-done" || this.state.status === "idle") {
      this.playScene(this.state.sceneIndex);
    } else if (this.state.status === "paused" && this.token) {
      this.token.skip = false;
      this.effects.resumeSpeech?.();
      this.setState({ status: "playing" });
    }
  }

  pause() {
    if (this.state.status !== "playing") return;
    if (this.token) this.token.skip = true; // 快进当前动作等待
    this.effects.pauseSpeech?.();
    this.setState({ status: "paused" });
  }

  /** 跳过当前场景剩余动作 */
  skip() {
    if (this.token) this.token.skip = true;
    this.effects.cancelSpeech();
  }

  next() {
    if (this.state.sceneIndex < this.stage.scenes.length - 1) {
      this.playScene(this.state.sceneIndex + 1);
    }
  }

  prev() {
    if (this.state.sceneIndex > 0) {
      this.playScene(this.state.sceneIndex - 1);
    }
  }

  destroy() {
    if (this.token) this.token.cancelled = true;
    this.effects.cancelSpeech();
    this.effects.setSpotlight(null);
  }
}
