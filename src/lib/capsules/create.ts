import { traceCapsuleSchema, type TraceCapsule, type TraceStepType } from "@/lib/capsules/schema";

type CreateTraceCapsuleInput = {
  taskId: string;
  stepType: TraceStepType;
  input: string;
  summary: string;
  output: unknown;
  previousPieceCid: string | null;
  metadata?: Record<string, unknown>;
};

export function createTraceCapsule(input: CreateTraceCapsuleInput): TraceCapsule {
  return traceCapsuleSchema.parse({
    capsuleVersion: "1",
    taskId: input.taskId,
    stepId: crypto.randomUUID(),
    stepType: input.stepType,
    input: input.input,
    summary: input.summary,
    output: input.output,
    previousPieceCid: input.previousPieceCid,
    createdAt: new Date().toISOString(),
    metadata: input.metadata ?? {}
  });
}
