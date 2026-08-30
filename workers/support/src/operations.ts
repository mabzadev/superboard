import { Hono, type Handler } from 'hono';
import type { Env } from './types';
import { readJsonObject } from './validation';
import { executeMacro } from './workflows';
import { recordSlaResolution } from './service-levels';

const operations = new Hono<{ Bindings: Env }>();
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_TRANSCRIPT_BODY = 8_000;
const INDEFINITE_MUTE = '9999-12-31T23:59:59.999Z';

operations.get('/:projectId/contacts', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const query = optionalQuery(c.req.query('q'), 'q', 255);
  const page = pageInput(c.req.query('limit'), c.req.query('cursor'));
  const like = `%${escapeLike(query)}%`;
  const rows = await c.env.DB.prepare(`
    SELECT contact.*, company.name AS company_name,
      (SELECT COUNT(*) FROM conversations conversation
       WHERE conversation.project_id = contact.project_id
         AND conversation.external_user_id = contact.external_user_id) AS conversation_count
    FROM support_contacts contact
    LEFT JOIN support_companies company
      ON company.id = contact.company_id AND company.project_id = contact.project_id
    WHERE contact.project_id = ?
      AND (? = '' OR contact.external_user_id LIKE ? ESCAPE '\\'
        OR COALESCE(contact.name, '') LIKE ? ESCAPE '\\'
        OR COALESCE(contact.email, '') LIKE ? ESCAPE '\\'
        OR COALESCE(contact.phone, '') LIKE ? ESCAPE '\\')
      AND (? IS NULL OR contact.updated_at < ?
        OR (contact.updated_at = ? AND contact.id < ?))
    ORDER BY contact.updated_at DESC, contact.id DESC LIMIT ?
  `).bind(
    projectId, query, like, like, like, like,
    page.cursor?.updated_at ?? null, page.cursor?.updated_at ?? null,
    page.cursor?.updated_at ?? null, page.cursor?.id ?? null, page.limit + 1,
  ).all<Record<string, unknown>>();
  return c.json(pageResponse(rows.results, page.limit, serializeContact));
});

operations.post('/:projectId/contacts', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const input = contactInput(await readJsonObject(c.req.raw));
  if (input.company_id) await company(c.env.DB, projectId, input.company_id);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO support_contacts (
          id, project_id, external_user_id, name, email, phone, company_id, avatar_url,
          blocked, custom_attributes_json, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, projectId, input.external_user_id, input.name, input.email, input.phone,
        input.company_id, input.avatar_url, input.blocked ? 1 : 0,
        JSON.stringify(input.custom_attributes), input.last_seen_at),
      auditStatement(c.env.DB, projectId, 'contact', id, 'created', actorId, {
        company_id: input.company_id,
        has_avatar: Boolean(input.avatar_url),
      }),
    ]);
  } catch (error) {
    throw conflict(error, 'contact_conflict', 'A contact with this identity or email already exists');
  }
  return c.json({ data: serializeContact(await contact(c.env.DB, projectId, id)) }, 201);
});

operations.post('/:projectId/contacts/imports', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const queue = c.env.SUPPORT_BULK_QUEUE;
  if (!queue) throw failure('support_bulk_unavailable', 'Support bulk processing is not configured', 503);
  const body = await readJsonObject(c.req.raw);
  const storageKey = objectKey(body.storage_key, 'storage_key');
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO support_import_jobs (id, project_id, resource_type, storage_key, created_by)
      VALUES (?, ?, 'contacts', ?, ?)
    `).bind(id, projectId, storageKey, actorId),
    auditStatement(c.env.DB, projectId, 'contact_import', id, 'queued', actorId, {}),
  ]);
  try {
    await sendBulkJob(queue, { type: 'support.import.requested.v1', projectId, importId: id });
  } catch {
    await markBulkJobFailed(c.env.DB, 'support_import_jobs', projectId, id);
    throw failure('support_bulk_unavailable', 'Support bulk processing is temporarily unavailable', 503);
  }
  return c.json({ data: await importJob(c.env.DB, projectId, id) }, 202);
});

operations.get('/:projectId/contacts/imports', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  return c.json(await listJobs(c.env.DB, projectId, 'support_import_jobs', c.req.query('limit'), c.req.query('cursor')));
});

operations.get('/:projectId/contacts/imports/:jobId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  return c.json({ data: await importJob(c.env.DB, projectId, identifier(c.req.param('jobId'), 'job_id')) });
});

operations.post('/:projectId/contacts/exports', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const queue = c.env.SUPPORT_BULK_QUEUE;
  if (!queue) throw failure('support_bulk_unavailable', 'Support bulk processing is not configured', 503);
  const body = await readJsonObject(c.req.raw);
  const filters = object(body.filters ?? {}, 'filters', 8_000);
  assertNoSensitiveFields(filters, 'filters');
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO support_export_jobs (id, project_id, resource_type, filters_json, created_by)
      VALUES (?, ?, 'contacts', ?, ?)
    `).bind(id, projectId, JSON.stringify(filters), actorId),
    auditStatement(c.env.DB, projectId, 'contact_export', id, 'queued', actorId, {}),
  ]);
  try {
    await sendBulkJob(queue, { type: 'support.export.requested.v1', projectId, exportId: id });
  } catch {
    await markBulkJobFailed(c.env.DB, 'support_export_jobs', projectId, id);
    throw failure('support_bulk_unavailable', 'Support bulk processing is temporarily unavailable', 503);
  }
  return c.json({ data: await exportJob(c.env.DB, projectId, id) }, 202);
});

operations.get('/:projectId/contacts/exports', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  return c.json(await listJobs(c.env.DB, projectId, 'support_export_jobs', c.req.query('limit'), c.req.query('cursor')));
});

operations.get('/:projectId/contacts/exports/:jobId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  return c.json({ data: await exportJob(c.env.DB, projectId, identifier(c.req.param('jobId'), 'job_id')) });
});

operations.get('/:projectId/contacts/exports/:jobId/download', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const jobId = identifier(c.req.param('jobId'), 'job_id');
  const job = await c.env.DB.prepare(`SELECT status, storage_key FROM support_export_jobs
    WHERE project_id = ? AND resource_type = 'contacts' AND id = ?`).bind(projectId, jobId)
    .first<{ status: string; storage_key: string | null }>();
  if (!job) throw failure('contact_export_not_found', 'Contact export job not found', 404);
  if (job.status !== 'completed' || !job.storage_key) {
    throw failure('contact_export_not_ready', 'Contact export is not ready', 409);
  }
  const object = await c.env.ATTACHMENTS.get(job.storage_key);
  if (!object) throw failure('contact_export_unavailable', 'Contact export is temporarily unavailable', 503);
  return new Response(object.body, {
    headers: {
      'cache-control': 'private, no-store',
      'content-disposition': `attachment; filename="support-contacts-${jobId}.json"`,
      'content-type': object.httpMetadata?.contentType || 'application/json',
      'x-content-type-options': 'nosniff',
    },
  });
});

operations.get('/:projectId/contacts/:contactId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const row = await contact(c.env.DB, projectId, c.req.param('contactId'));
  const [conversations, labels, inboxes, attachments] = await Promise.all([
    c.env.DB.prepare(`
      SELECT * FROM conversations WHERE project_id = ? AND external_user_id = ?
      ORDER BY updated_at DESC, id DESC LIMIT 100
    `).bind(projectId, row.external_user_id).all<Record<string, unknown>>(),
    contactLabels(c.env.DB, projectId, String(row.id)),
    contactInboxes(c.env.DB, projectId, String(row.id)),
    c.env.DB.prepare(`
      SELECT attachment.id, attachment.conversation_id, attachment.message_id,
        attachment.file_name, attachment.content_type, attachment.byte_size,
        attachment.position, attachment.created_at
      FROM support_message_attachments attachment
      INNER JOIN conversations conversation ON conversation.id = attachment.conversation_id
      WHERE attachment.project_id = ? AND conversation.project_id = ?
        AND conversation.external_user_id = ?
      ORDER BY attachment.created_at DESC, attachment.id DESC LIMIT 100
    `).bind(projectId, projectId, row.external_user_id).all<Record<string, unknown>>(),
  ]);
  return c.json({
    data: {
      ...serializeContact(row),
      conversations: conversations.results.map(serializeConversation),
      labels,
      inboxes,
      attachments: attachments.results.map(serializeAttachment),
    },
  });
});

