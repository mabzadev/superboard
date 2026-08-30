import { describe, expect, it, vi } from "vitest";
import {
  embedSupportText,
  semanticArticleMatches,
  supportKnowledgeContext,
} from "./knowledge";

describe("Support semantic knowledge", () => {
  it("queries only the project namespace and revalidates vector metadata in D1", async () => {
    const bind = vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({ results: [{ id: "article-allowed" }] }),
    });
    const prepare = vi.fn().mockReturnValue({ bind });
    const query = vi.fn().mockResolvedValue({
      matches: [
        {
          id: "document-1:0",
          score: 0.95,
          metadata: {
            project_id: 12,
            document_id: "document-1",
            source_id: "article-allowed",
            chunk: 0,
          },
        },
        {
          id: "document-foreign:0",
          score: 0.99,
          metadata: {
            project_id: 13,
            document_id: "document-foreign",
            source_id: "article-foreign",
            chunk: 0,
          },
        },
      ],
      count: 2,
    });
    const env = {
      AI: { run: vi.fn().mockResolvedValue({ data: [Array(1024).fill(0.25)] }) },
      DB: { prepare },
      SUPPORT_EMBEDDING_MODEL: "embedding-model",
      SUPPORT_KNOWLEDGE: { query },
    } as unknown as Parameters<typeof semanticArticleMatches>[0];

    await expect(semanticArticleMatches(env, 12, "billing question", 5))
      .resolves.toEqual([{
        articleId: "article-allowed",
        documentId: "document-1",
        chunk: 0,
        score: 0.95,
      }]);
    expect(query).toHaveBeenCalledWith(expect.any(Array), {
      topK: 15,
      namespace: "project:12",
      returnMetadata: "all",
    });
    expect(bind).toHaveBeenCalledWith(12, "article-allowed");
  });

  it("returns bounded source excerpts and rejects malformed embeddings", async () => {
    const articleContent = `${"A".repeat(3_000)}second chunk`;
    const all = vi.fn()
      .mockResolvedValueOnce({ results: [{ id: "article-1" }] })
      .mockResolvedValueOnce({
        results: [{
          id: "article-1",
          title: "Article one",
          slug: "article-one",
          content: articleContent,
          updated_at: "2026-08-13T00:00:00.000Z",
        }],
      });
    const env = {
      AI: { run: vi.fn().mockResolvedValue({ data: [Array(1024).fill(0.5)] }) },
      DB: { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ all }) }) },
      SUPPORT_EMBEDDING_MODEL: "embedding-model",
      SUPPORT_KNOWLEDGE: {
        query: vi.fn().mockResolvedValue({
          matches: [{
            id: "document-1:1",
            score: 0.8,
            metadata: {
              project_id: 12,
              document_id: "document-1",
              source_id: "article-1",
              chunk: 1,
            },
          }],
          count: 1,
        }),
      },
    } as unknown as Parameters<typeof supportKnowledgeContext>[0];
    await expect(supportKnowledgeContext(env, 12, "second", 3)).resolves.toEqual([{
      id: "article-1",
      title: "Article one",
      slug: "article-one",
      excerpt: "second chunk",
      score: 0.8,
      updated_at: "2026-08-13T00:00:00.000Z",
    }]);

    await expect(embedSupportText({
      AI: { run: vi.fn().mockResolvedValue({ data: [[1, 2]] }) },
      SUPPORT_EMBEDDING_MODEL: "embedding-model",
    } as unknown as Parameters<typeof embedSupportText>[0], "query"))
      .rejects.toMatchObject({ code: "embedding_invalid", status: 503 });
  });
});
