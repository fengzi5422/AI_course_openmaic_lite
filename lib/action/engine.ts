import { Action } from "@/lib/dsl";

/** 动作执行时的 UI 效果接口，由渲染层（React 组件）实现 */
export interface ActionEffects {
  speak(text: string): Promise<void>;
  cancelSpeech(): void;
  pauseSpeech?(): void;
  resumeSpeech?(): void;
  setSpotlight(s: { x: number; y: number; radius: number; text?: string } | null): void;
  drawPath(
    points: Array<[number, number]>,
    color: string,
    width: number,
    instant: boolean
  ): Promise<void>;
  drawText(x: number, y: number, text: string, color: string): void;
  clearWhiteboard(): void;
}

/** 一次场景执行的取消令牌：cancelled 中断整段，skip 跳过当前动作等待 */
export interface RunToken {
  cancelled: boolean;
  skip: boolean;
}

/** 可被 skip/cancel 打断的 sleep */
export function sleep(ms: number, token: RunToken): Promise<void> {
  const step = 50;
  return new Promise((resolve) => {
    let elapsed = 0;
    const timer = setInterval(() => {
      if (token.cancelled || token.skip || elapsed >= ms) {
        clearInterval(timer);
        resolve();
        return;
      }
      elapsed += step;
    }, step);
  });
}

/**
 * 执行单个动作，resolve 表示该动作完成。
 * 抛出异常仅表示执行环境错误，由上层决定是否继续。
 */
export async function executeAction(
  action: Action,
  effects: ActionEffects,
  token: RunToken
): Promise<void> {
  switch (action.type) {
    case "speech": {
      if (token.skip) {
        effects.cancelSpeech();
        return;
      }
      await effects.speak(action.text);
      return;
    }
    case "spotlight": {
      effects.setSpotlight({
        x: action.x,
        y: action.y,
        radius: action.radius,
        text: action.text,
      });
      await sleep(3000, token);
      effects.setSpotlight(null);
      return;
    }
    case "wb_draw": {
      await effects.drawPath(
        action.points,
        action.color ?? "#f59e0b",
        action.width ?? 4,
        token.skip
      );
      return;
    }
    case "wb_text": {
      effects.drawText(action.x, action.y, action.text, action.color ?? "#f59e0b");
      await sleep(800, token);
      return;
    }
    case "wb_clear": {
      effects.clearWhiteboard();
      return;
    }
  }
}