operations.patch('/:projectId/contacts/:contactId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const before = await contact(c.env.DB, projectId, c.req.param('contactId'));
  const body = await readJsonObject(c.req.raw);
  const merged = contactInput({
    ...serializeContact(before), ...body,
    custom_attributes: body.custom_attributes ?? parseJson(before.custom_attributes_json, {}),
  });
  if (merged.company_id) await company(c.env.DB, projectId, merged.company_id);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE support_contacts SET external_user_id = ?, name = ?, email = ?, phone = ?,
          company_id = ?, avatar_url = ?, blocked = ?, custom_attributes_json = ?, last_seen_at = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE project_id = ? AND id = ?
      `).bind(merged.external_user_id, merged.name, merged.email, merged.phone, merged.company_id,
        merged.avatar_url, merged.blocked ? 1 : 0, JSON.stringify(merged.custom_attributes),
        merged.last_seen_at, projectId, c.req.param('contactId')),
      auditStatement(c.env.DB, projectId, 'contact', String(before.id), 'updated', actorId, {
        company_id: merged.company_id,
        has_avatar: Boolean(merged.avatar_url),
      }),
    ]);
  } catch (error) {
    throw conflict(error, 'contact_conflict', 'A contact with this identity or email already exists');
  }
  return c.json({ data: serializeContact(await contact(c.env.DB, projectId, c.req.param('contactId'))) });
});

operations.delete('/:projectId/contacts/:contactId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const contactId = identifier(c.req.param('contactId'), 'contact_id');
  const actorId = requestActor(c.req.header.bind(c.req));
  await contact(c.env.DB, projectId, contactId);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM support_contacts WHERE project_id = ? AND id = ?').bind(projectId, contactId),
    auditStatement(c.env.DB, projectId, 'contact', contactId, 'deleted', actorId, {}),
  ]);
  return c.json({ data: { id: contactId, deleted: true } });
});

operations.post('/:projectId/contacts/:contactId/merge', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const sourceId = identifier(c.req.param('contactId'), 'contact_id');
  const actorId = requestActor(c.req.header.bind(c.req));
  const body = await readJsonObject(c.req.raw);
  const targetId = identifier(body.target_contact_id, 'target_contact_id');
  if (sourceId === targetId) throw failure('contact_merge_invalid', 'Source and target contacts must be different');
  const [source, target] = await Promise.all([
    contact(c.env.DB, projectId, sourceId),
    contact(c.env.DB, projectId, targetId),
  ]);
  const collision = await c.env.DB.prepare(`
    SELECT 1 collision FROM conversations source
    INNER JOIN conversations target
      ON target.project_id = source.project_id
      AND target.external_user_id = ?
      AND target.client_conversation_id = source.client_conversation_id
    WHERE source.project_id = ? AND source.external_user_id = ? LIMIT 1
  `).bind(target.external_user_id, projectId, source.external_user_id).first();
  if (collision) throw failure('contact_merge_conflict', 'Contacts contain conflicting conversations', 409);
  const targetAttributes = object(parseJson(target.custom_attributes_json, {}), 'custom_attributes', 8_000);
  const sourceAttributes = object(parseJson(source.custom_attributes_json, {}), 'custom_attributes', 8_000);
  const mergedAttributes = { ...sourceAttributes, ...targetAttributes };
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE conversations SET external_user_id = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND external_user_id = ?`).bind(target.external_user_id, projectId, source.external_user_id),
    c.env.DB.prepare('UPDATE support_contact_notes SET contact_id = ? WHERE project_id = ? AND contact_id = ?')
      .bind(targetId, projectId, sourceId),
    c.env.DB.prepare('UPDATE OR IGNORE support_contact_events SET contact_id = ? WHERE project_id = ? AND contact_id = ?')
      .bind(targetId, projectId, sourceId),
    c.env.DB.prepare('DELETE FROM support_contact_events WHERE project_id = ? AND contact_id = ?').bind(projectId, sourceId),
    c.env.DB.prepare('UPDATE support_campaign_deliveries SET contact_id = ? WHERE project_id = ? AND contact_id = ?')
      .bind(targetId, projectId, sourceId),
    c.env.DB.prepare('UPDATE OR IGNORE support_contact_inboxes SET contact_id = ? WHERE project_id = ? AND contact_id = ?')
      .bind(targetId, projectId, sourceId),
    c.env.DB.prepare('DELETE FROM support_contact_inboxes WHERE project_id = ? AND contact_id = ?').bind(projectId, sourceId),
    c.env.DB.prepare('UPDATE OR IGNORE support_contact_labels SET contact_id = ? WHERE project_id = ? AND contact_id = ?')
      .bind(targetId, projectId, sourceId),
    c.env.DB.prepare('DELETE FROM support_contact_labels WHERE project_id = ? AND contact_id = ?').bind(projectId, sourceId),
    c.env.DB.prepare('DELETE FROM support_contacts WHERE project_id = ? AND id = ?').bind(projectId, sourceId),
    c.env.DB.prepare(`UPDATE support_contacts SET
      name = COALESCE(name, ?), email = COALESCE(email, ?), phone = COALESCE(phone, ?),
      company_id = COALESCE(company_id, ?), avatar_url = COALESCE(avatar_url, ?),
      blocked = CASE WHEN blocked = 1 OR ? = 1 THEN 1 ELSE 0 END,
      custom_attributes_json = ?, last_seen_at = CASE
        WHEN last_seen_at IS NULL OR (? IS NOT NULL AND ? > last_seen_at) THEN ? ELSE last_seen_at END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND id = ?`).bind(
      source.name, source.email, source.phone, source.company_id, source.avatar_url,
      Number(source.blocked), JSON.stringify(mergedAttributes), source.last_seen_at,
      source.last_seen_at, source.last_seen_at, projectId, targetId,
    ),
    auditStatement(c.env.DB, projectId, 'contact', targetId, 'merged', actorId, {
      source_contact_id: sourceId,
      target_contact_id: targetId,
    }),
  ]);
  return c.json({ data: { contact: serializeContact(await contact(c.env.DB, projectId, targetId)), merged_contact_id: sourceId } });
});

operations.get('/:projectId/contacts/:contactId/labels', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const contactId = identifier(c.req.param('contactId'), 'contact_id');
  await contact(c.env.DB, projectId, contactId);
  return c.json({ data: await contactLabels(c.env.DB, projectId, contactId) });
});

operations.put('/:projectId/contacts/:contactId/labels', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const contactId = identifier(c.req.param('contactId'), 'contact_id');
  const actorId = requestActor(c.req.header.bind(c.req));
  await contact(c.env.DB, projectId, contactId);
  const body = await readJsonObject(c.req.raw);
  const labelIds = identifierArray(body.label_ids, 'label_ids', MAX_PAGE_LIMIT);
  if (labelIds.length) await requireLabels(c.env.DB, projectId, labelIds);
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare('DELETE FROM support_contact_labels WHERE project_id = ? AND contact_id = ?').bind(projectId, contactId),
    ...labelIds.map((labelId) => c.env.DB.prepare(`
      INSERT INTO support_contact_labels (project_id, contact_id, label_id, created_by)
      VALUES (?, ?, ?, ?)
    `).bind(projectId, contactId, labelId, actorId)),
    auditStatement(c.env.DB, projectId, 'contact', contactId, 'labels.updated', actorId, { label_ids: labelIds }),
  ];
  await c.env.DB.batch(statements);
  return c.json({ data: await contactLabels(c.env.DB, projectId, contactId) });
});

operations.get('/:projectId/contacts/:contactId/inboxes', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const contactId = identifier(c.req.param('contactId'), 'contact_id');
  await contact(c.env.DB, projectId, contactId);
  return c.json({ data: await contactInboxes(c.env.DB, projectId, contactId) });
});

operations.post('/:projectId/contacts/:contactId/inboxes', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const contactId = identifier(c.req.param('contactId'), 'contact_id');
  const actorId = requestActor(c.req.header.bind(c.req));
  await contact(c.env.DB, projectId, contactId);
  const body = await readJsonObject(c.req.raw);
  const inboxId = identifier(body.inbox_id, 'inbox_id');
  await inbox(c.env.DB, projectId, inboxId);
  const sourceId = identifier(body.source_id, 'source_id');
  const metadata = object(body.metadata ?? {}, 'metadata', 4_000);
  assertNoSensitiveFields(metadata, 'metadata');
  const id = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO support_contact_inboxes
          (id, project_id, contact_id, inbox_id, source_id, verified, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, projectId, contactId, inboxId, sourceId, body.verified === true ? 1 : 0, JSON.stringify(metadata)),
      auditStatement(c.env.DB, projectId, 'contact_inbox', id, 'created', actorId, {
        contact_id: contactId,
        inbox_id: inboxId,
      }),
    ]);
  } catch (error) {
    throw conflict(error, 'contact_inbox_conflict', 'This inbox identity is already associated');
  }
  const created = await c.env.DB.prepare(`
    SELECT association.*, inbox.name AS inbox_name, inbox.channel_type, inbox.status AS inbox_status
    FROM support_contact_inboxes association
    INNER JOIN support_inboxes inbox ON inbox.id = association.inbox_id
    WHERE association.project_id = ? AND association.id = ?
  `).bind(projectId, id).first<Record<string, unknown>>();
  return c.json({ data: serializeContactInbox(created || {}) }, 201);
});

operations.delete('/:projectId/contacts/:contactId/inboxes/:associationId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const contactId = identifier(c.req.param('contactId'), 'contact_id');
  const associationId = identifier(c.req.param('associationId'), 'association_id');
  const actorId = requestActor(c.req.header.bind(c.req));
  const existing = await c.env.DB.prepare(`
    SELECT id, inbox_id FROM support_contact_inboxes
    WHERE project_id = ? AND contact_id = ? AND id = ?
  `).bind(projectId, contactId, associationId).first<Record<string, unknown>>();
  if (!existing) throw failure('contact_inbox_not_found', 'Contact inbox association not found', 404);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM support_contact_inboxes WHERE project_id = ? AND contact_id = ? AND id = ?')
      .bind(projectId, contactId, associationId),
    auditStatement(c.env.DB, projectId, 'contact_inbox', associationId, 'deleted', actorId, {
      contact_id: contactId,
      inbox_id: existing.inbox_id,
    }),
  ]);
  return c.json({ data: { id: associationId, deleted: true } });
});

operations.get('/:projectId/contacts/:contactId/notes', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  await contact(c.env.DB, projectId, c.req.param('contactId'));
  const rows = await c.env.DB.prepare(`
    SELECT * FROM support_contact_notes WHERE project_id = ? AND contact_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 100
  `).bind(projectId, c.req.param('contactId')).all();
  return c.json({ data: rows.results });
});

operations.post('/:projectId/contacts/:contactId/notes', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  await contact(c.env.DB, projectId, c.req.param('contactId'));
  const body = await readJsonObject(c.req.raw);
  const content = text(body.content, 'content', 8_000);
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO support_contact_notes (id, project_id, contact_id, content, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, projectId, c.req.param('contactId'), content, actorId),
    auditStatement(c.env.DB, projectId, 'contact_note', id, 'created', actorId, { contact_id: c.req.param('contactId') }),
  ]);
  return c.json({ data: await c.env.DB.prepare('SELECT * FROM support_contact_notes WHERE id = ? AND project_id = ?')
    .bind(id, projectId).first() }, 201);
});

