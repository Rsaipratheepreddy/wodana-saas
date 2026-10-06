import { useLocalSearchParams } from 'expo-router';
import { ClientThreadScreen } from '../../../features/client/messages-screens';

export default function ThreadRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ClientThreadScreen requestId={String(id)} />;
}
