import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { errorMessage } from '../../core/api';
import { key, useT } from '../../core/i18n';
import type { LocalPhoto } from '../../core/media';
import { useOutbox } from '../../core/outbox';
import { SelectField, TextField } from '../../ui/fields';
import { Screen, Section } from '../../ui/layout';
import { PhotoGrid } from '../../ui/photos';
import { Button } from '../../ui/primitives';
import { useToast } from '../../ui/toast';
import { photoHandoff } from '../capture/handoff';
import { useMarkup } from '../capture/use-markup';
import type { ChangePayload } from './change-outbox';

type Reason = 'client_request' | 'site_condition' | 'design_change' | 'error';
const REASONS: Array<{ value: Reason; label: string }> = [
  { value: 'site_condition', label: key('Site condition') }, { value: 'client_request', label: key('Client request') },
  { value: 'design_change', label: key('Design change') }, { value: 'error', label: key('Error') },
];

/**
 * Raise a change from site (plan §6.20): photos first, then what changes and why. It lands on the project's changes
 * for the project manager and the QS to price, approve and send to the client. Works offline (the outbox sends it).
 */
export function NewChangeScreen() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const outbox = useOutbox();
  const markup = useMarkup();
  const { id: projectId } = useLocalSearchParams<{ id: string }>();
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState<Reason>('site_condition');
  const [description, setDescription] = useState('');
  const changeId = useRef(Crypto.randomUUID()).current;
  useEffect(() => { const handed = photoHandoff.take(); if (handed.length) setPhotos(handed); }, []);
  const send = async () => {
    const payload: ChangePayload = { projectId, photoIds: photos.map((photo) => photo.id), change: { id: changeId, title: title.trim(), reason, description: description.trim() } };
    try {
      await outbox.enqueue({ id: changeId, kind: 'project.change', title: t('Change · {title}', { title: title.trim() }), scope: `project:${projectId}`, payload },
        photos.map((photo) => ({ key: photo.id, uri: photo.uri, name: photo.name, type: photo.type })));
      toast.success(t('Change raised'));
      router.back();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  return <Screen back title={t('Raise a change')} keyboard
    footer={<Button label={t('Raise a change')} variant="primary" size="lg" full disabled={!title.trim()} onPress={send} />}>
    <Section flat title={t('Photos')}>
      <PhotoGrid photos={photos.map((photo) => ({ key: photo.id, uri: photo.uri }))} onAdd={(next) => setPhotos((list) => [...list, ...next].slice(0, 10))}
        onRemove={(key_) => setPhotos((list) => list.filter((photo) => photo.id !== key_))}
        onDraw={(item) => { const photo = photos.find((entry) => entry.id === item.key); if (photo) markup(photo, (drawn) => setPhotos((list) => list.map((entry) => (entry.id === photo.id ? drawn : entry)))); }} />
    </Section>
    <TextField label={t('What changes')} value={title} onChangeText={setTitle} maxLength={240} placeholder={t('e.g. Column found behind the kitchen wall')} />
    <SelectField label={t('Reason')} value={reason} onChange={(value) => setReason((value ?? 'site_condition') as Reason)} options={REASONS.map((option) => ({ value: option.value, label: t(option.label) }))} />
    <TextField label={t('Details')} value={description} onChangeText={setDescription} maxLength={4000} multiline placeholder={t('Optional')} />
  </Screen>;
}