operations.delete('/:projectId/contacts/:contactId/notes/:noteId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const row = await c.env.DB.prepare(`
    SELECT id FROM support_contact_notes WHERE id = ? AND contact_id = ? AND project_id = ?
  `).bind(c.req.param('noteId'), c.req.param('contactId'), projectId).first();
  if (!row) throw failure('contact_note_not_found', 'Contact note not found', 404);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM support_contact_notes WHERE id = ? AND contact_id = ? AND project_id = ?')
      .bind(c.req.param('noteId'), c.req.param('contactId'), projectId),
    auditStatement(c.env.DB, projectId, 'contact_note', c.req.param('noteId'), 'deleted', actorId, {}),
  ]);
  return c.json({ data: { id: c.req.param('noteId'), deleted: true } });
});

operations.get('/:projectId/companies', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const query = optionalQuery(c.req.query('q'), 'q', 255);
  const page = pageInput(c.req.query('limit'), c.req.query('cursor'));
  const like = `%${escapeLike(query)}%`;
  const rows = await c.env.DB.prepare(`
    SELECT company.*,
      (SELECT COUNT(*) FROM support_contacts contact
       WHERE contact.project_id = company.project_id AND contact.company_id = company.id) AS contact_count
    FROM support_companies company
    WHERE company.project_id = ?
      AND (? = '' OR company.name LIKE ? ESCAPE '\\'
        OR COALESCE(company.domain, '') LIKE ? ESCAPE '\\'
        OR COALESCE(company.description, '') LIKE ? ESCAPE '\\')
      AND (? IS NULL OR company.updated_at < ?
        OR (company.updated_at = ? AND company.id < ?))
    ORDER BY company.updated_at DESC, company.id DESC LIMIT ?
  `).bind(
    projectId, query, like, like, like,
    page.cursor?.updated_at ?? null, page.cursor?.updated_at ?? null,
    page.cursor?.updated_at ?? null, page.cursor?.id ?? null, page.limit + 1,
  ).all<Record<string, unknown>>();
  return c.json(pageResponse(rows.results, page.limit, serializeCompany));
});

operations.post('/:projectId/companies', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const input = companyInput(await readJsonObject(c.req.raw));
  const id = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO support_companies (id, project_id, name, domain, description, custom_attributes_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(id, projectId, input.name, input.domain, input.description, JSON.stringify(input.custom_attributes)),
      auditStatement(c.env.DB, projectId, 'company', id, 'created', actorId, {}),
    ]);
  } catch (error) {
    throw conflict(error, 'company_conflict', 'A company with this domain already exists');
  }
  return c.json({ data: serializeCompany(await companyWithCount(c.env.DB, projectId, id)) }, 201);
});

operations.get('/:projectId/companies/:companyId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const companyId = identifier(c.req.param('companyId'), 'company_id');
  const row = await companyWithCount(c.env.DB, projectId, companyId);
  const contacts = await c.env.DB.prepare(`
    SELECT id, external_user_id, name, email, phone, avatar_url, blocked, created_at, updated_at
    FROM support_contacts WHERE project_id = ? AND company_id = ?
    ORDER BY updated_at DESC, id DESC LIMIT 100
  `).bind(projectId, companyId).all<Record<string, unknown>>();
  return c.json({ data: { ...serializeCompany(row), contacts: contacts.results.map(serializeContact) } });
});

operations.patch('/:projectId/companies/:companyId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const companyId = identifier(c.req.param('companyId'), 'company_id');
  const actorId = requestActor(c.req.header.bind(c.req));
  const before = await company(c.env.DB, projectId, companyId);
  const body = await readJsonObject(c.req.raw);
  const input = companyInput({
    ...serializeCompany(before),
    ...body,
    custom_attributes: body.custom_attributes ?? parseJson(before.custom_attributes_json, {}),
  });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE support_companies SET name = ?, domain = ?, description = ?,
        custom_attributes_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE project_id = ? AND id = ?`).bind(input.name, input.domain, input.description,
        JSON.stringify(input.custom_attributes), projectId, companyId),
      auditStatement(c.env.DB, projectId, 'company', companyId, 'updated', actorId, {}),
    ]);
  } catch (error) {
    throw conflict(error, 'company_conflict', 'A company with this domain already exists');
  }
  return c.json({ data: serializeCompany(await companyWithCount(c.env.DB, projectId, companyId)) });
});

operations.delete('/:projectId/companies/:companyId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const companyId = identifier(c.req.param('companyId'), 'company_id');
  const actorId = requestActor(c.req.header.bind(c.req));
  await company(c.env.DB, projectId, companyId);
  const count = await c.env.DB.prepare('SELECT COUNT(*) count FROM support_contacts WHERE project_id = ? AND company_id = ?')
    .bind(projectId, companyId).first<{ count: number }>();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE support_contacts SET company_id = NULL, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE project_id = ? AND company_id = ?')
      .bind(projectId, companyId),
    c.env.DB.prepare('DELETE FROM support_companies WHERE project_id = ? AND id = ?').bind(projectId, companyId),
    auditStatement(c.env.DB, projectId, 'company', companyId, 'deleted', actorId, {
      detached_contacts: Number(count?.count || 0),
    }),
  ]);
  return c.json({ data: { id: companyId, deleted: true, detached_contacts: Number(count?.count || 0) } });
});

operations.get('/:projectId/conversations', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const query = optionalQuery(c.req.query('q'), 'q', 255);
  const status = optionalQuery(c.req.query('status'), 'status', 16);
  if (status && !['open', 'pending', 'closed'].includes(status)) {
    throw failure('conversation_status_invalid', 'Conversation status is invalid');
  }
  const page = conversationPageInput(c.req.query('limit'), c.req.query('cursor'));
  return c.json(await listConversations(c.env.DB, projectId, query, status, page));
});

operations.get('/:projectId/items', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const selectedType = optionalQuery(c.req.query('type'), 'type', 32) || 'all';
  if (!['all', 'conversation', 'refund_case'].includes(selectedType)) {
    throw failure('inbox_type_invalid', 'Inbox item type is invalid');
  }
  const query = optionalQuery(c.req.query('q'), 'q', 255);
  const status = optionalQuery(c.req.query('status'), 'status', 16);
  if (status && !['open', 'pending', 'closed'].includes(status)) {
    throw failure('conversation_status_invalid', 'Conversation status is invalid');
  }
  const page = conversationPageInput(c.req.query('limit'), c.req.query('cursor'));
  if (selectedType === 'refund_case') {
    return c.json({
      data: [],
      pagination: { limit: page.limit, has_more: false, next_cursor: null },
      degraded_sources: [],
      projection: true,
    });
  }
  const listed = await listConversations(c.env.DB, projectId, query, status, page);
  return c.json({
    ...listed,
    data: listed.data.map(serializeInboxItem),
    degraded_sources: [],
    projection: true,
  });
});

const handleConversationBulk: Handler<{ Bindings: Env }> = async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const body = await readJsonObject(c.req.raw);
  const conversationIds = identifierArray(body.conversation_ids, 'conversation_ids', MAX_PAGE_LIMIT);
  if (!conversationIds.length) throw failure('conversation_ids_invalid', 'conversation_ids must not be empty');
  await requireConversations(c.env.DB, projectId, conversationIds);
  const action = text(body.action, 'action', 32);
  const placeholders = placeholdersFor(conversationIds);
  const statements: D1PreparedStatement[] = [];
  const auditPayload: Record<string, unknown> = { action, conversation_ids: conversationIds };
  let closesConversations = false;

  if (action === 'set_status' || action === 'close' || action === 'reopen') {
    const status = action === 'close' ? 'closed' : action === 'reopen'
      ? 'open' : enumValue(body.status, 'status', ['open', 'pending', 'closed']);
    statements.push(c.env.DB.prepare(`UPDATE conversations SET status = ?,
      resolved_at = CASE WHEN ? = 'closed' THEN COALESCE(resolved_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE NULL END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND id IN (${placeholders})`).bind(status, status, projectId, ...conversationIds));
    auditPayload.status = status;
    closesConversations = status === 'closed';
  } else if (action === 'set_priority') {
    const priority = enumValue(body.priority, 'priority', ['low', 'normal', 'high', 'urgent']);
    statements.push(c.env.DB.prepare(`UPDATE conversations SET priority = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND id IN (${placeholders})`).bind(priority, projectId, ...conversationIds));
    auditPayload.priority = priority;
  } else if (action === 'mute' || action === 'unmute') {
    const mutedUntil = action === 'mute' ? muteUntil(body.muted_until) : null;
    statements.push(c.env.DB.prepare(`UPDATE conversations SET muted_until = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND id IN (${placeholders})`).bind(mutedUntil, projectId, ...conversationIds));
    auditPayload.muted_until = mutedUntil;
  } else if (action === 'transfer' || action === 'assign') {
    const inboxId = action === 'transfer' ? identifier(body.inbox_id, 'inbox_id')
      : nullableIdentifier(body.inbox_id, 'inbox_id');
    const membershipId = nullableIdentifier(body.assigned_user_id, 'assigned_user_id');
    const teamId = nullableIdentifier(body.assigned_team_id, 'assigned_team_id');
    if (inboxId) await inbox(c.env.DB, projectId, inboxId);
    if (membershipId) await membership(c.env.DB, projectId, membershipId);
    if (teamId) await team(c.env.DB, projectId, teamId);
    if (inboxId && membershipId) await requireInboxMembership(c.env.DB, projectId, inboxId, membershipId);
    statements.push(c.env.DB.prepare(`UPDATE conversations SET inbox_id = COALESCE(?, inbox_id),
      assigned_user_id = ?, assigned_team_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND id IN (${placeholders})`).bind(
      inboxId, membershipId, teamId, projectId, ...conversationIds,
    ));
    auditPayload.inbox_id = inboxId;
    auditPayload.assigned_user_id = membershipId;
    auditPayload.assigned_team_id = teamId;
  } else if (action === 'add_label' || action === 'remove_label') {
    const labelId = identifier(body.label_id, 'label_id');
    await requireLabels(c.env.DB, projectId, [labelId]);
    statements.push(action === 'add_label'
      ? c.env.DB.prepare(`INSERT OR IGNORE INTO support_conversation_labels
          (project_id, conversation_id, label_id, created_by)
        SELECT ?, id, ?, ? FROM conversations WHERE project_id = ? AND id IN (${placeholders})`)
        .bind(projectId, labelId, actorId, projectId, ...conversationIds)
      : c.env.DB.prepare(`DELETE FROM support_conversation_labels
        WHERE project_id = ? AND label_id = ? AND conversation_id IN (${placeholders})`)
        .bind(projectId, labelId, ...conversationIds));
    auditPayload.label_id = labelId;
  } else {
    throw failure('conversation_bulk_action_invalid', 'Conversation bulk action is invalid');
  }
  const operationId = crypto.randomUUID();
  statements.push(auditStatement(c.env.DB, projectId, 'conversation_bulk', operationId, 'executed', actorId, auditPayload));
  await c.env.DB.batch(statements);
  if (closesConversations) {
    await Promise.all(conversationIds.map((conversationId) =>
      recordSlaResolution(c.env.DB, projectId, conversationId)));
  }
  const updated = await conversationsById(c.env.DB, projectId, conversationIds);
  return c.json({ data: { operation_id: operationId, conversations: orderedRows(updated, conversationIds).map(serializeConversation) } });
};

