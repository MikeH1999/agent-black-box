import { createTraceCapsule } from "@/lib/capsules/create";
import type { FilecoinReceipt, TraceCapsule } from "@/lib/capsules/schema";
import { traceCapsuleSchema } from "@/lib/capsules/schema";
import type { JsonUploadLifecycleEvent } from "@/lib/filecoin/json-storage";
import { uploadJsonPayload } from "@/lib/filecoin/json-storage";
import type { Synapse } from "@filoz/synapse-sdk";

export type AgentWorkflowResult = {
  finalAnswer: string;
  capsules: TraceCapsule[];
};

export type SealedTraceCapsule = {
  capsule: TraceCapsule;
  receipt: FilecoinReceipt;
};

export type SealedAgentWorkflowResult = {
  finalAnswer: string;
  sealedCapsules: SealedTraceCapsule[];
};

type AgentWorkflowOptions = {
  returnAfter?: "complete" | "pieces-added";
  onCapsuleSealed?: (sealedCapsule: SealedTraceCapsule, index: number) => void;
  onUploadLifecycleEvent?: (event: JsonUploadLifecycleEvent, capsule: TraceCapsule, index: number) => void;
};

export function createPlaceholderWorkflow(task: string): AgentWorkflowResult {
  const taskId = crypto.randomUUID();
  return {
    finalAnswer: "The Filecoin-backed workflow scaffold is ready for the next integration step.",
    capsules: [
      createTraceCapsule({
        taskId,
        stepType: "plan",
        input: task,
        summary: "Created a placeholder plan capsule for the initial project skeleton.",
        output: { next: "Connect Synapse SDK and prove upload/download round trip." },
        previousPieceCid: null,
        metadata: {}
      })
    ]
  };
}

export async function runFixedAgentWorkflow(
  synapse: Synapse,
  task: string,
  options: AgentWorkflowOptions = {}
): Promise<SealedAgentWorkflowResult> {
  const taskId = crypto.randomUUID();
  const sealedCapsules: SealedTraceCapsule[] = [];
  let previousPieceCid: string | null = null;
  const taskModel = buildTaskModel(task);

  const plan = createTraceCapsule({
    taskId,
    stepType: "plan",
    input: task,
    summary: `Planned a ${taskModel.intentLabel} workflow for the requested task.`,
    output: {
      intent: taskModel.intent,
      subject: taskModel.subject,
      steps: taskModel.steps
    },
    previousPieceCid,
    metadata: { workflow: "task-aware-demo" }
  });
  previousPieceCid = await sealCapsule(synapse, plan, sealedCapsules, options);

  const analysis = createTraceCapsule({
    taskId,
    stepType: "analyze",
    input: task,
    summary: `Analyzed the task focus, expected output, and Filecoin trace value for ${taskModel.subject}.`,
    output: {
      intent: taskModel.intent,
      filecoinFit: taskModel.filecoinFit,
      expectedOutput: taskModel.expectedOutput,
      traceValue: "the reasoning path is sealed step-by-step, so the final answer can be restored and audited by PieceCID",
      demoRisk: taskModel.risk
    },
    previousPieceCid,
    metadata: { workflow: "task-aware-demo" }
  });
  previousPieceCid = await sealCapsule(synapse, analysis, sealedCapsules, options);

  const finalAnswer = buildTaskSpecificAnswer(taskModel);

  const answer = createTraceCapsule({
    taskId,
    stepType: "answer",
    input: task,
    summary: `Produced a task-specific answer for ${taskModel.subject}.`,
    output: {
      finalAnswer
    },
    previousPieceCid,
    metadata: { workflow: "task-aware-demo" }
  });
  previousPieceCid = await sealCapsule(synapse, answer, sealedCapsules, options);

  const seal = createTraceCapsule({
    taskId,
    stepType: "seal",
    input: task,
    summary: "Closed the trace chain with a final capsule that points to the previous answer capsule.",
    output: {
      traceLength: sealedCapsules.length + 1,
      intent: taskModel.intent,
      previousPieceCid
    },
    previousPieceCid,
    metadata: { workflow: "task-aware-demo" }
  });
  await sealCapsule(synapse, seal, sealedCapsules, options);

  return {
    finalAnswer,
    sealedCapsules
  };
}

