import type { Env } from "./types";

export type KnowledgeMatch = {
  articleId: string;
  documentId: string;
  chunk: number;
  score: number;
};

type KnowledgeEnv = Pick<
  Env,
  "AI" | "DB" | "SUPPORT_EMBEDDING_MODEL" | "SUPPORT_KNOWLEDGE"
>;

export async function semanticArticleMatches(
  env: KnowledgeEnv,
  projectId: number,
  query: string,
  limit = 10,
): Promise<KnowledgeMatch[]> {
  const embedding = await embedSupportText(env, query);
  const result = await env.SUPPORT_KNOWLEDGE.query(embedding, {
    topK: Math.min(50, Math.max(limit, limit * 3)),
    namespace: `project:${projectId}`,
    returnMetadata: "all",
  });
  const candidates = result.matches.flatMap((match) => {
    const metadata = match.metadata || {};
    const metadataProject = Number(metadata.project_id);
    const articleId = boundedIdentifier(metadata.source_id);
    const documentId = boundedIdentifier(metadata.document_id);
    const chunk = Number(metadata.chunk);
    if (
      metadataProject !== projectId ||
      !articleId ||
      !documentId ||
      !Number.isSafeInteger(chunk) ||
      chunk < 0 ||
      !Number.isFinite(match.score)
    ) {
      return [];
    }
    return [{ articleId, documentId, chunk, score: Number(match.score) }];
  });
  if (!candidates.length) return [];

  // Vector metadata is treated as an index hint, never as authority. Confirm
  // project ownership and publication in D1 before exposing any source.
  const articleIds = [...new Set(candidates.map((candidate) => candidate.articleId))];
  const rows = await env.DB.prepare(
    `SELECT article.id FROM support_articles article
     INNER JOIN support_knowledge_documents document
       ON document.project_id = article.project_id
      AND document.source_type = 'article' AND document.source_id = article.id
     WHERE article.project_id = ? AND article.status = 'published'
       AND document.status = 'indexed'
       AND article.id IN (${articleIds.map(() => "?").join(", ")})`,
  ).bind(projectId, ...articleIds).all<{ id: string }>();
  const allowed = new Set(rows.results.map((row) => row.id));
  return candidates.filter((candidate) => allowed.has(candidate.articleId)).slice(0, limit);
}

export async function supportKnowledgeContext(
  env: KnowledgeEnv,
  projectId: number,
  query: string,
  limit = 5,
) {
  const matches = await semanticArticleMatches(env, projectId, query, limit);
  if (!matches.length) return [];
  const articleIds = [...new Set(matches.map((match) => match.articleId))];
  const rows = await env.DB.prepare(
    `SELECT id, title, slug, content, updated_at FROM support_articles
     WHERE project_id = ? AND status = 'published'
       AND id IN (${articleIds.map(() => "?").join(", ")})`,
  ).bind(projectId, ...articleIds).all<{
    id: string;
    title: string;
    slug: string;
    content: string;
    updated_at: string;
  }>();
  const articles = new Map(rows.results.map((row) => [row.id, row]));
  return matches.flatMap((match) => {
    const article = articles.get(match.articleId);
    if (!article) return [];
    const content = chunkText(article.content, 3_000)[match.chunk];
    if (!content) return [];
    return [{
      id: article.id,
      title: article.title,
      slug: article.slug,
      excerpt: content,
      score: match.score,
      updated_at: article.updated_at,
    }];
  });
}

export async function embedSupportText(
  env: Pick<Env, "AI" | "SUPPORT_EMBEDDING_MODEL">,
  text: string,
) {
  const normalized = text.trim();
  if (!normalized || normalized.length > 32_000) {
    throw failure("knowledge_query_invalid", "Knowledge query must contain between 1 and 32000 characters");
  }
  const response = await env.AI.run(
    env.SUPPORT_EMBEDDING_MODEL as Parameters<Ai["run"]>[0],
    { text: [normalized] },
  ) as { data?: number[][] };
  const values = response.data?.[0];
  if (!values || values.length !== 1024 || values.some((value) => !Number.isFinite(value))) {
    throw failure("embedding_invalid", "Knowledge embedding result is invalid");
  }
  return values;
}

export function chunkText(value: string, size: number) {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

function boundedIdentifier(value: unknown) {
  const candidate = String(value || "");
  return candidate && candidate.length <= 255 && /^[\p{L}\p{N}][\p{L}\p{N}._:@+\-]{0,254}$/u.test(candidate)
    ? candidate
    : null;
}

function failure(code: string, message: string) {
  return Object.assign(new Error(message), { code, status: 503 });
}
