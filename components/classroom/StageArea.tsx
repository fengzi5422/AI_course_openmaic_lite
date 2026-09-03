"use client";

import { memo, useState } from "react";
import { Stage } from "@/lib/dsl";
import { resolveTheme } from "@/lib/dsl/theme";
import { SlideRenderer } from "@/components/slide-renderer/SlideRenderer";
import { Whiteboard, WhiteboardHandle } from "@/components/slide-renderer/Whiteboard";
import { Spotlight, SpotlightState } from "@/components/slide-renderer/Spotlight";
import { useStageScale, stageAspectStyle } from "@/components/slide-renderer/use-stage-scale";
import { PlaybackState } from "@/lib/playback/engine";

/** 测验交互层：渲染在 1280x720 逻辑坐标容器内（配色来自主题 token） */
function QuizLayerInner({
  options,
  answerIndex,
  explanation,
  bg,
  quiz,
  quizText,
  dim,
}: {
  options: string[];
  answerIndex: number;
  explanation?: string;
  bg: string;
  quiz: string;
  quizText: string;
  dim: string;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  return (
    <div className="absolute inset-0" style={{ pointerEvents: answered ? "none" : "auto" }}>
      <div className="absolute left-[80px] top-[380px] w-[1120px] grid grid-cols-2 gap-4">
        {options.map((o, i) => {
          const isRight = i === answerIndex;
          return (
            <button
              key={i}
              onClick={() => setPicked(i)}
              className={`px-6 py-3 text-3xl font-medium text-left anim-fade-in ${
                answered
                  ? isRight
                    ? "text-white"
                    : i === picked
                      ? "text-white"
                      : ""
                  : "transition-colors"
              }`}
              style={
                answered
                  ? isRight
                    ? { background: "#15803d" }
                    : i === picked
                      ? { background: "#b91c1c" }
                      : { background: dim, color: bg }
                  : { background: quiz, color: quizText, border: "1px solid rgba(0,0,0,0.08)" }
              }
            >
              {String.fromCharCode(65 + i)}. {o}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="absolute left-[80px] top-[620px] w-[1120px] text-2xl font-semibold anim-fade-in" style={{ color: quizText }}>
          {picked === answerIndex ? "回答正确。" : `正确答案是 ${String.fromCharCode(65 + answerIndex)}。`}
          {explanation ? ` ${explanation}` : ""}
        </div>
      )}
    </div>
  );
}

const QuizLayer = memo(QuizLayerInner);

/**
 * 舞台区：幻灯片 + 白板 + 聚光灯 + 测验层。
 * memo 隔离：pbState 高频更新时，若场景未变则不重渲染。
 */
function StageAreaInner({
  stage,
  pbState,
  spotlight,
  wbRef,
}: {
  stage: Stage;
  pbState: PlaybackState;
  spotlight: SpotlightState | null;
  wbRef: React.RefObject<WhiteboardHandle | null>;
}) {
  const { ref: wrapRef, innerStyle } = useStageScale<HTMLDivElement>();
  const scene = stage.scenes[pbState.sceneIndex] ?? null;
  // 主题 token：舞台环境与元素缺省色同源（内容/布局/主题分离）
  const tokens = resolveTheme(stage.theme).tokens;

  return (
    <div ref={wrapRef} className="w-full" style={stageAspectStyle}>
      <div
        className="relative w-full overflow-hidden"
        style={{ ...stageAspectStyle, background: tokens.bg, boxShadow: "0 2px 24px rgba(0,0,0,0.18)" }}
      >
        <div style={innerStyle} className="absolute left-0 top-0">
          {scene && (
            <div key={scene.id} className="scene-enter absolute inset-0">
              <SlideRenderer content={scene.content} tokens={tokens} />
            </div>
          )}
          <Whiteboard ref={wbRef} />
          {spotlight && <Spotlight s={spotlight} />}
          {scene?.content.kind === "quiz" && (
            <QuizLayer
              key={scene.id}
              options={scene.content.options}
              answerIndex={scene.content.answerIndex}
              explanation={scene.content.explanation}
              bg={tokens.bg}
              quiz={tokens.quiz}
              quizText={tokens.quizText}
              dim={tokens.dim}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export const StageArea = memo(StageAreaInner);