operations.post('/:projectId/conversations/bulk', handleConversationBulk);
operations.post('/:projectId/conversations/bulk-actions', handleConversationBulk);

operations.post('/:projectId/conversations/:conversationId/mute', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const conversationId = identifier(c.req.param('conversationId'), 'conversation_id');
  const actorId = requestActor(c.req.header.bind(c.req));
  await conversation(c.env.DB, projectId, conversationId);
  const body = await readJsonObject(c.req.raw);
  const mutedUntil = muteUntil(body.muted_until);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE conversations SET muted_until = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?`)
      .bind(mutedUntil, projectId, conversationId),
    auditStatement(c.env.DB, projectId, 'conversation', conversationId, 'muted', actorId, { muted_until: mutedUntil }),
  ]);
  return c.json({ data: serializeConversation(await conversation(c.env.DB, projectId, conversationId)) });
});

operations.post('/:projectId/conversations/:conversationId/unmute', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const conversationId = identifier(c.req.param('conversationId'), 'conversation_id');
  const actorId = requestActor(c.req.header.bind(c.req));
  await conversation(c.env.DB, projectId, conversationId);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE conversations SET muted_until = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?`)
      .bind(projectId, conversationId),
    auditStatement(c.env.DB, projectId, 'conversation', conversationId, 'unmuted', actorId, {}),
  ]);
  return c.json({ data: serializeConversation(await conversation(c.env.DB, projectId, conversationId)) });
});

operations.post('/:projectId/conversations/:conversationId/transfer', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const conversationId = identifier(c.req.param('conversationId'), 'conversation_id');
  const actorId = requestActor(c.req.header.bind(c.req));
  await conversation(c.env.DB, projectId, conversationId);
  const body = await readJsonObject(c.req.raw);
  const inboxId = identifier(body.inbox_id, 'inbox_id');
  const membershipId = nullableIdentifier(body.assigned_user_id, 'assigned_user_id');
  const teamId = nullableIdentifier(body.assigned_team_id, 'assigned_team_id');
  await inbox(c.env.DB, projectId, inboxId);
  if (membershipId) await membership(c.env.DB, projectId, membershipId);
  if (teamId) await team(c.env.DB, projectId, teamId);
  if (membershipId) await requireInboxMembership(c.env.DB, projectId, inboxId, membershipId);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE conversations SET inbox_id = ?, assigned_user_id = ?, assigned_team_id = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?`)
      .bind(inboxId, membershipId, teamId, projectId, conversationId),
    auditStatement(c.env.DB, projectId, 'conversation', conversationId, 'transferred', actorId, {
      inbox_id: inboxId,
      assigned_user_id: membershipId,
      assigned_team_id: teamId,
    }),
  ]);
  return c.json({ data: serializeConversation(await conversation(c.env.DB, projectId, conversationId)) });
});

operations.post('/:projectId/conversations/:conversationId/merge', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const sourceId = identifier(c.req.param('conversationId'), 'conversation_id');
  const actorId = requestActor(c.req.header.bind(c.req));
  const body = await readJsonObject(c.req.raw);
  const targetId = identifier(body.target_conversation_id, 'target_conversation_id');
  if (sourceId === targetId) throw failure('conversation_merge_invalid', 'Source and target conversations must be different');
  const source = await conversation(c.env.DB, projectId, sourceId);
  await conversation(c.env.DB, projectId, targetId);
  const duplicateMessage = await c.env.DB.prepare(`
    SELECT 1 duplicate_message FROM messages source_message
    INNER JOIN messages target_message
      ON target_message.conversation_id = ?
      AND target_message.client_message_id = source_message.client_message_id
    WHERE source_message.conversation_id = ? LIMIT 1
  `).bind(targetId, sourceId).first();
  if (duplicateMessage) throw failure('conversation_merge_conflict', 'Conversations contain conflicting messages', 409);
  const maxSequence = await c.env.DB.prepare('SELECT COALESCE(MAX(sequence), 0) sequence FROM messages WHERE conversation_id = ?')
    .bind(targetId).first<{ sequence: number }>();
  const sequenceOffset = Number(maxSequence?.sequence || 0);
  const mergeId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE support_message_attachments SET conversation_id = ? WHERE project_id = ? AND conversation_id = ?')
      .bind(targetId, projectId, sourceId),
    c.env.DB.prepare('UPDATE messages SET sequence = sequence + ? WHERE conversation_id = ?')
      .bind(sequenceOffset, sourceId),
    c.env.DB.prepare('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?').bind(targetId, sourceId),
    c.env.DB.prepare(`UPDATE support_provider_deliveries SET conversation_id = ?
      WHERE project_id = ? AND conversation_id = ?`).bind(targetId, projectId, sourceId),
    c.env.DB.prepare(`UPDATE support_calls SET conversation_id = ?
      WHERE project_id = ? AND conversation_id = ?`).bind(targetId, projectId, sourceId),
    c.env.DB.prepare(`UPDATE support_campaign_deliveries SET conversation_id = ?
      WHERE project_id = ? AND conversation_id = ?`).bind(targetId, projectId, sourceId),
    c.env.DB.prepare(`UPDATE support_copilot_threads SET conversation_id = ?
      WHERE project_id = ? AND conversation_id = ?`).bind(targetId, projectId, sourceId),
    c.env.DB.prepare(`UPDATE support_assistant_tasks SET conversation_id = ?
      WHERE project_id = ? AND conversation_id = ?`).bind(targetId, projectId, sourceId),
    c.env.DB.prepare(`UPDATE support_meetings SET conversation_id = ?
      WHERE project_id = ? AND conversation_id = ?`).bind(targetId, projectId, sourceId),
    c.env.DB.prepare(`UPDATE support_agent_notifications SET conversation_id = ?
      WHERE project_id = ? AND conversation_id = ?`).bind(targetId, projectId, sourceId),
    c.env.DB.prepare(`UPDATE OR IGNORE support_csat_responses SET conversation_id = ?
      WHERE project_id = ? AND conversation_id = ?`).bind(targetId, projectId, sourceId),
    c.env.DB.prepare('DELETE FROM support_realtime_tickets WHERE project_id = ? AND conversation_id = ?')
      .bind(projectId, sourceId),
    c.env.DB.prepare('DELETE FROM support_attachment_uploads WHERE project_id = ? AND conversation_id = ?')
      .bind(projectId, sourceId),
    c.env.DB.prepare(`INSERT OR IGNORE INTO support_conversation_participants
      (conversation_id, project_id, participant_kind, participant_id, created_by, created_at)
      SELECT ?, project_id, participant_kind, participant_id, created_by, created_at
      FROM support_conversation_participants WHERE project_id = ? AND conversation_id = ?`)
      .bind(targetId, projectId, sourceId),
    c.env.DB.prepare('DELETE FROM support_conversation_participants WHERE project_id = ? AND conversation_id = ?')
      .bind(projectId, sourceId),
    c.env.DB.prepare(`INSERT OR IGNORE INTO support_conversation_labels
      (project_id, conversation_id, label_id, created_by, created_at)
      SELECT project_id, ?, label_id, created_by, created_at FROM support_conversation_labels
      WHERE project_id = ? AND conversation_id = ?`).bind(targetId, projectId, sourceId),
    c.env.DB.prepare('DELETE FROM support_conversation_labels WHERE project_id = ? AND conversation_id = ?')
      .bind(projectId, sourceId),
    c.env.DB.prepare(`INSERT OR IGNORE INTO support_conversation_drafts
      (conversation_id, project_id, agent_id, content, attachments_json, updated_at)
      SELECT ?, project_id, agent_id, content, attachments_json, updated_at
      FROM support_conversation_drafts WHERE project_id = ? AND conversation_id = ?`)
      .bind(targetId, projectId, sourceId),
    c.env.DB.prepare('DELETE FROM support_conversation_drafts WHERE project_id = ? AND conversation_id = ?')
      .bind(projectId, sourceId),
    c.env.DB.prepare(`UPDATE conversations SET
      last_message_preview = CASE
        WHEN COALESCE(?, ?) > COALESCE(last_message_at, created_at) THEN ? ELSE last_message_preview END,
      last_message_at = CASE
        WHEN COALESCE(?, ?) > COALESCE(last_message_at, created_at) THEN COALESCE(?, ?) ELSE last_message_at END,
      unread_count = unread_count + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND id = ?`).bind(
      source.last_message_at, source.created_at, source.last_message_preview,
      source.last_message_at, source.created_at, source.last_message_at, source.created_at,
      Number(source.unread_count || 0), projectId, targetId,
    ),
    c.env.DB.prepare(`UPDATE conversations SET status = 'closed', resolved_at = COALESCE(resolved_at,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), external_user_id = ?, client_conversation_id = ?,
      assigned_user_id = NULL, assigned_team_id = NULL, unread_count = 0,
      last_message_preview = NULL, last_message_at = NULL,
      custom_attributes_json = json_set(custom_attributes_json, '$.merged_into_conversation_id', ?),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND id = ?`).bind(
      `merged:${sourceId}`.slice(0, 255),
      `merged:${sourceId}`.slice(0, 128),
      targetId,
      projectId,
      sourceId,
    ),
    auditStatement(c.env.DB, projectId, 'conversation', targetId, 'merged', actorId, {
      merge_id: mergeId,
      source_conversation_id: sourceId,
      target_conversation_id: targetId,
    }),
  ]);
  await recordSlaResolution(c.env.DB, projectId, sourceId);
  return c.json({
    data: {
      merge_id: mergeId,
      target: serializeConversation(await conversation(c.env.DB, projectId, targetId)),
      source: { id: sourceId, status: 'closed', merged_into_conversation_id: targetId },
    },
  });
});

operations.get('/:projectId/conversations/:conversationId/transcript', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const conversationId = identifier(c.req.param('conversationId'), 'conversation_id');
  const conversationRow = await conversation(c.env.DB, projectId, conversationId);
  const limit = pageLimit(c.req.query('limit'));
  const cursor = transcriptCursor(c.req.query('cursor'));
  const messages = await c.env.DB.prepare(`
    SELECT id, sender_kind, sender_id, body, visibility, content_type,
      reply_to_message_id, delivery_status, edited_at, deleted_at, sequence, created_at
    FROM messages WHERE conversation_id = ? AND (? IS NULL OR sequence > ?)
    ORDER BY sequence ASC LIMIT ?
  `).bind(conversationId, cursor, cursor, limit + 1).all<Record<string, unknown>>();
  const hasMore = messages.results.length > limit;
  const selected = messages.results.slice(0, limit);
  const messageIds = selected.map((message) => String(message.id));
  const attachments = messageIds.length
    ? await c.env.DB.prepare(`
      SELECT id, conversation_id, message_id, file_name, content_type, byte_size, position, created_at
      FROM support_message_attachments WHERE project_id = ? AND conversation_id = ?
        AND message_id IN (${placeholdersFor(messageIds)})
      ORDER BY message_id, position
    `).bind(projectId, conversationId, ...messageIds).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };
  const attachmentsByMessage = new Map<string, Record<string, unknown>[]>();
  for (const attachment of attachments.results) {
    const messageId = String(attachment.message_id);
    const existing = attachmentsByMessage.get(messageId) || [];
    existing.push(serializeAttachment(attachment));
    attachmentsByMessage.set(messageId, existing);
  }
  const last = selected.at(-1);
  return c.json({
    data: {
      conversation: serializeConversation(conversationRow),
      messages: selected.map((message) => ({
        ...message,
        body: message.deleted_at ? null : String(message.body || '').slice(0, MAX_TRANSCRIPT_BODY),
        attachments: attachmentsByMessage.get(String(message.id)) || [],
      })),
    },
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeTranscriptCursor(Number(last.sequence)) : null,
    },
  });
});

operations.get('/:projectId/conversations/:conversationId/participants', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  await conversation(c.env.DB, projectId, c.req.param('conversationId'));
  const rows = await c.env.DB.prepare(`
    SELECT * FROM support_conversation_participants
    WHERE project_id = ? AND conversation_id = ? ORDER BY created_at LIMIT 100
  `).bind(projectId, c.req.param('conversationId')).all();
  return c.json({ data: rows.results });
});

operations.post('/:projectId/conversations/:conversationId/participants', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  await conversation(c.env.DB, projectId, c.req.param('conversationId'));
  const body = await readJsonObject(c.req.raw);
  const kind = enumValue(body.participant_kind, 'participant_kind', ['agent', 'team', 'contact']);
  const participantId = identifier(body.participant_id, 'participant_id');
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO support_conversation_participants
        (conversation_id, project_id, participant_kind, participant_id, created_by)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
    `).bind(c.req.param('conversationId'), projectId, kind, participantId, actorId),
    auditStatement(c.env.DB, projectId, 'conversation_participant',
      `${c.req.param('conversationId')}:${kind}:${participantId}`.slice(0, 255), 'created', actorId, {}),
  ]);
  return c.json({ data: { conversation_id: c.req.param('conversationId'), participant_kind: kind, participant_id: participantId } }, 201);
});