type TaskModel = {
  originalTask: string;
  subject: string;
  intent: "brainstorm" | "checklist" | "debug" | "explain" | "write" | "evaluate" | "general";
  intentLabel: string;
  expectedOutput: string;
  filecoinFit: "strong" | "medium" | "light";
  risk: string;
  steps: string[];
};

function buildTaskModel(task: string): TaskModel {
  const normalizedTask = task.replace(/\s+/g, " ").trim();
  const safeTask = normalizedTask.length > 0 ? normalizedTask : "Untitled task";
  const lowerTask = safeTask.toLowerCase();
  const subject = safeTask.length > 120 ? `${safeTask.slice(0, 117)}...` : safeTask;
  const intent = inferIntent(lowerTask);
  const filecoinFit = inferFilecoinFit(lowerTask);

  return {
    originalTask: safeTask,
    subject,
    intent,
    intentLabel: getIntentLabel(intent),
    expectedOutput: getExpectedOutput(intent),
    filecoinFit,
    risk: getRisk(intent, filecoinFit),
    steps: getTaskSteps(intent)
  };
}

function inferIntent(lowerTask: string): TaskModel["intent"] {
  if (containsAny(lowerTask, ["brainstorm", "idea", "ideas", "头脑风暴", "创意", "想法"])) {
    return "brainstorm";
  }

  if (containsAny(lowerTask, ["todo", "checklist", "plan", "清单", "待办", "步骤", "计划", "开发顺序"])) {
    return "checklist";
  }

  if (containsAny(lowerTask, ["bug", "debug", "fix", "error", "卡住", "报错", "修复", "问题"])) {
    return "debug";
  }

  if (containsAny(lowerTask, ["explain", "why", "what is", "解释", "说明", "作用", "是什么", "为什么"])) {
    return "explain";
  }

  if (containsAny(lowerTask, ["write", "draft", "copy", "生成", "撰写", "写一", "文案"])) {
    return "write";
  }

  if (containsAny(lowerTask, ["evaluate", "score", "rank", "compare", "评估", "排序", "比较", "打分"])) {
    return "evaluate";
  }

  return "general";
}

function inferFilecoinFit(lowerTask: string): TaskModel["filecoinFit"] {
  if (containsAny(lowerTask, ["filecoin", "synapse", "piececid", "piece cid", "foc", "onchain", "proof", "storage", "链", "上链", "证明", "存储"])) {
    return "strong";
  }

  if (containsAny(lowerTask, ["agent", "audit", "log", "trace", "verify", "memory", "代理", "日志", "验证", "记忆", "追踪"])) {
    return "medium";
  }

  return "light";
}

function containsAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function getIntentLabel(intent: TaskModel["intent"]) {
  switch (intent) {
    case "brainstorm":
      return "brainstorming";
    case "checklist":
      return "execution planning";
    case "debug":
      return "debugging";
    case "explain":
      return "explanation";
    case "write":
      return "writing";
    case "evaluate":
      return "evaluation";
    case "general":
      return "general reasoning";
  }
}

function getExpectedOutput(intent: TaskModel["intent"]) {
  switch (intent) {
    case "brainstorm":
      return "a small set of distinct ideas with clear mechanisms and MVP paths";
    case "checklist":
      return "an ordered, buildable checklist focused on the critical path";
    case "debug":
      return "a diagnosis, likely cause, and concrete fix or verification step";
    case "explain":
      return "a concise explanation that names the component, purpose, and user-facing behavior";
    case "write":
      return "a polished draft that can be reused directly";
    case "evaluate":
      return "a ranked assessment with tradeoffs and a recommendation";
    case "general":
      return "a concise answer with practical next steps";
  }
}

function getRisk(intent: TaskModel["intent"], filecoinFit: TaskModel["filecoinFit"]) {
  if (filecoinFit === "light") {
    return "the task may not naturally need Filecoin, so the trace should emphasize auditability instead of storage for its own sake";
  }

  if (intent === "debug") {
    return "live wallet signing, provider latency, or upload confirmation can obscure whether the fix worked";
  }

  return "the main risk is making the Filecoin trace visible without slowing down the user workflow";
}

