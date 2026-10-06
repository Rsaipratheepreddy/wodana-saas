import { useLocalSearchParams } from 'expo-router';
import { ClientQuestionScreen } from '../../../features/client/messages-screens';

export default function QuestionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ClientQuestionScreen questionId={String(id)} />;
}
