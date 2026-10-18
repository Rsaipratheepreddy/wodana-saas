import { useLocalSearchParams } from 'expo-router';
import { ClientPaidScreen } from '../../../features/client/payments-screen';

export default function PaidRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ClientPaidScreen milestoneId={String(id)} />;
}