operations.delete('/:projectId/conversations/:conversationId/participants/:kind/:participantId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM support_conversation_participants
      WHERE project_id = ? AND conversation_id = ? AND participant_kind = ? AND participant_id = ?`)
      .bind(projectId, c.req.param('conversationId'), c.req.param('kind'), c.req.param('participantId')),
    auditStatement(c.env.DB, projectId, 'conversation_participant', c.req.param('participantId'), 'deleted', actorId, {}),
  ]);
  return c.json({ data: { participant_id: c.req.param('participantId'), deleted: true } });
});

operations.get('/:projectId/conversations/:conversationId/draft', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  await conversation(c.env.DB, projectId, c.req.param('conversationId'));
  const row = await c.env.DB.prepare(`
    SELECT * FROM support_conversation_drafts WHERE conversation_id = ? AND project_id = ? AND agent_id = ?
  `).bind(c.req.param('conversationId'), projectId, actorId).first<Record<string, unknown>>();
  return c.json({ data: row ? { ...row, attachments: safeAttachmentDrafts(row.attachments_json), attachments_json: undefined } : null });
});

operations.put('/:projectId/conversations/:conversationId/draft', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  await conversation(c.env.DB, projectId, c.req.param('conversationId'));
  const body = await readJsonObject(c.req.raw);
  const content = optionalText(body.content, 'content', 8_000);
  const attachments = safeDraftInput(body.attachments ?? []);
  await c.env.DB.prepare(`
    INSERT INTO support_conversation_drafts (conversation_id, project_id, agent_id, content, attachments_json)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(conversation_id, agent_id) DO UPDATE SET
      content = excluded.content, attachments_json = excluded.attachments_json,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(c.req.param('conversationId'), projectId, actorId, content, JSON.stringify(attachments)).run();
  return c.json({ data: { conversation_id: c.req.param('conversationId'), agent_id: actorId, content, attachments } });
});

operations.post('/:projectId/conversations/:conversationId/macros/:macroId/execute', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const result = await executeMacro(c.env, projectId, c.req.param('conversationId'), c.req.param('macroId'), actorId);
  return c.json({ data: result });
});

operations.get('/:projectId/csat', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const rows = await c.env.DB.prepare(`
    SELECT response.*, conversation.subject, conversation.assigned_user_id, conversation.assigned_team_id
    FROM support_csat_responses response JOIN conversations conversation ON conversation.id = response.conversation_id
    WHERE response.project_id = ? ORDER BY response.created_at DESC LIMIT 100
  `).bind(projectId).all();
  return c.json({ data: rows.results });
});

operations.get('/:projectId/notifications', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const unread = c.req.query('unread') === 'true';
  const page = pageInput(c.req.query('limit'), c.req.query('cursor'));
  const rows = await c.env.DB.prepare(`
    SELECT notification.*, notification.created_at AS updated_at
    FROM support_agent_notifications notification
    WHERE project_id = ? AND agent_id = ? AND (? = 0 OR read_at IS NULL)
      AND deleted_at IS NULL
      AND (snoozed_until IS NULL OR snoozed_until <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).bind(
    projectId, actorId, unread ? 1 : 0,
    page.cursor?.updated_at ?? null, page.cursor?.updated_at ?? null,
    page.cursor?.updated_at ?? null, page.cursor?.id ?? null, page.limit + 1,
  ).all<Record<string, unknown>>();
  return c.json(pageResponse(rows.results, page.limit, serializeNotification));
});

operations.get('/:projectId/notifications/unread-count', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const row = await c.env.DB.prepare(`
    SELECT COUNT(*) count FROM support_agent_notifications
    WHERE project_id = ? AND agent_id = ? AND read_at IS NULL AND deleted_at IS NULL
      AND (snoozed_until IS NULL OR snoozed_until <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).bind(projectId, actorId).first<{ count: number }>();
  return c.json({ data: { unread_count: Number(row?.count || 0) } });
});

operations.get('/:projectId/notifications/preferences', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const membership = await notificationMembership(c.env.DB, projectId, actorId);
  const row = await c.env.DB.prepare(`
    SELECT * FROM support_notification_preferences
    WHERE project_id = ? AND membership_id = ?
  `).bind(projectId, membership.id).first<Record<string, unknown>>();
  return c.json({ data: serializeNotificationPreferences(row || {
    project_id: projectId,
    membership_id: membership.id,
    email_enabled: 1,
    push_enabled: 1,
    browser_enabled: 1,
    in_app_enabled: 1,
    audio_enabled: 1,
    muted_event_types_json: '[]',
  }) });
});

