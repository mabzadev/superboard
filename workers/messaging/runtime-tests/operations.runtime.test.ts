import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const headers = {
  'X-OpenGrow-Internal-Token': 'runtime-test-internal-token',
  'X-OpenGrow-Agent-Id': 'operator-operations',
  'Content-Type': 'application/json',
};

describe('Messaging support operations in the Workers runtime', () => {
  it('persists companies, contacts, notes, participants, drafts, search, and notifications', async () => {
    const database = (env as unknown as { DB: D1Database }).DB;
    await database.prepare(`
      INSERT INTO conversations (id, project_id, external_user_id, client_conversation_id, subject)
      VALUES ('operations-conversation', 12, 'operations-contact', 'operations-client', 'Billing question')
    `).run();

    const companyResponse = await request('/internal/projects/12/companies', 'POST', {
      name: 'Example Company', domain: 'example.test', custom_attributes: { plan: 'pro' },
    });
    expect(companyResponse.status).toBe(201);
    const company = await companyResponse.json() as { data: { id: string } };

    const contactResponse = await request('/internal/projects/12/contacts', 'POST', {
      external_user_id: 'operations-contact', name: 'Ada Example', email: 'ada@example.test',
      company_id: company.data.id, custom_attributes: { language: 'en' },
    });
    expect(contactResponse.status).toBe(201);
    const contact = await contactResponse.json() as { data: { id: string } };

    const note = await request(`/internal/projects/12/contacts/${contact.data.id}/notes`, 'POST', { content: 'Prefers email follow-up.' });
    expect(note.status).toBe(201);
    const participant = await request('/internal/projects/12/conversations/operations-conversation/participants', 'POST', {
      participant_kind: 'agent', participant_id: 'agent-secondary',
    });
    expect(participant.status).toBe(201);
    const draft = await request('/internal/projects/12/conversations/operations-conversation/draft', 'PUT', {
      content: 'Draft reply', attachments: [],
    });
    expect(draft.status).toBe(200);
    const notification = await request('/internal/projects/12/notifications', 'POST', {
      agent_id: 'operator-operations', notification_type: 'conversation_assigned',
      title: 'Conversation assigned', body: 'A conversation needs a response.',
      conversation_id: 'operations-conversation', payload: { priority: 'high' },
    });
    expect(notification.status).toBe(201);

    const search = await SELF.fetch('https://messaging.internal/internal/projects/12/search?q=Billing', { headers });
    expect(search.status).toBe(200);
    await expect(search.json()).resolves.toMatchObject({
      data: { conversations: [{ id: 'operations-conversation' }] },
    });
    const contacts = await SELF.fetch('https://messaging.internal/internal/projects/12/contacts?q=Ada', { headers });
    await expect(contacts.json()).resolves.toMatchObject({
      data: [{ id: contact.data.id, company_name: 'Example Company', custom_attributes: { language: 'en' } }],
    });
  });

  it('keeps private agent notes out of public message history', async () => {
    const database = (env as unknown as { DB: D1Database }).DB;
    await database.prepare(`
      INSERT INTO conversations (id, project_id, external_user_id, client_conversation_id, subject)
      VALUES ('private-note-conversation', 11, 'private-note-contact', 'private-note-client', 'Private note')
    `).run();
    const response = await request('/internal/projects/11/conversations/private-note-conversation/messages', 'POST', {
      body: 'Internal context', private: true, client_message_id: 'private-note-1',
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: { visibility: 'private' } });

    const publicRows = await database.prepare(`
      SELECT id FROM messages WHERE conversation_id = ? AND visibility = 'public'
    `).bind('private-note-conversation').all();
    expect(publicRows.results).toEqual([]);
  });

  it('executes idempotent automations and explicit macros without financial actions', async () => {
    const database = (env as unknown as { DB: D1Database }).DB;
    await database.prepare(`
      INSERT INTO conversations (id, project_id, external_user_id, client_conversation_id, subject)
      VALUES ('workflow-conversation', 31, 'workflow-contact', 'workflow-client', 'Workflow')
    `).run();
    const automation = await request('/internal/projects/31/settings/entities', 'POST', {
      entity_type: 'automation_rule', name: 'Escalate agent messages',
      configuration: {
        event_name: 'message_created',
        conditions: [{ field: 'sender_kind', operator: 'equals', value: 'agent' }],
        actions: [{ type: 'set_priority', value: 'urgent' }, { type: 'add_label', value: 'automated' }],
      },
    });
    expect(automation.status).toBe(201);
    const macro = await request('/internal/projects/31/settings/entities', 'POST', {
      entity_type: 'macro', name: 'Pending review',
      configuration: { actions: [{ type: 'set_status', value: 'pending' }], visibility: 'project' },
    });
    const macroPayload = await macro.json() as { data: { id: string } };
    expect(macro.status).toBe(201);

    const message = await request('/internal/projects/31/conversations/workflow-conversation/messages', 'POST', {
      body: 'Agent response', client_message_id: 'workflow-message-1',
    });
    expect(message.status).toBe(201);
    await expect(database.prepare(`SELECT priority, labels_json FROM conversations WHERE id = 'workflow-conversation'`).first())
      .resolves.toMatchObject({ priority: 'urgent', labels_json: '["automated"]' });
    expect((await database.prepare(`SELECT COUNT(*) AS count FROM messaging_rule_executions WHERE conversation_id = 'workflow-conversation'`).first<{ count: number }>())?.count).toBe(1);

    const execute = await request(`/internal/projects/31/conversations/workflow-conversation/macros/${macroPayload.data.id}/execute`, 'POST', {});
    expect(execute.status).toBe(200);
    await expect(database.prepare(`SELECT status FROM conversations WHERE id = 'workflow-conversation'`).first())
      .resolves.toMatchObject({ status: 'pending' });
  });
});

function request(path: string, method: string, body: Record<string, unknown>) {
  return SELF.fetch(`https://messaging.internal${path}`, { method, headers, body: JSON.stringify(body) });
}