function getTaskSteps(intent: TaskModel["intent"]) {
  switch (intent) {
    case "brainstorm":
      return ["extract constraints", "generate differentiated options", "rank by buildability and Filecoin fit"];
    case "checklist":
      return ["identify critical path", "order implementation steps", "separate MVP from optional work"];
    case "debug":
      return ["reproduce the symptom", "isolate the failing layer", "ship the smallest verifiable fix"];
    case "explain":
      return ["name the component", "explain what it controls", "connect it to the user workflow"];
    case "write":
      return ["identify audience", "draft the core message", "tighten for demo clarity"];
    case "evaluate":
      return ["define scoring criteria", "assess strengths and risks", "recommend the best next move"];
    case "general":
      return ["understand the request", "produce an actionable response", "seal the reasoning trace"];
  }
}

function buildTaskSpecificAnswer(taskModel: TaskModel) {
  switch (taskModel.intent) {
    case "brainstorm":
      return `For "${taskModel.subject}", I would generate options that each have one obvious user action, one visible Filecoin primitive, and a demo path under 90 seconds. The strongest direction is the one where Filecoin changes the product experience, not just where files are uploaded. Next step: pick 2-3 candidate mechanisms, score them by build speed and Filecoin visibility, then seal the chosen rationale as the final trace.`;
    case "checklist":
      return `For "${taskModel.subject}", the right output is an ordered checklist: prove wallet connection first, prove one Filecoin write second, prove restore/verify third, then polish UI and demo copy. Keep optional features behind the critical path. The trace should show why each step was chosen, so the final PieceCID becomes a recoverable project decision record.`;
    case "debug":
      return `For "${taskModel.subject}", I would debug from the observable boundary inward: confirm the UI event fires, confirm the wallet or API call starts, confirm the Synapse lifecycle event arrives, then confirm the PieceCID can be restored. The likely fix should make the first successful Filecoin message visible immediately, because waiting for full confirmation makes the product feel frozen.`;
    case "explain":
      return `For "${taskModel.subject}", the short explanation is: this part exists to turn an agent action into a verifiable Filecoin trace. The user gives an input, the app creates plan/analyze/answer/seal capsules, and each capsule gets a PieceCID. The final PieceCID is the handle that restores the whole reasoning chain.`;
    case "write":
      return `Draft for "${taskModel.subject}": Agent Black Box turns an AI agent run into a Filecoin-backed audit trail. Every major step is sealed as a trace capsule, and the final PieceCID restores the full chain. The demo is simple: connect MetaMask, run a task, watch Filecoin messages appear, then verify any step directly from storage.`;
    case "evaluate":
      return `For "${taskModel.subject}", my assessment is: the idea is strongest if the Filecoin primitive is visible in the main loop, medium if it only stores a final artifact, and weak if it behaves like a normal upload app. Recommendation: optimize the demo around the moment a message is submitted and a PieceCID appears, because that is the clearest proof that the agent's reasoning became retrievable infrastructure.`;
    case "general":
      return `For "${taskModel.subject}", I would answer with a practical path: define the desired result, perform the smallest useful analysis, then produce a concrete next action. In this app, that reasoning is not ephemeral: the plan, analysis, answer, and seal steps are each stored as linked Filecoin trace capsules.`;
  }
}

async function sealCapsule(
  synapse: Synapse,
  capsule: TraceCapsule,
  sealedCapsules: SealedTraceCapsule[],
  options: AgentWorkflowOptions
): Promise<string> {
  const validatedCapsule = traceCapsuleSchema.parse(capsule);
  const capsuleIndex = sealedCapsules.length;
  const upload = await uploadJsonPayload(synapse, validatedCapsule, {
    capsuleVersion: validatedCapsule.capsuleVersion,
    stepType: validatedCapsule.stepType,
    taskId: validatedCapsule.taskId
  }, {
    returnAfter: options.returnAfter,
    onLifecycleEvent(event) {
      options.onUploadLifecycleEvent?.(event, validatedCapsule, capsuleIndex);
    }
  });
  const receipt: FilecoinReceipt = {
    pieceCid: upload.pieceCid,
    uploadedAt: new Date().toISOString(),
    size: upload.size,
    requestedCopies: upload.requestedCopies,
    complete: upload.complete,
    copies: upload.copies,
    failedAttempts: upload.failedAttempts
  };

  const sealedCapsule = {
    capsule: validatedCapsule,
    receipt
  };

  sealedCapsules.push(sealedCapsule);
  options.onCapsuleSealed?.(sealedCapsule, sealedCapsules.length - 1);

  return receipt.pieceCid;
}