operations.put('/:projectId/notifications/preferences', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const membership = await notificationMembership(c.env.DB, projectId, actorId);
  const input = notificationPreferencesInput(await readJsonObject(c.req.raw));
  await c.env.DB.prepare(`
    INSERT INTO support_notification_preferences
      (project_id, membership_id, email_enabled, push_enabled, browser_enabled,
       in_app_enabled, audio_enabled, muted_event_types_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, membership_id) DO UPDATE SET
      email_enabled = excluded.email_enabled,
      push_enabled = excluded.push_enabled,
      browser_enabled = excluded.browser_enabled,
      in_app_enabled = excluded.in_app_enabled,
      audio_enabled = excluded.audio_enabled,
      muted_event_types_json = excluded.muted_event_types_json,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(
    projectId, membership.id,
    input.email_enabled ? 1 : 0, input.push_enabled ? 1 : 0,
    input.browser_enabled ? 1 : 0, input.in_app_enabled ? 1 : 0,
    input.audio_enabled ? 1 : 0, JSON.stringify(input.muted_event_types),
  ).run();
  const row = await c.env.DB.prepare(`SELECT * FROM support_notification_preferences
    WHERE project_id = ? AND membership_id = ?`).bind(projectId, membership.id)
    .first<Record<string, unknown>>();
  return c.json({ data: serializeNotificationPreferences(row || {}) });
});

operations.post('/:projectId/notifications', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const body = await readJsonObject(c.req.raw);
  const id = crypto.randomUUID();
  const agentId = identifier(body.agent_id, 'agent_id');
  const notificationType = text(body.notification_type, 'notification_type', 64);
  const title = text(body.title, 'title', 255);
  const notificationBody = text(body.body, 'body', 2_000);
  const conversationId = nullableIdentifier(body.conversation_id, 'conversation_id');
  if (conversationId) await conversation(c.env.DB, projectId, conversationId);
  const payload = object(body.payload ?? {}, 'payload', 8_000);
  assertNoSensitiveFields(payload, 'payload');
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO support_agent_notifications
        (id, project_id, agent_id, notification_type, title, body, conversation_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, projectId, agentId, notificationType, title, notificationBody, conversationId, JSON.stringify(payload)),
    auditStatement(c.env.DB, projectId, 'notification', id, 'created', actorId, {
      agent_id: agentId,
      notification_type: notificationType,
    }),
  ]);
  return c.json({ data: { id } }, 201);
});

operations.patch('/:projectId/notifications/:notificationId/read', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const row = await c.env.DB.prepare(`
    UPDATE support_agent_notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND agent_id = ? RETURNING *
  `).bind(c.req.param('notificationId'), projectId, actorId).first();
  if (!row) throw failure('notification_not_found', 'Notification not found', 404);
  return c.json({ data: row });
});

operations.post('/:projectId/notifications/read-all', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const result = await c.env.DB.prepare(`
    UPDATE support_agent_notifications
    SET read_at = COALESCE(read_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE project_id = ? AND agent_id = ? AND read_at IS NULL AND deleted_at IS NULL
  `).bind(projectId, actorId).run();
  return c.json({ data: { updated: Number(result.meta.changes || 0) } });
});

operations.patch('/:projectId/notifications/:notificationId/snooze', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const body = await readJsonObject(c.req.raw);
  const snoozedUntil = body.snoozed_until == null
    ? null
    : futureTimestamp(body.snoozed_until, 'snoozed_until');
  const row = await c.env.DB.prepare(`
    UPDATE support_agent_notifications SET snoozed_until = ?
    WHERE id = ? AND project_id = ? AND agent_id = ? AND deleted_at IS NULL RETURNING *
  `).bind(snoozedUntil, c.req.param('notificationId'), projectId, actorId)
    .first<Record<string, unknown>>();
  if (!row) throw failure('notification_not_found', 'Notification not found', 404);
  return c.json({ data: serializeNotification(row) });
});

operations.delete('/:projectId/notifications/:notificationId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = requestActor(c.req.header.bind(c.req));
  const row = await c.env.DB.prepare(`
    UPDATE support_agent_notifications
    SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND agent_id = ? AND deleted_at IS NULL
    RETURNING id, deleted_at
  `).bind(c.req.param('notificationId'), projectId, actorId)
    .first<Record<string, unknown>>();
  if (!row) throw failure('notification_not_found', 'Notification not found', 404);
  return c.json({ data: row });
});

operations.get('/:projectId/search', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const query = text(c.req.query('q'), 'q', 255);
  if (query.length < 2) throw failure('search_query_too_short', 'Search query must contain at least two characters');
  const like = `%${escapeLike(query)}%`;
  const [contacts, companies, conversations, messages] = await Promise.all([
    c.env.DB.prepare(`SELECT id, external_user_id, name, email, phone, avatar_url FROM support_contacts
      WHERE project_id = ? AND (external_user_id LIKE ? ESCAPE '\\' OR COALESCE(name, '') LIKE ? ESCAPE '\\'
        OR COALESCE(email, '') LIKE ? ESCAPE '\\') LIMIT 50`).bind(projectId, like, like, like).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT id, name, domain, description FROM support_companies
      WHERE project_id = ? AND (name LIKE ? ESCAPE '\\' OR COALESCE(domain, '') LIKE ? ESCAPE '\\'
        OR COALESCE(description, '') LIKE ? ESCAPE '\\') LIMIT 50`).bind(projectId, like, like, like).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT * FROM conversations WHERE project_id = ? AND
      (external_user_id LIKE ? ESCAPE '\\' OR COALESCE(subject, '') LIKE ? ESCAPE '\\'
        OR COALESCE(last_message_preview, '') LIKE ? ESCAPE '\\') LIMIT 50`).bind(projectId, like, like, like).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT message.id, message.conversation_id, message.sender_kind, message.body,
      message.visibility, message.content_type, message.created_at
      FROM messages message JOIN conversations conversation ON conversation.id = message.conversation_id
      WHERE conversation.project_id = ? AND message.deleted_at IS NULL
        AND COALESCE(message.body, '') LIKE ? ESCAPE '\\'
      ORDER BY message.created_at DESC LIMIT 50`).bind(projectId, like).all<Record<string, unknown>>(),
  ]);
  return c.json({ data: {
    contacts: contacts.results.map(serializeContact),
    companies: companies.results.map(serializeCompany),
    conversations: conversations.results.map(serializeConversation),
    messages: messages.results,
  } });
});

