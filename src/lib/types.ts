// Minimal, permissive GiftContext shape used only by the local-agent-context
// helpers in this standalone package. The full GiftContext lives in the private
// Present Agent app; the hosted MCP only needs enough of it to type the
// optional local-context patch, so this intentionally stays loose.
export interface GiftContext {
  recipient?: {
    interests?: string[];
    wishes?: string[];
    avoids?: string[];
    [key: string]: unknown;
  };
  occasion?: {
    occasionContext?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
