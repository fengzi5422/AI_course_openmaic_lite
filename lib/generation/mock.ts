import { SceneOutline, Stage } from "@/lib/dsl";
import { normalizeStage } from "@/lib/dsl/normalize";

/**
 * 内置演示生成器：未配置 LLM_API_KEY 时使用，
 * 按主题产出结构合法、内容饱满的示例课程，保证全流程可演示。
 */

export function mockOutlines(topic: string): SceneOutline[] {
  return [
    { title: `走进${topic}`, points: [`${topic}要回答的核心问题`, `为什么现在值得学习：两个真实场景`, `本课学习路线与目标`] },
    { title: `${topic}的核心概念`, points: ["基本定义与边界", "三个关键特性", "与相近概念的区别", "常见误区辨析"] },
    { title: `${topic}的运行机制`, points: ["整体流程拆解", "关键环节的因果链", "一个可验算的小例子"] },
    { title: `${topic}真实案例拆解`, points: ["案例背景与数据", "过程逐步还原", "结果与启示", "可迁移的方法论"] },
    { title: "随堂测验", points: ["核心概念理解题", "答案逐项解析"] },
    { title: "总结与延伸学习", points: ["本课知识框架回顾", "常见误区清单", "下一步学习路径建议"] },
  ];
}

export function mockStage(topic: string): Stage {
  return normalizeStage({
    title: `${topic}（演示课程）`,
    description: `内置演示数据。配置 LLM_API_KEY 后可生成真实的「${topic}」课程。`,
    scenes: [
      {
        title: `走进${topic}`,
        content: {
          kind: "slide",
          elements: [
            { type: "text", content: `走进${topic}`, x: 80, y: 70, w: 1000, h: 90, fontSize: 48, color: "#111827", bold: true },
            { type: "text", content: "从一个日常问题出发，建立对它的第一性认知", x: 80, y: 170, w: 1000, h: 50, fontSize: 22, color: "#6b7280" },
            { type: "text", content: "· 它要回答的核心问题是什么\n· 两个真实场景：为什么值得学\n· 本课的学习路线与目标", x: 80, y: 260, w: 560, h: 200, fontSize: 26, color: "#374151" },
            { type: "shape", shape: "rect", x: 690, y: 260, w: 510, h: 200, fill: "#eef2ff" },
            { type: "text", content: "案例：某团队把它引入工作流后，处理效率提升约 40%，出错率下降一半——数字背后是方法论的差异。", x: 715, y: 280, w: 460, h: 160, fontSize: 22, color: "#1d4ed8" },
            { type: "text", content: "易错点：把它当成孤立技巧来学，而不先建立整体框架。", x: 80, y: 610, w: 1100, h: 60, fontSize: 22, color: "#b45309" },
          ],
        },
        actions: [
          { type: "speech", text: `大家好，欢迎来到${topic}的第一课。先不急着给定义，我想先问你一个问题：如果你只能用一句话向别人解释${topic}，你会怎么说？带着这个问题，我们开始今天的学习。` },
          { type: "spotlight", x: 360, y: 360, radius: 230, text: "先看这三个问题" },
          { type: "speech", text: "左边这三个问题就是我们今天的路线图。第一个问题关乎定义，第二个问题关乎价值，第三个问题关乎方法。很多人一上来就钻进细节，结果学了后面忘了前面，问题就出在没先看清路线。" },
          { type: "spotlight", x: 945, y: 360, radius: 220, text: "看右侧案例" },
          { type: "speech", text: "再看右边这个案例：同一个团队，引入前后效率差了将近一倍。注意，这里的关键不是工具本身有多神奇，而是使用者在应用之前先建立了系统的认知框架。这也正是本课想要带给你的。" },
          { type: "wb_text", x: 0.5, y: 0.12, text: "先框架，后细节", color: "#b45309" },
          { type: "speech", text: "所以请记住板书上这句话：先框架，后细节。带着这个原则，我们进入下一部分。", },
          { type: "wb_clear" },
        ],
      },
      {
        title: `${topic}的核心概念`,
        content: {
          kind: "slide",
          elements: [
            { type: "text", content: "核心概念", x: 80, y: 70, w: 800, h: 80, fontSize: 44, color: "#111827", bold: true },
            { type: "text", content: "定义：用一句话说清楚它是什么、不是什么", x: 80, y: 200, w: 560, h: 90, fontSize: 26, color: "#374151" },
            { type: "text", content: "特性一：可分解——复杂问题能拆成可操作的小步骤\n特性二：可验证——每一步都有明确的对错判据\n特性三：可迁移——方法能复用到相邻领域", x: 80, y: 310, w: 560, h: 220, fontSize: 24, color: "#374151" },
            { type: "shape", shape: "rect", x: 690, y: 200, w: 510, h: 330, fill: "#f0fdf4" },
            { type: "text", content: "与相近概念的区别：它强调「过程可复现」，而相邻概念只关注「结果正确」——这是初学者最容易混淆的地方。", x: 715, y: 225, w: 460, h: 160, fontSize: 22, color: "#047857" },
            { type: "chart", chart: "bar", data: [{ label: "先学概念", value: 78 }, { label: "跳过概念", value: 31 }], x: 715, y: 400, w: 460, h: 120, unit: "%", color: "#047857" },
            { type: "text", content: "易错点：把「知道名词」当成「理解概念」。检验标准是能否举出一个自己的例子。", x: 80, y: 620, w: 1100, h: 60, fontSize: 22, color: "#b45309" },
          ],
        },
        actions: [
          { type: "speech", text: "我们先明确定义。注意这句话里的两个词：是什么、不是什么。一个清晰的概念必须同时说清边界，否则就只是名词。比如很多人能背出定义，却说不清它和相邻概念的区别，这就是边界模糊。" },
          { type: "wb_draw", points: [[0.07, 0.44], [0.49, 0.44]], color: "#b45309", width: 4 },
          { type: "speech", text: "再看三个特性：可分解、可验证、可迁移。这三个词是有因果顺序的——正因为可分解，每一步才可验证；正因为每一步都可验证，方法才能被复用到别的领域。它们是一个整体。" },
          { type: "spotlight", x: 945, y: 365, radius: 220, text: "区别与数据" },
          { type: "speech", text: "右边这组数据值得留意：先掌握概念再练习的人，进阶完成率是 78%；跳过概念的只有 31%，差了一倍多。学习顺序本身就是效率的一部分。" },
          { type: "wb_text", x: 0.72, y: 0.18, text: "过程可复现 ≠ 结果正确", color: "#047857" },
          { type: "speech", text: "最后是易错点：把知道名词当成理解概念。检验方法很简单——你现在能不能举一个自己生活或工作里的例子？如果举不出来，说明还停留在名词层面。带着这个自测，我们看下一部分的机制。" },
          { type: "wb_clear" },
        ],
      },
      {
        title: `${topic}的运行机制`,
        content: {
          kind: "slide",
          elements: [
            { type: "text", content: "运行机制", x: 80, y: 70, w: 800, h: 80, fontSize: 44, color: "#111827", bold: true },
            { type: "text", content: "整体流程：输入 → 拆解 → 执行 → 校验 → 反馈闭环", x: 80, y: 180, w: 1100, h: 60, fontSize: 26, color: "#374151" },
            { type: "shape", shape: "rect", x: 80, y: 280, w: 240, h: 110, fill: "#eff6ff" },
            { type: "text", content: "拆解：把目标切成可验证的子任务", x: 95, y: 300, w: 210, h: 80, fontSize: 20, color: "#1d4ed8" },
            { type: "shape", shape: "rect", x: 380, y: 280, w: 240, h: 110, fill: "#f0fdf4" },
            { type: "text", content: "执行：按判据逐步推进，不跳步", x: 395, y: 300, w: 210, h: 80, fontSize: 20, color: "#047857" },
            { type: "shape", shape: "rect", x: 680, y: 280, w: 240, h: 110, fill: "#fefce8" },
            { type: "text", content: "校验：用事先定好的标准检验结果", x: 695, y: 300, w: 210, h: 80, fontSize: 20, color: "#b45309" },
            { type: "table", headers: ["步骤", "任务", "完成判据"], rows: [["1", "列提纲", "框架覆盖全部核心概念"], ["2", "收文献", "≥15 篇且含 3 篇综述"], ["3", "写初稿", "每节有论点与论据"], ["4", "核对引用", "引用与原文逐条对应"]], x: 80, y: 430, w: 1100, h: 160, fontSize: 16 },
            { type: "text", content: "易错点：省略校验环节直接进入下一步——问题会累积到最后集中爆发，返工成本成倍增加。", x: 80, y: 620, w: 1100, h: 60, fontSize: 22, color: "#b45309" },
          ],
        },
        actions: [
          { type: "speech", text: "理解了概念，我们看它怎么运转。整体流程是一个闭环：输入进来先拆解，拆成可验证的子任务；然后逐步执行；每一步之后都有校验；校验结果反馈回拆解环节，形成闭环。注意，闭环是关键——开环流程跑一次就结束了，错了也没有修正的机会。" },
          { type: "spotlight", x: 200, y: 335, radius: 180, text: "拆解" },
          { type: "speech", text: "拆解的质量决定了后面的一切。好的拆解有两个特征：每个子任务都足够小，以及每个子任务都有明确的完成判据。「写一篇综述」不是好任务，「列出包含至少 15 篇文献的提纲」才是。" },
          { type: "spotlight", x: 800, y: 335, radius: 180, text: "校验" },
          { type: "speech", text: "校验是大多数人最容易省略的环节。看底部这个易错点：省略校验直接往前走，问题不会消失，只会累积——到最后集中爆发时，返工的成本是逐步修正的好几倍。" },
          { type: "wb_text", x: 0.5, y: 0.85, text: "每一步都要有判据", color: "#b45309" },
          { type: "speech", text: "中间的小例子演示了完整流程怎么落地：四步拆解、四套判据、不达标就回退。你可以拿任何一个正在推进的事情套一遍，感受一下差别。接下来我们看一个完整的真实案例。" },
          { type: "wb_clear" },
        ],
      },
      {
        title: `${topic}真实案例拆解`,
        content: {
          kind: "slide",
          elements: [
            { type: "text", content: "真实案例拆解", x: 80, y: 70, w: 800, h: 80, fontSize: 44, color: "#111827", bold: true },
            { type: "text", content: "背景：2023 年，一家 20 人的内容团队面临产能瓶颈——每人每天只能产出 2 篇合格稿件。", x: 80, y: 190, w: 1100, h: 100, fontSize: 24, color: "#374151" },
            { type: "shape", shape: "rect", x: 80, y: 320, w: 550, h: 240, fill: "#eff6ff" },
            { type: "text", content: "过程还原：\n第 1 步：拆解流程，定位瓶颈在「选题」环节\n第 2 步：引入模板把选题时间从 90 分钟压到 25 分钟\n第 3 步：两周后人均日产出达到 3.5 篇", x: 105, y: 345, w: 500, h: 200, fontSize: 22, color: "#1d4ed8" },
            { type: "text", content: "结果与启示：\n产能提升 75%，但真正起作用的不是模板本身，而是「先测量、再改进」的思维方式。", x: 690, y: 320, w: 510, h: 150, fontSize: 22, color: "#374151" },
            { type: "text", content: "延伸思考：如果把同样的方法搬到你的工作里，第一个该测量的环节是什么？", x: 690, y: 490, w: 510, h: 80, fontSize: 22, color: "#6b7280" },
          ],
        },
        actions: [
          { type: "speech", text: "这节课我们看一个真实案例。2023 年，一家 20 人的内容团队遇到了典型的产能瓶颈：每人每天只能写出 2 篇合格稿件，加班也解决不了。他们的第一反应是招人，但成本不允许。" },
          { type: "spotlight", x: 355, y: 440, radius: 230, text: "三步过程" },
          { type: "speech", text: "他们后来做了三件事。第一步不是动手改，而是先拆解流程、测量每个环节的耗时，发现瓶颈竟然不在写作，而在选题——平均每篇要花 90 分钟。第二步引入模板，把选题压到 25 分钟。第三步才是固化流程。两周后人均日产出从 2 篇涨到 3.5 篇，提升 75%。" },
          { type: "spotlight", x: 945, y: 395, radius: 220, text: "启示" },
          { type: "speech", text: "请注意，真正起作用的不是模板，而是「先测量、再改进」这个顺序。如果他们一上来就引入模板，大概率会把模板用在错误的环节上。顺序错了，工具越好越浪费。" },
          { type: "wb_text", x: 0.5, y: 0.88, text: "先测量，再改进", color: "#b45309" },
          { type: "speech", text: "右边留了一个延伸问题：如果搬到你的工作里，第一个该测量的环节是什么？建议你课后真的去测一次，这比再看十篇文章都有用。" },
          { type: "wb_clear" },
        ],
      },
      {
        title: "随堂测验",
        content: {
          kind: "quiz",
          question: `某同学学习${topic}时，直接从刷题开始、跳过核心概念，最可能遇到的问题是？`,
          options: [
            "做题速度比别人慢，但没有其他影响",
            "遇到变形题就无从下手，因为缺少可迁移的概念框架",
            "只要题量足够大，就一定能弥补概念缺失",
            "核心概念对解题没有帮助，跳过是高效的做法",
          ],
          answerIndex: 1,
          explanation: "正确答案是 B。A 错在低估了影响：问题不在速度，而在面对没见过的变形题时缺乏拆解依据。C 是典型的「以量补质」误区，数据已表明跳过概念的完成率只有 31%，刷题无法替代框架。D 恰恰相反——概念框架正是解变形题的依据，跳过它等于放弃迁移能力。",
        },
        actions: [
          { type: "speech", text: "来做一道随堂测验，检验一下前面的学习成果。注意题干里的关键词：跳过核心概念、直接刷题。请凭刚才学到的内容判断，而不是凭感觉。" },
          { type: "spotlight", x: 640, y: 450, radius: 260 },
        ],
      },
      {
        title: "总结与延伸学习",
        content: {
          kind: "slide",
          elements: [
            { type: "text", content: "总结与延伸学习", x: 80, y: 70, w: 800, h: 80, fontSize: 44, color: "#111827", bold: true },
            { type: "text", content: "本课框架回顾：\n· 一个定义（是什么、不是什么）\n· 三个特性（可分解、可验证、可迁移）\n· 两条原则（先框架后细节、先测量再改进）", x: 80, y: 190, w: 560, h: 240, fontSize: 24, color: "#374151" },
            { type: "shape", shape: "rect", x: 690, y: 190, w: 510, h: 240, fill: "#fefce8" },
            { type: "table", headers: ["误区", "正解"], rows: [["知道名词＝理解概念", "能举例才算懂"], ["工具好用＝顺序正确", "先测量再改进"], ["题量够大＝框架牢", "概念先于刷题"]], x: 705, y: 205, w: 480, h: 210, fontSize: 16 },
            { type: "text", content: "延伸路径：下一步可以学习它在跨领域场景中的应用，推荐从「方法论迁移」与「数据驱动的改进循环」两个方向入手。", x: 80, y: 470, w: 1100, h: 100, fontSize: 24, color: "#374151" },
            { type: "text", content: "课后作业：找一个身边的真实流程，完成一次「测量 → 定位瓶颈 → 小步改进」的完整练习。", x: 80, y: 600, w: 1100, h: 70, fontSize: 22, color: "#1d4ed8" },
          ],
        },
        actions: [
          { type: "speech", text: "我们回顾一下今天的内容。一个定义、三个特性、两条原则——这就是本课的全部框架。如果只能记住一句话，请记住：先框架后细节，先测量再改进。这两句话在案例里都得到了验证。" },
          { type: "spotlight", x: 945, y: 310, radius: 220, text: "误区清单" },
          { type: "speech", text: "右边是三个最容易踩的误区，建议你截图保存。以后每当感觉自己「学会了」的时候，拿这张清单对照一遍：能不能举例？顺序对不对？有没有可验证的判据？" },
          { type: "speech", text: "课后作业在底部：找一个身边的真实流程，完整做一次测量、定位瓶颈、小步改进的练习。学习的目标从来不是知道，而是做到。有问题随时在问答区提问，下节课见。" },
        ],
      },
    ],
  });
}