export async function ensureSupportContact(db: D1Database, projectId: number, externalUserId: string) {
  await db.prepare(`
    INSERT INTO support_contacts (id, project_id, external_user_id)
    VALUES (?, ?, ?) ON CONFLICT(project_id, external_user_id) DO UPDATE SET
      last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(crypto.randomUUID(), projectId, externalUserId).run();
}

export async function sendBulkJob(queue: Queue, job: Record<string, unknown>) {
  await queue.send(job, { contentType: 'json' });
}

async function contact(db: D1Database, projectId: number, id: string) {
  const row = await db.prepare('SELECT * FROM support_contacts WHERE project_id = ? AND id = ?')
    .bind(projectId, identifier(id, 'contact_id')).first<Record<string, unknown>>();
  if (!row) throw failure('contact_not_found', 'Contact not found', 404);
  return row;
}

async function company(db: D1Database, projectId: number, id: string) {
  const row = await db.prepare('SELECT * FROM support_companies WHERE project_id = ? AND id = ?')
    .bind(projectId, identifier(id, 'company_id')).first<Record<string, unknown>>();
  if (!row) throw failure('company_not_found', 'Company not found', 404);
  return row;
}

async function companyWithCount(db: D1Database, projectId: number, id: string) {
  const row = await db.prepare(`SELECT company.*,
    (SELECT COUNT(*) FROM support_contacts contact
     WHERE contact.project_id = company.project_id AND contact.company_id = company.id) AS contact_count
    FROM support_companies company WHERE company.project_id = ? AND company.id = ?`)
    .bind(projectId, identifier(id, 'company_id')).first<Record<string, unknown>>();
  if (!row) throw failure('company_not_found', 'Company not found', 404);
  return row;
}

async function conversation(db: D1Database, projectId: number, id: string) {
  const row = await db.prepare(`SELECT conversation.*,
    COALESCE((SELECT json_group_array(linked.label_id) FROM support_conversation_labels linked
      WHERE linked.project_id = conversation.project_id AND linked.conversation_id = conversation.id), '[]') AS linked_labels_json
    FROM conversations conversation WHERE conversation.project_id = ? AND conversation.id = ?`)
    .bind(projectId, identifier(id, 'conversation_id')).first<Record<string, unknown>>();
  if (!row) throw failure('conversation_not_found', 'Conversation not found', 404);
  return row;
}

async function inbox(db: D1Database, projectId: number, id: string) {
  const row = await db.prepare(`SELECT id FROM support_inboxes
    WHERE project_id = ? AND id = ? AND status = 'active'`).bind(projectId, id).first();
  if (!row) throw failure('inbox_not_found', 'Active inbox not found', 404);
}

async function membership(db: D1Database, projectId: number, id: string) {
  const row = await db.prepare(`SELECT id FROM support_memberships
    WHERE project_id = ? AND id = ? AND active = 1`).bind(projectId, id).first();
  if (!row) throw failure('support_membership_not_found', 'Active Support membership not found', 404);
}

async function team(db: D1Database, projectId: number, id: string) {
  const row = await db.prepare(`SELECT id FROM support_teams
    WHERE project_id = ? AND id = ? AND active = 1`).bind(projectId, id).first();
  if (!row) throw failure('support_team_not_found', 'Active Support team not found', 404);
}

async function notificationMembership(db: D1Database, projectId: number, actorId: string) {
  const row = await db.prepare(`SELECT id FROM support_memberships
    WHERE project_id = ? AND active = 1 AND (auth_user_id = ? OR id = ?) LIMIT 1`)
    .bind(projectId, actorId, actorId).first<{ id: string }>();
  if (!row) throw failure('support_membership_required', 'An active Support membership is required', 403);
  return row;
}

async function requireInboxMembership(
  db: D1Database,
  projectId: number,
  inboxId: string,
  membershipId: string,
) {
  const row = await db.prepare(`SELECT 1 allowed FROM support_inbox_members
    WHERE project_id = ? AND inbox_id = ? AND membership_id = ? LIMIT 1`)
    .bind(projectId, inboxId, membershipId).first();
  if (!row) throw failure('support_inbox_membership_required', 'Assigned agent is not a member of the inbox', 422);
}

async function requireLabels(db: D1Database, projectId: number, ids: string[]) {
  const rows = await db.prepare(`SELECT id FROM support_labels
    WHERE project_id = ? AND active = 1 AND id IN (${placeholdersFor(ids)})`)
    .bind(projectId, ...ids).all<{ id: string }>();
  if (rows.results.length !== ids.length) throw failure('label_not_found', 'One or more active labels were not found', 404);
}

async function requireConversations(db: D1Database, projectId: number, ids: string[]) {
  const rows = await db.prepare(`SELECT id FROM conversations
    WHERE project_id = ? AND id IN (${placeholdersFor(ids)})`).bind(projectId, ...ids).all<{ id: string }>();
  if (rows.results.length !== ids.length) throw failure('conversation_not_found', 'One or more conversations were not found', 404);
}

async function conversationsById(db: D1Database, projectId: number, ids: string[]) {
  const rows = await db.prepare(`SELECT conversation.*,
    COALESCE((SELECT json_group_array(linked.label_id) FROM support_conversation_labels linked
      WHERE linked.project_id = conversation.project_id AND linked.conversation_id = conversation.id), '[]') AS linked_labels_json
    FROM conversations conversation WHERE conversation.project_id = ?
      AND conversation.id IN (${placeholdersFor(ids)})`).bind(projectId, ...ids).all<Record<string, unknown>>();
  return rows.results;
}

async function listConversations(
  db: D1Database,
  projectId: number,
  query: string,
  status: string,
  page: ReturnType<typeof conversationPageInput>,
) {
  const like = `%${escapeLike(query)}%`;
  const cursorRank = page.cursor?.rank ?? null;
  const cursorActivity = page.cursor?.activity ?? null;
  const cursorId = page.cursor?.id ?? null;
  const rows = await db.prepare(`
    SELECT conversation.*,
      (SELECT COUNT(*) FROM messages message WHERE message.conversation_id = conversation.id) AS message_count,
      (SELECT COUNT(*) FROM messages unread WHERE unread.conversation_id = conversation.id
        AND unread.sender_kind = 'user'
        AND (conversation.agent_last_read_at IS NULL OR unread.created_at > conversation.agent_last_read_at)) AS calculated_unread_count,
      COALESCE((SELECT json_group_array(linked.label_id) FROM support_conversation_labels linked
        WHERE linked.project_id = conversation.project_id AND linked.conversation_id = conversation.id), '[]') AS linked_labels_json,
      CASE conversation.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END AS priority_rank,
      COALESCE(conversation.last_message_at, conversation.created_at) AS activity_at
    FROM conversations conversation
    WHERE conversation.project_id = ? AND (? = '' OR conversation.status = ?)
      AND (? = '' OR conversation.external_user_id LIKE ? ESCAPE '\\'
        OR COALESCE(conversation.subject, '') LIKE ? ESCAPE '\\'
        OR COALESCE(conversation.last_message_preview, '') LIKE ? ESCAPE '\\')
      AND (? IS NULL
        OR CASE conversation.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END > ?
        OR (CASE conversation.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END = ?
          AND COALESCE(conversation.last_message_at, conversation.created_at) < ?)
        OR (CASE conversation.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END = ?
          AND COALESCE(conversation.last_message_at, conversation.created_at) = ? AND conversation.id < ?))
    ORDER BY priority_rank ASC, activity_at DESC, conversation.id DESC LIMIT ?
  `).bind(
    projectId, status, status, query, like, like, like,
    cursorRank, cursorRank, cursorRank, cursorActivity, cursorRank, cursorActivity, cursorId,
    page.limit + 1,
  ).all<Record<string, unknown>>();
  const hasMore = rows.results.length > page.limit;
  const selected = rows.results.slice(0, page.limit);
  const last = selected.at(-1);
  return {
    data: selected.map(serializeConversation),
    pagination: {
      limit: page.limit,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeConversationCursor({
        rank: Number(last.priority_rank),
        activity: String(last.activity_at),
        id: String(last.id),
      }) : null,
    },
  };
}

async function contactLabels(db: D1Database, projectId: number, contactId: string) {
  const rows = await db.prepare(`
    SELECT label.id, label.name, label.color, label.description, label.show_on_sidebar
    FROM support_labels label
    INNER JOIN support_contact_labels linked ON linked.label_id = label.id
    WHERE linked.project_id = ? AND linked.contact_id = ? AND label.project_id = ? AND label.active = 1
    ORDER BY label.name LIMIT 100
  `).bind(projectId, contactId, projectId).all<Record<string, unknown>>();
  return rows.results.map((row) => ({ ...row, show_on_sidebar: Number(row.show_on_sidebar) === 1 }));
}

async function contactInboxes(db: D1Database, projectId: number, contactId: string) {
  const rows = await db.prepare(`
    SELECT association.*, inbox.name AS inbox_name, inbox.channel_type, inbox.status AS inbox_status
    FROM support_contact_inboxes association
    INNER JOIN support_inboxes inbox ON inbox.id = association.inbox_id AND inbox.project_id = association.project_id
    WHERE association.project_id = ? AND association.contact_id = ?
    ORDER BY association.updated_at DESC, association.id DESC LIMIT 100
  `).bind(projectId, contactId).all<Record<string, unknown>>();
  return rows.results.map(serializeContactInbox);
}

async function importJob(db: D1Database, projectId: number, id: string) {
  const row = await db.prepare(`SELECT id, resource_type, status, checkpoint_json, result_json,
    last_error, created_at, updated_at FROM support_import_jobs
    WHERE project_id = ? AND resource_type = 'contacts' AND id = ?`).bind(projectId, id).first<Record<string, unknown>>();
  if (!row) throw failure('contact_import_not_found', 'Contact import job not found', 404);
  return serializeJob(row);
}

async function exportJob(db: D1Database, projectId: number, id: string) {
  const row = await db.prepare(`SELECT id, resource_type, status, filters_json, result_json,
    last_error, created_at, updated_at FROM support_export_jobs
    WHERE project_id = ? AND resource_type = 'contacts' AND id = ?`).bind(projectId, id).first<Record<string, unknown>>();
  if (!row) throw failure('contact_export_not_found', 'Contact export job not found', 404);
  return serializeExportJob(row);
}

async function listJobs(
  db: D1Database,
  projectId: number,
  table: 'support_import_jobs' | 'support_export_jobs',
  rawLimit: string | undefined,
  rawCursor: string | undefined,
) {
  const page = pageInput(rawLimit, rawCursor);
  const rows = await db.prepare(`SELECT id, resource_type, status, result_json, last_error, created_at, updated_at
    FROM ${table} WHERE project_id = ? AND resource_type = 'contacts'
      AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND id < ?))
    ORDER BY updated_at DESC, id DESC LIMIT ?`).bind(
    projectId, page.cursor?.updated_at ?? null, page.cursor?.updated_at ?? null,
    page.cursor?.updated_at ?? null, page.cursor?.id ?? null, page.limit + 1,
  ).all<Record<string, unknown>>();
  return pageResponse(rows.results, page.limit,
    table === 'support_export_jobs' ? serializeExportJob : serializeJob);
}

async function markBulkJobFailed(
  db: D1Database,
  table: 'support_import_jobs' | 'support_export_jobs',
  projectId: number,
  id: string,
) {
  await db.prepare(`UPDATE ${table} SET status = 'failed', last_error = 'queue_unavailable',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?`)
    .bind(projectId, id).run();
}

function contactInput(body: Record<string, unknown>) {
  return {
    external_user_id: identifier(body.external_user_id, 'external_user_id'),
    name: nullableText(body.name, 'name', 255),
    email: nullableEmail(body.email),
    phone: nullableText(body.phone, 'phone', 64),
    company_id: nullableIdentifier(body.company_id, 'company_id'),
    avatar_url: nullableHttpsUrl(body.avatar_url, 'avatar_url'),
    blocked: body.blocked === true,
    custom_attributes: object(body.custom_attributes ?? {}, 'custom_attributes', 8_000),
    last_seen_at: nullableTimestamp(body.last_seen_at, 'last_seen_at'),
  };
}

function companyInput(body: Record<string, unknown>) {
  return {
    name: text(body.name, 'name', 255),
    domain: nullableDomain(body.domain),
    description: nullableText(body.description, 'description', 2_000),
    custom_attributes: object(body.custom_attributes ?? {}, 'custom_attributes', 8_000),
  };
}

function serializeContact(row: Record<string, unknown>) {
  return {
    ...row,
    blocked: Number(row.blocked) === 1,
    avatar_url: publicHttpsReference(row.avatar_url),
    custom_attributes: redactSensitiveObject(parseJson(row.custom_attributes_json, {})),
    custom_attributes_json: undefined,
  };
}

function serializeCompany(row: Record<string, unknown>) {
  return {
    ...row,
    custom_attributes: redactSensitiveObject(parseJson(row.custom_attributes_json, {})),
    custom_attributes_json: undefined,
  };
}

function serializeConversation(row: Record<string, unknown>) {
  return {
    ...row,
    labels: parseJson(row.linked_labels_json ?? row.labels_json, []),
    custom_attributes: redactSensitiveObject(parseJson(row.custom_attributes_json, {})),
    labels_json: undefined,
    custom_attributes_json: undefined,
    linked_labels_json: undefined,
    priority_rank: undefined,
    activity_at: undefined,
    muted: typeof row.muted_until === 'string' && new Date(row.muted_until).getTime() > Date.now(),
    unread_count: Number(row.calculated_unread_count ?? row.unread_count ?? 0),
    calculated_unread_count: undefined,
  };
}

function serializeInboxItem(conversation: Record<string, unknown>) {
  const id = String(conversation.id || '');
  return {
    id: `conversation:${id}`,
    source_type: 'conversation',
    source_id: id,
    title: String(conversation.subject || 'Support conversation').slice(0, 255),
    preview: String(conversation.last_message_preview || 'No messages').slice(0, 1_000),
    status: conversation.status,
    priority: conversation.priority,
    customer_reference: conversation.external_user_id || null,
    updated_at: conversation.last_message_at || conversation.updated_at || conversation.created_at,
    destination: `/support/inbox?type=conversation&id=${encodeURIComponent(id)}`,
    capabilities: ['reply', 'assign', 'set_priority', 'set_status'],
    source: conversation,
  };
}

function serializeAttachment(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    conversation_id: String(row.conversation_id || ''),
    message_id: String(row.message_id || ''),
    file_name: String(row.file_name || 'attachment').slice(0, 255),
    content_type: String(row.content_type || 'application/octet-stream').slice(0, 255),
    byte_size: row.byte_size == null ? null : Math.max(0, Number(row.byte_size) || 0),
    position: Math.max(0, Number(row.position) || 0),
    created_at: row.created_at,
  };
}

function serializeContactInbox(row: Record<string, unknown>) {
  return {
    id: row.id,
    contact_id: row.contact_id,
    inbox_id: row.inbox_id,
    source_id: row.source_id,
    verified: Number(row.verified) === 1,
    metadata: redactSensitiveObject(parseJson(row.metadata_json, {})),
    inbox_name: row.inbox_name,
    channel_type: row.channel_type,
    status: row.inbox_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeJob(row: Record<string, unknown>) {
  return {
    id: row.id,
    resource_type: row.resource_type,
    status: row.status,
    filters: redactSensitiveObject(parseJson(row.filters_json, {})),
    checkpoint: redactSensitiveObject(parseJson(row.checkpoint_json, {})),
    result: redactSensitiveObject(parseJson(row.result_json, {})),
    error_code: row.last_error ? 'processing_failed' : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeExportJob(row: Record<string, unknown>) {
  return {
    ...serializeJob(row),
    download_ref: row.status === 'completed' ? row.id : null,
  };
}

function serializeNotification(row: Record<string, unknown>) {
  return {
    id: row.id,
    project_id: row.project_id,
    agent_id: row.agent_id,
    notification_type: row.notification_type,
    title: row.title,
    body: row.body,
    conversation_id: row.conversation_id,
    payload: redactSensitiveObject(parseJson(row.payload_json, {})),
    read_at: row.read_at,
    snoozed_until: row.snoozed_until,
    created_at: row.created_at,
  };
}

function serializeNotificationPreferences(row: Record<string, unknown>) {
  return {
    project_id: row.project_id,
    membership_id: row.membership_id,
    email_enabled: Number(row.email_enabled) === 1,
    push_enabled: Number(row.push_enabled) === 1,
    browser_enabled: Number(row.browser_enabled) === 1,
    in_app_enabled: Number(row.in_app_enabled) === 1,
    audio_enabled: Number(row.audio_enabled) === 1,
    muted_event_types: parseJson(row.muted_event_types_json, []),
    updated_at: row.updated_at ?? null,
  };
}

function notificationPreferencesInput(body: Record<string, unknown>) {
  const boolean = (name: string, fallback: boolean) => {
    if (!(name in body)) return fallback;
    if (typeof body[name] !== 'boolean') throw failure(`${name}_invalid`, `${name} must be a boolean`);
    return body[name] as boolean;
  };
  const muted = body.muted_event_types == null
    ? []
    : array(body.muted_event_types, 'muted_event_types', 100).map((value) => {
        const event = text(value, 'muted_event_type', 128);
        if (!/^[a-z][a-z0-9_.-]*$/u.test(event)) {
          throw failure('muted_event_types_invalid', 'muted_event_types contains an invalid event name');
        }
        return event;
      });
  if (new Set(muted).size !== muted.length) {
    throw failure('muted_event_types_invalid', 'muted_event_types must contain unique values');
  }
  return {
    email_enabled: boolean('email_enabled', true),
    push_enabled: boolean('push_enabled', true),
    browser_enabled: boolean('browser_enabled', true),
    in_app_enabled: boolean('in_app_enabled', true),
    audio_enabled: boolean('audio_enabled', true),
    muted_event_types: muted,
  };
}

function auditStatement(
  db: D1Database,
  projectId: number,
  type: string,
  id: string,
  action: string,
  actorId: string,
  payload: unknown,
) {
  return db.prepare(`INSERT INTO support_operations_audit_events
    (id, project_id, resource_type, resource_id, action, actor_id, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
    crypto.randomUUID(), projectId, type.slice(0, 128), id.slice(0, 255),
    action.slice(0, 128), actorId, JSON.stringify(redactSensitiveObject(payload)),
  );
}

function positiveInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw failure('project_id_invalid', 'Project id is invalid');
  return parsed;
}

function requestActor(header: (name: string) => string | undefined) {
  return actor(header('X-Actor-Id'));
}

function actor(value: unknown) {
  return identifier(value, 'agent_id');
}

function identifier(value: unknown, field: string) {
  const parsed = text(value, field, 255);
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._:@+\-]{0,254}$/u.test(parsed)) {
    throw failure(`${field}_invalid`, `${field} contains unsupported characters`);
  }
  return parsed;
}

function nullableIdentifier(value: unknown, field: string) {
  return value == null || value === '' ? null : identifier(value, field);
}

function identifierArray(value: unknown, field: string, max: number) {
  const values = array(value, field, max).map((item) => identifier(item, field));
  const unique = [...new Set(values)];
  if (unique.length !== values.length) throw failure(`${field}_invalid`, `${field} must contain unique identifiers`);
  return unique;
}

function text(value: unknown, field: string, max: number) {
  const parsed = String(value || '').trim();
  if (!parsed || parsed.length > max) {
    throw failure(`${field}_invalid`, `${field} is required and limited to ${max} characters`);
  }
  return parsed;
}

function optionalText(value: unknown, field: string, max: number) {
  const parsed = value == null ? '' : String(value);
  if (parsed.length > max) throw failure(`${field}_invalid`, `${field} is limited to ${max} characters`);
  return parsed;
}

function optionalQuery(value: unknown, field: string, max: number) {
  return optionalText(value, field, max).trim();
}

function nullableText(value: unknown, field: string, max: number) {
  const parsed = optionalText(value, field, max).trim();
  return parsed || null;
}

function nullableEmail(value: unknown) {
  const parsed = nullableText(value, 'email', 320)?.toLowerCase() || null;
  if (parsed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed)) throw failure('email_invalid', 'Email is invalid');
  return parsed;
}

function nullableDomain(value: unknown) {
  const parsed = nullableText(value, 'domain', 255)?.toLowerCase() || null;
  if (parsed && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(parsed)) {
    throw failure('domain_invalid', 'Domain is invalid');
  }
  return parsed;
}

function nullableHttpsUrl(value: unknown, field: string) {
  const parsed = nullableText(value, field, 2_048);
  if (!parsed) return null;
  try {
    const url = new URL(parsed);
    if (url.protocol !== 'https:' || url.username || url.password || hasSensitiveQuery(url)) throw new Error();
  } catch {
    throw failure(`${field}_invalid`, `${field} must be a credential-free HTTPS reference`);
  }
  return parsed;
}

function publicHttpsReference(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || hasSensitiveQuery(url)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function hasSensitiveQuery(url: URL) {
  return [...url.searchParams.keys()].some((key) => sensitiveKey(key));
}

function nullableTimestamp(value: unknown, field: string) {
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw failure(`${field}_invalid`, `${field} must be an ISO-8601 timestamp`);
  return date.toISOString();
}

function futureTimestamp(value: unknown, field: string) {
  const timestamp = nullableTimestamp(value, field);
  if (!timestamp || new Date(timestamp).getTime() <= Date.now()) {
    throw failure(`${field}_invalid`, `${field} must be in the future`);
  }
  return timestamp;
}

function muteUntil(value: unknown) {
  const timestamp = nullableTimestamp(value, 'muted_until') || INDEFINITE_MUTE;
  if (new Date(timestamp).getTime() <= Date.now()) throw failure('muted_until_invalid', 'muted_until must be in the future');
  return timestamp;
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const parsed = String(value || '') as T;
  if (!allowed.includes(parsed)) throw failure(`${field}_invalid`, `${field} is invalid`);
  return parsed;
}

function objectKey(value: unknown, field: string) {
  const key = text(value, field, 1_024);
  if (key.startsWith('/') || key.includes('\\') || key.includes('?') || key.includes('#')
    || key.includes('://') || key.split('/').includes('..') || /[\u0000-\u001f\u007f]/.test(key)) {
    throw failure(`${field}_invalid`, `${field} must be a safe object reference`);
  }
  return key;
}

function object(value: unknown, field: string, max: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > max) {
    throw failure(`${field}_invalid`, `${field} must be an object under ${max} bytes`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string, max: number) {
  if (!Array.isArray(value) || value.length > max || JSON.stringify(value).length > 8_000) {
    throw failure(`${field}_invalid`, `${field} must be an array with at most ${max} items`);
  }
  return value;
}

function safeDraftInput(value: unknown) {
  const attachments = array(value, 'attachments', 20).map((entry) => {
    const item = object(entry, 'attachment', 1_000);
    return {
      id: identifier(item.id, 'attachment_id'),
      file_name: text(item.file_name, 'file_name', 255),
      content_type: text(item.content_type, 'content_type', 255),
      byte_size: item.byte_size == null ? null : boundedNonNegativeInt(item.byte_size, 'byte_size'),
    };
  });
  return attachments;
}

function safeAttachmentDrafts(value: unknown) {
  try {
    return safeDraftInput(parseJson(value, []));
  } catch {
    return [];
  }
}

function boundedNonNegativeInt(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw failure(`${field}_invalid`, `${field} is invalid`);
  return parsed;
}

function assertNoSensitiveFields(value: unknown, field: string) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (sensitiveKey(key)) throw failure(`${field}_invalid`, `${field} cannot contain credentials`);
    assertNoSensitiveFields(nested, field);
  }
}

function redactSensitiveObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !sensitiveKey(key))
    .map(([key, nested]) => [key, redactSensitiveObject(nested)]));
}

function sensitiveKey(key: string) {
  return /(?:secret|password|authorization|cookie|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|signature)/i.test(key);
}

function parseJson(value: unknown, fallback: unknown) {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function conflict(error: unknown, code: string, message: string) {
  if (String((error as Error).message).includes('UNIQUE')) return failure(code, message, 409);
  return error;
}

function failure(code: string, message: string, status = 422) {
  return Object.assign(new Error(message), { code, status });
}

function pageLimit(value: unknown) {
  if (value == null || value === '') return DEFAULT_PAGE_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_LIMIT) {
    throw failure('limit_invalid', `limit must be between 1 and ${MAX_PAGE_LIMIT}`);
  }
  return parsed;
}

function pageInput(rawLimit: unknown, rawCursor: unknown) {
  return { limit: pageLimit(rawLimit), cursor: decodePageCursor(rawCursor) };
}

function pageResponse<T extends Record<string, unknown>, U>(rows: T[], limit: number, serialize: (row: T) => U) {
  const hasMore = rows.length > limit;
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  return {
    data: selected.map(serialize),
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodePageCursor({ updated_at: String(last.updated_at), id: String(last.id) }) : null,
    },
  };
}

function encodePageCursor(cursor: { updated_at: string; id: string }) {
  return encodeOpaque(cursor);
}

function decodePageCursor(value: unknown): { updated_at: string; id: string } | null {
  if (value == null || value === '') return null;
  const parsed = decodeOpaque(value, 'cursor');
  if (typeof parsed.updated_at !== 'string' || !parsed.updated_at || parsed.updated_at.length > 64
    || typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 255) {
    throw failure('cursor_invalid', 'cursor is invalid');
  }
  return { updated_at: parsed.updated_at, id: parsed.id };
}

function conversationPageInput(rawLimit: unknown, rawCursor: unknown) {
  return { limit: pageLimit(rawLimit), cursor: decodeConversationCursor(rawCursor) };
}

function encodeConversationCursor(cursor: { rank: number; activity: string; id: string }) {
  return encodeOpaque(cursor);
}

function decodeConversationCursor(value: unknown): { rank: number; activity: string; id: string } | null {
  if (value == null || value === '') return null;
  const parsed = decodeOpaque(value, 'cursor');
  if (!Number.isInteger(parsed.rank) || Number(parsed.rank) < 0 || Number(parsed.rank) > 3
    || typeof parsed.activity !== 'string' || !parsed.activity || parsed.activity.length > 64
    || typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 255) {
    throw failure('cursor_invalid', 'cursor is invalid');
  }
  return { rank: Number(parsed.rank), activity: parsed.activity, id: parsed.id };
}

function transcriptCursor(value: unknown) {
  if (value == null || value === '') return null;
  const parsed = decodeOpaque(value, 'cursor');
  if (!Number.isSafeInteger(parsed.sequence) || Number(parsed.sequence) < 0) {
    throw failure('cursor_invalid', 'cursor is invalid');
  }
  return Number(parsed.sequence);
}

function encodeTranscriptCursor(sequence: number) {
  return encodeOpaque({ sequence });
}

function encodeOpaque(value: Record<string, unknown>) {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeOpaque(value: unknown, field: string) {
  const encoded = text(value, field, 1_024);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) throw failure(`${field}_invalid`, `${field} is invalid`);
  try {
    const padded = encoded.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw failure(`${field}_invalid`, `${field} is invalid`);
  }
}

function placeholdersFor(values: readonly unknown[]) {
  if (!values.length) throw failure('list_invalid', 'At least one item is required');
  return values.map(() => '?').join(', ');
}

function orderedRows(rows: Record<string, unknown>[], ids: string[]) {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return ids.flatMap((id) => byId.get(id) ? [byId.get(id) as Record<string, unknown>] : []);
}

export default operations;
