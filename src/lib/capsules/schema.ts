import { z } from "zod";

export const traceStepTypeSchema = z.enum(["plan", "analyze", "answer", "seal"]);

export const filecoinReceiptSchema = z.object({
  pieceCid: z.string().min(1),
  uploadedAt: z.string().datetime(),
  size: z.number().int().nonnegative(),
  requestedCopies: z.number().int().nonnegative().optional(),
  complete: z.boolean().optional(),
  copies: z
    .array(
      z.object({
        providerId: z.string(),
        dataSetId: z.string(),
        pieceId: z.string(),
        role: z.string(),
        retrievalUrl: z.string(),
        isNewDataSet: z.boolean()
      })
    )
    .optional(),
  failedAttempts: z
    .array(
      z.object({
        providerId: z.string(),
        role: z.string(),
        error: z.string(),
        explicit: z.boolean()
      })
    )
    .optional()
});

export const traceCapsuleSchema = z.object({
  capsuleVersion: z.literal("1"),
  taskId: z.string().min(1),
  stepId: z.string().min(1),
  stepType: traceStepTypeSchema,
  input: z.string(),
  summary: z.string(),
  output: z.unknown(),
  previousPieceCid: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown())
});

export const conversationImageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  dataUrl: z.string().min(1)
});

export const conversationMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  images: z.array(conversationImageSchema),
  createdAt: z.string().datetime()
});

export const conversationSnapshotSchema = z.object({
  capsuleVersion: z.literal("conversation-1"),
  conversationId: z.string().min(1),
  title: z.string().min(1),
  note: z.string(),
  messages: z.array(conversationMessageSchema).min(1),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown())
});

export type TraceStepType = z.infer<typeof traceStepTypeSchema>;
export type FilecoinReceipt = z.infer<typeof filecoinReceiptSchema>;
export type TraceCapsule = z.infer<typeof traceCapsuleSchema>;
export type ConversationImage = z.infer<typeof conversationImageSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>;
