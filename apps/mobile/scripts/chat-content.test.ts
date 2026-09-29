import assert from 'node:assert/strict';
import test from 'node:test';
import { attachmentPath, captionOf, fillTemplate, hasContent, renderTemplate, sendableTemplate, templateOf, type ChatAttachment, type ChatTemplate } from '../src/features/inbox/chat-content';

const photo: ChatAttachment = { id: 'a1', kind: 'image', mimeType: 'image/jpeg', fileName: 'kitchen.jpg', byteSize: 1200, status: 'stored', failureCode: null };

test('a chat file shows once, without the provider placeholder under it', () => {
  assert.equal(attachmentPath('c1', 'a1'), 'crm/conversations/c1/attachments/a1');
  assert.equal(captionOf({ bodyText: 'Image received', attachment: photo, metadata: { messageType: 'image' } }), null);
  assert.equal(captionOf({ bodyText: 'kitchen.jpg', attachment: photo }), null);
  assert.equal(captionOf({ bodyText: 'The wall by the window', attachment: photo }), 'The wall by the window');
  assert.equal(captionOf({ bodyText: 'Hello', metadata: null }), 'Hello');
  // A photo without text still shows; an empty message doesn't.
  assert.equal(hasContent({ bodyText: null, hiddenAt: null, attachment: photo }), true);
  assert.equal(hasContent({ bodyText: null, hiddenAt: null, metadata: {} }), false);
});

test('a message sent from a template names it', () => {
  assert.equal(templateOf({ metadata: { template: { code: 'quote_ready', language: 'en' } } }), 'quote_ready');
  assert.equal(templateOf({ metadata: { template: 'x' } }), null);
  assert.equal(templateOf({ metadata: null }), null);
});

test('a template fills from the chat and names what it lacks; only approved numbered ones are sent', () => {
  const template: ChatTemplate = { id: 't1', code: 'visit', locale: 'en', body: 'Hi {{1}}, see you at {{2}}.', positions: [1, 2], usable: true,
    variables: [{ position: 1, source: 'contact.first_name' }, { position: 2, source: 'meeting.time' }], approved: true, providerStatus: 'approved' };
  const filled = fillTemplate(template, { 'contact.first_name': 'Maya' });
  assert.deepEqual(filled, { parameters: ['Maya', ''], missing: [{ position: 2, source: 'meeting.time' }] });
  assert.equal(renderTemplate(template.body, filled.parameters), 'Hi Maya, see you at {{2}}.');
  assert.equal(renderTemplate(template.body, ['Maya', '5 pm']), 'Hi Maya, see you at 5 pm.');
  assert.equal(sendableTemplate(template), true);
  assert.equal(sendableTemplate({ ...template, providerStatus: 'pending' }), false);
  assert.equal(sendableTemplate({ ...template, usable: false }), false);
});
